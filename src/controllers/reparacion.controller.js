import pool from "../db.js"
import { validationResult } from "express-validator"

// Importar la función para registrar acciones en el historial
import { registrarAccion } from "./historial-acciones.controller.js"

// Función para generar número de ticket único para reparaciones
const generarNumeroTicket = async (puntoVentaId) => {
  const fecha = new Date()
  const año = fecha.getFullYear().toString().substr(-2) // Últimos 2 dígitos del año
  const mes = String(fecha.getMonth() + 1).padStart(2, "0")
  const dia = String(fecha.getDate()).padStart(2, "0")
  const fechaFormateada = `${año}${mes}${dia}`
  const prefijo = `REP${fechaFormateada}`

  // Obtener el último número de ticket con este prefijo para este punto de venta
  const [ultimoTicket] = await pool.query(
    "SELECT numero_ticket FROM reparaciones WHERE numero_ticket LIKE ? AND punto_venta_id = ? ORDER BY id DESC LIMIT 1",
    [`${prefijo}%`, puntoVentaId],
  )

  let numero = 1
  if (ultimoTicket.length > 0 && ultimoTicket[0].numero_ticket) {
    // Extraer el número secuencial del último ticket
    const ultimoNumero = ultimoTicket[0].numero_ticket.toString()
    // Si el formato es REP + YYMMDD-XXXX
    if (ultimoNumero.startsWith("REP") && ultimoNumero.includes("-")) {
      const ultimoSecuencial = Number.parseInt(ultimoNumero.split("-")[1])
      if (!isNaN(ultimoSecuencial)) {
        numero = ultimoSecuencial + 1
      }
    }
  }

  // Formatear el número secuencial con ceros a la izquierda (4 dígitos)
  const secuencialFormateado = String(numero).padStart(4, "0")

  // Crear el número de ticket final con el formato REP + YYMMDD-XXXX
  return `${prefijo}-${secuencialFormateado}`
}

