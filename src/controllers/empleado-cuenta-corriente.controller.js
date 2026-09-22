import pool from "../db.js"
import { validationResult } from "express-validator"
import { formatearFechaParaDB, fechaParaAPI } from "../utils/dateUtils.js"

const PREFIJO_CONCEPTO_RETIRO = "Retiro empleado"

const asegurarCuentaEmpleado = async (connection, usuarioId) => {
  const [existentes] = await connection.query(
    "SELECT * FROM cuentas_corrientes_empleados WHERE usuario_id = ? LIMIT 1",
    [usuarioId],
  )
  if (existentes.length > 0) return existentes[0]

  const [result] = await connection.query(
    "INSERT INTO cuentas_corrientes_empleados (usuario_id, saldo) VALUES (?, 0)",
    [usuarioId],
  )
  const [creadas] = await connection.query(
    "SELECT * FROM cuentas_corrientes_empleados WHERE id = ?",
    [result.insertId],
  )
  return creadas[0]
}

const mapearCuenta = (cuenta, usuario = null) => {
  if (!cuenta) return null
  return {
    id: cuenta.id,
    usuario_id: cuenta.usuario_id,
    saldo: Number(cuenta.saldo) || 0,
    fecha_ultimo_movimiento: cuenta.fecha_ultimo_movimiento
      ? fechaParaAPI(cuenta.fecha_ultimo_movimiento)
      : null,
    fecha_creacion: cuenta.fecha_creacion ? fechaParaAPI(cuenta.fecha_creacion) : null,
    usuario: usuario
      ? { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol }
      : cuenta.usuario_nombre
        ? {
            id: cuenta.usuario_id,
            nombre: cuenta.usuario_nombre,
            rol: cuenta.usuario_rol || null,
          }
        : null,
  }
}

const mapearMovimiento = (mov) => ({
  id: mov.id,
  tipo: mov.tipo,
  monto: Number(mov.monto) || 0,
  saldo_anterior: Number(mov.saldo_anterior) || 0,
  saldo_nuevo: Number(mov.saldo_nuevo) || 0,
  notas: mov.notas || null,
  caja_movimiento_id: mov.caja_movimiento_id || null,
  fecha: mov.fecha ? fechaParaAPI(mov.fecha) : null,
  registrado_por: mov.registrado_por_nombre
    ? { id: mov.registrado_por_usuario_id, nombre: mov.registrado_por_nombre }
    : null,
})

/** Lista usuarios activos con saldo de C/C (para selector de retiro en caja).
 *  Admin: todos. Empleado: solo el propio usuario.
 */
export const getUsuariosParaRetiro = async (req, res) => {
  try {
    const esAdmin = req.user?.role === "admin" || req.user?.rol === "admin"
    const params = []
    let sql = `
      SELECT u.id, u.nombre, u.rol, u.activo,
             COALESCE(cce.saldo, 0) AS saldo_cuenta_corriente
      FROM usuarios u
      LEFT JOIN cuentas_corrientes_empleados cce ON cce.usuario_id = u.id
      WHERE COALESCE(u.activo, 1) = 1
    `
    if (!esAdmin) {
      sql += " AND u.id = ?"
      params.push(req.user.id)
    }
    sql += " ORDER BY u.nombre ASC"

    const [rows] = await pool.query(sql, params)

    res.json(
      rows.map((u) => ({
        id: u.id,
        nombre: u.nombre,
        rol: u.rol,
        saldo_cuenta_corriente: Number(u.saldo_cuenta_corriente) || 0,
      })),
    )
  } catch (error) {
    console.error("Error en getUsuariosParaRetiro:", error)
    res.status(500).json({ message: "Error al obtener usuarios para retiro" })
  }
}

