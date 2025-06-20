import pool from "../../db.js"
import { validationResult } from "express-validator"
import { formatearFechaParaDB } from "../../utils/dateUtils.js"

// Función para asegurar que el precio sea un número
const ensurePriceIsNumber = (price) => {
  if (typeof price === "number") return price

  // Si es string, intentar convertirlo a número
  if (typeof price === "string") {
    // Eliminar posibles caracteres no numéricos excepto punto decimal
    const cleanPrice = price.replace(/[^\d.]/g, "")
    return Number.parseFloat(cleanPrice)
  }

  return 0 // Valor por defecto si no se puede convertir
}

// NUEVA FUNCIÓN: Obtener productos con paginación y optimización
export const getProductosPaginados = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search = "",
      categoria_id,
      punto_venta_id,
      min_precio,
      max_precio,
      min_stock,
      max_stock,
      sort_by = "fecha_creacion",
      sort_order = "DESC",
      fecha_inicio,
      fecha_fin,
    } = req.query

    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    // Construir la consulta base con JOINs optimizados
    let baseQuery = `
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id AND (c.activo = 1 OR c.activo IS NULL)
      LEFT JOIN inventario i ON p.id = i.producto_id
      LEFT JOIN puntos_venta pv ON i.punto_venta_id = pv.id
      LEFT JOIN (
        SELECT 
          producto_id,
          id,
          porcentaje,
          fecha_inicio,
          fecha_fin
        FROM descuentos d1
        WHERE d1.activo = 1 
        AND d1.fecha_inicio <= CURDATE() 
        AND d1.fecha_fin >= CURDATE()
        AND d1.id = (
          SELECT MAX(d2.id) 
          FROM descuentos d2 
          WHERE d2.producto_id = d1.producto_id 
          AND d2.activo = 1
          AND d2.fecha_inicio <= CURDATE() 
          AND d2.fecha_fin >= CURDATE()
        )
      ) desc_activo ON p.id = desc_activo.producto_id
      WHERE 1=1
    `

    const params = []

    // Aplicar filtros
    if (search) {
      baseQuery += ` AND (p.nombre LIKE ? OR p.codigo LIKE ? OR p.descripcion LIKE ?)`
      const searchTerm = `%${search}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }

    if (categoria_id) {
      baseQuery += ` AND p.categoria_id = ?`
      params.push(categoria_id)
    }

    if (punto_venta_id) {
      baseQuery += ` AND i.punto_venta_id = ?`
      params.push(punto_venta_id)
    }

    if (min_precio !== undefined) {
      baseQuery += ` AND p.precio >= ?`
      params.push(min_precio)
    }

    if (max_precio !== undefined) {
      baseQuery += ` AND p.precio <= ?`
      params.push(max_precio)
    }

    if (min_stock !== undefined) {
      baseQuery += ` AND COALESCE(i.stock, 0) >= ?`
      params.push(min_stock)
    }

    if (max_stock !== undefined) {
      baseQuery += ` AND COALESCE(i.stock, 0) <= ?`
      params.push(max_stock)
    }

    // Filtrar por rango de fechas
    if (fecha_inicio) {
      baseQuery += ` AND p.fecha_creacion >= ?`
      params.push(fecha_inicio)
    }

    if (fecha_fin) {
      baseQuery += ` AND p.fecha_creacion <= ?`
      params.push(fecha_fin)
    }

    // Contar total de registros
    const countQuery = `SELECT COUNT(DISTINCT p.id) as total ${baseQuery}`
    const [countResult] = await pool.query(countQuery, params)
    const total = countResult[0].total

    // Consulta principal con todos los datos necesarios
    const dataQuery = `
      SELECT DISTINCT
        p.id, 
        p.codigo, 
        p.nombre, 
        p.descripcion, 
        p.precio, 
        p.fecha_creacion,
        p.fecha_actualizacion,
        c.nombre AS categoria,
        c.id AS categoria_id,
        COALESCE(i.stock, 0) AS stock,
        pv.id AS punto_venta_id,
        pv.nombre AS punto_venta,
        desc_activo.id AS descuento_id,
        desc_activo.porcentaje AS descuento_porcentaje,
        desc_activo.fecha_inicio AS descuento_fecha_inicio,
        desc_activo.fecha_fin AS descuento_fecha_fin
      ${baseQuery}
      ORDER BY p.${sort_by} ${sort_order}
      LIMIT ? OFFSET ?
    `

    const [productos] = await pool.query(dataQuery, [...params, Number.parseInt(limit), offset])

    // Calcular metadatos de paginación
    const totalPages = Math.ceil(total / Number.parseInt(limit))
    const hasNextPage = Number.parseInt(page) < totalPages
    const hasPrevPage = Number.parseInt(page) > 1

    res.json({
      data: productos,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: Number.parseInt(limit),
        hasNextPage,
        hasPrevPage,
      },
    })
  } catch (error) {
    console.error("Error al obtener productos paginados:", error)
    res.status(500).json({ message: "Error al obtener productos" })
  }
}

// Obtener todos los productos (mantener para compatibilidad, pero optimizado)
export const getProductos = async (req, res) => {
  try {
    // Usar la función paginada con un límite alto para mantener compatibilidad
    req.query = { ...req.query, limit: 1000, page: 1 }
    const result = await getProductosPaginados(req, res)
    return result
  } catch (error) {
    console.error("Error al obtener productos:", error)
    res.status(500).json({ message: "Error al obtener productos" })
  }
}

// NUEVA FUNCIÓN: Búsqueda rápida para autocompletado
export const searchProductosRapido = async (req, res) => {
  try {
    const { q, limit = 10 } = req.query

    if (!q || q.length < 2) {
      return res.json([])
    }

    const [productos] = await pool.query(
      `
      SELECT 
        p.id,
        p.codigo,
        p.nombre,
        p.precio,
        COALESCE(i.stock, 0) AS stock
      FROM productos p
      LEFT JOIN inventario i ON p.id = i.producto_id
      WHERE (p.nombre LIKE ? OR p.codigo LIKE ?)
      ORDER BY p.nombre ASC
      LIMIT ?
    `,
      [`%${q}%`, `%${q}%`, Number.parseInt(limit)],
    )

    res.json(productos)
  } catch (error) {
    console.error("Error en búsqueda rápida:", error)
    res.status(500).json({ message: "Error en búsqueda rápida" })
  }
}

// Obtener un producto por ID (optimizado)
export const getProductoById = async (req, res) => {
  try {
    const { id } = req.params

    const [productos] = await pool.query(
      `
      SELECT 
        p.id, 
        p.codigo, 
        p.nombre, 
        p.descripcion, 
        p.precio, 
        p.fecha_creacion,
        p.fecha_actualizacion,
        c.nombre AS categoria,
        c.id AS categoria_id,
        COALESCE(i.stock, 0) AS stock,
        pv.id AS punto_venta_id,
        pv.nombre AS punto_venta,
        desc_activo.id AS descuento_id,
        desc_activo.porcentaje AS descuento_porcentaje,
        desc_activo.fecha_inicio AS descuento_fecha_inicio,
        desc_activo.fecha_fin AS descuento_fecha_fin
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      LEFT JOIN inventario i ON p.id = i.producto_id
      LEFT JOIN puntos_venta pv ON i.punto_venta_id = pv.id
      LEFT JOIN (
        SELECT 
          producto_id,
          id,
          porcentaje,
          fecha_inicio,
          fecha_fin
        FROM descuentos d1
        WHERE d1.activo = 1 
        AND d1.fecha_inicio <= CURDATE() 
        AND d1.fecha_fin >= CURDATE()
        AND d1.id = (
          SELECT MAX(d2.id) 
          FROM descuentos d2 
          WHERE d2.producto_id = d1.producto_id 
          AND d2.activo = 1
          AND d2.fecha_inicio <= CURDATE() 
          AND d2.fecha_fin >= CURDATE()
        )
      ) desc_activo ON p.id = desc_activo.producto_id
      WHERE p.id = ?
      `,
      [id],
    )

    if (productos.length === 0) {
      return res.status(404).json({ message: "Producto no encontrado" })
    }

    res.json(productos[0])
  } catch (error) {
    console.error("Error al obtener producto:", error)
    res.status(500).json({ message: "Error al obtener producto" })
  }
}

// Crear un nuevo producto
export const createProducto = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { codigo, nombre, descripcion, precio, categoria_id, punto_venta_id, stock } = req.body

  // Asegurar que el precio sea un número
  const precioNumerico = ensurePriceIsNumber(precio)

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Usar la función utilitaria para obtener la fecha actual en Argentina
    const fechaActual = formatearFechaParaDB()

    // Insertar el producto con fecha y hora correcta
    const [result] = await connection.query(
      "INSERT INTO productos (codigo, nombre, descripcion, precio, categoria_id, fecha_creacion, fecha_actualizacion) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [codigo, nombre, descripcion, precioNumerico, categoria_id || null, fechaActual, fechaActual],
    )

    const productoId = result.insertId

    // Si se proporciona punto_venta_id y stock, actualizar el inventario
    if (punto_venta_id && stock !== undefined) {
      await connection.query("INSERT INTO inventario (producto_id, punto_venta_id, stock) VALUES (?, ?, ?)", [
        productoId,
        punto_venta_id,
        stock,
      ])
    }

    await connection.commit()

    res.status(201).json({
      id: productoId,
      message: "Producto creado exitosamente",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear producto:", error)

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "El código del producto ya existe" })
    }

    res.status(500).json({ message: "Error al crear producto" })
  } finally {
    connection.release()
  }
}

// Actualizar un producto
export const updateProducto = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { id } = req.params
  const { codigo, nombre, descripcion, precio, categoria_id, punto_venta_id, stock } = req.body

  // Asegurar que el precio sea un número
  const precioNumerico = ensurePriceIsNumber(precio)

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Verificar si el producto existe y obtener su precio actual
    const [productos] = await connection.query("SELECT precio FROM productos WHERE id = ?", [id])
    if (productos.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Producto no encontrado" })
    }

    // Si el precio no cambió (es el mismo que el actual), usar el precio actual
    // Esto evita problemas de redondeo o formato
    const precioActual = productos[0].precio
    const precioFinal = precio === precioActual ? precioActual : precioNumerico

    // Usar la función utilitaria para obtener la fecha actual en Argentina
    const fechaActual = formatearFechaParaDB()

    // Actualizar el producto con fecha de actualización correcta
    await connection.query(
      "UPDATE productos SET codigo = ?, nombre = ?, descripcion = ?, precio = ?, categoria_id = ?, fecha_actualizacion = ? WHERE id = ?",
      [codigo, nombre, descripcion, precioFinal, categoria_id || null, fechaActual, id],
    )

    // Si se proporciona punto_venta_id y stock, actualizar el inventario
    if (punto_venta_id && stock !== undefined) {
      // Verificar si ya existe un registro de inventario para este producto y punto de venta
      const [inventario] = await connection.query(
        "SELECT * FROM inventario WHERE producto_id = ? AND punto_venta_id = ?",
        [id, punto_venta_id],
      )

      if (inventario.length > 0) {
        // Actualizar el inventario existente
        await connection.query("UPDATE inventario SET stock = ? WHERE producto_id = ? AND punto_venta_id = ?", [
          stock,
          id,
          punto_venta_id,
        ])
      } else {
        // Crear un nuevo registro de inventario
        await connection.query("INSERT INTO inventario (producto_id, punto_venta_id, stock) VALUES (?, ?, ?)", [
          id,
          punto_venta_id,
          stock,
        ])
      }
    }

    await connection.commit()

    res.json({ message: "Producto actualizado exitosamente" })
  } catch (error) {
    await connection.rollback()
    console.error("Error al actualizar producto:", error)

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "El código del producto ya existe" })
    }

    res.status(500).json({ message: "Error al actualizar producto" })
  } finally {
    connection.release()
  }
}

// Eliminar un producto
export const deleteProducto = async (req, res) => {
  const { id } = req.params

  try {
    // Eliminar el producto (las restricciones de clave foránea se encargarán de eliminar los registros relacionados)
    const [result] = await pool.query("DELETE FROM productos WHERE id = ?", [id])

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Producto no encontrado" })
    }

    res.json({ message: "Producto eliminado exitosamente" })
  } catch (error) {
    console.error("Error al eliminar producto:", error)
    res.status(500).json({ message: "Error al eliminar producto" })
  }
}

// Buscar productos (mantener para compatibilidad)
export const searchProductos = async (req, res) => {
  try {
    // Redirigir a la función paginada
    req.query = { ...req.query, page: 1, limit: 100 }
    return await getProductosPaginados(req, res)
  } catch (error) {
    console.error("Error al buscar productos:", error)
    res.status(500).json({ message: "Error al buscar productos" })
  }
}
