import pool from "../db.js"
import { validationResult } from "express-validator"
import { formatearFechaParaDB, fechaParaAPI } from "../utils/dateUtils.js"

/** Verifica si existe una sesión de caja abierta para el punto de venta. Usar antes de registrar ventas/reparaciones/compras. */
export const tieneCajaAbierta = async (punto_venta_id) => {
  const [rows] = await pool.query(
    "SELECT id FROM caja_sesiones WHERE punto_venta_id = ? AND estado = 'abierta' LIMIT 1",
    [punto_venta_id],
  )
  return rows.length > 0
}

// Obtener la sesión de caja abierta para un punto de venta (si existe)
export const getCajaActual = async (req, res) => {
  try {
    const { punto_venta_id } = req.query

    if (!punto_venta_id) {
      return res.status(400).json({ message: "punto_venta_id es obligatorio" })
    }

    const [sesiones] = await pool.query(
      `SELECT cs.*, u.nombre AS usuario_apertura_nombre, uc.nombre AS usuario_cierre_nombre, pv.nombre AS punto_venta_nombre
       FROM caja_sesiones cs
       JOIN usuarios u ON cs.usuario_apertura_id = u.id
       JOIN puntos_venta pv ON cs.punto_venta_id = pv.id
       LEFT JOIN usuarios uc ON cs.usuario_cierre_id = uc.id
       WHERE cs.punto_venta_id = ? AND cs.estado = 'abierta'
       ORDER BY cs.fecha_apertura DESC
       LIMIT 1`,
      [punto_venta_id],
    )

    if (sesiones.length === 0) {
      return res.json(null)
    }

    const sesion = sesiones[0]

    // Calcular totales de ingresos/egresos propios de caja_movimientos (global)
    const [movimientos] = await pool.query(
      `SELECT tipo, SUM(monto) as total
       FROM caja_movimientos
       WHERE caja_sesion_id = ?
       GROUP BY tipo`,
      [sesion.id],
    )

    const totalesMovimientos = movimientos.reduce(
      (acc, mov) => {
        if (mov.tipo === "ingreso") acc.ingresos += Number(mov.total) || 0
        if (mov.tipo === "egreso") acc.egresos += Number(mov.total) || 0
        return acc
      },
      { ingresos: 0, egresos: 0 },
    )

    // Totales de ingresos/egresos por origen (ventas_productos, ventas_equipos, reparaciones, general)
    const [movimientosPorOrigenRows] = await pool.query(
      `SELECT origen, tipo, SUM(monto) AS total
       FROM caja_movimientos
       WHERE caja_sesion_id = ?
       GROUP BY origen, tipo`,
      [sesion.id],
    )

    const baseOrigen = {
      ingresos: 0,
      egresos: 0,
    }

    const movimientosPorOrigen = {
      general: { ...baseOrigen },
      ventas_productos: { ...baseOrigen },
      ventas_equipos: { ...baseOrigen },
      reparaciones: { ...baseOrigen },
    }

    movimientosPorOrigenRows.forEach((row) => {
      const origen = row.origen || "general"
      if (!movimientosPorOrigen[origen]) {
        movimientosPorOrigen[origen] = { ...baseOrigen }
      }
      if (row.tipo === "ingreso") {
        movimientosPorOrigen[origen].ingresos += Number(row.total) || 0
      }
      if (row.tipo === "egreso") {
        movimientosPorOrigen[origen].egresos += Number(row.total) || 0
      }
    })

    // Totales de pagos de VENTAS DE PRODUCTOS: por sesión (caja_sesion_id) o por rango de fechas si es legacy (NULL)
    const [totalesVentasProductos] = await pool.query(
      `SELECT 
          p.tipo_pago,
          SUM(p.monto) AS total
        FROM pagos p
        JOIN ventas v ON p.referencia_id = v.id AND p.tipo_referencia = 'venta'
        WHERE (
          p.caja_sesion_id = ?
          OR (
            p.caja_sesion_id IS NULL
            AND p.punto_venta_id = ?
            AND p.fecha >= ?
            AND p.fecha <= COALESCE(?, NOW())
          )
        )
          AND p.anulado = 0
          AND v.anulada = 0
        GROUP BY p.tipo_pago`,
      [sesion.id, punto_venta_id, sesion.fecha_apertura, sesion.fecha_cierre],
    )

    // Totales de pagos de VENTAS DE EQUIPOS (tabla pagos_ventas_equipos) ligados a la sesión actual
    const [totalesVentasEquipos] = await pool.query(
      `SELECT 
          pe.tipo_pago,
          SUM(pe.monto_ars) AS total
        FROM pagos_ventas_equipos pe
        JOIN ventas_equipos ve ON pe.venta_equipo_id = ve.id
        WHERE pe.caja_sesion_id = ?
          AND pe.anulado = 0
          AND ve.anulada = 0
        GROUP BY pe.tipo_pago`,
      [sesion.id],
    )

    // Totales de pagos de COMPRAS (tipo_referencia = 'compra')
    const [totalesCompras] = await pool.query(
      `SELECT 
          p.tipo_pago,
          SUM(p.monto) AS total
        FROM pagos p
        JOIN compras c ON p.referencia_id = c.id AND p.tipo_referencia = 'compra'
        WHERE p.punto_venta_id = ?
          AND p.fecha BETWEEN ? AND COALESCE(?, NOW())
          AND p.anulado = 0
          AND c.anulada = 0
        GROUP BY p.tipo_pago`,
      [punto_venta_id, sesion.fecha_apertura, sesion.fecha_cierre],
    )

    // Totales de pagos de REPARACIONES (tabla pagos_reparacion) ligados a la sesión actual
    const [totalesReparaciones] = await pool.query(
      `SELECT 
          pr.metodo_pago AS tipo_pago,
          SUM(pr.monto) AS total
        FROM pagos_reparacion pr
        JOIN reparaciones r ON pr.reparacion_id = r.id
        WHERE pr.caja_sesion_id = ?
        GROUP BY pr.metodo_pago`,
      [sesion.id],
    )

    // Nota: para ventas de equipos tu sistema usa pagos_ventas_equipos; se pueden sumar más adelante

    const sesionNormalizada = sesion
      ? {
          ...sesion,
          fecha_apertura: fechaParaAPI(sesion.fecha_apertura),
          fecha_cierre: sesion.fecha_cierre ? fechaParaAPI(sesion.fecha_cierre) : null,
        }
      : null

    res.json({
      sesion: sesionNormalizada,
      totales: {
        movimientos: totalesMovimientos,
        movimientos_por_origen: movimientosPorOrigen,
        ventas_productos: totalesVentasProductos,
        ventas_equipos: totalesVentasEquipos,
        compras: totalesCompras,
        reparaciones: totalesReparaciones,
      },
    })
  } catch (error) {
    console.error("Error al obtener caja actual:", error)
    res.status(500).json({ message: "Error al obtener caja actual" })
  }
}

