import pool from "../../db.js"
import { validationResult } from "express-validator"
// Ya no usaremos registrarPagoInterno directamente aquí para el pago principal de la venta de equipo.
// import { registrarPagoInterno } from "../pago.controller.js"
import { formatearFechaParaDB } from "../../utils/dateUtils.js"

// Generar número de factura único para ventas de equipos (sin cambios)
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
  if (ultimaFactura.length > 0) {
    const ultimoNumero = Number.parseInt(ultimaFactura[0].numero_factura.split("-")[1])
    numero = ultimoNumero + 1
  }

  return `${prefijo}-${numero.toString().padStart(4, "0")}`
}

// Obtener todas las ventas de equipos (modificado para indicar múltiples pagos)
export const getVentasEquipos = async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, cliente_id, punto_venta_id, anuladas } = req.query

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
                v.multiples_pagos, -- Nueva columna
                v.estado_pago,
                v.total_pagado_usd,
                v.total_pagado_ars,
                v.saldo_pendiente_usd,
                v.saldo_pendiente_ars,
                c.id AS cliente_id,
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                u.id AS usuario_id,
                u.nombre AS usuario_nombre,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta_nombre,
                e.id AS equipo_id,
                e.marca,
                e.modelo,
                e.imei
                -- Ya no traemos v.tipo_pago directamente
            FROM ventas_equipos v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            JOIN usuarios u ON v.usuario_id = u.id
            JOIN puntos_venta pv ON v.punto_venta_id = pv.id
            JOIN equipos e ON v.equipo_id = e.id
            WHERE 1=1
        `
    // ... (resto de los filtros sin cambios)
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

    sql += ` ORDER BY v.fecha DESC`

    const [ventas] = await pool.query(sql, params)

    // Para cada venta, podríamos obtener los tipos de pago si es necesario para la lista
    // o simplemente confiar en la bandera `multiples_pagos`.
    // Por simplicidad, por ahora solo devolvemos la bandera.

    res.json(ventas)
  } catch (error) {
    console.error("Error al obtener ventas de equipos:", error)
    res.status(500).json({ message: "Error al obtener ventas de equipos" })
  }
}

// Obtener una venta de equipo por ID (modificado para incluir los múltiples pagos)
export const getVentaEquipoById = async (req, res) => {
  try {
    const { id } = req.params

    const [ventas] = await pool.query(
      `
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
                v.multiples_pagos, -- Nueva columna
                v.estado_pago,
                v.total_pagado_usd,
                v.total_pagado_ars,
                v.saldo_pendiente_usd,
                v.saldo_pendiente_ars,
                v.notas,
                c.id AS cliente_id,
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                u.id AS usuario_id,
                u.nombre AS usuario_nombre,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta_nombre,
                e.id AS equipo_id,
                e.marca,
                e.modelo,
                e.memoria,
                e.color,
                e.bateria,
                e.descripcion AS equipo_descripcion,
                e.imei,
                e.tipo_cambio AS equipo_tipo_cambio,
                e.tipo_cambio_original AS equipo_tipo_cambio_original
                -- Ya no traemos v.tipo_pago directamente
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

    const venta = ventas[0]

    // Obtener los pagos asociados desde la nueva tabla `venta_equipo_pagos`
    const [pagosDetalle] = await pool.query(
      `SELECT id, tipo_pago, monto_usd, monto_ars, tipo_cambio_pago, descripcion, fecha_pago 
       FROM venta_equipo_pagos 
       WHERE venta_equipo_id = ?`,
      [id],
    )

    // Obtener información del plan canje si existe (sin cambios)
    const [planCanje] = await pool.query(
      `SELECT * FROM plan_canje WHERE venta_equipo_id = ?`,
      [id],
    )

    // Construir la respuesta
    const ventaCompleta = {
      ...venta,
      pagos: pagosDetalle, // Reemplazar los pagos anteriores con los de la nueva tabla
      plan_canje: planCanje.length > 0 ? planCanje[0] : null,
    }

    res.json(ventaCompleta)
  } catch (error) {
    console.error("Error al obtener venta de equipo:", error)
    res.status(500).json({ message: "Error al obtener venta de equipo" })
  }
}

