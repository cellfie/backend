import pool from "../../db.js"
import { validationResult } from "express-validator"
import { formatearFechaParaDB } from "../../utils/dateUtils.js"

// Generar número de factura único para ventas de equipos
const generarNumeroFactura = async () => {
  const fecha = new Date()
  const año = fecha.getFullYear().toString().substr(-2)
  const mes = (fecha.getMonth() + 1).toString().padStart(2, "0")
  const dia = fecha.getDate().toString().padStart(2, "0")
  const prefijo = `E${año}${mes}${dia}`

  const [ultimaFactura] = await pool.query(
    "SELECT numero_factura FROM ventas_equipos WHERE numero_factura LIKE ? ORDER BY id DESC LIMIT 1",
    [`${prefijo}%`],
  )

  let numero = 1
  if (ultimaFactura.length > 0 && ultimaFactura[0].numero_factura) {
    const ultimoNumeroStr = ultimaFactura[0].numero_factura.split("-")[1]
    if (ultimoNumeroStr) {
      const ultimoNumero = Number.parseInt(ultimoNumeroStr)
      if (!Number.isNaN(ultimoNumero)) {
        numero = ultimoNumero + 1
      }
    }
  }
  return `${prefijo}-${numero.toString().padStart(4, "0")}`
}

// Obtener todas las ventas de equipos
export const getVentasEquipos = async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, cliente_id, punto_venta_id, anuladas, estado_pago_filter } = req.query

    let sql = `
            SELECT 
                v.id, 
                v.numero_factura, 
                v.fecha, 
                v.precio_usd,
                v.precio_ars,
                v.tipo_cambio,
                v.porcentaje_interes,
                v.monto_interes,
                v.porcentaje_descuento,
                v.monto_descuento,
                v.total_usd,
                v.total_ars,
                v.anulada,
                v.fecha_anulacion,
                v.motivo_anulacion,
                v.estado_pago,
                v.total_pagado_usd,
                v.total_pagado_ars,
                v.saldo_pendiente_usd,
                v.saldo_pendiente_ars,
                v.fecha_ultimo_pago,
                c.id AS cliente_id,
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                u.id AS usuario_id,
                u.nombre AS usuario_nombre,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta_nombre,
                v.tipo_pago, -- Este campo podría ser 'Multiple' o el tipo del primer pago
                e.id AS equipo_id,
                e.marca,
                e.modelo,
                e.imei
            FROM ventas_equipos v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            JOIN usuarios u ON v.usuario_id = u.id
            JOIN puntos_venta pv ON v.punto_venta_id = pv.id
            JOIN equipos e ON v.equipo_id = e.id
            WHERE 1=1
        `
    const params = []

    if (fecha_inicio) {
      sql += ` AND DATE(v.fecha) >= ?`
      params.push(fecha_inicio)
    }
    if (fecha_fin) {
      sql += ` AND DATE(v.fecha) <= ?`
      params.push(fecha_fin)
    }
    if (cliente_id) {
      sql += ` AND v.cliente_id = ?`
      params.push(cliente_id)
    }
    if (punto_venta_id) {
      sql += ` AND v.punto_venta_id = ?`
      params.push(punto_venta_id)
    }
    if (anuladas !== undefined) {
      sql += ` AND v.anulada = ?`
      params.push(anuladas === "true" ? 1 : 0)
    }
    if (estado_pago_filter) {
      sql += ` AND v.estado_pago = ?`
      params.push(estado_pago_filter)
    }

    sql += ` ORDER BY v.fecha DESC`

    const [ventas] = await pool.query(sql, params)
    res.json(ventas)
  } catch (error) {
    console.error("Error al obtener ventas de equipos:", error)
    res.status(500).json({ message: "Error al obtener ventas de equipos" })
  }
}