// Abrir una nueva sesión de caja
export const abrirCaja = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { punto_venta_id, monto_apertura, notas_apertura } = req.body

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado" })
  }

  const usuario_id = req.user.id

  try {
    const [sesionesAbiertas] = await pool.query(
      "SELECT id, fecha_apertura FROM caja_sesiones WHERE punto_venta_id = ? AND estado = 'abierta' ORDER BY fecha_apertura DESC",
      [punto_venta_id],
    )

    if (sesionesAbiertas.length > 0) {
      const sesionVigente = sesionesAbiertas[0]
      const fechaAperturaSesion = sesionVigente.fecha_apertura ? new Date(sesionVigente.fecha_apertura) : null
      const hoy = new Date()
      const esMismoDia =
        fechaAperturaSesion &&
        fechaAperturaSesion.getFullYear() === hoy.getFullYear() &&
        fechaAperturaSesion.getMonth() === hoy.getMonth() &&
        fechaAperturaSesion.getDate() === hoy.getDate()
      if (esMismoDia) {
        return res.status(400).json({ message: "Ya existe una caja abierta para este punto de venta" })
      }
      // Sesión abierta de otro día: cerrarla para poder abrir una nueva desde 0
      const fechaCierre = formatearFechaParaDB()
      await pool.query(
        `UPDATE caja_sesiones SET estado = 'cerrada', usuario_cierre_id = ?, fecha_cierre = ?, notas_cierre = ? WHERE id = ?`,
        [usuario_id, fechaCierre, "Cierre automático al abrir nueva sesión del día.", sesionVigente.id],
      )
    }

    const fechaApertura = formatearFechaParaDB()

    const [result] = await pool.query(
      `INSERT INTO caja_sesiones (
        punto_venta_id,
        usuario_apertura_id,
        fecha_apertura,
        monto_apertura,
        estado,
        notas_apertura
      ) VALUES (?, ?, ?, ?, 'abierta', ?)`,
      [punto_venta_id, usuario_id, fechaApertura, monto_apertura || 0, notas_apertura || null],
    )

    const [sesion] = await pool.query("SELECT * FROM caja_sesiones WHERE id = ?", [result.insertId])
    const s = sesion[0]
    if (s) {
      s.fecha_apertura = fechaParaAPI(s.fecha_apertura)
      s.fecha_cierre = s.fecha_cierre ? fechaParaAPI(s.fecha_cierre) : null
    }

    res.status(201).json({
      message: "Caja abierta correctamente",
      sesion: s,
    })
  } catch (error) {
    console.error("Error al abrir caja:", error)
    res.status(500).json({ message: "Error al abrir caja" })
  }
}

