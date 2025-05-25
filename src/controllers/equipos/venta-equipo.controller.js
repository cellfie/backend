import pool from "../../db.js"
import { validationResult } from "express-validator"
import { registrarPagoInterno } from "../pago.controller.js"

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
                c.id AS cliente_id,
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                u.id AS usuario_id,
                u.nombre AS usuario_nombre,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta_nombre,
                v.tipo_pago,
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
                c.id AS cliente_id,
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                u.id AS usuario_id,
                u.nombre AS usuario_nombre,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta_nombre,
                v.tipo_pago,
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
                p.monto,
                p.fecha,
                p.anulado,
                p.tipo_pago
            FROM pagos p
            WHERE p.referencia_id = ? AND p.tipo_referencia = 'venta_equipo' AND p.anulado = 0
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
    tipo_pago,
    equipo_id,
    porcentaje_interes = 0,
    porcentaje_descuento = 0,
    plan_canje = null,
    notas,
    tipo_cambio,
  } = req.body

  // Verificar si el usuario está autenticado y tiene un ID
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado o ID de usuario no disponible" })
  }

  const usuario_id = req.user.id

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Verificar que el punto de venta existe
    const [puntosVenta] = await connection.query("SELECT * FROM puntos_venta WHERE id = ?", [punto_venta_id])
    if (puntosVenta.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Punto de venta no encontrado" })
    }

    // Verificar que el tipo de pago es válido
    if (!tipo_pago) {
      await connection.rollback()
      return res.status(400).json({ message: "Tipo de pago no especificado" })
    }

    // Verificar que el cliente existe si se proporciona un ID
    let clienteId = null
    if (cliente_id) {
      const [clientes] = await connection.query("SELECT * FROM clientes WHERE id = ?", [cliente_id])
      if (clientes.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: "Cliente no encontrado" })
      }
      clienteId = cliente_id
    }

    // Verificar que el equipo existe, pertenece al punto de venta y no está vendido
    const [equipos] = await connection.query(
      "SELECT * FROM equipos WHERE id = ? AND punto_venta_id = ? AND vendido = 0",
      [equipo_id, punto_venta_id],
    )
    if (equipos.length === 0) {
      await connection.rollback()
      return res.status(404).json({
        message: "Equipo no encontrado, no pertenece al punto de venta seleccionado, o ya ha sido vendido",
      })
    }

    // Obtener el tipo de cambio actual del sistema
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

    // Calcular subtotal (precio - descuento plan canje)
    const subtotalUSD = precioUSD - descuentoPlanCanje
    const subtotalARS = subtotalUSD * tipoCambio

    // Calcular montos de interés y descuento
    const montoInteresUSD = (subtotalUSD * porcentaje_interes) / 100
    const montoDescuentoUSD = (subtotalUSD * porcentaje_descuento) / 100
    const montoInteresARS = montoInteresUSD * tipoCambio
    const montoDescuentoARS = montoDescuentoUSD * tipoCambio

    // Calcular totales
    const totalUSD = subtotalUSD + montoInteresUSD - montoDescuentoUSD
    const totalARS = totalUSD * tipoCambio

    // Generar número de factura
    const numeroFactura = await generarNumeroFactura()

    // Insertar la venta
    const [resultVenta] = await connection.query(
      `INSERT INTO ventas_equipos (
                numero_factura, cliente_id, usuario_id, punto_venta_id, tipo_pago,
                equipo_id, precio_usd, precio_ars, tipo_cambio,
                porcentaje_interes, monto_interes, porcentaje_descuento, monto_descuento,
                total_usd, total_ars
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroFactura,
        clienteId,
        usuario_id,
        punto_venta_id,
        tipo_pago,
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
      ],
    )

    const ventaId = resultVenta.insertId

    // Marcar el equipo como vendido y asociarlo a esta venta
    await connection.query("UPDATE equipos SET vendido = 1, venta_id = ? WHERE id = ?", [ventaId, equipo_id])

    // Si hay plan canje, registrarlo y crear un nuevo equipo en el inventario
    let equipoCanjeId = null
    if (plan_canje) {
      // Registrar en la tabla plan_canje
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

      // Crear un nuevo equipo en el inventario con el equipo recibido por canje
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
          tipoCambio, // Guardar el tipo de cambio actual como original
          0, // No vendido
          null, // Sin venta asociada
          1, // Es un equipo de canje
          clienteId, // Cliente que entregó el equipo
          ventaId, // ID de la venta donde se recibió el equipo
        ],
      )

      equipoCanjeId = resultEquipoCanje.insertId

      // Registrar en log_equipos el ingreso del equipo por canje
      await connection.query(
        `INSERT INTO log_equipos (
                    equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas
                ) VALUES (?, ?, ?, ?, NOW(), ?)`,
        [
          equipoCanjeId,
          "ingreso_canje",
          ventaId,
          usuario_id,
          `Equipo recibido por plan canje en venta #${numeroFactura}`,
        ],
      )
    }

    // Registrar en log_equipos
    await connection.query(
      `INSERT INTO log_equipos (
                equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas
            ) VALUES (?, ?, ?, ?, NOW(), ?)`,
      [equipo_id, "venta", ventaId, usuario_id, notas || `Venta de equipo #${numeroFactura}`],
    )

    // Si el tipo de pago es cuenta corriente, registrar el movimiento
    const tipoPagoNombre = tipo_pago.toLowerCase()
    if (tipoPagoNombre === "cuenta corriente" || tipoPagoNombre === "cuenta") {
      if (!clienteId) {
        await connection.rollback()
        return res.status(400).json({
          message: "Se requiere un cliente para ventas con cuenta corriente",
        })
      }

      // Verificar si el cliente tiene cuenta corriente
      const [cuentasCorrientes] = await connection.query(
        "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
        [clienteId],
      )

      let cuentaCorrienteId

      if (cuentasCorrientes.length === 0) {
        // Crear cuenta corriente para el cliente
        const [resultCuenta] = await connection.query(
          "INSERT INTO cuentas_corrientes (cliente_id, saldo) VALUES (?, ?)",
          [clienteId, totalARS],
        )
        cuentaCorrienteId = resultCuenta.insertId
      } else {
        cuentaCorrienteId = cuentasCorrientes[0].id

        // Verificar límite de crédito si existe
        if (
          cuentasCorrientes[0].limite_credito > 0 &&
          cuentasCorrientes[0].saldo + totalARS > cuentasCorrientes[0].limite_credito
        ) {
          await connection.rollback()
          return res.status(400).json({
            message: "La venta excede el límite de crédito del cliente",
          })
        }

        // Actualizar saldo
        await connection.query(
          "UPDATE cuentas_corrientes SET saldo = saldo + ?, fecha_ultimo_movimiento = NOW() WHERE id = ?",
          [totalARS, cuentaCorrienteId],
        )
      }

      // Registrar movimiento
      await connection.query(
        `INSERT INTO movimientos_cuenta_corriente (
                    cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
                    referencia_id, tipo_referencia, usuario_id, notas
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cuentaCorrienteId,
          "cargo",
          totalARS,
          cuentasCorrientes.length > 0 ? Number(cuentasCorrientes[0].saldo) : 0,
          cuentasCorrientes.length > 0 ? Number(cuentasCorrientes[0].saldo) + totalARS : totalARS,
          ventaId,
          "venta_equipo",
          usuario_id,
          "Venta de equipo a cuenta corriente",
        ],
      )
    } else {
      // Si no es cuenta corriente, registrar el pago normal usando la función centralizada
      await registrarPagoInterno(connection, {
        monto: totalARS,
        tipo_pago: tipo_pago,
        referencia_id: ventaId,
        tipo_referencia: "venta", // ← Usar "venta" en lugar de "venta_equipo"
        cliente_id: clienteId,
        usuario_id,
        punto_venta_id,
        notas: notas || "Pago de venta de equipo #" + numeroFactura,
      })
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

    // Verificar que la venta existe y no está anulada
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

    // Desmarcar el equipo como vendido
    await connection.query("UPDATE equipos SET vendido = 0, venta_id = NULL WHERE id = ?", [venta.equipo_id])

    // Registrar en log_equipos
    await connection.query(
      `INSERT INTO log_equipos (
                equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas
            ) VALUES (?, ?, ?, ?, NOW(), ?)`,
      [
        venta.equipo_id,
        "anulacion_venta",
        id,
        usuario_id,
        `Anulación de venta de equipo #${venta.numero_factura}: ${motivo}`,
      ],
    )

    // Verificar si hay un plan canje asociado a esta venta
    const [planCanje] = await connection.query("SELECT * FROM plan_canje WHERE venta_equipo_id = ?", [id])

    if (planCanje.length > 0) {
      // Buscar el equipo que se creó por el plan canje
      const [equiposCanje] = await connection.query("SELECT * FROM equipos WHERE es_canje = 1 AND venta_canje_id = ?", [
        id,
      ])

      if (equiposCanje.length > 0) {
        const equipoCanjeId = equiposCanje[0].id

        // Registrar en log_equipos la eliminación del equipo de canje
        await connection.query(
          `INSERT INTO log_equipos (
                    equipo_id, tipo_movimiento, referencia_id, usuario_id, fecha, notas
                ) VALUES (?, ?, ?, ?, NOW(), ?)`,
          [
            equipoCanjeId,
            "eliminacion_canje",
            id,
            usuario_id,
            `Eliminación de equipo de canje por anulación de venta #${venta.numero_factura}: ${motivo}`,
          ],
        )

        // Eliminar el equipo de canje
        await connection.query("DELETE FROM equipos WHERE id = ?", [equipoCanjeId])
      }
    }

    // Si la venta fue con cuenta corriente, revertir el movimiento
    const tipoPagoNombre = venta.tipo_pago.toLowerCase()
    if (venta.cliente_id && (tipoPagoNombre === "cuenta corriente" || tipoPagoNombre === "cuenta")) {
      // Obtener la cuenta corriente del cliente
      const [cuentasCorrientes] = await connection.query(
        "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
        [venta.cliente_id],
      )

      if (cuentasCorrientes.length > 0) {
        const cuentaCorriente = cuentasCorrientes[0]

        // Actualizar saldo de la cuenta corriente
        await connection.query(
          "UPDATE cuentas_corrientes SET saldo = saldo - ?, fecha_ultimo_movimiento = NOW() WHERE id = ?",
          [venta.total_ars, cuentaCorriente.id],
        )

        // Registrar movimiento de reversión
        await connection.query(
          `INSERT INTO movimientos_cuenta_corriente (
                        cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
                        referencia_id, tipo_referencia, usuario_id, notas
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cuentaCorriente.id,
            "pago",
            venta.total_ars,
            cuentaCorriente.saldo,
            cuentaCorriente.saldo - venta.total_ars,
            id,
            "anulacion_venta_equipo",
            usuario_id,
            "Anulación de venta de equipo: " + motivo,
          ],
        )
      }
    } else {
      // Anular los pagos asociados a esta venta
      const [pagos] = await connection.query(
        "SELECT * FROM pagos WHERE referencia_id = ? AND tipo_referencia = 'venta'",
        [id],
      )

      for (const pago of pagos) {
        await connection.query(
          "UPDATE pagos SET anulado = 1, fecha_anulacion = NOW(), motivo_anulacion = ? WHERE id = ?",
          [`Anulación de venta de equipo: ${motivo}`, pago.id],
        )
      }
    }

    // Anular la venta
    await connection.query(
      "UPDATE ventas_equipos SET anulada = 1, fecha_anulacion = NOW(), motivo_anulacion = ? WHERE id = ?",
      [motivo, id],
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