// Obtener todas las reparaciones
export const getReparaciones = async (req, res) => {
  try {
    // Parámetros de filtrado opcionales
    const { fecha_inicio, fecha_fin, cliente_id, punto_venta_id, estado } = req.query

    let query = `
      SELECT r.*, 
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
      WHERE 1=1
    `
    const queryParams = []

    // Aplicar filtros si se proporcionan
    if (fecha_inicio) {
      query += " AND DATE(r.fecha_ingreso) >= ?"
      queryParams.push(fecha_inicio)
    }
    if (fecha_fin) {
      query += " AND DATE(r.fecha_ingreso) <= ?"
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

    query += " ORDER BY r.fecha_ingreso DESC"

    const [reparaciones] = await pool.query(query, queryParams)

    // Para cada reparación, obtener el equipo y los detalles
    for (const reparacion of reparaciones) {
      // Obtener el equipo
      const [equipos] = await pool.query(
        `
        SELECT * FROM equipos_reparacion 
        WHERE reparacion_id = ?
      `,
        [reparacion.id],
      )

      reparacion.equipo = equipos.length > 0 ? equipos[0] : null

      // Obtener los detalles de la reparación
      const [detalles] = await pool.query(
        `
        SELECT * FROM detalles_reparacion 
        WHERE reparacion_id = ?
      `,
        [reparacion.id],
      )

      reparacion.detalles = detalles

      // Obtener los pagos de la reparación
      const [pagos] = await pool.query(
        `
        SELECT * FROM pagos_reparacion 
        WHERE reparacion_id = ?
      `,
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
    console.error("Error al obtener reparaciones:", error)
    res.status(500).json({ message: "Error al obtener reparaciones" })
  }
}

// Obtener una reparación por ID
export const getReparacionById = async (req, res) => {
  try {
    const { id } = req.params

    const [reparaciones] = await pool.query(
      `
      SELECT r.*, 
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
      WHERE r.id = ?
    `,
      [id],
    )

    if (reparaciones.length === 0) {
      return res.status(404).json({ message: "Reparación no encontrada" })
    }

    const reparacion = reparaciones[0]

    // Obtener el equipo
    const [equipos] = await pool.query(
      `
      SELECT * FROM equipos_reparacion 
      WHERE reparacion_id = ?
    `,
      [id],
    )

    reparacion.equipo = equipos.length > 0 ? equipos[0] : null

    // Obtener los detalles de la reparación
    const [detalles] = await pool.query(
      `
      SELECT * FROM detalles_reparacion 
      WHERE reparacion_id = ?
    `,
      [id],
    )

    reparacion.detalles = detalles

    // Obtener los pagos de la reparación
    const [pagos] = await pool.query(
      `
  SELECT pr.*, u.nombre as usuario_nombre
  FROM pagos_reparacion pr
  LEFT JOIN usuarios u ON pr.usuario_id = u.id
  WHERE pr.reparacion_id = ?
`,
      [id],
    )

    reparacion.pagos = pagos

    // Calcular el saldo pendiente
    const totalReparacion = Number.parseFloat(reparacion.total) || 0
    const totalPagado = Number.parseFloat(reparacion.total_pagado) || 0
    reparacion.saldo_pendiente = totalReparacion - totalPagado

    res.json(reparacion)
  } catch (error) {
    console.error("Error al obtener reparación:", error)
    res.status(500).json({ message: "Error al obtener reparación" })
  }
}

// Modificar la función createReparacion para registrar la acción de creación
export const createReparacion = async (req, res) => {
  // Validar los datos de entrada
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    // Extraer los datos del cuerpo de la solicitud
    const { cliente, equipo, reparaciones, pago, notas, punto_venta_id } = req.body

    // Verificar si se proporciona un punto de venta
    if (!punto_venta_id) {
      await connection.rollback()
      return res.status(400).json({ message: "Se requiere seleccionar un punto de venta" })
    }

    // Verificar que el punto de venta existe
    const [puntosVenta] = await connection.query("SELECT * FROM puntos_venta WHERE id = ?", [punto_venta_id])
    if (puntosVenta.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Punto de venta no encontrado" })
    }

    // Verificar si se proporciona un cliente
    if (!cliente) {
      await connection.rollback()
      return res.status(400).json({ message: "Se requiere información del cliente" })
    }

    // Manejar el cliente (existente o nuevo)
    let clienteId = null

    if (cliente.id) {
      // Verificar que el cliente existe
      const [clientesExistentes] = await connection.query("SELECT * FROM clientes WHERE id = ?", [cliente.id])

      if (clientesExistentes.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: "Cliente no encontrado" })
      }

      clienteId = cliente.id
    } else {
      // Crear un nuevo cliente
      if (!cliente.nombre) {
        await connection.rollback()
        return res.status(400).json({ message: "El nombre del cliente es obligatorio" })
      }

      const [resultCliente] = await connection.query("INSERT INTO clientes (nombre, telefono, dni) VALUES (?, ?, ?)", [
        cliente.nombre,
        cliente.telefono || null,
        cliente.dni || null,
      ])

      clienteId = resultCliente.insertId
    }

    // Generar un número de ticket único
    const numeroTicket = await generarNumeroTicket(punto_venta_id)

    // Calcular el total de la reparación
    let totalReparacion = 0
    for (const item of reparaciones) {
      totalReparacion += Number.parseFloat(item.precio) || 0
    }

    // Insertar la reparación
    const [resultReparacion] = await connection.query(
      `
      INSERT INTO reparaciones (
        numero_ticket, 
        cliente_id, 
        fecha_ingreso, 
        estado, 
        notas, 
        total, 
        usuario_id, 
        punto_venta_id
      ) VALUES (?, ?, NOW(), 'pendiente', ?, ?, ?, ?)
    `,
      [numeroTicket, clienteId, notas || null, totalReparacion, req.user.id, punto_venta_id],
    )

    const reparacionId = resultReparacion.insertId

    // Registrar la acción de creación en el historial
    await registrarAccion(reparacionId, "creacion", req.user.id, "Reparación registrada en el sistema", connection)

    // Insertar el equipo
    await connection.query(
      `
      INSERT INTO equipos_reparacion (
        reparacion_id, 
        marca, 
        modelo, 
        imei, 
        password, 
        descripcion
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      [
        reparacionId,
        equipo.marca,
        equipo.modelo || null,
        equipo.imei || null,
        equipo.password || null,
        equipo.descripcion || null,
      ],
    )

    // Insertar los detalles de la reparación
    for (const detalle of reparaciones) {
      await connection.query(
        `
        INSERT INTO detalles_reparacion (
          reparacion_id, 
          descripcion, 
          precio, 
          completado
        ) VALUES (?, ?, ?, 0)
      `,
        [reparacionId, detalle.descripcion, detalle.precio],
      )
    }

    // Procesar el pago si existe
    if (pago && pago.realizaPago && Number.parseFloat(pago.monto) > 0) {
      const montoPago = Number.parseFloat(pago.monto)

      // Verificar que el monto no exceda el total
      if (montoPago > totalReparacion) {
        await connection.rollback()
        return res.status(400).json({
          message: "El monto del pago no puede ser mayor al total de la reparación",
        })
      }

      // Si es cuenta corriente
      if (pago.metodo === "cuentaCorriente") {
        // Verificar si el cliente tiene cuenta corriente
        const [cuentasCorrientes] = await connection.query(
          "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
          [clienteId],
        )

        let cuentaCorrienteId
        let saldoAnterior = 0
        let nuevoSaldo = 0

        if (cuentasCorrientes.length === 0) {
          // Crear cuenta corriente para el cliente
          const [resultCuenta] = await connection.query(
            "INSERT INTO cuentas_corrientes (cliente_id, saldo, activo) VALUES (?, ?, 1)",
            [clienteId, montoPago],
          )
          cuentaCorrienteId = resultCuenta.insertId
          saldoAnterior = 0
          nuevoSaldo = montoPago
        } else {
          cuentaCorrienteId = cuentasCorrientes[0].id
          saldoAnterior = Number.parseFloat(cuentasCorrientes[0].saldo)
          nuevoSaldo = saldoAnterior + montoPago

          // Verificar límite de crédito si existe
          if (cuentasCorrientes[0].limite_credito > 0 && nuevoSaldo > cuentasCorrientes[0].limite_credito) {
            await connection.rollback()
            return res.status(400).json({
              message: "El pago excede el límite de crédito del cliente",
            })
          }

          // Actualizar saldo
          await connection.query(
            "UPDATE cuentas_corrientes SET saldo = ?, fecha_ultimo_movimiento = NOW() WHERE id = ?",
            [nuevoSaldo, cuentaCorrienteId],
          )
        }

        // Registrar movimiento en cuenta corriente
        const [resultMovimiento] = await connection.query(
          `INSERT INTO movimientos_cuenta_corriente (
            cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
            referencia_id, tipo_referencia, fecha, usuario_id, notas
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
          [
            cuentaCorrienteId,
            "cargo",
            montoPago,
            saldoAnterior,
            nuevoSaldo,
            reparacionId,
            "reparacion",
            req.user.id,
            `Cargo por reparación #${numeroTicket}`,
          ],
        )

        // Registrar pago de reparación
        const [resultPago] = await connection.query(
          `INSERT INTO pagos_reparacion (
            reparacion_id, monto, metodo_pago, fecha_pago, usuario_id, referencia_cuenta_corriente
          ) VALUES (?, ?, ?, NOW(), ?, ?)`,
          [reparacionId, montoPago, pago.metodo, req.user.id, resultMovimiento.insertId],
        )

        // Registrar la acción de pago en el historial
        await registrarAccion(
          reparacionId,
          "pago",
          req.user.id,
          `Pago de ${montoPago.toFixed(2)} con cuenta corriente`,
          connection,
        )
      } else {
        // Registrar pago normal
        const [resultPago] = await connection.query(
          `INSERT INTO pagos_reparacion (
            reparacion_id, monto, metodo_pago, fecha_pago, usuario_id
          ) VALUES (?, ?, ?, NOW(), ?)`,
          [reparacionId, montoPago, pago.metodo, req.user.id],
        )

        // Registrar la acción de pago en el historial
        await registrarAccion(
          reparacionId,
          "pago",
          req.user.id,
          `Pago de ${montoPago.toFixed(2)} con ${pago.metodo}`,
          connection,
        )
      }
    }

    await connection.commit()

    // Obtener la reparación completa para devolverla en la respuesta
    const [reparacionesResult] = await pool.query(
      `
      SELECT r.*, 
             c.nombre AS cliente_nombre,
             c.telefono AS cliente_telefono,
             u.nombre AS usuario_nombre,
             pv.nombre AS punto_venta_nombre
      FROM reparaciones r
      LEFT JOIN clientes c ON r.cliente_id = c.id
      LEFT JOIN usuarios u ON r.usuario_id = u.id
      LEFT JOIN puntos_venta pv ON r.punto_venta_id = pv.id
      WHERE r.id = ?
    `,
      [reparacionId],
    )

    const reparacion = reparacionesResult[0]

    // Obtener el equipo
    const [equipos] = await pool.query(
      `
      SELECT * FROM equipos_reparacion 
      WHERE reparacion_id = ?
    `,
      [reparacionId],
    )

    reparacion.equipo = equipos.length > 0 ? equipos[0] : null

    // Obtener los detalles de la reparación
    const [detallesReparacion] = await pool.query(
      `
      SELECT * FROM detalles_reparacion 
      WHERE reparacion_id = ?
    `,
      [reparacionId],
    )

    reparacion.detalles = detallesReparacion

    res.status(201).json(reparacion)
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear reparación:", error)
    res.status(500).json({ message: "Error al crear reparación: " + error.message })
  } finally {
    connection.release()
  }
}