// Cerrar una sesión de caja
export const cerrarCaja = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { id } = req.params
  const { monto_cierre, notas_cierre } = req.body

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado" })
  }

  const usuario_id = req.user.id

  try {
    const [sesiones] = await pool.query("SELECT * FROM caja_sesiones WHERE id = ?", [id])

    if (sesiones.length === 0) {
      return res.status(404).json({ message: "Sesión de caja no encontrada" })
    }

    const sesion = sesiones[0]

    if (sesion.estado === "cerrada") {
      return res.status(400).json({ message: "La caja ya está cerrada" })
    }

    const fechaCierre = formatearFechaParaDB()

    // Calcular diferencia simple: monto_cierre - monto_apertura - (ingresos - egresos)
    const [movimientos] = await pool.query(
      `SELECT tipo, SUM(monto) as total
       FROM caja_movimientos
       WHERE caja_sesion_id = ?
       GROUP BY tipo`,
      [id],
    )

    const totalesMovimientos = movimientos.reduce(
      (acc, mov) => {
        if (mov.tipo === "ingreso") acc.ingresos += Number(mov.total) || 0
        if (mov.tipo === "egreso") acc.egresos += Number(mov.total) || 0
        return acc
      },
      { ingresos: 0, egresos: 0 },
    )

    const montoApertura = Number(sesion.monto_apertura) || 0
    const montoCierreNum = Number(monto_cierre) || 0
    const saldoTeorico = montoApertura + totalesMovimientos.ingresos - totalesMovimientos.egresos
    const diferencia = montoCierreNum - saldoTeorico

    await pool.query(
      `UPDATE caja_sesiones
       SET estado = 'cerrada',
           usuario_cierre_id = ?,
           fecha_cierre = ?,
           monto_cierre = ?,
           diferencia = ?,
           notas_cierre = ?
       WHERE id = ?`,
      [usuario_id, fechaCierre, montoCierreNum, diferencia, notas_cierre || null, id],
    )

    const [sesionActualizada] = await pool.query("SELECT * FROM caja_sesiones WHERE id = ?", [id])
    const s = sesionActualizada[0]
    if (s) {
      s.fecha_apertura = fechaParaAPI(s.fecha_apertura)
      s.fecha_cierre = s.fecha_cierre ? fechaParaAPI(s.fecha_cierre) : null
    }

    res.json({
      message: "Caja cerrada correctamente",
      sesion: s,
    })
  } catch (error) {
    console.error("Error al cerrar caja:", error)
    res.status(500).json({ message: "Error al cerrar caja" })
  }
}

