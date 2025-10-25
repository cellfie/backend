import pool from "../../db.js"
import { validationResult } from "express-validator"

// Obtener todos los repuestos con información de inventario
export const getRepuestos = async (req, res) => {
  try {
    const [repuestos] = await pool.query(`
            SELECT 
                r.id, 
                r.nombre,
                r.descripcion,
                r.precio
            FROM repuestos r
            ORDER BY r.fecha_creacion DESC
        `)

    // Obtener inventario para cada repuesto
    for (const repuesto of repuestos) {
      // Obtener información de inventario
      const [inventario] = await pool.query(
        `
                SELECT 
                    i.stock,
                    pv.id AS punto_venta_id,
                    pv.nombre AS punto_venta
                FROM inventario_repuestos i
                JOIN puntos_venta pv ON i.punto_venta_id = pv.id
                WHERE i.repuesto_id = ?
            `,
        [repuesto.id],
      )

      // Asignar inventario al repuesto
      if (inventario.length > 0) {
        repuesto.stock = inventario[0].stock
        repuesto.punto_venta_id = inventario[0].punto_venta_id
        repuesto.punto_venta = inventario[0].punto_venta
      } else {
        repuesto.stock = 0
        repuesto.punto_venta_id = null
        repuesto.punto_venta = null
      }
    }

    res.json(repuestos)
  } catch (error) {
    console.error("Error al obtener repuestos:", error)
    res.status(500).json({ message: "Error al obtener repuestos" })
  }
}

// Obtener un repuesto por ID
export const getRepuestoById = async (req, res) => {
  try {
    const { id } = req.params

    const [repuestos] = await pool.query(
      `
            SELECT 
                r.id, 
                r.nombre,
                r.descripcion,
                r.precio
            FROM repuestos r
            WHERE r.id = ?
        `,
      [id],
    )

    if (repuestos.length === 0) {
      return res.status(404).json({ message: "Repuesto no encontrado" })
    }

    const repuesto = repuestos[0]

    // Obtener información de inventario
    const [inventario] = await pool.query(
      `
            SELECT 
                i.stock,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta
            FROM inventario_repuestos i
            JOIN puntos_venta pv ON i.punto_venta_id = pv.id
            WHERE i.repuesto_id = ?
        `,
      [repuesto.id],
    )

    // Asignar inventario al repuesto
    if (inventario.length > 0) {
      repuesto.stock = inventario[0].stock
      repuesto.punto_venta_id = inventario[0].punto_venta_id
      repuesto.punto_venta = inventario[0].punto_venta
    } else {
      repuesto.stock = 0
      repuesto.punto_venta_id = null
      repuesto.punto_venta = null
    }

    res.json(repuesto)
  } catch (error) {
    console.error("Error al obtener repuesto:", error)
    res.status(500).json({ message: "Error al obtener repuesto" })
  }
}

// Crear un nuevo repuesto
export const createRepuesto = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { nombre, descripcion, precio, punto_venta_id, stock } = req.body

  // Validaciones manuales adicionales
  if (!nombre || nombre.trim() === "") {
    return res.status(400).json({ message: "El nombre es obligatorio" })
  }

  if (!punto_venta_id) {
    return res.status(400).json({ message: "El punto de venta es obligatorio" })
  }

  if (stock !== undefined && (isNaN(stock) || stock < 0)) {
    return res.status(400).json({ message: "El stock debe ser un número no negativo" })
  }

  let precioFinal = 0
  if (precio !== undefined && precio !== null && precio !== "") {
    precioFinal = Number(precio)
    if (isNaN(precioFinal) || precioFinal < 0) {
      return res.status(400).json({ message: "El precio debe ser un número no negativo" })
    }
  }

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    const [existingRepuestos] = await connection.query(
      `SELECT r.id, r.nombre, pv.nombre as punto_venta_nombre
       FROM repuestos r
       INNER JOIN inventario_repuestos i ON r.id = i.repuesto_id
       INNER JOIN puntos_venta pv ON i.punto_venta_id = pv.id
       WHERE LOWER(TRIM(r.nombre)) = LOWER(TRIM(?)) AND i.punto_venta_id = ?`,
      [nombre, punto_venta_id],
    )

    if (existingRepuestos.length > 0) {
      await connection.rollback()
      return res.status(400).json({
        message: `Ya existe un repuesto con el nombre "${nombre}" en el punto de venta ${existingRepuestos[0].punto_venta_nombre}`,
      })
    }

    // Insertar el repuesto (modelo simplificado)
    const [result] = await connection.query("INSERT INTO repuestos (nombre, descripcion, precio) VALUES (?, ?, ?)", [
      nombre,
      descripcion || null,
      precioFinal,
    ])

    const repuestoId = result.insertId

    // Si se proporciona punto_venta_id y stock, actualizar el inventario
    if (punto_venta_id && stock !== undefined) {
      // Verificar si el punto de venta existe
      const [puntosVenta] = await connection.query("SELECT id FROM puntos_venta WHERE id = ?", [punto_venta_id])

      if (puntosVenta.length === 0) {
        await connection.rollback()
        return res.status(400).json({ message: "El punto de venta especificado no existe" })
      }

      await connection.query("INSERT INTO inventario_repuestos (repuesto_id, punto_venta_id, stock) VALUES (?, ?, ?)", [
        repuestoId,
        punto_venta_id,
        stock,
      ])
    }

    await connection.commit()

    res.status(201).json({
      id: repuestoId,
      message: "Repuesto creado exitosamente",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear repuesto:", error)

    res.status(500).json({ message: "Error al crear repuesto" })
  } finally {
    connection.release()
  }
}