/** Obtener C/C de un empleado + movimientos */
export const getCuentaCorrienteEmpleado = async (req, res) => {
  try {
    const { id } = req.params
    const { fecha_inicio, fecha_fin } = req.query

    const [usuarios] = await pool.query(
      "SELECT id, nombre, rol, activo FROM usuarios WHERE id = ?",
      [id],
    )
    if (usuarios.length === 0) {
      return res.status(404).json({ message: "Usuario no encontrado" })
    }

    const connection = await pool.getConnection()
    let cuenta
    try {
      await connection.beginTransaction()
      cuenta = await asegurarCuentaEmpleado(connection, Number(id))
      await connection.commit()
    } catch (e) {
      await connection.rollback()
      throw e
    } finally {
      connection.release()
    }

    let sqlMov = `
      SELECT m.*, u.nombre AS registrado_por_nombre
      FROM movimientos_cuenta_corriente_empleado m
      LEFT JOIN usuarios u ON m.registrado_por_usuario_id = u.id
      WHERE m.cuenta_corriente_empleado_id = ?
    `
    const params = [cuenta.id]

    if (fecha_inicio) {
      sqlMov += " AND m.fecha >= ?"
      params.push(`${fecha_inicio} 00:00:00`)
    }
    if (fecha_fin) {
      sqlMov += " AND m.fecha <= ?"
      params.push(`${fecha_fin} 23:59:59`)
    }
    sqlMov += " ORDER BY m.fecha DESC, m.id DESC LIMIT 200"

    const [movimientos] = await pool.query(sqlMov, params)

    res.json({
      cuenta_corriente: mapearCuenta(cuenta, usuarios[0]),
      movimientos: movimientos.map(mapearMovimiento),
    })
  } catch (error) {
    console.error("Error en getCuentaCorrienteEmpleado:", error)
    res.status(500).json({ message: "Error al obtener cuenta corriente del empleado" })
  }
}

/**
 * Retiro de empleado: egreso de caja + cargo en C/C del empleado (partida doble).
 * El saldo de C/C sube = monto a liquidar/pagar al empleado.
 */