// Registrar un movimiento manual de caja (ingreso / egreso)
export const registrarMovimientoCaja = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { caja_sesion_id, tipo, concepto, monto, metodo_pago, origen } = req.body

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado" })
  }

  const usuario_id = req.user.id

  try {
    const [sesiones] = await pool.query("SELECT * FROM caja_sesiones WHERE id = ?", [caja_sesion_id])

    if (sesiones.length === 0) {
      return res.status(404).json({ message: "Sesión de caja no encontrada" })
    }

    const sesion = sesiones[0]

    if (sesion.estado !== "abierta") {
      return res.status(400).json({ message: "No se pueden registrar movimientos en una caja cerrada" })
    }

    const fecha = formatearFechaParaDB()

    const origenSanitizado =
      origen && ["general", "ventas_productos", "ventas_equipos", "reparaciones"].includes(origen)
        ? origen
        : "general"

    const [result] = await pool.query(
      `INSERT INTO caja_movimientos (
        caja_sesion_id,
        tipo,
        concepto,
        monto,
        metodo_pago,
        origen,
        usuario_id,
        fecha
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [caja_sesion_id, tipo, concepto, monto, metodo_pago || null, origenSanitizado, usuario_id, fecha],
    )

    const [movimiento] = await pool.query("SELECT * FROM caja_movimientos WHERE id = ?", [result.insertId])
    const mov = movimiento[0]
    if (mov) mov.fecha = fechaParaAPI(mov.fecha)

    res.status(201).json({
      message: "Movimiento de caja registrado correctamente",
      movimiento: mov,
    })
  } catch (error) {
    console.error("Error al registrar movimiento de caja:", error)
    res.status(500).json({ message: "Error al registrar movimiento de caja" })
  }
}

// Historial de sesiones de caja (paginado)
export const getSesionesCaja = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      punto_venta_id,
      estado, // abierta / cerrada / todos
    } = req.query

    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    let where = "WHERE 1=1"
    const params = []
    const countParams = []

    if (punto_venta_id) {
      where += " AND cs.punto_venta_id = ?"
      params.push(punto_venta_id)
      countParams.push(punto_venta_id)
    }

    if (estado && estado !== "todos") {
      where += " AND cs.estado = ?"
      params.push(estado)
      countParams.push(estado)
    }

    const sql = `
      SELECT 
        cs.*,
        u.nombre AS usuario_apertura_nombre,
        uc.nombre AS usuario_cierre_nombre,
        pv.nombre AS punto_venta_nombre
      FROM caja_sesiones cs
      JOIN usuarios u ON cs.usuario_apertura_id = u.id
      JOIN puntos_venta pv ON cs.punto_venta_id = pv.id
      LEFT JOIN usuarios uc ON cs.usuario_cierre_id = uc.id
      ${where}
      ORDER BY cs.fecha_apertura DESC
      LIMIT ? OFFSET ?
    `

    const countSql = `
      SELECT COUNT(*) AS total
      FROM caja_sesiones cs
      ${where}
    `

    const finalParams = [...params, Number.parseInt(limit), Number.parseInt(offset)]

    const [sesionesResult, countResult] = await Promise.all([
      pool.query(sql, finalParams),
      pool.query(countSql, countParams),
    ])

    const sesionesRaw = sesionesResult[0]
    const sesiones = sesionesRaw.map((s) => ({
      ...s,
      fecha_apertura: fechaParaAPI(s.fecha_apertura),
      fecha_cierre: s.fecha_cierre ? fechaParaAPI(s.fecha_cierre) : null,
    }))
    const total = countResult[0][0].total
    const totalPages = Math.ceil(total / Number.parseInt(limit))

    res.json({
      sesiones,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: Number.parseInt(limit),
        hasNextPage: Number.parseInt(page) < totalPages,
        hasPrevPage: Number.parseInt(page) > 1,
        startItem: offset + 1,
        endItem: Math.min(offset + Number.parseInt(limit), total),
      },
    })
  } catch (error) {
    console.error("Error al obtener sesiones de caja:", error)
    res.status(500).json({ message: "Error al obtener sesiones de caja" })
  }
}

// Historial de movimientos de una sesión de caja (paginado)
export const getMovimientosCaja = async (req, res) => {
  try {
    const { caja_sesion_id, page = 1, limit = 20, tipo, origen } = req.query

    if (!caja_sesion_id) {
      return res.status(400).json({ message: "caja_sesion_id es obligatorio" })
    }

    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    let where = "WHERE cm.caja_sesion_id = ?"
    const params = [caja_sesion_id]
    const countParams = [caja_sesion_id]

    if (tipo && tipo !== "todos") {
      where += " AND cm.tipo = ?"
      params.push(tipo)
      countParams.push(tipo)
    }

    if (origen && origen !== "todos") {
      where += " AND cm.origen = ?"
      params.push(origen)
      countParams.push(origen)
    }

    const sql = `
      SELECT 
        cm.*,
        u.nombre AS usuario_nombre
      FROM caja_movimientos cm
      JOIN usuarios u ON cm.usuario_id = u.id
      ${where}
      ORDER BY cm.fecha DESC, cm.id DESC
      LIMIT ? OFFSET ?
    `

    const countSql = `
      SELECT COUNT(*) AS total
      FROM caja_movimientos cm
      ${where}
    `

    const finalParams = [...params, Number.parseInt(limit), Number.parseInt(offset)]

    const [movsResult, countResult] = await Promise.all([
      pool.query(sql, finalParams),
      pool.query(countSql, countParams),
    ])

    const rows = movsResult[0]
    const movimientos = rows.map((m) => ({ ...m, fecha: fechaParaAPI(m.fecha) }))
    const total = countResult[0][0].total
    const totalPages = Math.ceil(total / Number.parseInt(limit))

    res.json({
      movimientos,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: Number.parseInt(limit),
        hasNextPage: Number.parseInt(page) < totalPages,
        hasPrevPage: Number.parseInt(page) > 1,
        startItem: offset + 1,
        endItem: Math.min(offset + Number.parseInt(limit), total),
      },
    })
  } catch (error) {
    console.error("Error al obtener movimientos de caja:", error)
    res.status(500).json({ message: "Error al obtener movimientos de caja" })
  }
}

// Movimientos completos por tab: ventas (pagos) + movimientos manuales, unificados y paginados.
// Las ventas viven en pagos (con caja_sesion_id); los ingresos/egresos manuales en caja_movimientos.
// El historial por sesión une ambos; las fechas se normalizan a Argentina (-03:00) para evitar desfase en el frontend.
export const getMovimientosCompletosCaja = async (req, res) => {
  try {
    const { id: caja_sesion_id } = req.params
    const { origen = "ventas_productos", page = 1, limit = 50 } = req.query

    if (!caja_sesion_id) {
      return res.status(400).json({ message: "caja_sesion_id es obligatorio" })
    }

    const [sesiones] = await pool.query(
      "SELECT id, punto_venta_id, fecha_apertura, fecha_cierre FROM caja_sesiones WHERE id = ?",
      [caja_sesion_id],
    )
    if (sesiones.length === 0) {
      return res.status(404).json({ message: "Sesión de caja no encontrada" })
    }
    const sesion = sesiones[0]
    const punto_venta_id = sesion.punto_venta_id
    const fechaDesde = sesion.fecha_apertura
    const fechaHasta = sesion.fecha_cierre || formatearFechaParaDB()

    const normalizeRow = (row, tipo, concepto) => ({
      id: row.id,
      fecha: fechaParaAPI(row.fecha),
      concepto: concepto || row.concepto || "",
      monto: Number(row.monto) || 0,
      tipo_pago: row.tipo_pago || row.metodo_pago || "",
      tipo,
      usuario_nombre: row.usuario_nombre || "",
      origen: row.origen || null,
    })

    let todos = []

    if (origen === "ventas_productos") {
      const [pagosVenta] = await pool.query(
        `SELECT p.id, p.fecha, p.monto, p.tipo_pago, p.referencia_id, u.nombre AS usuario_nombre, v.numero_factura
         FROM pagos p
         JOIN ventas v ON p.referencia_id = v.id AND p.tipo_referencia = 'venta'
         JOIN usuarios u ON p.usuario_id = u.id
         WHERE (
           p.caja_sesion_id = ?
           OR (
             p.caja_sesion_id IS NULL
             AND p.punto_venta_id = ?
             AND p.fecha >= ? AND p.fecha <= ?
           )
         )
           AND p.anulado = 0 AND v.anulada = 0
         ORDER BY p.fecha DESC`,
        [caja_sesion_id, punto_venta_id, fechaDesde, fechaHasta],
      )
      todos = pagosVenta.map((row) =>
        normalizeRow(row, "venta", `Venta ${row.numero_factura || row.referencia_id}`),
      )

      const [manual] = await pool.query(
        `SELECT cm.id, cm.fecha, cm.concepto, cm.monto, cm.metodo_pago AS tipo_pago, cm.tipo, u.nombre AS usuario_nombre, cm.origen
         FROM caja_movimientos cm
         JOIN usuarios u ON cm.usuario_id = u.id
         WHERE cm.caja_sesion_id = ? AND (cm.origen = 'general' OR cm.origen IS NULL)
         ORDER BY cm.fecha DESC`,
        [caja_sesion_id],
      )
      manual.forEach((row) => {
        todos.push(
          normalizeRow(
            { ...row, tipo_pago: row.tipo_pago },
            row.tipo === "egreso" ? "egreso" : "ingreso",
            row.concepto,
          ),
        )
      })
    } else if (origen === "ventas_equipos") {
      const [pagosEquipos] = await pool.query(
        `SELECT pe.id, pe.fecha_pago AS fecha, pe.monto_ars AS monto, pe.tipo_pago, pe.venta_equipo_id AS referencia_id, u.nombre AS usuario_nombre, ve.numero_factura
         FROM pagos_ventas_equipos pe
         JOIN ventas_equipos ve ON pe.venta_equipo_id = ve.id
         LEFT JOIN usuarios u ON pe.usuario_id = u.id
         WHERE pe.caja_sesion_id = ?
           AND pe.anulado = 0 AND ve.anulada = 0
         ORDER BY pe.fecha_pago DESC`,
        [caja_sesion_id],
      )
      todos = pagosEquipos.map((row) =>
        normalizeRow(row, "venta", `Venta equipo ${row.numero_factura || row.referencia_id}`),
      )

      const [manual] = await pool.query(
        `SELECT cm.id, cm.fecha, cm.concepto, cm.monto, cm.metodo_pago AS tipo_pago, cm.tipo, u.nombre AS usuario_nombre, cm.origen
         FROM caja_movimientos cm
         JOIN usuarios u ON cm.usuario_id = u.id
         WHERE cm.caja_sesion_id = ? AND (cm.origen = 'general' OR cm.origen IS NULL)
         ORDER BY cm.fecha DESC`,
        [caja_sesion_id],
      )
      manual.forEach((row) =>
        todos.push(
          normalizeRow(
            { ...row, tipo_pago: row.tipo_pago },
            row.tipo === "egreso" ? "egreso" : "ingreso",
            row.concepto,
          ),
        ),
      )
    } else if (origen === "reparaciones") {
      const [pagosRep] = await pool.query(
        `SELECT pr.id, pr.fecha_pago AS fecha, pr.monto, pr.metodo_pago AS tipo_pago, pr.reparacion_id AS referencia_id, u.nombre AS usuario_nombre
         FROM pagos_reparacion pr
         JOIN reparaciones r ON pr.reparacion_id = r.id
         LEFT JOIN usuarios u ON pr.usuario_id = u.id
         WHERE pr.caja_sesion_id = ?
         ORDER BY pr.fecha_pago DESC`,
        [caja_sesion_id],
      )
      todos = pagosRep.map((row) =>
        normalizeRow(row, "venta", `Reparación #${row.referencia_id}`),
      )

      const [manual] = await pool.query(
        `SELECT cm.id, cm.fecha, cm.concepto, cm.monto, cm.metodo_pago AS tipo_pago, cm.tipo, u.nombre AS usuario_nombre, cm.origen
         FROM caja_movimientos cm
         JOIN usuarios u ON cm.usuario_id = u.id
         WHERE cm.caja_sesion_id = ? AND (cm.origen = 'general' OR cm.origen IS NULL)
         ORDER BY cm.fecha DESC`,
        [caja_sesion_id],
      )
      manual.forEach((row) =>
        todos.push(
          normalizeRow(
            { ...row, tipo_pago: row.tipo_pago },
            row.tipo === "egreso" ? "egreso" : "ingreso",
            row.concepto,
          ),
        ),
      )
    } else {
      // general: todos los movimientos de la sesión (ventas productos + ventas equipos + reparaciones + manuales)
      const [pagosVenta] = await pool.query(
        `SELECT p.id, p.fecha, p.monto, p.tipo_pago, p.referencia_id, u.nombre AS usuario_nombre, v.numero_factura
         FROM pagos p
         JOIN ventas v ON p.referencia_id = v.id AND p.tipo_referencia = 'venta'
         JOIN usuarios u ON p.usuario_id = u.id
         WHERE p.caja_sesion_id = ? AND p.anulado = 0 AND v.anulada = 0
         ORDER BY p.fecha DESC`,
        [caja_sesion_id],
      )
      pagosVenta.forEach((row) =>
        todos.push(normalizeRow(row, "venta", `Venta ${row.numero_factura || row.referencia_id}`)),
      )

      const [pagosEquipos] = await pool.query(
        `SELECT pe.id, pe.fecha_pago AS fecha, pe.monto_ars AS monto, pe.tipo_pago, pe.venta_equipo_id AS referencia_id, u.nombre AS usuario_nombre, ve.numero_factura
         FROM pagos_ventas_equipos pe
         JOIN ventas_equipos ve ON pe.venta_equipo_id = ve.id
         LEFT JOIN usuarios u ON pe.usuario_id = u.id
         WHERE pe.caja_sesion_id = ? AND pe.anulado = 0 AND ve.anulada = 0
         ORDER BY pe.fecha_pago DESC`,
        [caja_sesion_id],
      )
      pagosEquipos.forEach((row) =>
        todos.push(normalizeRow(row, "venta", `Venta equipo ${row.numero_factura || row.referencia_id}`)),
      )

      const [pagosRep] = await pool.query(
        `SELECT pr.id, pr.fecha_pago AS fecha, pr.monto, pr.metodo_pago AS tipo_pago, pr.reparacion_id AS referencia_id, u.nombre AS usuario_nombre
         FROM pagos_reparacion pr
         JOIN reparaciones r ON pr.reparacion_id = r.id
         LEFT JOIN usuarios u ON pr.usuario_id = u.id
         WHERE pr.caja_sesion_id = ?
         ORDER BY pr.fecha_pago DESC`,
        [caja_sesion_id],
      )
      pagosRep.forEach((row) =>
        todos.push(normalizeRow(row, "venta", `Reparación #${row.referencia_id}`)),
      )

      const [manual] = await pool.query(
        `SELECT cm.id, cm.fecha, cm.concepto, cm.monto, cm.metodo_pago AS tipo_pago, cm.tipo, u.nombre AS usuario_nombre, cm.origen
         FROM caja_movimientos cm
         JOIN usuarios u ON cm.usuario_id = u.id
         WHERE cm.caja_sesion_id = ? AND (cm.origen = 'general' OR cm.origen IS NULL)
         ORDER BY cm.fecha DESC`,
        [caja_sesion_id],
      )
      manual.forEach((row) =>
        todos.push(
          normalizeRow(
            { ...row, tipo_pago: row.tipo_pago },
            row.tipo === "egreso" ? "egreso" : "ingreso",
            row.concepto,
          ),
        ),
      )
    }

    todos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))

    const totalItems = todos.length
    const limitNum = Math.min(Math.max(1, Number.parseInt(limit) || 50), 200)
    const pageNum = Math.max(1, Number.parseInt(page) || 1)
    const offset = (pageNum - 1) * limitNum
    const movimientos = todos.slice(offset, offset + limitNum)
    const totalPages = Math.ceil(totalItems / limitNum)

    res.json({
      movimientos,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
        startItem: totalItems ? offset + 1 : 0,
        endItem: Math.min(offset + limitNum, totalItems),
      },
    })
  } catch (error) {
    console.error("Error al obtener movimientos completos de caja:", error)
    res.status(500).json({ message: "Error al obtener movimientos de caja" })
  }
}