// Crear una nueva venta de equipo (modificado para manejar múltiples pagos)
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
    notas,
    // tipo_cambio, // El tipo de cambio general de la venta se tomará del sistema o del equipo
    pagos, // Nuevo: Array de objetos de pago
  } = req.body

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado o ID de usuario no disponible" })
  }
  const usuario_id = req.user.id

  // Validar que se proporcionen pagos
  if (!pagos || !Array.isArray(pagos) || pagos.length === 0) {
    return res.status(400).json({ message: "Se debe especificar al menos un método de pago." })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const fechaActual = formatearFechaParaDB()

    // --- Validaciones (similares a antes) ---
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
      "SELECT * FROM equipos WHERE id = ? AND punto_venta_id = ? AND vendido = 0",
      [equipo_id, punto_venta_id],
    )
    if (equipos.length === 0) {
      await connection.rollback()
      return res.status(404).json({
        message: "Equipo no encontrado, no pertenece al punto de venta o ya fue vendido",
      })
    }
    const equipo = equipos[0]

    // --- Tipo de cambio y cálculos de la venta (similares a antes) ---
    const [tcRows] = await connection.query(`SELECT valor FROM tipo_cambio WHERE activo = 1 ORDER BY fecha DESC LIMIT 1`)
    const tipoCambioVenta = tcRows.length > 0 ? Number.parseFloat(tcRows[0].valor) : equipo.tipo_cambio

    const precioUSD = equipo.precio
    const precioARS = precioUSD * tipoCambioVenta
    let descuentoPlanCanje = 0
    if (plan_canje && plan_canje.precio) {
      descuentoPlanCanje = plan_canje.precio
    }
    const subtotalUSD = precioUSD - descuentoPlanCanje
    // const subtotalARS = subtotalUSD * tipoCambioVenta // No es necesario para el total de la venta si los pagos tienen su propio TC

    const montoInteresUSD = (subtotalUSD * porcentaje_interes) / 100
    const montoDescuentoUSD = (subtotalUSD * porcentaje_descuento) / 100
    // const montoInteresARS = montoInteresUSD * tipoCambioVenta
    // const montoDescuentoARS = montoDescuentoUSD * tipoCambioVenta

    const totalVentaUSD = subtotalUSD + montoInteresUSD - montoDescuentoUSD
    const totalVentaARS = totalVentaUSD * tipoCambioVenta // Total de la venta en ARS con el TC de la venta

    // --- Procesar pagos ---
    let totalPagadoUSD = 0
    let totalPagadoARS = 0
    for (const pago of pagos) {
      if (!pago.tipo_pago || !pago.monto_usd || !pago.monto_ars || !pago.tipo_cambio_pago) {
        await connection.rollback()
        return res.status(400).json({ message: "Cada pago debe tener tipo_pago, monto_usd, monto_ars y tipo_cambio_pago." })
      }
      totalPagadoUSD += Number(pago.monto_usd)
      totalPagadoARS += Number(pago.monto_ars)

      // Validar si es cuenta corriente y se requiere cliente
      const tipoPagoNombreNormalizado = pago.tipo_pago.toLowerCase().trim()
      if ((tipoPagoNombreNormalizado === "cuenta corriente" || tipoPagoNombreNormalizado === "cuenta") && !clienteId) {
        await connection.rollback()
        return res.status(400).json({ message: "Se requiere un cliente para pagos con cuenta corriente." })
      }
    }
    
    // Validar que el total pagado coincida con el total de la venta (o manejar pagos parciales si es necesario)
    // Por ahora, asumimos que el total pagado debe cubrir el total de la venta.
    // Se puede ajustar esta lógica para permitir pagos parciales y actualizar `estado_pago`.
    if (Math.abs(totalPagadoUSD - totalVentaUSD) > 0.01) { // Usar una pequeña tolerancia para comparaciones de punto flotante
        // await connection.rollback(); // Comentado para permitir pagos parciales o diferentes
        // return res.status(400).json({ message: `El total pagado en USD (${totalPagadoUSD.toFixed(2)}) no coincide con el total de la venta (${totalVentaUSD.toFixed(2)}).` });
        console.warn(`Advertencia: El total pagado en USD (${totalPagadoUSD.toFixed(2)}) no coincide con el total de la venta (${totalVentaUSD.toFixed(2)}). Se registrará como pago parcial/excedente.`);
    }


    // --- Insertar la venta ---
    const numeroFactura = await generarNumeroFactura()
    const multiplesPagosFlag = pagos.length > 1
    
    // Determinar estado_pago
    let estadoPago = 'completo';
    const saldoPendienteUSD = totalVentaUSD - totalPagadoUSD;
    const saldoPendienteARS = totalVentaARS - totalPagadoARS; // Asumiendo que el TC de la venta aplica al saldo

    if (Math.abs(saldoPendienteUSD) < 0.01) {
        estadoPago = 'completo';
    } else if (totalPagadoUSD > 0 && totalPagadoUSD < totalVentaUSD) {
        estadoPago = 'parcial';
    } else if (totalPagadoUSD === 0) {
        estadoPago = 'pendiente';
    }
    // Considerar también si totalPagadoUSD > totalVentaUSD (pago excedente)

    const [resultVenta] = await connection.query(
      `INSERT INTO ventas_equipos (
                numero_factura, cliente_id, usuario_id, punto_venta_id, 
                equipo_id, precio_usd, precio_ars, tipo_cambio,
                porcentaje_interes, monto_interes, porcentaje_descuento, monto_descuento,
                total_usd, total_ars, fecha, multiples_pagos, notas,
                estado_pago, total_pagado_usd, total_pagado_ars, saldo_pendiente_usd, saldo_pendiente_ars, fecha_ultimo_pago
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroFactura, clienteId, usuario_id, punto_venta_id,
        equipo_id, precioUSD, precioARS, tipoCambioVenta,
        porcentaje_interes, montoInteresUSD, porcentaje_descuento, montoDescuentoUSD,
        totalVentaUSD, totalVentaARS, fechaActual, multiplesPagosFlag, notas,
        estadoPago, totalPagadoUSD, totalPagadoARS, saldoPendienteUSD, saldoPendienteARS, (totalPagadoUSD > 0 ? fechaActual : null)
      ],
    )
    const ventaId = resultVenta.insertId

    // --- Insertar los pagos en `venta_equipo_pagos` ---
    for (const pago of pagos) {
      let movimientoCuentaId = null
      const tipoPagoNombreNormalizado = pago.tipo_pago.toLowerCase().trim()

      if ((tipoPagoNombreNormalizado === "cuenta corriente" || tipoPagoNombreNormalizado === "cuenta")) {
        const [cuentasCorrientes] = await connection.query(
          "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
          [clienteId],
        )
        let cuentaCorrienteId
        let saldoAnteriorCC = 0

        if (cuentasCorrientes.length === 0) {
          const [resultCuenta] = await connection.query(
            "INSERT INTO cuentas_corrientes (cliente_id, saldo, fecha_ultimo_movimiento) VALUES (?, ?, ?)",
            [clienteId, Number(pago.monto_ars), fechaActual], // El saldo inicial es el monto del cargo
          )
          cuentaCorrienteId = resultCuenta.insertId
        } else {
          cuentaCorrienteId = cuentasCorrientes[0].id
          saldoAnteriorCC = Number(cuentasCorrientes[0].saldo)
          if (
            cuentasCorrientes[0].limite_credito > 0 &&
            (saldoAnteriorCC + Number(pago.monto_ars)) > cuentasCorrientes[0].limite_credito
          ) {
            await connection.rollback()
            return res.status(400).json({ message: `El pago con cuenta corriente excede el límite de crédito del cliente para el pago de ARS ${pago.monto_ars}.` })
          }
          await connection.query(
            "UPDATE cuentas_corrientes SET saldo = saldo + ?, fecha_ultimo_movimiento = ? WHERE id = ?",
            [Number(pago.monto_ars), fechaActual, cuentaCorrienteId],
          )
        }
        const saldoNuevoCC = saldoAnteriorCC + Number(pago.monto_ars)
        const [resultMovimiento] = await connection.query(
          `INSERT INTO movimientos_cuenta_corriente (
                        cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
                        referencia_id, tipo_referencia, usuario_id, notas, fecha
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cuentaCorrienteId, "cargo", Number(pago.monto_ars), saldoAnteriorCC, saldoNuevoCC,
            ventaId, "venta_equipo", usuario_id, `Cargo por venta de equipo #${numeroFactura} (Pago ${pago.tipo_pago})`, fechaActual,
          ],
        )
        movimientoCuentaId = resultMovimiento.insertId
      }

      await connection.query(
        `INSERT INTO venta_equipo_pagos (
                    venta_equipo_id, tipo_pago, monto_usd, monto_ars, tipo_cambio_pago, 
                    descripcion, movimiento_cuenta_id, usuario_id, punto_venta_id, fecha_pago
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ventaId, pago.tipo_pago, Number(pago.monto_usd), Number(pago.monto_ars), Number(pago.tipo_cambio_pago),
          pago.descripcion || null, movimientoCuentaId, usuario_id, punto_venta_id, fechaActual,
        ],
      )
    }

    // --- Resto de la lógica (marcar equipo, plan canje, logs) similar a antes ---
    await connection.query("UPDATE equipos SET vendido = 1, venta_id = ? WHERE id = ?", [ventaId, equipo_id])

    let equipoCanjeId = null
    if (plan_canje) {
      // (Lógica de plan canje sin cambios significativos, asegurarse que usa `fechaActual`)
      await connection.query(
        `INSERT INTO plan_canje (venta_equipo_id, marca, modelo, memoria, color, bateria, precio, descripcion, imei, fecha_ingreso) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ventaId, plan_canje.marca, plan_canje.modelo, plan_canje.memoria || null, plan_canje.color || null, plan_canje.bateria || null, plan_canje.precio, plan_canje.descripcion || null, plan_canje.imei, plan_canje.fecha_ingreso || fechaActual.split(' ')[0]]
      );
      const [resultEquipoCanje] = await connection.query(
        `INSERT INTO equipos (marca, modelo, memoria, color, bateria, precio, descripcion, imei, fecha_ingreso, punto_venta_id, tipo_cambio, tipo_cambio_original, vendido, venta_id, es_canje, cliente_canje_id, venta_canje_id, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, ?, ?, ?)`,
        [plan_canje.marca, plan_canje.modelo, plan_canje.memoria || null, plan_canje.color || null, plan_canje.bateria || null, plan_canje.precio, plan_canje.descripcion || `Equipo recibido por plan canje en venta #${numeroFactura}`, plan_canje.imei, plan_canje.fecha_ingreso || fechaActual.split(' ')[0], punto_venta_id, tipoCambioVenta, tipoCambioVenta, clienteId, ventaId, fechaActual]
      );
      equipoCanjeId = resultEquipoCanje.insertId;
      await connection.query(
        `INSERT INTO log_equipos (equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas) VALUES (?, ?, ?, ?, ?, ?)`,
        [equipoCanjeId, "ajuste", ventaId, usuario_id, fechaActual, `Equipo recibido por plan canje en venta #${numeroFactura}`]
      );
    }

    await connection.query(
      `INSERT INTO log_equipos (equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas) VALUES (?, ?, ?, ?, ?, ?)`,
      [equipo_id, "venta", ventaId, usuario_id, fechaActual, notas || `Venta de equipo #${numeroFactura}`],
    )
    
    // Registrar en log_estados_pago_equipos
    await connection.query(
        `INSERT INTO log_estados_pago_equipos (
            venta_equipo_id, estado_anterior, estado_nuevo, 
            monto_pago_usd, monto_pago_ars, tipo_pago, usuario_id, fecha, notas
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            ventaId, 
            null, // Estado anterior es null para una nueva venta
            estadoPago,
            totalPagadoUSD, 
            totalPagadoARS, 
            pagos.map(p => p.tipo_pago).join(', '), // Concatena los tipos de pago
            usuario_id, 
            fechaActual, 
            `Venta inicial de equipo #${numeroFactura}`
        ]
    );


    await connection.commit()
    res.status(201).json({
      id: ventaId,
      numero_factura: numeroFactura,
      total_usd: totalVentaUSD,
      total_ars: totalVentaARS,
      equipo_canje_id: equipoCanjeId,
      message: "Venta de equipo registrada exitosamente con múltiples pagos.",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear venta de equipo:", error)
    res.status(500).json({ message: "Error al crear venta de equipo: " + error.message })
  } finally {
    connection.release()
  }
}

