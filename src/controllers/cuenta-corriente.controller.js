import pool from "../db.js"
import { validationResult } from "express-validator"

// Obtener todas las cuentas corrientes
export const getCuentasCorrientes = async (req, res) => {
  try {
    const [cuentas] = await pool.query(`
            SELECT 
                cc.id, 
                cc.cliente_id, 
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                cc.limite_credito, 
                cc.saldo, 
                cc.fecha_ultimo_movimiento,
                cc.activo,
                cc.fecha_creacion
            FROM cuentas_corrientes cc
            JOIN clientes c ON cc.cliente_id = c.id
            ORDER BY c.nombre ASC
        `)

    res.json(cuentas)
  } catch (error) {
    console.error("Error al obtener cuentas corrientes:", error)
    res.status(500).json({ message: "Error al obtener cuentas corrientes" })
  }
}

// Obtener cuenta corriente por ID de cliente
export const getCuentaCorrienteByCliente = async (req, res) => {
  try {
    const { cliente_id } = req.params

    // Verificar si el cliente existe
    const [clientes] = await pool.query("SELECT * FROM clientes WHERE id = ?", [cliente_id])

    if (clientes.length === 0) {
      return res.status(404).json({ message: "Cliente no encontrado" })
    }

    // Obtener la cuenta corriente
    const [cuentas] = await pool.query(
      `
            SELECT 
                cc.id, 
                cc.cliente_id, 
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                cc.limite_credito, 
                cc.saldo, 
                cc.fecha_ultimo_movimiento,
                cc.activo,
                cc.fecha_creacion
            FROM cuentas_corrientes cc
            JOIN clientes c ON cc.cliente_id = c.id
            WHERE cc.cliente_id = ?
        `,
      [cliente_id],
    )

    // Si el cliente no tiene cuenta corriente, crear una respuesta con valores predeterminados
    if (cuentas.length === 0) {
      return res.status(404).json({
        message: "El cliente no tiene cuenta corriente",
        cliente_id: cliente_id,
        cliente_nombre: clientes[0].nombre,
      })
    }

    // Obtener los últimos movimientos con zona horaria local
    const [movimientos] = await pool.query(
      `
            SELECT 
                m.id,
                m.tipo,
                m.monto,
                m.saldo_anterior,
                m.saldo_nuevo,
                m.referencia_id,
                m.tipo_referencia,
                CONVERT_TZ(m.fecha, '+00:00', '-03:00') as fecha,
                m.notas,
                u.nombre AS usuario_nombre
            FROM movimientos_cuenta_corriente m
            JOIN usuarios u ON m.usuario_id = u.id
            WHERE m.cuenta_corriente_id = ?
            ORDER BY m.fecha DESC
            LIMIT 20
        `,
      [cuentas[0].id],
    )

    // Construir la respuesta
    const cuenta = {
      ...cuentas[0],
      movimientos,
    }

    res.json(cuenta)
  } catch (error) {
    console.error("Error al obtener cuenta corriente:", error)
    res.status(500).json({ message: "Error al obtener cuenta corriente" })
  }
}

// Crear o actualizar cuenta corriente
export const createOrUpdateCuentaCorriente = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { cliente_id, limite_credito, activo } = req.body

  try {
    // Verificar si el cliente existe
    const [clientes] = await pool.query("SELECT * FROM clientes WHERE id = ?", [cliente_id])

    if (clientes.length === 0) {
      return res.status(404).json({ message: "Cliente no encontrado" })
    }

    // Verificar si ya existe una cuenta corriente para este cliente
    const [cuentas] = await pool.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ?", [cliente_id])

    if (cuentas.length > 0) {
      // Actualizar la cuenta existente
      await pool.query("UPDATE cuentas_corrientes SET limite_credito = ?, activo = ? WHERE id = ?", [
        limite_credito || 0,
        activo !== undefined ? activo : 1,
        cuentas[0].id,
      ])

      res.json({
        id: cuentas[0].id,
        cliente_id,
        limite_credito: limite_credito || 0,
        activo: activo !== undefined ? activo : 1,
        message: "Cuenta corriente actualizada exitosamente",
      })
    } else {
      // Crear una nueva cuenta
      const [result] = await pool.query(
        "INSERT INTO cuentas_corrientes (cliente_id, limite_credito, activo) VALUES (?, ?, ?)",
        [cliente_id, limite_credito || 0, activo !== undefined ? activo : 1],
      )

      res.status(201).json({
        id: result.insertId,
        cliente_id,
        limite_credito: limite_credito || 0,
        activo: activo !== undefined ? activo : 1,
        message: "Cuenta corriente creada exitosamente",
      })
    }
  } catch (error) {
    console.error("Error al crear/actualizar cuenta corriente:", error)
    res.status(500).json({ message: "Error al crear/actualizar cuenta corriente" })
  }
}