// Obtener una venta de equipo por ID
export const getVentaEquipoById = async (req, res) => {
  try {
    const { id } = req.params
    const [ventas] = await pool.query(
      `
            SELECT 
                v.id, v.numero_factura, v.fecha, v.precio_usd, v.precio_ars,
                v.tipo_cambio, v.porcentaje_interes, v.monto_interes,
                v.porcentaje_descuento, v.monto_descuento, v.total_usd, v.total_ars,
                v.anulada, v.fecha_anulacion, v.motivo_anulacion,
                v.estado_pago, v.total_pagado_usd, v.total_pagado_ars,
                v.saldo_pendiente_usd, v.saldo_pendiente_ars, v.fecha_ultimo_pago,
                c.id AS cliente_id, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
                u.id AS usuario_id, u.nombre AS usuario_nombre,
                pv.id AS punto_venta_id, pv.nombre AS punto_venta_nombre,
                v.tipo_pago AS tipo_pago_venta, -- Tipo de pago general de la venta
                e.id AS equipo_id, e.marca, e.modelo, e.memoria, e.color, e.bateria,
                e.descripcion, e.imei, e.tipo_cambio AS equipo_tipo_cambio,
                e.tipo_cambio_original AS equipo_tipo_cambio_original
            FROM ventas_equipos v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            JOIN usuarios u ON v.usuario_id = u.id
            JOIN puntos_venta pv ON v.punto_venta_id = pv.id
            JOIN equipos e ON v.equipo_id = e.id
            WHERE v.id = ?
        `,
      [id],
    )

    if (ventas.length === 0) {
      return res.status(404).json({ message: "Venta de equipo no encontrada" })
    }

    const [planCanje] = await pool.query("SELECT * FROM plan_canje WHERE venta_equipo_id = ?", [id])
    const [pagosDetalle] = await pool.query(
      `SELECT id, monto_usd, monto_ars, tipo_pago, fecha_pago, notas, anulado 
       FROM pagos_ventas_equipos 
       WHERE venta_equipo_id = ? AND anulado = 0`,
      [id],
    )

    const venta = {
      ...ventas[0],
      plan_canje: planCanje.length > 0 ? planCanje[0] : null,
      pagos: pagosDetalle,
    }
    res.json(venta)
  } catch (error) {
    console.error("Error al obtener venta de equipo:", error)
    res.status(500).json({ message: "Error al obtener venta de equipo" })
  }
}