// Modificar la función updateReparacion para registrar la acción de edición
export const updateReparacion = async (req, res) => {
  // Validar los datos de entrada
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const { id } = req.params
    const { reparaciones, notas } = req.body

    // Verificar que la reparación existe y no está cancelada
    const [reparacionesExistentes] = await connection.query(
      "SELECT * FROM reparaciones WHERE id = ? AND estado != 'cancelada'",
      [id],
    )
    if (reparacionesExistentes.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Reparación no encontrada o cancelada" })
    }

    // Actualizar las notas de la reparación
    await connection.query(
      `
      UPDATE reparaciones 
      SET notas = ? 
      WHERE id = ?
    `,
      [notas || null, id],
    )

    // Eliminar los detalles existentes
    await connection.query("DELETE FROM detalles_reparacion WHERE reparacion_id = ?", [id])

    // Insertar los nuevos detalles
    let totalReparacion = 0
    for (const detalle of reparaciones) {
      await connection.query(
        `
        INSERT INTO detalles_reparacion (
          reparacion_id, 
          descripcion, 
          precio, 
          completado
        ) VALUES (?, ?, ?, 0)
      `,
        [id, detalle.descripcion, detalle.precio],
      )

      totalReparacion += Number.parseFloat(detalle.precio)
    }

    // Actualizar el total de la reparación
    await connection.query(
      `
      UPDATE reparaciones 
      SET total = ? 
      WHERE id = ?
    `,
      [totalReparacion, id],
    )

    // Registrar la acción de edición en el historial
    await registrarAccion(
      id,
      "edicion",
      req.user.id,
      `Reparación editada: actualización de detalles y total a ${totalReparacion.toFixed(2)}`,
      connection,
    )

    await connection.commit()

    // Obtener la reparación actualizada
    const [reparacionesActualizadas] = await pool.query(
      `
      SELECT r.*, 
             c.nombre AS cliente_nombre,
             c.telefono AS cliente_telefono,
             u.nombre AS usuario_nombre,
             pv.nombre AS punto_venta_nombre,
             (SELECT SUM(pr.monto) FROM pagos_reparacion pr WHERE pr.reparacion_id = r.id) AS total_pagado
      FROM reparaciones r
      LEFT JOIN clientes c ON r.cliente_id = c.id
      LEFT JOIN usuarios u ON r.usuario_id = u.id
      LEFT JOIN puntos_venta pv ON r.punto_venta_id = pv.id
      WHERE r.id = ?
    `,
      [id],
    )

    const reparacion = reparacionesActualizadas[0]

    // Obtener el equipo
    const [equipos] = await pool.query(
      `
      SELECT * FROM equipos_reparacion 
      WHERE reparacion_id = ?
    `,
      [id],
    )

    reparacion.equipo = equipos.length > 0 ? equipos[0] : null

    // Obtener los detalles de la reparación
    const [detalles] = await pool.query(
      `
      SELECT * FROM detalles_reparacion 
      WHERE reparacion_id = ?
    `,
      [id],
    )

    reparacion.detalles = detalles

    // Obtener los pagos de la reparación
    const [pagos] = await pool.query(
      `
      SELECT * FROM pagos_reparacion 
      WHERE reparacion_id = ?
    `,
      [id],
    )

    reparacion.pagos = pagos

    // Calcular el saldo pendiente
    const totalReparacionActualizada = Number.parseFloat(reparacion.total) || 0
    const totalPagado = Number.parseFloat(reparacion.total_pagado) || 0
    reparacion.saldo_pendiente = totalReparacionActualizada - totalPagado

    res.json(reparacion)
  } catch (error) {
    await connection.rollback()
    console.error("Error al actualizar reparación:", error)
    res.status(500).json({ message: "Error al actualizar reparación" })
  } finally {
    connection.release()
  }
}

