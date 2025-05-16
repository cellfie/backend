import pool from "../../db.js"
import { validationResult } from "express-validator"

// Obtener todo el inventario de repuestos
export const getInventarioRepuestos = async (req, res) => {
  try {
    const [inventario] = await pool.query(`
            SELECT 
                i.repuesto_id,
                i.punto_venta_id,
                i.stock,
                r.codigo,
                r.nombre AS repuesto_nombre,
                r.marca,
                r.modelo,
                pv.nombre AS punto_venta_nombre
            FROM inventario_repuestos i
            JOIN repuestos r ON i.repuesto_id = r.id
            JOIN puntos_venta pv ON i.punto_venta_id = pv.id
            ORDER BY r.nombre ASC
        `)

    res.json(inventario)
  } catch (error) {
    console.error("Error al obtener inventario de repuestos:", error)
    res.status(500).json({ message: "Error al obtener inventario de repuestos" })
  }
}

// Obtener inventario por repuesto
export const getInventarioByRepuesto = async (req, res) => {
  try {
    const { id } = req.params

    // Verificar si el repuesto existe
    const [repuestos] = await pool.query("SELECT * FROM repuestos WHERE id = ?", [id])

    if (repuestos.length === 0) {
      return res.status(404).json({ message: "Repuesto no encontrado" })
    }

    // Obtener el inventario del repuesto
    const [inventario] = await pool.query(
      `
            SELECT 
                i.punto_venta_id,
                i.stock,
                pv.nombre AS punto_venta_nombre
            FROM inventario_repuestos i
            JOIN puntos_venta pv ON i.punto_venta_id = pv.id
            WHERE i.repuesto_id = ?
        `,
      [id],
    )

    res.json(inventario)
  } catch (error) {
    console.error("Error al obtener inventario por repuesto:", error)
    res.status(500).json({ message: "Error al obtener inventario por repuesto" })
  }
}

// Actualizar inventario de repuesto
export const updateInventarioRepuesto = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { repuesto_id, punto_venta_id, stock } = req.body

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
        stock,
        repuesto_id,
        punto_venta_id,
      ])
    } else {
      // Crear un nuevo registro de inventario
      await pool.query("INSERT INTO inventario_repuestos (repuesto_id, punto_venta_id, stock) VALUES (?, ?, ?)", [
        repuesto_id,
        punto_venta_id,
        stock,
      ])
    }

    res.json({ message: "Inventario de repuesto actualizado exitosamente" })
  } catch (error) {
    console.error("Error al actualizar inventario de repuesto:", error)
    res.status(500).json({ message: "Error al actualizar inventario de repuesto" })
  }
}
