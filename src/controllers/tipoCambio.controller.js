import pool from "../db.js"

export const getTipoCambio = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, valor, fecha FROM tipo_cambio WHERE activo = TRUE ORDER BY id DESC LIMIT 1",
    )

    if (rows.length === 0) {
      return res.json({ valor: 0 })
    }

    res.json({
      id: rows[0].id,
      valor: rows[0].valor,
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

    // Iniciar una transacción
    const connection = await pool.getConnection()
    await connection.beginTransaction()

    try {
      // Obtener el tipo de cambio actual
      const [currentRate] = await connection.query(
        "SELECT id, valor FROM tipo_cambio WHERE activo = TRUE ORDER BY id DESC LIMIT 1",
      )

      let tipoCambioId

      if (currentRate.length > 0) {
        // Si existe un registro activo, actualizarlo
        tipoCambioId = currentRate[0].id

        // Actualizar el registro existente
        await connection.query(
          "UPDATE tipo_cambio SET valor = ?, usuario_id = ?, fecha = CONVERT_TZ(NOW(), '+00:00', '-03:00'), notas = ? WHERE id = ?",
          [numericValue, usuario_id || null, notas || null, tipoCambioId],
        )
      } else {
        // Si no existe un registro activo, crear uno nuevo
        const [insertResult] = await connection.query(
          "INSERT INTO tipo_cambio (valor, usuario_id, notas, activo, fecha) VALUES (?, ?, ?, TRUE, CONVERT_TZ(NOW(), '+00:00', '-03:00'))",
          [numericValue, usuario_id || null, notas || null],
        )

        tipoCambioId = insertResult.insertId
      }

      // Actualizar el tipo de cambio en todos los equipos no vendidos
      await connection.query("UPDATE equipos SET tipo_cambio = ? WHERE vendido = 0", [numericValue])

      // Confirmar la transacción
      await connection.commit()

      res.json({
        message: "Tipo de cambio actualizado correctamente",
        id: tipoCambioId,
        valor: numericValue,
        fecha: new Date(),
      })
    } catch (error) {
      // Si hay un error, revertir la transacción
      await connection.rollback()
      throw error
    } finally {
      // Liberar la conexión
      connection.release()
    }
  } catch (error) {
    console.error("Error al actualizar tipo de cambio:", error)
    res.status(500).json({ message: "Error al actualizar tipo de cambio", error: error.message })
  }
}
