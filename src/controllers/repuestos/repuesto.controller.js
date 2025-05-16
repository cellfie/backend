import pool from "../../db.js"
import { validationResult } from "express-validator"

// Obtener todos los repuestos con información de inventario
export const getRepuestos = async (req, res) => {
  try {
    const [repuestos] = await pool.query(`
            SELECT 
                r.id, 
                r.codigo, 
                r.nombre,
                r.marca,
                r.modelo,
                r.descripcion
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
                r.codigo, 
                r.nombre,
                r.marca,
                r.modelo,
                r.descripcion
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

  const { codigo, nombre, marca, modelo, descripcion, punto_venta_id, stock } = req.body

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Insertar el repuesto
    const [result] = await connection.query(
      "INSERT INTO repuestos (codigo, nombre, marca, modelo, descripcion) VALUES (?, ?, ?, ?, ?)",
      [codigo, nombre, marca, modelo, descripcion || null],
    )

    const repuestoId = result.insertId

    // Si se proporciona punto_venta_id y stock, actualizar el inventario
    if (punto_venta_id && stock !== undefined) {
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

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "El código del repuesto ya existe" })
    }

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
  const { codigo, nombre, marca, modelo, descripcion, punto_venta_id, stock } = req.body

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Verificar si el repuesto existe
    const [repuestos] = await connection.query("SELECT * FROM repuestos WHERE id = ?", [id])
    if (repuestos.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Repuesto no encontrado" })
    }

    // Actualizar el repuesto
    await connection.query(
      "UPDATE repuestos SET codigo = ?, nombre = ?, marca = ?, modelo = ?, descripcion = ? WHERE id = ?",
      [codigo, nombre, marca, modelo, descripcion || null, id],
    )

    // Si se proporciona punto_venta_id y stock, actualizar el inventario
    if (punto_venta_id && stock !== undefined) {
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

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "El código del repuesto ya existe" })
    }

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
    const { query, marca, modelo, punto_venta_id, min_stock, max_stock } = req.query

    let sql = `
            SELECT 
                r.id, 
                r.codigo, 
                r.nombre,
                r.marca,
                r.modelo,
                r.descripcion
            FROM repuestos r
            LEFT JOIN inventario_repuestos i ON r.id = i.repuesto_id
            WHERE 1=1
        `

    const params = []

    // Filtrar por término de búsqueda
    if (query) {
      sql += ` AND (r.nombre LIKE ? OR r.codigo LIKE ? OR r.descripcion LIKE ? OR r.marca LIKE ? OR r.modelo LIKE ?)`
      const searchTerm = `%${query}%`
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm)
    }

    // Filtrar por marca
    if (marca) {
      sql += ` AND r.marca LIKE ?`
      params.push(`%${marca}%`)
    }

    // Filtrar por modelo
    if (modelo) {
      sql += ` AND r.modelo LIKE ?`
      params.push(`%${modelo}%`)
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