// Crear una nueva venta de equipo
export const createVentaEquipo = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const {
    cliente_id,
    punto_venta_id,
    equipo_id,
    porcentaje_interes = 0,
    porcentaje_descuento = 0,
    plan_canje = null,
    notas, // Notas generales de la venta
    pagos, // Array de pagos: [{ monto_usd, monto_ars, tipo_pago, notas_pago }]
    marcar_como_incompleta = false, // Flag para permitir guardar con pago parcial/pendiente
  } = req.body

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado" })
  }
  const usuario_id = req.user.id

  if (!pagos || !Array.isArray(pagos) || pagos.length === 0) {
     if (!marcar_como_incompleta) { // Si no se marca como incompleta y no hay pagos, es un error
        return res.status(400).json({ message: "Debe proporcionar al menos un método de pago o marcar la venta como incompleta." });
    }
    // Si se marca como incompleta y no hay pagos, se asume que es una venta pendiente de pago total.
  }


  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const fechaActual = formatearFechaParaDB()

    const [puntosVenta] = await connection.query("SELECT * FROM puntos_venta WHERE id = ?", [punto_venta_id])
    if (puntosVenta.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Punto de venta no encontrado" })
    }

    let clienteId = null
    if (cliente_id) {
      const [clientes] = await connection.query("SELECT * FROM clientes WHERE id = ?", [cliente_id])
      if (clientes.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: "Cliente no encontrado" })
      }
      clienteId = cliente_id
    }

    const [equipos] = await connection.query(
      "SELECT * FROM equipos WHERE id = ? AND (punto_venta_id = ? OR punto_venta_id IS NULL) AND vendido = 0", // Permite equipos sin punto de venta asignado explicitamente si es necesario, o ajustar esta lógica.
      [equipo_id, punto_venta_id],
    )
    if (equipos.length === 0) {
      await connection.rollback()
      return res.status(404).json({
        message: "Equipo no encontrado, no pertenece al punto de venta, o ya ha sido vendido",
      })
    }
    const equipo = equipos[0]

    const [tcRows] = await connection.query("SELECT valor FROM tipo_cambio ORDER BY fecha DESC LIMIT 1")
    const tipoCambioActual = tcRows.length > 0 ? Number.parseFloat(tcRows[0].valor) : equipo.tipo_cambio

    const precioUSD = equipo.precio
    const precioARS = precioUSD * tipoCambioActual
    let descuentoPlanCanjeUSD = 0
    if (plan_canje && plan_canje.precio) {
      descuentoPlanCanjeUSD = Number.parseFloat(plan_canje.precio)
    }

    const subtotalUSD = precioUSD - descuentoPlanCanjeUSD
    const montoInteresUSD = (subtotalUSD * porcentaje_interes) / 100
    const montoDescuentoUSD = (subtotalUSD * porcentaje_descuento) / 100
    const totalVentaUSD = subtotalUSD + montoInteresUSD - montoDescuentoUSD
    const totalVentaARS = totalVentaUSD * tipoCambioActual

    // Procesar pagos múltiples
    let totalPagadoUSD = 0
    let totalPagadoARS = 0
    if (pagos && pagos.length > 0) {
        pagos.forEach(p => {
            totalPagadoUSD += Number.parseFloat(p.monto_usd || 0);
            totalPagadoARS += Number.parseFloat(p.monto_ars || 0);
        });
    }


    let estadoPago
    const saldoPendienteUSD = totalVentaUSD - totalPagadoUSD
    const saldoPendienteARS = totalVentaARS - totalPagadoARS

    if (totalPagadoUSD >= totalVentaUSD) {
      estadoPago = 'completo'
    } else if (totalPagadoUSD > 0) {
      estadoPago = 'parcial'
    } else {
      estadoPago = 'pendiente'
    }
    
    if (!marcar_como_incompleta && estadoPago !== 'completo') {
        await connection.rollback();
        return res.status(400).json({ message: `El monto pagado (${totalPagadoUSD.toFixed(2)} USD) es menor al total de la venta (${totalVentaUSD.toFixed(2)} USD). Complete el pago o marque la venta como incompleta.` });
    }


    const numeroFactura = await generarNumeroFactura()
    const tipoPagoPrincipal = pagos && pagos.length > 0 ? (pagos.length === 1 ? pagos[0].tipo_pago : "Multiple") : "Pendiente";


    const [resultVenta] = await connection.query(
      `INSERT INTO ventas_equipos (
          numero_factura, cliente_id, usuario_id, punto_venta_id, tipo_pago, equipo_id,
          precio_usd, precio_ars, tipo_cambio, porcentaje_interes, monto_interes,
          porcentaje_descuento, monto_descuento, total_usd, total_ars, fecha,
          estado_pago, total_pagado_usd, total_pagado_ars, saldo_pendiente_usd, saldo_pendiente_ars, fecha_ultimo_pago, notas
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroFactura, clienteId, usuario_id, punto_venta_id, tipoPagoPrincipal, equipo_id,
        precioUSD, precioARS, tipoCambioActual, porcentaje_interes, montoInteresUSD,
        porcentaje_descuento, montoDescuentoUSD, totalVentaUSD, totalVentaARS, fechaActual,
        estadoPago, totalPagadoUSD, totalPagadoARS, saldoPendienteUSD, saldoPendienteARS, (totalPagadoUSD > 0 ? fechaActual : null), notas
      ],
    )
    const ventaId = resultVenta.insertId

    // Insertar pagos en pagos_ventas_equipos
    if (pagos && pagos.length > 0) {
        for (const pago of pagos) {
            await connection.query(
            `INSERT INTO pagos_ventas_equipos (
                venta_equipo_id, monto_usd, monto_ars, tipo_pago, fecha_pago, 
                usuario_id, punto_venta_id, notas
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [ventaId, pago.monto_usd, pago.monto_ars, pago.tipo_pago, fechaActual, usuario_id, punto_venta_id, pago.notas_pago],
            )

            // Lógica de Cuenta Corriente si aplica para este pago
            if (pago.tipo_pago.toLowerCase() === "cuenta corriente" || pago.tipo_pago.toLowerCase() === "cuenta") {
                if (!clienteId) {
                    await connection.rollback()
                    return res.status(400).json({ message: "Se requiere un cliente para pagos con cuenta corriente" })
                }
                const [cuentasCorrientes] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1", [clienteId])
                let cuentaCorrienteId
                let saldoAnteriorCC = 0

                if (cuentasCorrientes.length === 0) {
                    const [resultCuenta] = await connection.query("INSERT INTO cuentas_corrientes (cliente_id, saldo) VALUES (?, ?)", [clienteId, pago.monto_ars])
                    cuentaCorrienteId = resultCuenta.insertId
                } else {
                    cuentaCorrienteId = cuentasCorrientes[0].id
                    saldoAnteriorCC = Number(cuentasCorrientes[0].saldo)
                    if (cuentasCorrientes[0].limite_credito > 0 && (saldoAnteriorCC + Number(pago.monto_ars)) > cuentasCorrientes[0].limite_credito) {
                        await connection.rollback()
                        return res.status(400).json({ message: `El pago con cuenta corriente excede el límite de crédito del cliente para el pago de ${pago.monto_ars}` })
                    }
                    await connection.query("UPDATE cuentas_corrientes SET saldo = saldo + ?, fecha_ultimo_movimiento = ? WHERE id = ?", [pago.monto_ars, fechaActual, cuentaCorrienteId])
                }
                await connection.query(
                    `INSERT INTO movimientos_cuenta_corriente (
                        cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
                        referencia_id, tipo_referencia, usuario_id, notas
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [cuentaCorrienteId, "cargo", pago.monto_ars, saldoAnteriorCC, saldoAnteriorCC + Number(pago.monto_ars), ventaId, "venta_equipo", usuario_id, `Cargo por venta de equipo #${numeroFactura} (Pago parcial)`]
                )
            }
        }
    }
    
    // Log de cambio de estado de pago inicial
    await connection.query(
      `INSERT INTO log_estados_pago_equipos (
          venta_equipo_id, estado_nuevo, monto_pago_usd, monto_pago_ars, tipo_pago, usuario_id, notas
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ventaId, estadoPago, totalPagadoUSD, totalPagadoARS, tipoPagoPrincipal, usuario_id, 'Creación de venta']
    );


    await connection.query("UPDATE equipos SET vendido = 1, venta_id = ? WHERE id = ?", [ventaId, equipo_id])

    let equipoCanjeId = null
    if (plan_canje) {
      // (La lógica de plan canje permanece igual que en el original)
      await connection.query(
        `INSERT INTO plan_canje (
            venta_equipo_id, marca, modelo, memoria, color, bateria,
            precio, descripcion, imei, fecha_ingreso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ventaId, plan_canje.marca, plan_canje.modelo, plan_canje.memoria || null, plan_canje.color || null,
          plan_canje.bateria || null, plan_canje.precio, plan_canje.descripcion || null, plan_canje.imei,
          plan_canje.fecha_ingreso || new Date().toISOString().split("T")[0],
        ],
      )
      const [resultEquipoCanje] = await connection.query(
        `INSERT INTO equipos (
            marca, modelo, memoria, color, bateria, precio, descripcion, 
            imei, fecha_ingreso, punto_venta_id, tipo_cambio, tipo_cambio_original, 
            vendido, venta_id, es_canje, cliente_canje_id, venta_canje_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          plan_canje.marca, plan_canje.modelo, plan_canje.memoria || null, plan_canje.color || null,
          plan_canje.bateria || null, plan_canje.precio, `Equipo recibido por plan canje en venta #${numeroFactura}`,
          plan_canje.imei, plan_canje.fecha_ingreso || new Date().toISOString().split("T")[0],
          punto_venta_id, tipoCambioActual, tipoCambioActual, 0, null, 1, clienteId, ventaId,
        ],
      )
      equipoCanjeId = resultEquipoCanje.insertId
      await connection.query(
        `INSERT INTO log_equipos (equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [equipoCanjeId, "ajuste", ventaId, usuario_id, fechaActual, `Equipo recibido por plan canje en venta #${numeroFactura}`],
      )
    }

    await connection.query(
      `INSERT INTO log_equipos (equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [equipo_id, "venta", ventaId, usuario_id, fechaActual, notas || `Venta de equipo #${numeroFactura}`],
    )

    await connection.commit()
    res.status(201).json({
      id: ventaId, numero_factura: numeroFactura, total_usd: totalVentaUSD, total_ars: totalVentaARS,
      estado_pago: estadoPago, equipo_canje_id: equipoCanjeId, message: "Venta de equipo registrada exitosamente",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear venta de equipo:", error)
    res.status(500).json({ message: "Error al crear venta de equipo: " + error.message })
  } finally {
    connection.release()
  }
}