// Modificar la función updateEstadoReparacion para registrar la acción de cambio de estado
export const updateEstadoReparacion = async (req, res) => {
  // Validar los datos de entrada
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const { id } = req.params
    const { estado, notas } = req.body

    // Verificar que la reparación existe y no está cancelada
    const [reparaciones] = await connection.query("SELECT * FROM reparaciones WHERE id = ? AND estado != 'cancelada'", [
      id,
    ])
    if (reparaciones.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Reparación no encontrada o cancelada" })
    }

    const reparacion = reparaciones[0]

    // Verificar que el estado es válido
    const estadosValidos = ["pendiente", "terminada", "entregada", "cancelada"]
    if (!estadosValidos.includes(estado)) {
      await connection.rollback()
      return res.status(400).json({ message: "Estado no válido" })
    }

    // Si se está marcando como entregada, verificar que esté pagada completamente
    if (estado === "entregada") {
      const [pagos] = await connection.query(
        "SELECT SUM(monto) as total_pagado FROM pagos_reparacion WHERE reparacion_id = ?",
        [id],
      )
      const totalPagado = pagos[0].total_pagado || 0
      const totalReparacion = Number.parseFloat(reparacion.total) || 0

      if (totalPagado < totalReparacion) {
        await connection.rollback()
        return res.status(400).json({
          message: "No se puede marcar como entregada porque no está pagada completamente",
          saldoPendiente: totalReparacion - totalPagado,
        })
      }
    }

    // Actualizar el estado de la reparación
    let query = "UPDATE reparaciones SET estado = ?"
    const queryParams = [estado]

    // Si se proporciona notas, actualizarlas también
    if (notas !== undefined) {
      query += ", notas = ?"
      queryParams.push(notas)
    }

    // Si se está marcando como entregada, actualizar la fecha de entrega
    if (estado === "entregada") {
      query += ", fecha_entrega = NOW()"
    }

    query += " WHERE id = ?"
    queryParams.push(id)

    await connection.query(query, queryParams)

    // Si se está marcando como terminada, marcar todos los detalles como completados
    if (estado === "terminada") {
      await connection.query(
        `
        UPDATE detalles_reparacion 
        SET completado = 1, fecha_completado = NOW() 
        WHERE reparacion_id = ? AND completado = 0
      `,
        [id],
      )
    }

    // Registrar la acción en el historial
    let detallesAccion = ""
    if (estado === "terminada") {
      detallesAccion = "Reparación finalizada"
      if (notas) detallesAccion += `: ${notas}`
    } else if (estado === "entregada") {
      detallesAccion = "Equipo entregado al cliente"
    } else if (estado === "cancelada") {
      detallesAccion = notas || "Reparación cancelada"
    } else {
      detallesAccion = `Estado cambiado a ${estado}`
      if (notas) detallesAccion += `: ${notas}`
    }

    await registrarAccion(id, estado, req.user.id, detallesAccion, connection)

    await connection.commit()

    res.json({ message: `Reparación marcada como ${estado}` })
  } catch (error) {
    await connection.rollback()
    console.error("Error al actualizar estado de reparación:", error)
    res.status(500).json({ message: "Error al actualizar estado de reparación" })
  } finally {
    connection.release()
  }
}

