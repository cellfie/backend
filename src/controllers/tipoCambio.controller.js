import pool from "../db.js"

export const getTipoCambio = async (req, res) => {
  try {
    // Obtener el tipo de cambio activo
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
  const usuario_id = req.usuario?.id // Asumiendo que el middleware de autenticación agrega el usuario al request

  try {
    // Validar que el valor sea un número válido
    const numericValue = Number.parseFloat(valor)
    if (isNaN(numericValue) || numericValue <= 0) {
      return res.status(400).json({ message: "El valor debe ser un número mayor a cero" })
    }

    // Iniciar una transacción para asegurar que todas las operaciones se completen o ninguna
    const connection = await pool.getConnection()
    await connection.beginTransaction()

    try {
      // Obtener el tipo de cambio actual para el historial
      const [currentRate] = await connection.query(
        "SELECT id, valor FROM tipo_cambio WHERE activo = TRUE ORDER BY fecha DESC LIMIT 1"
      )
      
      const currentValue = currentRate.length > 0 ? currentRate[0].valor : 0
      const currentId = currentRate.length > 0 ? currentRate[0].id : null

      // Desactivar el tipo de cambio actual (en lugar de eliminarlo)
      if (currentId) {
        await connection.query(
          "UPDATE tipo_cambio SET activo = FALSE WHERE id = ?", 
          [currentId]
        )
      }

      // Crear un nuevo registro con el nuevo valor
      const [insertResult] = await connection.query(
        "INSERT INTO tipo_cambio (valor, usuario_id, notas) VALUES (?, ?, ?)", 
        [numericValue, usuario_id || null, notas || null]
      )
      
      const newId = insertResult.insertId

      // Registrar en el historial (si existe la tabla)
      try {
        await connection.query(
          "INSERT INTO historial_tipo_cambio (valor_anterior, valor_nuevo, usuario_id) VALUES (?, ?, ?)",
          [currentValue, numericValue, usuario_id || null]
        )
      } catch (historyError) {
        // Si la tabla no existe, simplemente continuamos
        console.log("Nota: La tabla historial_tipo_cambio no existe o hubo un error al insertar:", historyError)
      }

      // Actualizar el tipo de cambio en todos los equipos no vendidos
      // Esta operación podría ser costosa si hay muchos equipos
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

// Nueva función para obtener el historial de tipos de cambio
export const getHistorialTipoCambio = async (req, res) => {
  try {
    const { limit = 10, offset = 0 } = req.query
    
    const [rows] = await pool.query(
      `SELECT tc.id, tc.valor, tc.fecha, tc.notas, u.nombre as usuario_nombre
       FROM tipo_cambio tc
       LEFT JOIN usuarios u ON tc.usuario_id = u.id
       ORDER BY tc.fecha DESC
       LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)]
    )
    
    const [total] = await pool.query("SELECT COUNT(*) as total FROM tipo_cambio")
    
    res.json({
      data: rows,
      pagination: {
        total: total[0].total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    })
  } catch (error) {
    console.error("Error al obtener historial de tipo de cambio:", error)
    res.status(500).json({ message: "Error al obtener historial de tipo de cambio" })
  }
}