// Anular una venta de equipo
export const anularVentaEquipo = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { id } = req.params
  const { motivo } = req.body
  const usuario_id = req.user.id

  if (!motivo || motivo.trim() === "") {
    return res.status(400).json({ message: "El motivo de anulación es obligatorio" })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const fechaActual = formatearFechaParaDB()

    const [ventas] = await connection.query("SELECT * FROM ventas_equipos WHERE id = ?", [id])
    if (ventas.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Venta de equipo no encontrada" })
    }
    const venta = ventas[0]

    if (venta.anulada) {
      await connection.rollback()
      return res.status(400).json({ message: "La venta de equipo ya está anulada" })
    }

    // Revertir pagos
    const [pagosDeVenta] = await connection.query("SELECT * FROM pagos_ventas_equipos WHERE venta_equipo_id = ? AND anulado = 0", [id])
    for (const pago of pagosDeVenta) {
      await connection.query(
        "UPDATE pagos_ventas_equipos SET anulado = 1, fecha_anulacion = ?, motivo_anulacion = ? WHERE id = ?",
        [fechaActual, `Anulación de venta de equipo: ${motivo}`, pago.id],
      )

      // Revertir movimiento de cuenta corriente si aplica
      if (pago.tipo_pago.toLowerCase() === "cuenta corriente" || pago.tipo_pago.toLowerCase() === "cuenta") {
        if (venta.cliente_id) {
          const [cuentasCorrientes] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1", [venta.cliente_id])
          if (cuentasCorrientes.length > 0) {
            const cuentaCorriente = cuentasCorrientes[0]
            const saldoAnteriorCC = Number(cuentaCorriente.saldo)
            const nuevoSaldoCC = saldoAnteriorCC - Number(pago.monto_ars) // Restar el cargo original
            
            await connection.query("UPDATE cuentas_corrientes SET saldo = ?, fecha_ultimo_movimiento = ? WHERE id = ?", [nuevoSaldoCC, fechaActual, cuentaCorriente.id])
            await connection.query(
              `INSERT INTO movimientos_cuenta_corriente (
                  cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
                  referencia_id, tipo_referencia, usuario_id, notas
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [cuentaCorriente.id, "pago", pago.monto_ars, saldoAnteriorCC, nuevoSaldoCC, id, "ajuste", usuario_id, `Anulación de cargo por venta de equipo #${venta.numero_factura}: ${motivo}`]
            )
          }
        }
      }
    }
    
    // Log de cambio de estado de pago por anulación
    await connection.query(
      `INSERT INTO log_estados_pago_equipos (
          venta_equipo_id, estado_anterior, estado_nuevo, usuario_id, notas
      ) VALUES (?, ?, ?, ?, ?)`,
      [id, venta.estado_pago, 'anulada', usuario_id, `Anulación de venta: ${motivo}`]
    );


    await connection.query("UPDATE equipos SET vendido = 0, venta_id = NULL WHERE id = ?", [venta.equipo_id])
    await connection.query(
      `INSERT INTO log_equipos (equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [venta.equipo_id, "ajuste", id, usuario_id, fechaActual, `Anulación de venta de equipo #${venta.numero_factura}: ${motivo}`],
    )

    const [planCanje] = await connection.query("SELECT * FROM plan_canje WHERE venta_equipo_id = ?", [id])
    if (planCanje.length > 0) {
      const [equiposCanje] = await connection.query("SELECT * FROM equipos WHERE es_canje = 1 AND venta_canje_id = ?", [id])
      if (equiposCanje.length > 0) {
        const equipoCanjeId = equiposCanje[0].id
        await connection.query(
          `INSERT INTO log_equipos (equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [equipoCanjeId, "ajuste", id, usuario_id, fechaActual, `Eliminación de equipo de canje por anulación de venta #${venta.numero_factura}: ${motivo}`],
        )
        await connection.query("DELETE FROM equipos WHERE id = ?", [equipoCanjeId])
      }
    }

    await connection.query(
      "UPDATE ventas_equipos SET anulada = 1, fecha_anulacion = ?, motivo_anulacion = ?, estado_pago = 'anulada' WHERE id = ?",
      [fechaActual, motivo, id],
    )

    await connection.commit()
    res.json({ message: "Venta de equipo anulada exitosamente", id: venta.id, numero_factura: venta.numero_factura })
  } catch (error) {
    await connection.rollback()
    console.error("Error al anular venta de equipo:", error)
    res.status(500).json({ message: "Error al anular venta de equipo: " + error.message })
  } finally {
    connection.release()
  }
}