// Registrar pago en cuenta corriente
export const registrarPago = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { cliente_id, monto, tipo_pago, punto_venta_id, notas } = req.body

  // Obtener el ID del usuario desde el token JWT
  const usuario_id = req.user.id

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Verificar si el cliente existe
    const [clientes] = await connection.query("SELECT * FROM clientes WHERE id = ?", [cliente_id])

    if (clientes.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Cliente no encontrado" })
    }

    // Verificar si el cliente tiene cuenta corriente
    const [cuentas] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ?", [cliente_id])

    if (cuentas.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "El cliente no tiene cuenta corriente" })
    }

    if (!cuentas[0].activo) {
      await connection.rollback()
      return res.status(400).json({ message: "La cuenta corriente está inactiva" })
    }

    // Obtener el saldo actual de la cuenta corriente y convertirlo a número
    const cuentaCorriente = cuentas[0]
    const saldoActual = Number.parseFloat(cuentaCorriente.saldo)
    const montoNumerico = Number.parseFloat(monto)

    // Validar que el monto no exceda el saldo
    if (montoNumerico > saldoActual) {
      await connection.rollback()
      return res.status(400).json({ message: "El monto del pago excede el saldo de la cuenta" })
    }

    // Calcular nuevo saldo
    const nuevoSaldo = saldoActual - montoNumerico

    // Registrar el pago con zona horaria local
    const [resultPago] = await connection.query(
      `
      INSERT INTO pagos (
        monto, 
        fecha, 
        referencia_id, 
        tipo_referencia, 
        tipo_pago, 
        cliente_id, 
        usuario_id, 
        punto_venta_id, 
        notas
      ) VALUES (?, CONVERT_TZ(NOW(), '+00:00', '-03:00'), ?, 'cuenta_corriente', ?, ?, ?, ?, ?)
    `,
      [
        montoNumerico,
        cuentaCorriente.id,
        tipo_pago || "Efectivo",
        cliente_id,
        usuario_id,
        punto_venta_id || 1,
        notas || `Pago en cuenta corriente. Saldo anterior: ${saldoActual.toFixed(2)}`,
      ],
    )

    // Actualizar saldo de la cuenta corriente
    await connection.query(
      `
      UPDATE cuentas_corrientes 
      SET saldo = ?, fecha_ultimo_movimiento = CONVERT_TZ(NOW(), '+00:00', '-03:00') 
      WHERE id = ?
    `,
      [nuevoSaldo, cuentaCorriente.id],
    )

    // Registrar movimiento en la cuenta corriente con zona horaria local
    const [resultMovimiento] = await connection.query(
      `
      INSERT INTO movimientos_cuenta_corriente (
        cuenta_corriente_id, 
        tipo, 
        monto, 
        saldo_anterior, 
        saldo_nuevo, 
        referencia_id, 
        tipo_referencia, 
        fecha, 
        usuario_id, 
        notas
      ) VALUES (?, 'pago', ?, ?, ?, ?, 'otro', CONVERT_TZ(NOW(), '+00:00', '-03:00'), ?, ?)
    `,
      [
        cuentaCorriente.id,
        montoNumerico,
        saldoActual.toFixed(2),
        nuevoSaldo.toFixed(2),
        resultPago.insertId,
        usuario_id,
        notas || `Pago en cuenta corriente`,
      ],
    )

    await connection.commit()

    // Obtener el movimiento creado con zona horaria local
    const [movimiento] = await connection.query(
      `
      SELECT m.*, CONVERT_TZ(m.fecha, '+00:00', '-03:00') as fecha_formateada
      FROM movimientos_cuenta_corriente m
      WHERE m.id = ?
    `,
      [resultMovimiento.insertId],
    )

    res.status(201).json({
      ...movimiento[0],
      message: "Pago registrado exitosamente",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al registrar pago:", error)
    res.status(500).json({ message: "Error al registrar pago: " + error.message })
  } finally {
    connection.release()
  }
}

// Obtener movimientos de cuenta corriente
export const getMovimientosCuentaCorriente = async (req, res) => {
  try {
    const { cuenta_id } = req.params
    const { fecha_inicio, fecha_fin, tipo } = req.query

    // Verificar si la cuenta existe
    const [cuentas] = await pool.query("SELECT * FROM cuentas_corrientes WHERE id = ?", [cuenta_id])

    if (cuentas.length === 0) {
      return res.status(404).json({ message: "Cuenta corriente no encontrada" })
    }

    let sql = `
            SELECT 
                m.id,
                m.tipo,
                m.monto,
                m.saldo_anterior,
                m.saldo_nuevo,
                m.referencia_id,
                m.tipo_referencia,
                CONVERT_TZ(m.fecha, '+00:00', '-03:00') as fecha,
                m.notas,
                u.nombre AS usuario_nombre
            FROM movimientos_cuenta_corriente m
            JOIN usuarios u ON m.usuario_id = u.id
            WHERE m.cuenta_corriente_id = ?
        `

    const params = [cuenta_id]

    // Filtrar por fecha de inicio
    if (fecha_inicio) {
      sql += " AND DATE(CONVERT_TZ(m.fecha, '+00:00', '-03:00')) >= ?"
      params.push(fecha_inicio)
    }

    // Filtrar por fecha de fin
    if (fecha_fin) {
      sql += " AND DATE(CONVERT_TZ(m.fecha, '+00:00', '-03:00')) <= ?"
      params.push(fecha_fin)
    }

    // Filtrar por tipo
    if (tipo) {
      sql += " AND m.tipo = ?"
      params.push(tipo)
    }

    // Ordenar por fecha descendente
    sql += " ORDER BY m.fecha DESC"

    const [movimientos] = await pool.query(sql, params)

    res.json(movimientos)
  } catch (error) {
    console.error("Error al obtener movimientos:", error)
    res.status(500).json({ message: "Error al obtener movimientos" })
  }
}