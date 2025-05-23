import pool from "../../db.js"
import { validationResult } from "express-validator"

// Actualizar inventario de repuesto
export const actualizarInventario = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { repuesto_id, punto_venta_id, cantidad } = req.body

  try {
    // Verificar si el repuesto existe
    const [repuestos] = await pool.query("SELECT * FROM repuestos WHERE id = ?", [repuesto_id])

    if (repuestos.length === 0) {
      return res.status(404).json({ message: "Repuesto no encontrado" })
    }

    // Verificar si el punto de venta existe
    const [puntosVenta] = await pool.query("SELECT * FROM puntos_venta WHERE id = ?", [punto_venta_id])

    if (puntosVenta.length === 0) {
      return res.status(404).json({ message: "Punto de venta no encontrado" })
    }

    // Verificar si ya existe un registro de inventario para este repuesto y punto de venta
    const [inventario] = await pool.query(
      "SELECT * FROM inventario_repuestos WHERE repuesto_id = ? AND punto_venta_id = ?",
      [repuesto_id, punto_venta_id],
    )

    if (inventario.length > 0) {
      // Actualizar el inventario existente
      await pool.query("UPDATE inventario_repuestos SET stock = ? WHERE repuesto_id = ? AND punto_venta_id = ?", [
        cantidad,
        repuesto_id,
        punto_venta_id,
      ])
    } else {
      // Crear un nuevo registro de inventario
      await pool.query("INSERT INTO inventario_repuestos (repuesto_id, punto_venta_id, stock) VALUES (?, ?, ?)", [
        repuesto_id,
        punto_venta_id,
        cantidad,
      ])
    }

    // Registrar el movimiento en el historial
    await pool.query(
      `INSERT INTO historial_inventario (
        repuesto_id, 
        punto_venta_id, 
        tipo_movimiento, 
        cantidad, 
        stock_resultante, 
        usuario_id, 
        fecha, 
        referencia_tipo, 
        referencia_id, 
        notas
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
      [
        repuesto_id,
        punto_venta_id,
        "ajuste",
        cantidad,
        cantidad,
        req.user.id,
        "ajuste_manual",
        null,
        "Ajuste manual de inventario",
      ],
    )

    res.json({ message: "Inventario actualizado exitosamente" })
  } catch (error) {
    console.error("Error al actualizar inventario:", error)
    res.status(500).json({ message: "Error al actualizar inventario" })
  }
}

// Descontar repuestos del inventario
export const descontarRepuestos = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { repuestos, reparacion_id } = req.body

  if (!Array.isArray(repuestos) || repuestos.length === 0) {
    return res.status(400).json({ message: "Debe proporcionar al menos un repuesto" })
  }

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Procesar cada repuesto
    for (const repuesto of repuestos) {
      const { id, punto_venta_id, cantidad } = repuesto

      // Verificar si el repuesto existe
      const [repuestosResult] = await connection.query("SELECT * FROM repuestos WHERE id = ?", [id])

      if (repuestosResult.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: `Repuesto con ID ${id} no encontrado` })
      }

      // Verificar si hay suficiente stock
      const [inventarioResult] = await connection.query(
        "SELECT * FROM inventario_repuestos WHERE repuesto_id = ? AND punto_venta_id = ?",
        [id, punto_venta_id],
      )

      if (inventarioResult.length === 0) {
        await connection.rollback()
        return res.status(400).json({
          message: `No hay inventario para el repuesto ${repuestosResult[0].nombre} en el punto de venta seleccionado`,
        })
      }

      const stockActual = inventarioResult[0].stock

      if (stockActual < cantidad) {
        await connection.rollback()
        return res.status(400).json({
          message: `Stock insuficiente para el repuesto ${repuestosResult[0].nombre}. Disponible: ${stockActual}, Solicitado: ${cantidad}`,
        })
      }

      // Actualizar el inventario
      const nuevoStock = stockActual - cantidad
      await connection.query("UPDATE inventario_repuestos SET stock = ? WHERE repuesto_id = ? AND punto_venta_id = ?", [
        nuevoStock,
        id,
        punto_venta_id,
      ])

      // Registrar el movimiento en el historial
      await connection.query(
        `INSERT INTO historial_inventario (
          repuesto_id, 
          punto_venta_id, 
          tipo_movimiento, 
          cantidad, 
          stock_resultante, 
          usuario_id, 
          fecha, 
          referencia_tipo, 
          referencia_id, 
          notas
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [
          id,
          punto_venta_id,
          "salida",
          cantidad,
          nuevoStock,
          req.user.id,
          "reparacion",
          reparacion_id,
          `Repuesto utilizado en reparación #${reparacion_id}`,
        ],
      )

      // Registrar el repuesto utilizado en la reparación
      await connection.query(
        `INSERT INTO repuestos_utilizados (
          reparacion_id,
          repuesto_id,
          cantidad,
          fecha
        ) VALUES (?, ?, ?, NOW())`,
        [reparacion_id, id, cantidad],
      )
    }

    await connection.commit()
    res.json({ message: "Repuestos descontados exitosamente del inventario" })
  } catch (error) {
    await connection.rollback()
    console.error("Error al descontar repuestos:", error)
    res.status(500).json({ message: "Error al descontar repuestos del inventario" })
  } finally {
    connection.release()
  }
}

// Obtener historial de movimientos de inventario
export const getHistorialInventario = async (req, res) => {
  try {
    const { repuesto_id, punto_venta_id, fecha_inicio, fecha_fin } = req.query

    let query = `
      SELECT 
        hi.*,
        r.nombre AS repuesto_nombre,
        pv.nombre AS punto_venta_nombre,
        u.nombre AS usuario_nombre
      FROM historial_inventario hi
      JOIN repuestos r ON hi.repuesto_id = r.id
      JOIN puntos_venta pv ON hi.punto_venta_id = pv.id
      JOIN usuarios u ON hi.usuario_id = u.id
      WHERE 1=1
    `
    const queryParams = []

    // Aplicar filtros si se proporcionan
    if (repuesto_id) {
      query += " AND hi.repuesto_id = ?"
      queryParams.push(repuesto_id)
    }
    if (punto_venta_id) {
      query += " AND hi.punto_venta_id = ?"
      queryParams.push(punto_venta_id)
    }
    if (fecha_inicio) {
      query += " AND DATE(hi.fecha) >= ?"
      queryParams.push(fecha_inicio)
    }
    if (fecha_fin) {
      query += " AND DATE(hi.fecha) <= ?"
      queryParams.push(fecha_fin)
    }

    query += " ORDER BY hi.fecha DESC"

    const [historial] = await pool.query(query, queryParams)

    res.json(historial)
  } catch (error) {
    console.error("Error al obtener historial de inventario:", error)
    res.status(500).json({ message: "Error al obtener historial de inventario" })
  }
}
