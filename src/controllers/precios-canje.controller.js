import pool from "../db.js"
import { validationResult } from "express-validator"

// Obtener todos los precios de canjes
export const getPreciosCanjes = async (req, res) => {
  try {
    const [preciosCanjes] = await pool.query(`
      SELECT 
        id, 
        nombre, 
        precioNormal, 
        precioCellfie,
        fecha_creacion
      FROM precios_canjes
      ORDER BY nombre ASC
    `)

    res.json(preciosCanjes)
  } catch (error) {
    console.error("Error al obtener precios de canjes:", error)
    res.status(500).json({ message: "Error al obtener precios de canjes" })
  }
}

// Crear un nuevo precio de canje
export const createPrecioCanje = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { nombre, precioNormal, precioCellfie } = req.body

  try {
    const [result] = await pool.query(
      `INSERT INTO precios_canjes (nombre, precioNormal, precioCellfie) 
       VALUES (?, ?, ?)`,
      [nombre, precioNormal, precioCellfie],
    )

    const [nuevoPrecio] = await pool.query(`SELECT * FROM precios_canjes WHERE id = ?`, [result.insertId])

    res.status(201).json(nuevoPrecio[0])
  } catch (error) {
    console.error("Error al crear precio de canje:", error)
    res.status(500).json({ message: "Error al crear precio de canje" })
  }
}

// Eliminar un precio de canje
export const deletePrecioCanje = async (req, res) => {
  const { id } = req.params

  try {
    const [result] = await pool.query(`DELETE FROM precios_canjes WHERE id = ?`, [id])

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Precio de canje no encontrado" })
    }

    res.json({ message: "Precio de canje eliminado correctamente", id })
  } catch (error) {
    console.error("Error al eliminar precio de canje:", error)
    res.status(500).json({ message: "Error al eliminar precio de canje" })
  }
}
