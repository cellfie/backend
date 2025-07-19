import pool from "../db.js"
import { validationResult } from "express-validator"

// Obtener todos los pagos
export const getPagos = async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, cliente_id, punto_venta_id, tipo_referencia, anulados } = req.query

    let sql = `
            SELECT 
                p.id, 
                p.monto, 
                p.fecha,
                p.tipo_referencia,
                p.referencia_id,
                p.notas,
                p.anulado,
                p.fecha_anulacion,
                p.motivo_anulacion,
                c.id AS cliente_id,
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                u.id AS usuario_id,
                u.nombre AS usuario_nombre,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta_nombre,
                p.tipo_pago AS tipo_pago_nombre
            FROM pagos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            JOIN usuarios u ON p.usuario_id = u.id
            JOIN puntos_venta pv ON p.punto_venta_id = pv.id
            WHERE 1=1
        `

    const params = []

    // Filtrar por fecha de inicio
    if (fecha_inicio) {
      sql += ` AND DATE(p.fecha) >= ?`
      params.push(fecha_inicio)
    }

    // Filtrar por fecha de fin
    if (fecha_fin) {
      sql += ` AND DATE(p.fecha) <= ?`
      params.push(fecha_fin)
    }

    // Filtrar por cliente
    if (cliente_id) {
      sql += ` AND p.cliente_id = ?`
      params.push(cliente_id)
    }

    // Filtrar por punto de venta
    if (punto_venta_id) {
      sql += ` AND p.punto_venta_id = ?`
      params.push(punto_venta_id)
    }

    // Filtrar por tipo de referencia
    if (tipo_referencia) {
      sql += ` AND p.tipo_referencia = ?`
      params.push(tipo_referencia)
    }

    // Filtrar por estado de anulación
    if (anulados !== undefined) {
      sql += ` AND p.anulado = ?`
      params.push(anulados === "true" ? 1 : 0)
    }

    // Ordenar por fecha descendente
    sql += ` ORDER BY p.fecha DESC`

    const [pagos] = await pool.query(sql, params)

    res.json(pagos)
  } catch (error) {
    console.error("Error al obtener pagos:", error)
    res.status(500).json({ message: "Error al obtener pagos" })
  }
}

// Obtener un pago por ID
export const getPagoById = async (req, res) => {
  try {
    const { id } = req.params

    const [pagos] = await pool.query(
      `
            SELECT 
                p.id, 
                p.monto, 
                p.fecha,
                p.tipo_referencia,
                p.referencia_id,
                p.notas,
                p.anulado,
                p.fecha_anulacion,
                p.motivo_anulacion,
                c.id AS cliente_id,
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                u.id AS usuario_id,
                u.nombre AS usuario_nombre,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta_nombre,
                p.tipo_pago AS tipo_pago_nombre
            FROM pagos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            JOIN usuarios u ON p.usuario_id = u.id
            JOIN puntos_venta pv ON p.punto_venta_id = pv.id
            WHERE p.id = ?
            `,
      [id],
    )

    if (pagos.length === 0) {
      return res.status(404).json({ message: "Pago no encontrado" })
    }

    res.json(pagos[0])
  } catch (error) {
    console.error("Error al obtener pago:", error)
    res.status(500).json({ message: "Error al obtener pago" })
  }
}

