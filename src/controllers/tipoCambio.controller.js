import pool from "../db.js"

export const getTipoCambio = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, valor, fecha FROM tipo_cambio WHERE activo = TRUE ORDER BY fecha DESC LIMIT 1"
    )
    
    if (rows.length === 0) {
      return res.json({ valor: 0 })
    }
    
    res.json({ 
      id: rows[0].id,
      valor: rows[0].valor,
      fecha: rows[0].fecha
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
        "SELECT id, valor FROM tipo_cambio WHERE activo = TRUE ORDER BY fecha DESC LIMIT 1"
      )
      
      const currentValue = currentRate.length > 0 ? parseFloat(currentRate[0].valor) : 0
      const currentId = currentRate.length > 0 ? currentRate[0].id : null

      // Verificar si el valor es el mismo que el actual
      if (Math.abs(currentValue - numericValue) < 0.001) {
        // Si el valor es el mismo, no hacemos nada y devolvemos éxito
        await connection.rollback()
        connection.release()
        return res.json({ 
          message: "El tipo de cambio ya tiene ese valor", 
          id: currentId,
          valor: currentValue,
          fecha: new Date(),
          noChange: true
        })
      }

      // Verificar si hay una actualización reciente (en los últimos 5 segundos)
      const [recentUpdates] = await connection.query(
        "SELECT COUNT(*) as count FROM tipo_cambio WHERE fecha > DATE_SUB(NOW(), INTERVAL 5 SECOND)"
      )
      
      if (recentUpdates[0].count > 0) {
        // Si hay actualizaciones recientes, rechazamos la solicitud
        await connection.rollback()
        connection.release()
        return res.status(429).json({ 
          message: "Demasiadas actualizaciones en poco tiempo. Por favor, espera unos segundos." 
        })
      }

      // Desactivar el tipo de cambio actual
      if (currentId) {
        await connection.query(
          "UPDATE tipo_cambio SET activo = FALSE WHERE id = ?", 
          [currentId]
        )
      }

      // Crear un nuevo registro con el nuevo valor
      const [insertResult] = await connection.query(
        "INSERT INTO tipo_cambio (valor, usuario_id, notas, activo) VALUES (?, ?, ?, TRUE)", 
        [numericValue, usuario_id || null, notas || null]
      )
      
      const newId = insertResult.insertId

      // Actualizar el tipo de cambio en todos los equipos no vendidos
      await connection.query(
        "UPDATE equipos SET tipo_cambio = ? WHERE vendido = 0", 
        [numericValue]
      )

      // Confirmar la transacción
      await connection.commit()

      res.json({ 
        message: "Tipo de cambio actualizado correctamente", 
        id: newId,
        valor: numericValue,
        fecha: new Date()
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