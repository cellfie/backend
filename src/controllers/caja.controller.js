import pool from "../db.js"
import { validationResult } from "express-validator"
import { formatearFechaParaDB } from "../utils/dateUtils.js"

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

    // Calcular totales de ingresos/egresos propios de caja_movimientos
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

    // Totales de pagos de VENTAS (tipo_referencia = 'venta')
    const [totalesVentas] = await pool.query(
      `SELECT 
          p.tipo_pago,
          SUM(p.monto) AS total
        FROM pagos p
        JOIN ventas v ON p.referencia_id = v.id AND p.tipo_referencia = 'venta'
        WHERE p.punto_venta_id = ?
          AND p.fecha BETWEEN ? AND COALESCE(?, NOW())
          AND p.anulado = 0
          AND v.anulada = 0
        GROUP BY p.tipo_pago`,
      [punto_venta_id, sesion.fecha_apertura, sesion.fecha_cierre],
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

    // Totales de pagos de REPARACIONES (tabla pagos_reparacion)
    const [totalesReparaciones] = await pool.query(
      `SELECT 
          pr.metodo_pago AS tipo_pago,
          SUM(pr.monto) AS total
        FROM pagos_reparacion pr
        JOIN reparaciones r ON pr.reparacion_id = r.id
        WHERE r.punto_venta_id = ?
          AND pr.fecha_pago BETWEEN ? AND COALESCE(?, NOW())
        GROUP BY pr.metodo_pago`,
      [punto_venta_id, sesion.fecha_apertura, sesion.fecha_cierre],
    )

    // Nota: para ventas de equipos tu sistema usa pagos_ventas_equipos; se pueden sumar más adelante

    res.json({
      sesion,
      totales: {
        movimientos: totalesMovimientos,
        ventas: totalesVentas,
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
      "SELECT id FROM caja_sesiones WHERE punto_venta_id = ? AND estado = 'abierta' LIMIT 1",
      [punto_venta_id],
    )

    if (sesionesAbiertas.length > 0) {
      return res.status(400).json({ message: "Ya existe una caja abierta para este punto de venta" })
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

    res.status(201).json({
      message: "Caja abierta correctamente",
      sesion: sesion[0],
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

    res.json({
      message: "Caja cerrada correctamente",
      sesion: sesionActualizada[0],
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

  const { caja_sesion_id, tipo, concepto, monto, metodo_pago } = req.body

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

    const [result] = await pool.query(
      `INSERT INTO caja_movimientos (
        caja_sesion_id,
        tipo,
        concepto,
        monto,
        metodo_pago,
        usuario_id,
        fecha
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [caja_sesion_id, tipo, concepto, monto, metodo_pago || null, usuario_id, fecha],
    )

    const [movimiento] = await pool.query("SELECT * FROM caja_movimientos WHERE id = ?", [result.insertId])

    res.status(201).json({
      message: "Movimiento de caja registrado correctamente",
      movimiento: movimiento[0],
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

    const sesiones = sesionesResult[0]
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
    const { caja_sesion_id, page = 1, limit = 20, tipo } = req.query

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

    const movimientos = movsResult[0]
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

