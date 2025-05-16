import pool from "../db.js"

export const getTipoCambio = async (req, res) => {
  const [rows] = await pool.query("SELECT valor FROM tipo_cambio ORDER BY fecha DESC LIMIT 1")
  res.json({ valor: rows[0]?.valor ?? 0 })
}

export const setTipoCambio = async (req, res) => {
  const { valor } = req.body

  try {
    // Verificar si ya existe un registro
    const [existingRows] = await pool.query("SELECT id FROM tipo_cambio ORDER BY fecha DESC LIMIT 1")

    if (existingRows.length > 0) {
      // Actualizar el registro existente
      await pool.query("UPDATE tipo_cambio SET valor = ?, fecha = CURRENT_TIMESTAMP WHERE id = ?", [
        valor,
        existingRows[0].id,
      ])
    } else {
      // Crear un nuevo registro si no existe ninguno
      await pool.query("INSERT INTO tipo_cambio (valor) VALUES (?)", [valor])
    }

    // Actualizar el tipo de cambio en todos los equipos no vendidos
    // Pero mantener el tipo_cambio_original
    await pool.query("UPDATE equipos SET tipo_cambio = ? WHERE vendido = 0", [valor])

    res.json({ message: "Tipo de cambio actualizado", valor })
  } catch (error) {
    console.error("Error al actualizar tipo de cambio:", error)
    res.status(500).json({ message: "Error al actualizar tipo de cambio" })
  }
}
