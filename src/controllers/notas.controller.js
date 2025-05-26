import pool from "../db.js"
import { validationResult } from "express-validator"

// Obtener todas las notas
export const getNotas = async (req, res) => {
  try {
    const { completadas } = req.query
    const usuario_id = req.usuario.id

    let sql = `
SELECT 
  n.id, 
  n.texto, 
  n.completada, 
  n.fecha_creacion,
  n.fecha_completada,
  n.punto_venta_id,
  pv.nombre AS punto_venta_nombre,
  u.nombre AS usuario_nombre
FROM notas n
LEFT JOIN puntos_venta pv ON n.punto_venta_id = pv.id
LEFT JOIN usuarios u ON n.usuario_id = u.id
WHERE n.usuario_id = ?
`

    const params = [usuario_id]

    // Filtrar por completadas/pendientes si se especifica
    if (completadas !== undefined) {
      sql += " AND n.completada = ?"
      params.push(completadas === "true" ? 1 : 0)
    }

    // Ordenar por fecha de creación (más recientes primero)
    sql += " ORDER BY n.fecha_creacion DESC"

    const [notas] = await pool.query(sql, params)

    res.json(notas)
  } catch (error) {
    console.error("Error al obtener notas:", error)
    res.status(500).json({ message: "Error al obtener notas" })
  }
}

// Crear una nueva nota
export const createNota = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { texto, punto_venta_id } = req.body
  const usuario_id = req.usuario.id

  try {
    const [result] = await pool.query("INSERT INTO notas (texto, usuario_id, punto_venta_id) VALUES (?, ?, ?)", [
      texto,
      usuario_id,
      punto_venta_id || null,
    ])

    // Obtener la nota recién creada
    const [notas] = await pool.query(
      `SELECT 
    n.id, 
    n.texto, 
    n.completada, 
    n.fecha_creacion,
    n.fecha_completada,
    n.punto_venta_id,
    pv.nombre AS punto_venta_nombre,
    u.nombre AS usuario_nombre
  FROM notas n
  LEFT JOIN puntos_venta pv ON n.punto_venta_id = pv.id
  LEFT JOIN usuarios u ON n.usuario_id = u.id
  WHERE n.id = ?`,
      [result.insertId],
    )

    res.status(201).json({
      message: "Nota creada exitosamente",
      nota: notas[0],
    })
  } catch (error) {
    console.error("Error al crear nota:", error)
    res.status(500).json({ message: "Error al crear nota" })
  }
}

// Actualizar una nota
export const updateNota = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { id } = req.params
  const { texto, completada } = req.body
  const usuario_id = req.usuario.id

  try {
    // Verificar que la nota exista y pertenezca al usuario
    const [notas] = await pool.query("SELECT * FROM notas WHERE id = ? AND usuario_id = ?", [id, usuario_id])

    if (notas.length === 0) {
      return res.status(404).json({ message: "Nota no encontrada" })
    }

    const updateFields = []
    const updateParams = []

    if (texto !== undefined) {
      updateFields.push("texto = ?")
      updateParams.push(texto)
    }

    if (completada !== undefined) {
      updateFields.push("completada = ?")
      updateParams.push(completada ? 1 : 0)

      // Si se está marcando como completada, actualizar la fecha de completada
      if (completada) {
        updateFields.push("fecha_completada = NOW()")
      } else {
        updateFields.push("fecha_completada = NULL")
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: "No se proporcionaron campos para actualizar" })
    }

    // Añadir el ID a los parámetros
    updateParams.push(id)

    await pool.query(`UPDATE notas SET ${updateFields.join(", ")} WHERE id = ?`, updateParams)

    // Obtener la nota actualizada
    const [notasActualizadas] = await pool.query(
      `SELECT 
    n.id, 
    n.texto, 
    n.completada, 
    n.fecha_creacion, 
    n.fecha_completada,
    n.punto_venta_id,
    pv.nombre AS punto_venta_nombre,
    u.nombre AS usuario_nombre
  FROM notas n
  LEFT JOIN puntos_venta pv ON n.punto_venta_id = pv.id
  LEFT JOIN usuarios u ON n.usuario_id = u.id
  WHERE n.id = ?`,
      [id],
    )

    res.json({
      message: "Nota actualizada exitosamente",
      nota: notasActualizadas[0],
    })
  } catch (error) {
    console.error("Error al actualizar nota:", error)
    res.status(500).json({ message: "Error al actualizar nota" })
  }
}

// Eliminar una nota
export const deleteNota = async (req, res) => {
  const { id } = req.params
  const usuario_id = req.usuario.id

  try {
    // Verificar que la nota exista y pertenezca al usuario
    const [notas] = await pool.query("SELECT * FROM notas WHERE id = ? AND usuario_id = ?", [id, usuario_id])

    if (notas.length === 0) {
      return res.status(404).json({ message: "Nota no encontrada" })
    }

    await pool.query("DELETE FROM notas WHERE id = ?", [id])

    res.json({ message: "Nota eliminada exitosamente" })
  } catch (error) {
    console.error("Error al eliminar nota:", error)
    res.status(500).json({ message: "Error al eliminar nota" })
  }
}

// Marcar una nota como completada o pendiente
export const toggleNotaCompletada = async (req, res) => {
  const { id } = req.params
  const usuario_id = req.usuario.id

  try {
    // Verificar que la nota exista y pertenezca al usuario
    const [notas] = await pool.query("SELECT * FROM notas WHERE id = ? AND usuario_id = ?", [id, usuario_id])

    if (notas.length === 0) {
      return res.status(404).json({ message: "Nota no encontrada" })
    }

    const nota = notas[0]
    const nuevoEstado = nota.completada === 0 ? 1 : 0
    const fechaCompletada = nuevoEstado === 1 ? "NOW()" : "NULL"

    await pool.query(`UPDATE notas SET completada = ?, fecha_completada = ${fechaCompletada} WHERE id = ?`, [
      nuevoEstado,
      id,
    ])

    // Obtener la nota actualizada
    const [notasActualizadas] = await pool.query(
      `SELECT 
    n.id, 
    n.texto, 
    n.completada, 
    n.fecha_creacion,
    n.fecha_completada,
    n.punto_venta_id,
    pv.nombre AS punto_venta_nombre,
    u.nombre AS usuario_nombre
  FROM notas n
  LEFT JOIN puntos_venta pv ON n.punto_venta_id = pv.id
  LEFT JOIN usuarios u ON n.usuario_id = u.id
  WHERE n.id = ?`,
      [id],
    )

    res.json({
      message: `Nota marcada como ${nuevoEstado === 1 ? "completada" : "pendiente"} exitosamente`,
      nota: notasActualizadas[0],
    })
  } catch (error) {
    console.error("Error al actualizar estado de la nota:", error)
    res.status(500).json({ message: "Error al actualizar estado de la nota" })
  }
}