// Modificar la función cancelarReparacion para registrar la acción de cancelación
export const cancelarReparacion = async (req, res) => {
  // Validar los datos de entrada
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const { id } = req.params
    const { motivo } = req.body

    // Verificar que la reparación existe y no está cancelada
    const [reparaciones] = await connection.query("SELECT * FROM reparaciones WHERE id = ? AND estado != 'cancelada'", [
      id,
    ])
    if (reparaciones.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Reparación no encontrada o ya cancelada" })
    }

    // Obtener los pagos con cuenta corriente
    const [pagosCuentaCorriente] = await connection.query(
      `
      SELECT pr.*, mcc.cuenta_corriente_id, mcc.id as movimiento_id
      FROM pagos_reparacion pr
      LEFT JOIN movimientos_cuenta_corriente mcc ON pr.referencia_cuenta_corriente = mcc.id
      WHERE pr.reparacion_id = ? AND pr.metodo_pago = 'cuentaCorriente'
    `,
      [id],
    )

    // Revertir los pagos con cuenta corriente
    for (const pago of pagosCuentaCorriente) {
      if (pago.cuenta_corriente_id) {
        // Obtener el saldo actual de la cuenta corriente
        const [cuentas] = await connection.query("SELECT * FROM cuentas_corrientes WHERE id = ?", [
          pago.cuenta_corriente_id,
        ])
        if (cuentas.length > 0) {
          const cuenta = cuentas[0]
          const saldoActual = Number.parseFloat(cuenta.saldo)
          const montoPago = Number.parseFloat(pago.monto)

          // Actualizar el saldo de la cuenta corriente (restar el monto del pago)
          const nuevoSaldo = saldoActual - montoPago
          await connection.query(
            `
            UPDATE cuentas_corrientes 
            SET saldo = ?, fecha_ultimo_movimiento = NOW() 
            WHERE id = ?
          `,
            [nuevoSaldo, cuenta.id],
          )

          // Registrar el movimiento de reversión en la cuenta corriente
          await connection.query(
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
            ) VALUES (?, 'pago', ?, ?, ?, ?, 'anulacion_reparacion', NOW(), ?, ?)
          `,
            [
              cuenta.id,
              montoPago,
              saldoActual,
              nuevoSaldo,
              id,
              req.user.id,
              `Reversión de cargo por cancelación de reparación #${reparaciones[0].numero_ticket}`,
            ],
          )
        }
      }
    }

    // Actualizar el estado de la reparación a cancelada
    await connection.query(
      `
      UPDATE reparaciones 
      SET estado = 'cancelada', notas = CONCAT(IFNULL(notas, ''), '\n\nMotivo de cancelación: ', ?) 
      WHERE id = ?
    `,
      [motivo || "No especificado", id],
    )

    // Registrar la acción de cancelación en el historial
    await registrarAccion(id, "cancelada", req.user.id, motivo || "Reparación cancelada", connection)

    await connection.commit()

    res.json({ message: "Reparación cancelada correctamente" })
  } catch (error) {
    await connection.rollback()
    console.error("Error al cancelar reparación:", error)
    res.status(500).json({ message: "Error al cancelar reparación" })
  } finally {
    connection.release()
  }
}

