import pool from "../db.js"

export const getTipoCambio = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, valor, fecha FROM tipo_cambio WHERE activo = TRUE ORDER BY id DESC LIMIT 1",
    )

    if (rows.length === 0) {
      // Si no hay registro, crear uno por defecto
      const [insertResult] = await pool.query(
        "INSERT INTO tipo_cambio (valor, activo, fecha) VALUES (1000.00, TRUE, NOW())",
      )

      return res.json({
        id: insertResult.insertId,
        valor: 1000.0,
        fecha: new Date(),
      })
    }

    res.json({
      id: rows[0].id,
      valor: Number.parseFloat(rows[0].valor),
      fecha: rows[0].fecha,
    })
  } catch (error) {
    console.error("Error al obtener tipo de cambio:", error)
    res.status(500).json({ message: "Error al obtener tipo de cambio" })
  }
}

export const setTipoCambio = async (req, res) => {
  const { valor, notas } = req.body
  const usuario_id = req.usuario?.id

  try {
    // Validar que el valor sea un número válido
    const numericValue = Number.parseFloat(valor)
    if (isNaN(numericValue) || numericValue <= 0) {
      return res.status(400).json({ message: "El valor debe ser un número mayor a cero" })
    }

    // Redondear a 2 decimales
    const roundedValue = Math.round(numericValue * 100) / 100

    // Obtener conexión y usar transacción simple
    const connection = await pool.getConnection()

    try {
      await connection.beginTransaction()

      // Buscar el registro activo actual
      const [currentRows] = await connection.query("SELECT id FROM tipo_cambio WHERE activo = TRUE LIMIT 1")

      if (currentRows.length > 0) {
        // Actualizar el registro existente
        await connection.query(
          `UPDATE tipo_cambio 
           SET valor = ?, 
               usuario_id = ?, 
               fecha = NOW(), 
               notas = ? 
           WHERE id = ?`,
          [roundedValue, usuario_id || null, notas || null, currentRows[0].id],
        )
      } else {
        // Crear nuevo registro si no existe ninguno activo
        await connection.query(
          `INSERT INTO tipo_cambio (valor, usuario_id, notas, activo, fecha) 
           VALUES (?, ?, ?, TRUE, NOW())`,
          [roundedValue, usuario_id || null, notas || null],
        )
      }

      // Actualizar equipos no vendidos
      await connection.query("UPDATE equipos SET tipo_cambio = ? WHERE vendido = 0", [roundedValue])

      await connection.commit()

      res.json({
        success: true,
        message: "Tipo de cambio actualizado correctamente",
        valor: roundedValue,
        fecha: new Date(),
      })
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  } catch (error) {
    console.error("Error al actualizar tipo de cambio:", error)
    res.status(500).json({
      success: false,
      message: "Error al actualizar tipo de cambio",
      error: error.message,
    })
  }
}
