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

// Obtener todos los productos con información de categoría, inventario y descuentos
export const getProductos = async (req, res) => {
  try {
    const [productos] = await pool.query(`
            SELECT 
                p.id, 
                p.codigo, 
                p.nombre, 
                p.descripcion, 
                p.precio, 
                p.fecha_creacion,
                p.fecha_actualizacion,
                c.nombre AS categoria,
                c.id AS categoria_id
            FROM productos p
            LEFT JOIN categorias c ON p.categoria_id = c.id
            WHERE c.activo = 1 OR c.activo IS NULL
            ORDER BY p.fecha_creacion DESC
        `)

    // Obtener inventario para cada producto
    for (const producto of productos) {
      // Obtener información de inventario
      const [inventario] = await pool.query(
        `
                SELECT 
                    i.stock,
                    pv.id AS punto_venta_id,
                    pv.nombre AS punto_venta
                FROM inventario i
                JOIN puntos_venta pv ON i.punto_venta_id = pv.id
                WHERE i.producto_id = ?
            `,
        [producto.id],
      )

      // Obtener descuentos activos
      const [descuentos] = await pool.query(
        `
                SELECT 
                    id,
                    porcentaje,
                    fecha_inicio,
                    fecha_fin
                FROM descuentos
                WHERE producto_id = ? 
                AND activo = 1 
                AND fecha_inicio <= CURDATE() 
                AND fecha_fin >= CURDATE()
                ORDER BY fecha_creacion DESC
                LIMIT 1
            `,
        [producto.id],
      )

      // Asignar inventario y descuento al producto
      if (inventario.length > 0) {
        producto.stock = inventario[0].stock
        producto.punto_venta_id = inventario[0].punto_venta_id
        producto.punto_venta = inventario[0].punto_venta
      } else {
        producto.stock = 0
        producto.punto_venta_id = null
        producto.punto_venta = null
      }

      if (descuentos.length > 0) {
        producto.descuento = {
          id: descuentos[0].id,
          porcentaje: descuentos[0].porcentaje,
          fecha_inicio: descuentos[0].fecha_inicio,
          fecha_fin: descuentos[0].fecha_fin,
        }
      } else {
        producto.descuento = null
      }
    }

    res.json(productos)
  } catch (error) {
    console.error("Error al obtener productos:", error)
    res.status(500).json({ message: "Error al obtener productos" })
  }
}