// Modificar la función registrarPagoReparacion para registrar la acción de pago
export const registrarPagoReparacion = async (req, res) => {
  // Validar los datos de entrada
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const { id } = req.params
    const { monto, metodo_pago } = req.body

    // Verificar que la reparación existe y no está cancelada
    const [reparaciones] = await connection.query(
      `
      SELECT r.*, c.id as cliente_id, c.nombre as cliente_nombre,
             (SELECT SUM(pr.monto) FROM pagos_reparacion pr WHERE pr.reparacion_id = r.id) AS total_pagado
      FROM reparaciones r
      LEFT JOIN clientes c ON r.cliente_id = c.id
      WHERE r.id = ? AND r.estado != 'cancelada'
    `,
      [id],
    )
    if (reparaciones.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Reparación no encontrada o cancelada" })
    }

    const reparacion = reparaciones[0]
    const totalReparacion = Number.parseFloat(reparacion.total) || 0
    const totalPagadoRep = Number.parseFloat(reparacion.total_pagado) || 0
    const saldoPendiente = totalReparacion - totalPagadoRep
    const montoNumerico = Number.parseFloat(monto)

    // Verificar que el monto no exceda el saldo pendiente
    if (montoNumerico > saldoPendiente) {
      await connection.rollback()
      return res.status(400).json({
        message: `El monto no puede ser mayor al saldo pendiente (${saldoPendiente.toFixed(2)})`,
      })
    }

    let referenciaCuentaCorriente = null

    // Si el método de pago es cuenta corriente, actualizar el saldo
    if (metodo_pago === "cuentaCorriente") {
      if (!reparacion.cliente_id) {
        await connection.rollback()
        return res.status(400).json({ message: "No se puede usar cuenta corriente sin un cliente asociado" })
      }

      // Verificar si el cliente tiene cuenta corriente
      const [cuentas] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1", [
        reparacion.cliente_id,
      ])

      let cuentaCorrienteId
      let saldoAnterior = 0
      let nuevoSaldo = 0
      if (cuentas.length === 0) {
        // Crear una cuenta corriente para el cliente
        const [resultCuenta] = await connection.query(
          "INSERT INTO cuentas_corrientes (cliente_id, saldo, activo) VALUES (?, ?, 1)",
          [reparacion.cliente_id, montoNumerico],
        )
        cuentaCorrienteId = resultCuenta.insertId
        saldoAnterior = 0
        nuevoSaldo = montoNumerico
      } else {
        // Actualizar la cuenta existente
        cuentaCorrienteId = cuentas[0].id
        saldoAnterior = Number.parseFloat(cuentas[0].saldo)
        nuevoSaldo = saldoAnterior + montoNumerico

        // Verificar límite de crédito si existe
        if (cuentas[0].limite_credito > 0 && nuevoSaldo > cuentas[0].limite_credito) {
          await connection.rollback()
          return res.status(400).json({
            message: `El pago excede el límite de crédito del cliente (${Number.parseFloat(
              cuentas[0].limite_credito,
            ).toFixed(2)})`,
          })
        }

        await connection.query(
          `
          UPDATE cuentas_corrientes 
          SET saldo = ?, fecha_ultimo_movimiento = NOW() 
          WHERE id = ?
        `,
          [nuevoSaldo, cuentaCorrienteId],
        )
      }

      // Registrar el movimiento en la cuenta corriente
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
        ) VALUES (?, 'cargo', ?, ?, ?, ?, 'reparacion', NOW(), ?, ?)
      `,
        [
          cuentaCorrienteId,
          montoNumerico,
          saldoAnterior,
          nuevoSaldo,
          id,
          req.user.id,
          `Cargo por reparación #${reparacion.numero_ticket} - ${reparacion.cliente_nombre}`,
        ],
      )

      referenciaCuentaCorriente = resultMovimiento.insertId
    }

    // Registrar el pago
    const [resultPago] = await connection.query(
      `
      INSERT INTO pagos_reparacion (
        reparacion_id, 
        monto, 
        metodo_pago, 
        fecha_pago, 
        usuario_id, 
        referencia_cuenta_corriente
      ) VALUES (?, ?, ?, NOW(), ?, ?)
    `,
      [id, montoNumerico, metodo_pago, req.user.id, referenciaCuentaCorriente],
    )

    // Registrar la acción de pago en el historial
    await registrarAccion(
      id,
      "pago",
      req.user.id,
      `Pago de ${montoNumerico.toFixed(2)} con ${
        metodo_pago === "efectivo"
          ? "efectivo"
          : metodo_pago === "tarjeta"
            ? "tarjeta"
            : metodo_pago === "transferencia"
              ? "transferencia"
              : metodo_pago === "cuentaCorriente"
                ? "cuenta corriente"
                : "método desconocido"
      }`,
      connection,
    )

    // Si con este pago se completa el total, y la reparación está terminada, preguntar si desea marcarla como entregada
    const nuevoTotalPagado = totalPagadoRep + montoNumerico
    const pagadaCompletamente = nuevoTotalPagado >= totalReparacion

    await connection.commit()

    res.status(201).json({
      message: "Pago registrado correctamente",
      pagadaCompletamente,
      puedeMarcarEntregada: pagadaCompletamente && reparacion.estado === "terminada",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al registrar pago:", error)
    res.status(500).json({ message: "Error al registrar pago" })
  } finally {
    connection.release()
  }
}