// Registrar un pago adicional a una venta de equipo existente
export const registrarPagoAdicionalVentaEquipo = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id: venta_equipo_id } = req.params;
  const { monto_usd, monto_ars, tipo_pago, notas_pago, punto_venta_id_pago } = req.body;

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado" });
  }
  const usuario_id = req.user.id;

  if (!monto_usd && !monto_ars) {
    return res.status(400).json({ message: "Debe proporcionar un monto para el pago." });
  }
  if (!tipo_pago) {
    return res.status(400).json({ message: "Debe especificar un tipo de pago." });
  }
   if (!punto_venta_id_pago) {
    return res.status(400).json({ message: "Debe especificar un punto de venta para el pago." });
  }


  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const fechaActual = formatearFechaParaDB();

    // Verificar la venta
    const [ventas] = await connection.query("SELECT * FROM ventas_equipos WHERE id = ?", [venta_equipo_id]);
    if (ventas.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Venta de equipo no encontrada." });
    }
    const venta = ventas[0];

    if (venta.anulada) {
      await connection.rollback();
      return res.status(400).json({ message: "La venta está anulada y no se pueden registrar más pagos." });
    }
    if (venta.estado_pago === 'completo') {
      await connection.rollback();
      return res.status(400).json({ message: "La venta ya está completamente pagada." });
    }

    // Insertar el nuevo pago
    const [resultPago] = await connection.query(
      `INSERT INTO pagos_ventas_equipos (
          venta_equipo_id, monto_usd, monto_ars, tipo_pago, fecha_pago, 
          usuario_id, punto_venta_id, notas
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [venta_equipo_id, monto_usd || 0, monto_ars || 0, tipo_pago, fechaActual, usuario_id, punto_venta_id_pago, notas_pago]
    );
    const pagoId = resultPago.insertId;
    
    const estadoAnterior = venta.estado_pago;

    // Actualizar totales y estado de la venta
    const nuevoTotalPagadoUSD = Number(venta.total_pagado_usd) + Number(monto_usd || 0);
    const nuevoTotalPagadoARS = Number(venta.total_pagado_ars) + Number(monto_ars || 0);
    const nuevoSaldoPendienteUSD = Number(venta.total_usd) - nuevoTotalPagadoUSD;
    const nuevoSaldoPendienteARS = Number(venta.total_ars) - nuevoTotalPagadoARS;

    let nuevoEstadoPago = venta.estado_pago;
    if (nuevoSaldoPendienteUSD <= 0) {
      nuevoEstadoPago = 'completo';
    } else if (nuevoTotalPagadoUSD > 0) {
      nuevoEstadoPago = 'parcial';
    } else {
      nuevoEstadoPago = 'pendiente'; // Aunque no debería llegar aquí si se está añadiendo un pago
    }
    
    await connection.query(
      `UPDATE ventas_equipos SET 
          total_pagado_usd = ?, total_pagado_ars = ?, 
          saldo_pendiente_usd = ?, saldo_pendiente_ars = ?,
          estado_pago = ?, fecha_ultimo_pago = ?
       WHERE id = ?`,
      [nuevoTotalPagadoUSD, nuevoTotalPagadoARS, nuevoSaldoPendienteUSD, nuevoSaldoPendienteARS, nuevoEstadoPago, fechaActual, venta_equipo_id]
    );

    // Log del cambio de estado de pago
    await connection.query(
      `INSERT INTO log_estados_pago_equipos (
          venta_equipo_id, estado_anterior, estado_nuevo, monto_pago_usd, monto_pago_ars, tipo_pago, usuario_id, notas
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [venta_equipo_id, estadoAnterior, nuevoEstadoPago, monto_usd || 0, monto_ars || 0, tipo_pago, usuario_id, notas_pago || `Pago adicional registrado`]
    );

    // Lógica de Cuenta Corriente si aplica para este pago
    if (tipo_pago.toLowerCase() === "cuenta corriente" || tipo_pago.toLowerCase() === "cuenta") {
        if (!venta.cliente_id) {
            await connection.rollback();
            return res.status(400).json({ message: "La venta no tiene un cliente asociado para pagos con cuenta corriente." });
        }
        const [cuentasCorrientes] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1", [venta.cliente_id]);
        let cuentaCorrienteId;
        let saldoAnteriorCC = 0;

        if (cuentasCorrientes.length === 0) {
            // Si no tiene CC, se crea una. El monto del pago es un cargo.
            const [resultCuenta] = await connection.query("INSERT INTO cuentas_corrientes (cliente_id, saldo) VALUES (?, ?)", [venta.cliente_id, monto_ars || 0]);
            cuentaCorrienteId = resultCuenta.insertId;
        } else {
            cuentaCorrienteId = cuentasCorrientes[0].id;
            saldoAnteriorCC = Number(cuentasCorrientes[0].saldo);
            // Verificar límite de crédito
            if (cuentasCorrientes[0].limite_credito > 0 && (saldoAnteriorCC + Number(monto_ars || 0)) > cuentasCorrientes[0].limite_credito) {
                await connection.rollback();
                return res.status(400).json({ message: `El pago con cuenta corriente excede el límite de crédito del cliente.` });
            }
            await connection.query("UPDATE cuentas_corrientes SET saldo = saldo + ?, fecha_ultimo_movimiento = ? WHERE id = ?", [monto_ars || 0, fechaActual, cuentaCorrienteId]);
        }
        await connection.query(
            `INSERT INTO movimientos_cuenta_corriente (
                cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
                referencia_id, tipo_referencia, usuario_id, notas
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [cuentaCorrienteId, "cargo", monto_ars || 0, saldoAnteriorCC, saldoAnteriorCC + Number(monto_ars || 0), venta_equipo_id, "venta_equipo", usuario_id, `Pago adicional para venta de equipo #${venta.numero_factura}`]
        );
    }

    await connection.commit();
    res.status(201).json({
      pago_id: pagoId,
      venta_equipo_id,
      nuevo_estado_pago: nuevoEstadoPago,
      message: "Pago adicional registrado exitosamente."
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error al registrar pago adicional:", error);
    res.status(500).json({ message: "Error al registrar pago adicional: " + error.message });
  } finally {
    connection.release();
  }
};