// Obtener un producto por ID
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
                c.id AS categoria_id
            FROM productos p
            LEFT JOIN categorias c ON p.categoria_id = c.id
            WHERE p.id = ?
        `,
      [id],
    )

    if (productos.length === 0) {
      return res.status(404).json({ message: "Producto no encontrado" })
    }

    const producto = productos[0]

    // Obtener información de inventario
    const [inventario] = await pool.query(
      `
            SELECT 
                i.stock,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta
            FROM inventario i
            JOIN puntos_venta pv ON i.punto_venta_id = pv.id
            WHERE i.producto_id = ?
        `,
      [producto.id],
    )

    // Obtener descuentos activos
    const [descuentos] = await pool.query(
      `
            SELECT 
                id,
                porcentaje,
                fecha_inicio,
                fecha_fin
            FROM descuentos
            WHERE producto_id = ? 
            AND activo = 1 
            AND fecha_inicio <= CURDATE() 
            AND fecha_fin >= CURDATE()
            ORDER BY fecha_creacion DESC
            LIMIT 1
        `,
      [producto.id],
    )

    // Asignar inventario y descuento al producto
    if (inventario.length > 0) {
      producto.stock = inventario[0].stock
      producto.punto_venta_id = inventario[0].punto_venta_id
      producto.punto_venta = inventario[0].punto_venta
    } else {
      producto.stock = 0
      producto.punto_venta_id = null
      producto.punto_venta = null
    }

    if (descuentos.length > 0) {
      producto.descuento = {
        id: descuentos[0].id,
        porcentaje: descuentos[0].porcentaje,
        fecha_inicio: descuentos[0].fecha_inicio,
        fecha_fin: descuentos[0].fecha_fin,
      }
    } else {
      producto.descuento = null
    }

    res.json(producto)
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

// Buscar productos
export const searchProductos = async (req, res) => {
  try {
    const { query, categoria_id, punto_venta_id, min_precio, max_precio, min_stock, max_stock } = req.query

    let sql = `
            SELECT 
                p.id, 
                p.codigo, 
                p.nombre, 
                p.descripcion, 
                p.precio, 
                p.fecha_creacion,
                p.fecha_actualizacion,
                c.nombre AS categoria,
                c.id AS categoria_id
            FROM productos p
            LEFT JOIN categorias c ON p.categoria_id = c.id
            LEFT JOIN inventario i ON p.id = i.producto_id
            WHERE 1=1
        `

    const params = []

    // Filtrar por término de búsqueda
    if (query) {
      sql += ` AND (p.nombre LIKE ? OR p.codigo LIKE ? OR p.descripcion LIKE ?)`
      const searchTerm = `%${query}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }

    // Filtrar por categoría
    if (categoria_id) {
      sql += ` AND p.categoria_id = ?`
      params.push(categoria_id)
    }

    // Filtrar por punto de venta
    if (punto_venta_id) {
      sql += ` AND i.punto_venta_id = ?`
      params.push(punto_venta_id)
    }

    // Filtrar por rango de precio
    if (min_precio !== undefined) {
      sql += ` AND p.precio >= ?`
      params.push(min_precio)
    }

    if (max_precio !== undefined) {
      sql += ` AND p.precio <= ?`
      params.push(max_precio)
    }

    // Filtrar por rango de stock
    if (min_stock !== undefined) {
      sql += ` AND i.stock >= ?`
      params.push(min_stock)
    }

    if (max_stock !== undefined) {
      sql += ` AND i.stock <= ?`
      params.push(max_stock)
    }

    // Agrupar por producto para evitar duplicados
    sql += ` GROUP BY p.id ORDER BY p.nombre ASC`

    const [productos] = await pool.query(sql, params)

    // Obtener inventario y descuentos para cada producto
    for (const producto of productos) {
      // Obtener información de inventario
      const [inventario] = await pool.query(
        `
                SELECT 
                    i.stock,
                    pv.id AS punto_venta_id,
                    pv.nombre AS punto_venta
                FROM inventario i
                JOIN puntos_venta pv ON i.punto_venta_id = pv.id
                WHERE i.producto_id = ?
            `,
        [producto.id],
      )

      // Obtener descuentos activos
      const [descuentos] = await pool.query(
        `
                SELECT 
                    id,
                    porcentaje,
                    fecha_inicio,
                    fecha_fin
                FROM descuentos
                WHERE producto_id = ? 
                AND activo = 1 
                AND fecha_inicio <= CURDATE() 
                AND fecha_fin >= CURDATE()
                ORDER BY fecha_creacion DESC
                LIMIT 1
            `,
        [producto.id],
      )

      // Asignar inventario y descuento al producto
      if (inventario.length > 0) {
        producto.stock = inventario[0].stock
        producto.punto_venta_id = inventario[0].punto_venta_id
        producto.punto_venta = inventario[0].punto_venta
      } else {
        producto.stock = 0
        producto.punto_venta_id = null
        producto.punto_venta = null
      }

      if (descuentos.length > 0) {
        producto.descuento = {
          id: descuentos[0].id,
          porcentaje: descuentos[0].porcentaje,
          fecha_inicio: descuentos[0].fecha_inicio,
          fecha_fin: descuentos[0].fecha_fin,
        }
      } else {
        producto.descuento = null
      }
    }

    res.json(productos)
  } catch (error) {
    console.error("Error al buscar productos:", error)
    res.status(500).json({ message: "Error al buscar productos" })
  }
}