// Obtener estadísticas de reparaciones
export const getEstadisticasReparaciones = async (req, res) => {
  try {
    // Parámetros de filtrado opcionales
    const { fecha_inicio, fecha_fin, punto_venta_id } = req.query

    // Construir la cláusula WHERE base
    let whereClause = "1=1"
    const queryParams = []

    // Aplicar filtros si se proporcionan
    if (fecha_inicio) {
      whereClause += " AND DATE(r.fecha_ingreso) >= ?"
      queryParams.push(fecha_inicio)
    }
    if (fecha_fin) {
      whereClause += " AND DATE(r.fecha_ingreso) <= ?"
      queryParams.push(fecha_fin)
    }
    if (punto_venta_id) {
      whereClause += " AND r.punto_venta_id = ?"
      queryParams.push(punto_venta_id)
    }

    // Obtener el total de reparaciones
    const [totalReparaciones] = await pool.query(
      `
      SELECT COUNT(*) as total FROM reparaciones r WHERE ${whereClause}
    `,
      queryParams,
    )

    // Obtener el total por estado
    const [totalPorEstado] = await pool.query(
      `
      SELECT 
        estado, 
        COUNT(*) as total 
      FROM reparaciones r 
      WHERE ${whereClause} 
      GROUP BY estado
    `,
      queryParams,
    )

    // Obtener el total de ingresos
    const [totalIngresos] = await pool.query(
      `
      SELECT 
        SUM(pr.monto) as total 
      FROM pagos_reparacion pr
      JOIN reparaciones r ON pr.reparacion_id = r.id
      WHERE ${whereClause}
    `,
      queryParams,
    )

    // Obtener el total de ingresos por método de pago
    const [ingresosPorMetodo] = await pool.query(
      `
      SELECT 
        pr.metodo_pago, 
        SUM(pr.monto) as total 
      FROM pagos_reparacion pr
      JOIN reparaciones r ON pr.reparacion_id = r.id
      WHERE ${whereClause}
      GROUP BY pr.metodo_pago
    `,
      queryParams,
    )

    // Obtener el total de reparaciones por día
    const [reparacionesPorDia] = await pool.query(
      `
      SELECT 
        DATE(r.fecha_ingreso) as fecha, 
        COUNT(*) as total 
      FROM reparaciones r 
      WHERE ${whereClause} 
      GROUP BY DATE(r.fecha_ingreso)
      ORDER BY fecha
    `,
      queryParams,
    )

    // Obtener el total de ingresos por día
    const [ingresosPorDia] = await pool.query(
      `
      SELECT 
        DATE(pr.fecha_pago) as fecha, 
        SUM(pr.monto) as total 
      FROM pagos_reparacion pr
      JOIN reparaciones r ON pr.reparacion_id = r.id
      WHERE ${whereClause}
      GROUP BY DATE(pr.fecha_pago)
      ORDER BY fecha
    `,
      queryParams,
    )

    res.json({
      totalReparaciones: totalReparaciones[0].total,
      totalPorEstado,
      totalIngresos: totalIngresos[0].total || 0,
      ingresosPorMetodo,
      reparacionesPorDia,
      ingresosPorDia,
    })
  } catch (error) {
    console.error("Error al obtener estadísticas:", error)
    res.status(500).json({ message: "Error al obtener estadísticas" })
  }
}