export const registrarRetiroEmpleado = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado" })
  }

  const { caja_sesion_id, empleado_usuario_id, monto, metodo_pago, notas } = req.body
  const montoNum = Number(monto)
  const sesionId = Number(caja_sesion_id)
  const esAdmin = req.user?.role === "admin" || req.user?.rol === "admin"
  // Empleado solo puede retirar a su propia cuenta; admin puede elegir a cualquiera
  const empleadoId = esAdmin ? Number(empleado_usuario_id) : Number(req.user.id)

  if (!sesionId || !empleadoId || !Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ message: "Datos de retiro inválidos" })
  }

  if (!esAdmin && Number(empleado_usuario_id) && Number(empleado_usuario_id) !== Number(req.user.id)) {
    return res.status(403).json({ message: "Solo podés registrar un retiro a tu propia cuenta" })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const [sesiones] = await connection.query("SELECT * FROM caja_sesiones WHERE id = ? FOR UPDATE", [
      sesionId,
    ])
    if (sesiones.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Sesión de caja no encontrada" })
    }
    const sesion = sesiones[0]
    if (sesion.estado !== "abierta") {
      await connection.rollback()
      return res.status(400).json({ message: "No se pueden registrar retiros en una caja cerrada" })
    }

    const [empleados] = await connection.query(
      "SELECT id, nombre, rol, activo FROM usuarios WHERE id = ?",
      [empleadoId],
    )
    if (empleados.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Empleado no encontrado" })
    }
    const empleado = empleados[0]
    if (Number(empleado.activo) === 0) {
      await connection.rollback()
      return res.status(400).json({ message: "El usuario está deshabilitado" })
    }

    const cuenta = await asegurarCuentaEmpleado(connection, empleadoId)
    const saldoAnterior = Number(cuenta.saldo) || 0
    const saldoNuevo = saldoAnterior + montoNum
    const fecha = formatearFechaParaDB()
    const concepto = `${PREFIJO_CONCEPTO_RETIRO} - ${empleado.nombre}`
    const notasFinal = notas?.trim() || `Retiro de caja imputado a C/C de ${empleado.nombre}`

    const [resultMovCaja] = await connection.query(
      `INSERT INTO caja_movimientos (
        caja_sesion_id, tipo, concepto, monto, metodo_pago, origen,
        usuario_id, fecha, referencia_id, tipo_referencia
      ) VALUES (?, 'egreso', ?, ?, ?, 'general', ?, ?, ?, 'retiro_empleado')`,
      [
        sesionId,
        concepto,
        montoNum,
        metodo_pago || "Efectivo",
        req.user.id,
        fecha,
        empleadoId,
      ],
    )
    const cajaMovimientoId = resultMovCaja.insertId

    await connection.query(
      `UPDATE cuentas_corrientes_empleados
       SET saldo = ?, fecha_ultimo_movimiento = ?
       WHERE id = ?`,
      [saldoNuevo, fecha, cuenta.id],
    )

    const [resultMovCc] = await connection.query(
      `INSERT INTO movimientos_cuenta_corriente_empleado (
        cuenta_corriente_empleado_id, usuario_id, caja_movimiento_id, tipo, monto,
        saldo_anterior, saldo_nuevo, registrado_por_usuario_id, notas, fecha
      ) VALUES (?, ?, ?, 'cargo', ?, ?, ?, ?, ?, ?)`,
      [
        cuenta.id,
        empleadoId,
        cajaMovimientoId,
        montoNum,
        saldoAnterior,
        saldoNuevo,
        req.user.id,
        notasFinal,
        fecha,
      ],
    )

    await connection.commit()

    const [movCajaRows] = await pool.query("SELECT * FROM caja_movimientos WHERE id = ?", [
      cajaMovimientoId,
    ])
    const movCaja = movCajaRows[0]
    if (movCaja) movCaja.fecha = fechaParaAPI(movCaja.fecha)

    res.status(201).json({
      message: "Retiro de empleado registrado correctamente",
      movimiento_caja: movCaja,
      cuenta_corriente: mapearCuenta({ ...cuenta, saldo: saldoNuevo, fecha_ultimo_movimiento: fecha }, empleado),
      movimiento_cuenta_corriente: {
        id: resultMovCc.insertId,
        tipo: "cargo",
        monto: montoNum,
        saldo_anterior: saldoAnterior,
        saldo_nuevo: saldoNuevo,
      },
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error en registrarRetiroEmpleado:", error)
    res.status(500).json({ message: "Error al registrar retiro de empleado" })
  } finally {
    connection.release()
  }
}

/**
 * Liquidación / pago de C/C empleado (baja el saldo sin tocar caja).
 * Usar cuando se paga el sueldo y se descuenta lo ya retirado, o se salda la cuenta.
 */
export const registrarPagoCuentaCorrienteEmpleado = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado" })
  }

  const { id } = req.params
  const { monto, notas } = req.body
  const montoNum = Number(monto)
  const empleadoId = Number(id)

  if (!empleadoId || !Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ message: "Monto inválido" })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const [usuarios] = await connection.query(
      "SELECT id, nombre, rol, activo FROM usuarios WHERE id = ?",
      [empleadoId],
    )
    if (usuarios.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Usuario no encontrado" })
    }

    const cuenta = await asegurarCuentaEmpleado(connection, empleadoId)
    const saldoAnterior = Number(cuenta.saldo) || 0
    if (montoNum - saldoAnterior > 0.01) {
      await connection.rollback()
      return res.status(400).json({
        message: `El monto supera el saldo de la cuenta (${saldoAnterior.toFixed(2)})`,
      })
    }

    const saldoNuevo = saldoAnterior - montoNum
    const fecha = formatearFechaParaDB()

    await connection.query(
      `UPDATE cuentas_corrientes_empleados
       SET saldo = ?, fecha_ultimo_movimiento = ?
       WHERE id = ?`,
      [saldoNuevo, fecha, cuenta.id],
    )

    const [resultMov] = await connection.query(
      `INSERT INTO movimientos_cuenta_corriente_empleado (
        cuenta_corriente_empleado_id, usuario_id, caja_movimiento_id, tipo, monto,
        saldo_anterior, saldo_nuevo, registrado_por_usuario_id, notas, fecha
      ) VALUES (?, ?, NULL, 'pago', ?, ?, ?, ?, ?, ?)`,
      [
        cuenta.id,
        empleadoId,
        montoNum,
        saldoAnterior,
        saldoNuevo,
        req.user.id,
        notas?.trim() || `Liquidación / pago de cuenta corriente - ${usuarios[0].nombre}`,
        fecha,
      ],
    )

    await connection.commit()

    res.status(201).json({
      message: "Pago de cuenta corriente registrado correctamente",
      cuenta_corriente: mapearCuenta({ ...cuenta, saldo: saldoNuevo, fecha_ultimo_movimiento: fecha }, usuarios[0]),
      movimiento: {
        id: resultMov.insertId,
        tipo: "pago",
        monto: montoNum,
        saldo_anterior: saldoAnterior,
        saldo_nuevo: saldoNuevo,
      },
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error en registrarPagoCuentaCorrienteEmpleado:", error)
    res.status(500).json({ message: "Error al registrar pago de cuenta corriente del empleado" })
  } finally {
    connection.release()
  }
}

export const PREFIJO_CONCEPTO_RETIRO_EMPLEADO = PREFIJO_CONCEPTO_RETIRO