// CORREGIDO: Modificar la función registrarPagoInterno para verificar tipo_pago en lugar de tipo_referencia
export const registrarPagoInterno = async (
  connection,
  { monto, tipo_pago, referencia_id, tipo_referencia, cliente_id, usuario_id, punto_venta_id, notas },
) => {
  // Verificar que el punto de venta existe
  const [puntosVenta] = await connection.query("SELECT * FROM puntos_venta WHERE id = ?", [punto_venta_id])
  if (puntosVenta.length === 0) {
    throw new Error("Punto de venta no encontrado")
  }

  // Verificar que el cliente existe si se proporciona un ID
  if (cliente_id) {
    const [clientes] = await connection.query("SELECT * FROM clientes WHERE id = ?", [cliente_id])
    if (clientes.length === 0) {
      throw new Error("Cliente no encontrado")
    }
  }

  // CORREGIDO: Si es un pago de cuenta corriente, actualizar el saldo (verificar tipo_pago en lugar de tipo_referencia)
  if (tipo_pago && tipo_pago.toLowerCase().includes("cuenta") && cliente_id) {
    // Verificar si el cliente tiene cuenta corriente
    const [cuentasCorrientes] = await connection.query(
      "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
      [cliente_id],
    )

    if (cuentasCorrientes.length === 0) {
      throw new Error("El cliente no tiene cuenta corriente activa")
    }

    const cuentaCorriente = cuentasCorrientes[0]

    // Convertir a números para evitar problemas con strings
    const saldoActual = Number.parseFloat(cuentaCorriente.saldo)
    const montoNumerico = Number.parseFloat(monto)

    // CORREGIDO: Para ventas con cuenta corriente, el saldo debe AUMENTAR (se agrega deuda)
    // No verificar límite aquí porque ya se verificó en el frontend
    const nuevoSaldo = saldoActual + montoNumerico

    await connection.query("UPDATE cuentas_corrientes SET saldo = ?, fecha_ultimo_movimiento = NOW() WHERE id = ?", [
      nuevoSaldo,
      cuentaCorriente.id,
    ])

    // CORREGIDO: Registrar movimiento como "cargo" (aumenta la deuda del cliente)
    await connection.query(
      `INSERT INTO movimientos_cuenta_corriente (
              cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
              referencia_id, tipo_referencia, usuario_id, notas, fecha
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        cuentaCorriente.id,
        "cargo", // CORREGIDO: Es un cargo (aumenta la deuda)
        montoNumerico,
        saldoActual,
        nuevoSaldo,
        referencia_id,
        tipo_referencia, // "venta" para ventas, "devolucion" para devoluciones
        usuario_id,
        notas ||
          `${tipo_referencia === "devolucion" ? "Devolución" : "Venta"} en cuenta corriente. Saldo anterior: ${saldoActual.toFixed(2)}, Nuevo saldo: ${nuevoSaldo.toFixed(2)}`,
      ],
    )
  }

  // Insertar el pago con el campo tipo_pago como string SIN conversión de zona horaria
  const [resultPago] = await connection.query(
    `INSERT INTO pagos (
            monto, tipo_pago, referencia_id, tipo_referencia, 
            cliente_id, usuario_id, punto_venta_id, notas, fecha
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [monto, tipo_pago, referencia_id, tipo_referencia, cliente_id, usuario_id, punto_venta_id, notas],
  )

  return {
    id: resultPago.insertId,
    monto,
    tipo_pago,
    tipo_referencia,
    cliente_id,
  }
}

// Crear un nuevo pago (endpoint API)
export const createPago = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { monto, tipo_pago, referencia_id, tipo_referencia, cliente_id, punto_venta_id, notas } = req.body

  const usuario_id = req.user.id

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    const resultado = await registrarPagoInterno(connection, {
      monto,
      tipo_pago,
      referencia_id,
      tipo_referencia,
      cliente_id,
      usuario_id,
      punto_venta_id,
      notas,
    })

    await connection.commit()

    res.status(201).json({
      ...resultado,
      message: "Pago registrado exitosamente",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear pago:", error)
    res.status(500).json({ message: "Error al crear pago: " + error.message })
  } finally {
    connection.release()
  }
}

// CORREGIDO: Anular un pago con lógica corregida para cuenta corriente
export const anularPago = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { id } = req.params
  const { motivo } = req.body
  const usuario_id = req.user.id

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Verificar que el pago existe y no está anulado
    const [pagos] = await connection.query("SELECT * FROM pagos WHERE id = ?", [id])

    if (pagos.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Pago no encontrado" })
    }

    const pago = pagos[0]

    if (pago.anulado) {
      await connection.rollback()
      return res.status(400).json({ message: "El pago ya está anulado" })
    }

    // CORREGIDO: Si es un pago de cuenta corriente, revertir el movimiento (verificar tipo_pago)
    if (pago.tipo_pago && pago.tipo_pago.toLowerCase().includes("cuenta") && pago.cliente_id) {
      // Obtener la cuenta corriente del cliente
      const [cuentasCorrientes] = await connection.query(
        "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
        [pago.cliente_id],
      )

      if (cuentasCorrientes.length > 0) {
        const cuentaCorriente = cuentasCorrientes[0]

        // CORREGIDO: Al anular un pago de cuenta corriente, el saldo debe DISMINUIR (se quita la deuda)
        const nuevoSaldo = cuentaCorriente.saldo - pago.monto
        await connection.query(
          "UPDATE cuentas_corrientes SET saldo = ?, fecha_ultimo_movimiento = NOW() WHERE id = ?",
          [nuevoSaldo, cuentaCorriente.id],
        )

        // CORREGIDO: Registrar movimiento de reversión como "pago" (disminuye la deuda)
        await connection.query(
          `INSERT INTO movimientos_cuenta_corriente (
                        cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
                        referencia_id, tipo_referencia, usuario_id, notas, fecha
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            cuentaCorriente.id,
            "pago", // CORREGIDO: Es un pago (disminuye la deuda)
            pago.monto,
            cuentaCorriente.saldo,
            nuevoSaldo,
            id,
            "ajuste",
            usuario_id,
            "Anulación de pago: " + motivo,
          ],
        )
      }
    }

    // Anular el pago SIN conversión de zona horaria
    await connection.query("UPDATE pagos SET anulado = 1, fecha_anulacion = NOW(), motivo_anulacion = ? WHERE id = ?", [
      motivo,
      id,
    ])

    await connection.commit()

    res.json({
      message: "Pago anulado exitosamente",
      id: pago.id,
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al anular pago:", error)
    res.status(500).json({ message: "Error al anular pago" })
  } finally {
    connection.release()
  }
}
