// historial-acciones.controller.js
import pool from "../db.js"
import { formatearFechaParaDB } from "../utils/dateUtils.js"

// Registrar una acción en el historial
export const registrarAccion = async (reparacionId, tipoAccion, usuarioId, detalles = null, connection = null) => {
  try {
    const useConnection = connection || pool

    // Obtener información del usuario
    const [usuarios] = await useConnection.query("SELECT nombre FROM usuarios WHERE id = ?", [usuarioId])

    const usuarioNombre = usuarios.length > 0 ? usuarios[0].nombre : "Usuario desconocido"

    // Insertar la acción en el historial
    const [result] = await useConnection.query(
      `INSERT INTO historial_acciones_reparacion (
        reparacion_id, 
        tipo_accion, 
        usuario_id, 
        usuario_nombre,
        fecha, 
        detalles
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [reparacionId, tipoAccion, usuarioId, usuarioNombre, formatearFechaParaDB(), detalles],
    )

    return result.insertId
  } catch (error) {
    console.error("Error al registrar acción en historial:", error)
    throw error
  }
}

// Obtener el historial de acciones de una reparación
export const getHistorialAcciones = async (req, res) => {
  try {
    const { id } = req.params

    const [historial] = await pool.query(
      `SELECT 
  ha.id,
  ha.tipo_accion,
  ha.usuario_id,
  ha.usuario_nombre,
  ha.fecha,
  DATE_FORMAT(CONVERT_TZ(ha.fecha, '+00:00', '-03:00'), '%H:%i') as hora,
  ha.detalles
FROM historial_acciones_reparacion ha
WHERE ha.reparacion_id = ?
ORDER BY ha.fecha ASC`,
      [id],
    )

    res.json(historial)
  } catch (error) {
    console.error("Error al obtener historial de acciones:", error)
    res.status(500).json({ message: "Error al obtener historial de acciones" })
  }
}

// Obtener una reparación con su historial completo
export const getReparacionCompleta = async (req, res) => {
  try {
    const { id } = req.params

    // Obtener la reparación
    const [reparaciones] = await pool.query(
      `SELECT r.*, 
             c.nombre AS cliente_nombre,
             c.telefono AS cliente_telefono,
             c.dni AS cliente_dni,
             u.nombre AS usuario_nombre,
             pv.nombre AS punto_venta_nombre,
             (SELECT SUM(pr.monto) FROM pagos_reparacion pr WHERE pr.reparacion_id = r.id) AS total_pagado
      FROM reparaciones r
      LEFT JOIN clientes c ON r.cliente_id = c.id
      LEFT JOIN usuarios u ON r.usuario_id = u.id
      LEFT JOIN puntos_venta pv ON r.punto_venta_id = pv.id
      WHERE r.id = ?`,
      [id],
    )

    if (reparaciones.length === 0) {
      return res.status(404).json({ message: "Reparación no encontrada" })
    }

    const reparacion = reparaciones[0]

    // Obtener el equipo
    const [equipos] = await pool.query("SELECT * FROM equipos_reparacion WHERE reparacion_id = ?", [id])

    reparacion.equipo = equipos.length > 0 ? equipos[0] : null

    // Obtener los detalles de la reparación
    const [detalles] = await pool.query("SELECT * FROM detalles_reparacion WHERE reparacion_id = ?", [id])

    reparacion.detalles = detalles

    // Obtener los pagos de la reparación
    const [pagos] = await pool.query(
      `SELECT pr.*, u.nombre as usuario_nombre
      FROM pagos_reparacion pr
      LEFT JOIN usuarios u ON pr.usuario_id = u.id
      WHERE pr.reparacion_id = ?`,
      [id],
    )

    reparacion.pagos = pagos

    // Obtener el historial de acciones
    const [historial] = await pool.query(
      `SELECT 
  ha.id,
  ha.tipo_accion,
  ha.usuario_id,
  ha.usuario_nombre,
  ha.fecha,
  DATE_FORMAT(CONVERT_TZ(ha.fecha, '+00:00', '-03:00'), '%H:%i') as hora,
  ha.detalles
FROM historial_acciones_reparacion ha
WHERE ha.reparacion_id = ?
ORDER BY ha.fecha ASC`,
      [id],
    )

    reparacion.historial_acciones = historial

    // Calcular el saldo pendiente
    const totalReparacion = Number.parseFloat(reparacion.total) || 0
    const totalPagado = Number.parseFloat(reparacion.total_pagado) || 0
    reparacion.saldo_pendiente = totalReparacion - totalPagado

    res.json(reparacion)
  } catch (error) {
    console.error("Error al obtener reparación completa:", error)
    res.status(500).json({ message: "Error al obtener reparación completa" })
  }
}

// Nueva función para buscar reparaciones por tipo de acción y fecha
export const getReparacionesPorAccion = async (req, res) => {
  try {
    // Parámetros de filtrado
    const { tipo_accion, fecha_inicio, fecha_fin, cliente_id, punto_venta_id, estado } = req.query

    // Construir la consulta base
    let query = `
      SELECT DISTINCT r.id
      FROM reparaciones r
      LEFT JOIN historial_acciones_reparacion ha ON r.id = ha.reparacion_id
      WHERE 1=1
    `
    const queryParams = []

    // Aplicar filtros si se proporcionan
    if (tipo_accion) {
      query += " AND ha.tipo_accion = ?"
      queryParams.push(tipo_accion)
    }

    if (fecha_inicio) {
      query += " AND DATE(ha.fecha) >= ?"
      queryParams.push(fecha_inicio)
    }

    if (fecha_fin) {
      query += " AND DATE(ha.fecha) <= ?"
      queryParams.push(fecha_fin)
    }

    if (cliente_id) {
      query += " AND r.cliente_id = ?"
      queryParams.push(cliente_id)
    }

    if (punto_venta_id) {
      query += " AND r.punto_venta_id = ?"
      queryParams.push(punto_venta_id)
    }

    if (estado) {
      query += " AND r.estado = ?"
      queryParams.push(estado)
    }

    // Obtener los IDs de las reparaciones que cumplen con los filtros
    const [reparacionIds] = await pool.query(query, queryParams)
    
    if (reparacionIds.length === 0) {
      return res.json([])
    }

    // Extraer los IDs
    const ids = reparacionIds.map(r => r.id)

    // Obtener los detalles completos de las reparaciones filtradas
    const [reparaciones] = await pool.query(
      `SELECT r.*, 
             c.nombre AS cliente_nombre,
             c.telefono AS cliente_telefono,
             c.dni AS cliente_dni,
             u.nombre AS usuario_nombre,
             pv.nombre AS punto_venta_nombre,
             (SELECT SUM(pr.monto) FROM pagos_reparacion pr WHERE pr.reparacion_id = r.id) AS total_pagado
      FROM reparaciones r
      LEFT JOIN clientes c ON r.cliente_id = c.id
      LEFT JOIN usuarios u ON r.usuario_id = u.id
      LEFT JOIN puntos_venta pv ON r.punto_venta_id = pv.id
      WHERE r.id IN (?)
      ORDER BY r.fecha_ingreso DESC`,
      [ids]
    )

    // Para cada reparación, obtener el equipo y los detalles
    for (const reparacion of reparaciones) {
      // Obtener el equipo
      const [equipos] = await pool.query(
        `SELECT * FROM equipos_reparacion 
        WHERE reparacion_id = ?`,
        [reparacion.id],
      )

      reparacion.equipo = equipos.length > 0 ? equipos[0] : null

      // Obtener los detalles de la reparación
      const [detalles] = await pool.query(
        `SELECT * FROM detalles_reparacion 
        WHERE reparacion_id = ?`,
        [reparacion.id],
      )

      reparacion.detalles = detalles

      // Obtener los pagos de la reparación
      const [pagos] = await pool.query(
        `SELECT * FROM pagos_reparacion 
        WHERE reparacion_id = ?`,
        [reparacion.id],
      )

      reparacion.pagos = pagos

      // Calcular el saldo pendiente
      const totalReparacion = Number.parseFloat(reparacion.total) || 0
      const totalPagado = Number.parseFloat(reparacion.total_pagado) || 0
      reparacion.saldo_pendiente = totalReparacion - totalPagado
    }

    res.json(reparaciones)
  } catch (error) {
    console.error("Error al obtener reparaciones por acción:", error)
    res.status(500).json({ message: "Error al obtener reparaciones por acción" })
  }
}