// Anular una venta de equipo (modificado para manejar múltiples pagos)
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

    // --- Revertir pagos y movimientos de cuenta corriente ---
    const [pagosDeVenta] = await connection.query(
      "SELECT * FROM venta_equipo_pagos WHERE venta_equipo_id = ?",
      [id],
    )

    for (const pago of pagosDeVenta) {
      if (pago.movimiento_cuenta_id) {
        // Revertir movimiento de cuenta corriente
        const [movimientoOriginal] = await connection.query(
          "SELECT * FROM movimientos_cuenta_corriente WHERE id = ?",
          [pago.movimiento_cuenta_id],
        )
        if (movimientoOriginal.length > 0) {
          const mov = movimientoOriginal[0]
          const [cuentaCorrienteActual] = await connection.query(
            "SELECT * FROM cuentas_corrientes WHERE id = ?",
            [mov.cuenta_corriente_id]
          )
          let saldoAnteriorCCAnulacion = 0;
          if(cuentaCorrienteActual.length > 0){
            saldoAnteriorCCAnulacion = Number(cuentaCorrienteActual[0].saldo);
          }

          await connection.query(
            "UPDATE cuentas_corrientes SET saldo = saldo - ?, fecha_ultimo_movimiento = ? WHERE id = ?",
            [mov.monto, fechaActual, mov.cuenta_corriente_id], // Restar el monto del cargo original
          )
          const saldoNuevoCCAnulacion = saldoAnteriorCCAnulacion - Number(mov.monto);

          await connection.query(
            `INSERT INTO movimientos_cuenta_corriente (
                            cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
                            referencia_id, tipo_referencia, usuario_id, notas, fecha
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              mov.cuenta_corriente_id, "pago", mov.monto, saldoAnteriorCCAnulacion, saldoNuevoCCAnulacion, // 'pago' para revertir el 'cargo'
              id, "ajuste", usuario_id, `Anulación de cargo por venta de equipo #${venta.numero_factura} (Pago ${pago.tipo_pago}): ${motivo}`, fechaActual,
            ],
          )
        }
      }
    }
    // No es necesario eliminar de `venta_equipo_pagos` si la venta se marca como anulada,
    // pero si se quisiera, aquí sería el lugar. Por ahora, se mantiene el historial.
    // await connection.query("DELETE FROM venta_equipo_pagos WHERE venta_equipo_id = ?", [id]);

    // --- Resto de la lógica de anulación (equipo, plan canje, logs) similar a antes ---
    await connection.query("UPDATE equipos SET vendido = 0, venta_id = NULL WHERE id = ?", [venta.equipo_id])
    await connection.query(
      `INSERT INTO log_equipos (equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas) VALUES (?, ?, ?, ?, ?, ?)`,
      [venta.equipo_id, "ajuste", id, usuario_id, fechaActual, `Anulación de venta de equipo #${venta.numero_factura}: ${motivo}`],
    )

    const [planCanje] = await connection.query("SELECT * FROM plan_canje WHERE venta_equipo_id = ?", [id])
    if (planCanje.length > 0) {
      const [equiposCanje] = await connection.query("SELECT * FROM equipos WHERE es_canje = 1 AND venta_canje_id = ?", [id])
      if (equiposCanje.length > 0) {
        const equipoCanjeId = equiposCanje[0].id
        await connection.query(
          `INSERT INTO log_equipos (equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas) VALUES (?, ?, ?, ?, ?, ?)`,
          [equipoCanjeId, "ajuste", id, usuario_id, fechaActual, `Eliminación equipo de canje por anulación de venta #${venta.numero_factura}: ${motivo}`]
        );
        await connection.query("DELETE FROM equipos WHERE id = ?", [equipoCanjeId])
      }
      // También eliminar de la tabla plan_canje
      await connection.query("DELETE FROM plan_canje WHERE venta_equipo_id = ?", [id]);
    }
    
    // Registrar en log_estados_pago_equipos la anulación
     await connection.query(
        `INSERT INTO log_estados_pago_equipos (
            venta_equipo_id, estado_anterior, estado_nuevo, 
            usuario_id, fecha, notas
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
            id, 
            venta.estado_pago, 
            'anulada', // Nuevo estado
            usuario_id, 
            fechaActual, 
            `Anulación de venta: ${motivo}`
        ]
    );


    await connection.query(
      "UPDATE ventas_equipos SET anulada = 1, fecha_anulacion = ?, motivo_anulacion = ?, estado_pago = 'anulada', saldo_pendiente_usd = total_usd, saldo_pendiente_ars = total_ars, total_pagado_usd = 0, total_pagado_ars = 0 WHERE id = ?",
      [fechaActual, motivo, id],
    )

    await connection.commit()
    res.json({
      message: "Venta de equipo anulada exitosamente",
      id: venta.id,
      numero_factura: venta.numero_factura,
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al anular venta de equipo:", error)
    res.status(500).json({ message: "Error al anular venta de equipo: " + error.message })
  } finally {
    connection.release()
  }
}