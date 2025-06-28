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

  // Obtener el último número de factura con este prefijo
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

// Obtener todas las ventas de equipos
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
                v.multiples_pagos,
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
                e.imei,
                -- Subconsulta para obtener métodos de pago
                (SELECT GROUP_CONCAT(DISTINCT p.tipo_pago SEPARATOR ', ') 
                 FROM pagos_ventas_equipos p 
                 WHERE p.venta_equipo_id = v.id AND p.anulado = 0) AS metodos_pago,
                (SELECT COUNT(DISTINCT p.tipo_pago) 
                 FROM pagos_ventas_equipos p 
                 WHERE p.venta_equipo_id = v.id AND p.anulado = 0) AS cantidad_metodos_pago
            FROM ventas_equipos v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            JOIN usuarios u ON v.usuario_id = u.id
            JOIN puntos_venta pv ON v.punto_venta_id = pv.id
            JOIN equipos e ON v.equipo_id = e.id
            WHERE 1=1
        `

    const params = []

    // Filtrar por fecha de inicio
    if (fecha_inicio) {
      sql += ` AND DATE(v.fecha) >= ?`
      params.push(fecha_inicio)
    }

    // Filtrar por fecha de fin
    if (fecha_fin) {
      sql += ` AND DATE(v.fecha) <= ?`
      params.push(fecha_fin)
    }

    // Filtrar por cliente
    if (cliente_id) {
      sql += ` AND v.cliente_id = ?`
      params.push(cliente_id)
    }

    // Filtrar por punto de venta
    if (punto_venta_id) {
      sql += ` AND v.punto_venta_id = ?`
      params.push(punto_venta_id)
    }

    // Filtrar por estado de anulación
    if (anuladas !== undefined) {
      sql += ` AND v.anulada = ?`
      params.push(anuladas === "true" ? 1 : 0)
    }

    // Ordenar por fecha descendente
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

    // Obtener la información de la venta
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
                v.multiples_pagos,
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
                e.descripcion,
                e.imei,
                e.tipo_cambio AS equipo_tipo_cambio,
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

    // Obtener información del plan canje si existe
    const [planCanje] = await pool.query(
      `
            SELECT * FROM plan_canje
            WHERE venta_equipo_id = ?
        `,
      [id],
    )

    // Obtener los pagos asociados a esta venta
    const [pagos] = await pool.query(
      `
            SELECT 
                p.id,
                p.monto_ars as monto,
                p.fecha_pago as fecha,
                p.anulado,
                p.tipo_pago
            FROM pagos_ventas_equipos p
            WHERE p.venta_equipo_id = ? AND p.anulado = 0
            ORDER BY p.fecha_pago ASC
        `,
      [id],
    )

    // Construir la respuesta
    const venta = {
      ...ventas[0],
      plan_canje: planCanje.length > 0 ? planCanje[0] : null,
      pagos,
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
    pagos, // Array de pagos
    equipo_id,
    porcentaje_interes = 0,
    porcentaje_descuento = 0,
    plan_canje = null,
    notas,
  } = req.body

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado o ID de usuario no disponible" })
  }

  const usuario_id = req.user.id
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    const fechaActual = formatearFechaParaDB()

    // Validar punto de venta
    const [puntosVenta] = await connection.query("SELECT * FROM puntos_venta WHERE id = ?", [punto_venta_id])
    if (puntosVenta.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Punto de venta no encontrado" })
    }

    // Validar cliente si se proporciona
    let clienteId = null
    if (cliente_id) {
      const [clientes] = await connection.query("SELECT * FROM clientes WHERE id = ?", [cliente_id])
      if (clientes.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: "Cliente no encontrado" })
      }
      clienteId = cliente_id
    }

    // Validar equipo
    const [equipos] = await connection.query(
      "SELECT * FROM equipos WHERE id = ? AND punto_venta_id = ? AND vendido = 0",
      [equipo_id, punto_venta_id],
    )
    if (equipos.length === 0) {
      await connection.rollback()
      return res.status(404).json({
        message: "Equipo no encontrado, no pertenece al punto de venta, o ya fue vendido",
      })
    }

    // Obtener tipo de cambio actual
    const [tcRows] = await connection.query(`SELECT valor FROM tipo_cambio ORDER BY fecha DESC LIMIT 1`)
    const tipoCambio = tcRows.length > 0 ? Number.parseFloat(tcRows[0].valor) : equipos[0].tipo_cambio

    const equipo = equipos[0]
    const precioUSD = equipo.precio
    const precioARS = precioUSD * tipoCambio

    // Calcular descuento por plan canje
    let descuentoPlanCanje = 0
    if (plan_canje && plan_canje.precio) {
      descuentoPlanCanje = plan_canje.precio
    }

    // Calcular totales
    const subtotalUSD = precioUSD - descuentoPlanCanje
    const montoInteresUSD = (subtotalUSD * porcentaje_interes) / 100
    const montoDescuentoUSD = (subtotalUSD * porcentaje_descuento) / 100
    const totalUSD = subtotalUSD + montoInteresUSD - montoDescuentoUSD
    const totalARS = totalUSD * tipoCambio

    // Validar que la suma de los pagos coincida con el total de la venta
    const totalPagadoARS = pagos.reduce((sum, pago) => sum + Number(pago.monto), 0)
    if (Math.abs(totalPagadoARS - totalARS) > 0.01) {
      await connection.rollback()
      return res.status(400).json({
        message: `El monto total de los pagos (${totalPagadoARS.toFixed(2)}) no coincide con el total de la venta (${totalARS.toFixed(2)})`,
      })
    }

    const numeroFactura = await generarNumeroFactura()

    // Determinar si hay múltiples métodos de pago
    const tiposPagoUnicos = [...new Set(pagos.map((p) => p.tipo_pago.toLowerCase()))]
    const multiplesPagos = tiposPagoUnicos.length > 1 ? 1 : 0

    // Insertar la venta de equipo
    const [resultVenta] = await connection.query(
      `INSERT INTO ventas_equipos (
                numero_factura, cliente_id, usuario_id, punto_venta_id,
                equipo_id, precio_usd, precio_ars, tipo_cambio,
                porcentaje_interes, monto_interes, porcentaje_descuento, monto_descuento,
                total_usd, total_ars, fecha, multiples_pagos, notas
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroFactura,
        clienteId,
        usuario_id,
        punto_venta_id,
        equipo_id,
        precioUSD,
        precioARS,
        tipoCambio,
        porcentaje_interes,
        montoInteresUSD,
        porcentaje_descuento,
        montoDescuentoUSD,
        totalUSD,
        totalARS,
        fechaActual,
        multiplesPagos,
        notas,
      ],
    )

    const ventaId = resultVenta.insertId

    // Marcar equipo como vendido
    await connection.query("UPDATE equipos SET vendido = 1, venta_id = ? WHERE id = ?", [ventaId, equipo_id])

    // Procesar plan canje si existe
    let equipoCanjeId = null
    if (plan_canje) {
      await connection.query(
        `INSERT INTO plan_canje (
                    venta_equipo_id, marca, modelo, memoria, color, bateria,
                    precio, descripcion, imei, fecha_ingreso
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ventaId,
          plan_canje.marca,
          plan_canje.modelo,
          plan_canje.memoria || null,
          plan_canje.color || null,
          plan_canje.bateria || null,
          plan_canje.precio,
          plan_canje.descripcion || null,
          plan_canje.imei,
          plan_canje.fecha_ingreso || new Date().toISOString().split("T")[0],
        ],
      )

      // Crear equipo de canje en inventario
      const [resultEquipoCanje] = await connection.query(
        `INSERT INTO equipos (
                    marca, modelo, memoria, color, bateria, precio, descripcion, 
                    imei, fecha_ingreso, punto_venta_id, tipo_cambio, tipo_cambio_original, 
                    vendido, venta_id, es_canje, cliente_canje_id, venta_canje_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          plan_canje.marca,
          plan_canje.modelo,
          plan_canje.memoria || null,
          plan_canje.color || null,
          plan_canje.bateria || null,
          plan_canje.precio,
          plan_canje.descripcion || `Equipo recibido por plan canje en venta #${numeroFactura}`,
          plan_canje.imei,
          plan_canje.fecha_ingreso || new Date().toISOString().split("T")[0],
          punto_venta_id,
          tipoCambio,
          tipoCambio,
          0,
          null,
          1,
          clienteId,
          ventaId,
        ],
      )
      equipoCanjeId = resultEquipoCanje.insertId

      // Log del equipo de canje
      await connection.query(
        `INSERT INTO log_equipos (
                    equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas
                ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          equipoCanjeId,
          "ajuste",
          ventaId,
          usuario_id,
          fechaActual,
          `Equipo recibido por plan canje en venta #${numeroFactura}`,
        ],
      )
    }

    // Log del equipo vendido
    await connection.query(
      `INSERT INTO log_equipos (
                equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas
            ) VALUES (?, ?, ?, ?, ?, ?)`,
      [equipo_id, "venta", ventaId, usuario_id, fechaActual, notas || `Venta de equipo #${numeroFactura}`],
    )

    // Procesar cada método de pago
    for (const pago of pagos) {
      const tipoPagoNombre = pago.tipo_pago.toLowerCase()
      const montoPagoARS = Number(pago.monto)
      const montoPagoUSD = montoPagoARS / tipoCambio

      if (tipoPagoNombre === "cuenta corriente" || tipoPagoNombre === "cuenta") {
        // Validar que hay cliente para cuenta corriente
        if (!clienteId) {
          await connection.rollback()
          return res.status(400).json({
            message: "Se requiere un cliente para pagos con cuenta corriente",
          })
        }

        // Buscar o crear cuenta corriente
        const [cuentasCorrientes] = await connection.query(
          "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
          [clienteId],
        )

        let cuentaCorrienteId
        let saldoAnterior = 0

        if (cuentasCorrientes.length === 0) {
          // Crear nueva cuenta corriente
          const [resultCuenta] = await connection.query(
            "INSERT INTO cuentas_corrientes (cliente_id, saldo) VALUES (?, ?)",
            [clienteId, montoPagoARS],
          )
          cuentaCorrienteId = resultCuenta.insertId
        } else {
          // Usar cuenta existente
          cuentaCorrienteId = cuentasCorrientes[0].id
          saldoAnterior = Number(cuentasCorrientes[0].saldo)

          // Verificar límite de crédito
          if (
            cuentasCorrientes[0].limite_credito > 0 &&
            saldoAnterior + montoPagoARS > cuentasCorrientes[0].limite_credito
          ) {
            await connection.rollback()
            return res.status(400).json({
              message: "La venta excede el límite de crédito del cliente",
            })
          }

          // Actualizar saldo
          await connection.query(
            "UPDATE cuentas_corrientes SET saldo = saldo + ?, fecha_ultimo_movimiento = ? WHERE id = ?",
            [montoPagoARS, fechaActual, cuentaCorrienteId],
          )
        }

        // Registrar movimiento en cuenta corriente
        await connection.query(
          `INSERT INTO movimientos_cuenta_corriente (
                        cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
                        referencia_id, tipo_referencia, usuario_id, notas
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cuentaCorrienteId,
            "cargo",
            montoPagoARS,
            saldoAnterior,
            saldoAnterior + montoPagoARS,
            ventaId,
            "venta_equipo",
            usuario_id,
            `Cargo por venta de equipo #${numeroFactura}`,
          ],
        )
      }

      // Registrar el pago en la tabla de pagos (para todos los tipos de pago)
      await connection.query(
        `INSERT INTO pagos_ventas_equipos (
                    venta_equipo_id, monto_usd, monto_ars, tipo_pago, fecha_pago,
                    usuario_id, punto_venta_id, notas
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ventaId,
          montoPagoUSD,
          montoPagoARS,
          pago.tipo_pago,
          fechaActual,
          usuario_id,
          punto_venta_id,
          notas || `Pago por venta de equipo #${numeroFactura}`,
        ],
      )
    }

    await connection.commit()

    res.status(201).json({
      id: ventaId,
      numero_factura: numeroFactura,
      total_usd: totalUSD,
      total_ars: totalARS,
      equipo_canje_id: equipoCanjeId,
      message: "Venta de equipo registrada exitosamente",
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

    // Obtener información de la venta
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

    // Marcar equipo como disponible
    await connection.query("UPDATE equipos SET vendido = 0, venta_id = NULL WHERE id = ?", [venta.equipo_id])

    // Log de anulación del equipo
    await connection.query(
      `INSERT INTO log_equipos (
                equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas
            ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        venta.equipo_id,
        "ajuste",
        id,
        usuario_id,
        fechaActual,
        `Anulación de venta de equipo #${venta.numero_factura}: ${motivo}`,
      ],
    )

    // Procesar plan canje si existe
    const [planCanje] = await connection.query("SELECT * FROM plan_canje WHERE venta_equipo_id = ?", [id])

    if (planCanje.length > 0) {
      const [equiposCanje] = await connection.query("SELECT * FROM equipos WHERE es_canje = 1 AND venta_canje_id = ?", [
        id,
      ])

      if (equiposCanje.length > 0) {
        const equipoCanjeId = equiposCanje[0].id
        await connection.query(
          `INSERT INTO log_equipos (
                    equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas
                ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            equipoCanjeId,
            "ajuste",
            id,
            usuario_id,
            fechaActual,
            `Eliminación de equipo de canje por anulación de venta #${venta.numero_factura}: ${motivo}`,
          ],
        )
        await connection.query("DELETE FROM equipos WHERE id = ?", [equipoCanjeId])
      }
    }

    // Anular todos los pagos asociados
    await connection.query(
      "UPDATE pagos_ventas_equipos SET anulado = 1, fecha_anulacion = ?, motivo_anulacion = ? WHERE venta_equipo_id = ?",
      [fechaActual, `Anulación de venta #${venta.numero_factura}: ${motivo}`, id],
    )

    // Revertir movimientos de cuenta corriente
    const [movimientosCC] = await connection.query(
      "SELECT * FROM movimientos_cuenta_corriente WHERE referencia_id = ? AND tipo_referencia = 'venta_equipo'",
      [id],
    )

    for (const movimiento of movimientosCC) {
      const [cuentasCorrientes] = await connection.query("SELECT * FROM cuentas_corrientes WHERE id = ?", [
        movimiento.cuenta_corriente_id,
      ])
      if (cuentasCorrientes.length > 0) {
        const cuentaCorriente = cuentasCorrientes[0]
        await connection.query(
          "UPDATE cuentas_corrientes SET saldo = saldo - ?, fecha_ultimo_movimiento = ? WHERE id = ?",
          [movimiento.monto, fechaActual, cuentaCorriente.id],
        )
        await connection.query(
          `INSERT INTO movimientos_cuenta_corriente (
                        cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
                        referencia_id, tipo_referencia, usuario_id, notas
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cuentaCorriente.id,
            "pago", // Reversión es un 'pago'
            movimiento.monto,
            cuentaCorriente.saldo,
            cuentaCorriente.saldo - movimiento.monto,
            id,
            "ajuste",
            usuario_id,
            `Anulación de venta de equipo #${venta.numero_factura}: ${motivo}`,
          ],
        )
      }
    }

    // Marcar venta como anulada
    await connection.query(
      "UPDATE ventas_equipos SET anulada = 1, fecha_anulacion = ?, motivo_anulacion = ? WHERE id = ?",
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