// Actualizar un repuesto
export const updateRepuesto = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { id } = req.params
  const { nombre, descripcion, precio, punto_venta_id, stock } = req.body

  // Validaciones manuales adicionales
  if (!nombre || nombre.trim() === "") {
    return res.status(400).json({ message: "El nombre es obligatorio" })
  }

  let precioFinal = 0
  if (precio !== undefined && precio !== null && precio !== "") {
    precioFinal = Number(precio)
    if (isNaN(precioFinal) || precioFinal < 0) {
      return res.status(400).json({ message: "El precio debe ser un número no negativo" })
    }
  }

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Verificar si el repuesto existe
    const [repuestos] = await connection.query("SELECT * FROM repuestos WHERE id = ?", [id])
    if (repuestos.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Repuesto no encontrado" })
    }

    // Actualizar el repuesto (modelo simplificado)
    await connection.query("UPDATE repuestos SET nombre = ?, descripcion = ?, precio = ? WHERE id = ?", [
      nombre,
      descripcion || null,
      precioFinal,
      id,
    ])

    // Si se proporciona punto_venta_id y stock, actualizar el inventario
    if (punto_venta_id && stock !== undefined) {
      // Verificar si el punto de venta existe
      const [puntosVenta] = await connection.query("SELECT id FROM puntos_venta WHERE id = ?", [punto_venta_id])

      if (puntosVenta.length === 0) {
        await connection.rollback()
        return res.status(400).json({ message: "El punto de venta especificado no existe" })
      }

      // Verificar si ya existe un registro de inventario para este repuesto y punto de venta
      const [inventario] = await connection.query(
        "SELECT * FROM inventario_repuestos WHERE repuesto_id = ? AND punto_venta_id = ?",
        [id, punto_venta_id],
      )

      if (inventario.length > 0) {
        // Actualizar el inventario existente
        await connection.query(
          "UPDATE inventario_repuestos SET stock = ? WHERE repuesto_id = ? AND punto_venta_id = ?",
          [stock, id, punto_venta_id],
        )
      } else {
        // Crear un nuevo registro de inventario
        await connection.query(
          "INSERT INTO inventario_repuestos (repuesto_id, punto_venta_id, stock) VALUES (?, ?, ?)",
          [id, punto_venta_id, stock],
        )
      }
    }

    await connection.commit()

    res.json({ message: "Repuesto actualizado exitosamente" })
  } catch (error) {
    await connection.rollback()
    console.error("Error al actualizar repuesto:", error)
    res.status(500).json({ message: "Error al actualizar repuesto" })
  } finally {
    connection.release()
  }
}

// Eliminar un repuesto
export const deleteRepuesto = async (req, res) => {
  const { id } = req.params

  try {
    // Eliminar el repuesto (las restricciones de clave foránea se encargarán de eliminar los registros relacionados)
    const [result] = await pool.query("DELETE FROM repuestos WHERE id = ?", [id])

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Repuesto no encontrado" })
    }

    res.json({ message: "Repuesto eliminado exitosamente" })
  } catch (error) {
    console.error("Error al eliminar repuesto:", error)
    res.status(500).json({ message: "Error al eliminar repuesto" })
  }
}

// Buscar repuestos
export const searchRepuestos = async (req, res) => {
  try {
    const { query, punto_venta_id, min_stock, max_stock } = req.query

    let sql = `
            SELECT 
                r.id, 
                r.nombre,
                r.descripcion,
                r.precio
            FROM repuestos r
            LEFT JOIN inventario_repuestos i ON r.id = i.repuesto_id
            WHERE 1=1
        `

    const params = []

    // Filtrar por término de búsqueda
    if (query) {
      sql += ` AND (r.nombre LIKE ? OR r.descripcion LIKE ?)`
      const searchTerm = `%${query}%`
      params.push(searchTerm, searchTerm)
    }

    // Filtrar por punto de venta
    if (punto_venta_id) {
      sql += ` AND i.punto_venta_id = ?`
      params.push(punto_venta_id)
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

    // Agrupar por repuesto para evitar duplicados
    sql += ` GROUP BY r.id ORDER BY r.nombre ASC`

    const [repuestos] = await pool.query(sql, params)

    // Obtener inventario para cada repuesto
    for (const repuesto of repuestos) {
      // Obtener información de inventario
      const [inventario] = await pool.query(
        `
                SELECT 
                    i.stock,
                    pv.id AS punto_venta_id,
                    pv.nombre AS punto_venta
                FROM inventario_repuestos i
                JOIN puntos_venta pv ON i.punto_venta_id = pv.id
                WHERE i.repuesto_id = ?
            `,
        [repuesto.id],
      )

      // Asignar inventario al repuesto
      if (inventario.length > 0) {
        repuesto.stock = inventario[0].stock
        repuesto.punto_venta_id = inventario[0].punto_venta_id
        repuesto.punto_venta = inventario[0].punto_venta
      } else {
        repuesto.stock = 0
        repuesto.punto_venta_id = null
        repuesto.punto_venta = null
      }
    }

    res.json(repuestos)
  } catch (error) {
    console.error("Error al buscar repuestos:", error)
    res.status(500).json({ message: "Error al buscar repuestos" })
  }
}
