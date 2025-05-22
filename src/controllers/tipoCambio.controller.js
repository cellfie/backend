import pool from "../db.js"

export const getTipoCambio = async (req, res) => {
  const [rows] = await pool.query("SELECT valor FROM tipo_cambio ORDER BY fecha DESC LIMIT 1")
  res.json({ valor: rows[0]?.valor ?? 0 })
}

export const setTipoCambio = async (req, res) => {
  const { valor } = req.body

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
      // Crear un nuevo registro con el nuevo valor
      await connection.query("INSERT INTO tipo_cambio (valor) VALUES (?)", [numericValue])

      // Obtener el ID del nuevo registro
      const [newRecord] = await connection.query("SELECT id FROM tipo_cambio ORDER BY fecha DESC LIMIT 1")
      const newId = newRecord[0].id

      // Actualizar el tipo de cambio en todos los equipos no vendidos
      await connection.query("UPDATE equipos SET tipo_cambio = ? WHERE vendido = 0", [numericValue])

      // Eliminar todos los registros anteriores
      await connection.query("DELETE FROM tipo_cambio WHERE id != ?", [newId])

      // Confirmar la transacción
      await connection.commit()

      res.json({ message: "Tipo de cambio actualizado", valor: numericValue })
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
    res.status(500).json({ message: "Error al actualizar tipo de cambio" })
  }
}