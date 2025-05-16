import pool from "../../db.js"
import { validationResult } from "express-validator"
import { registrarPagoInterno } from "../pago.controller.js"

// Generar número de factura único
const generarNumeroFactura = async () => {
  const fecha = new Date()
  const año = fecha.getFullYear().toString().substr(-2)
  const mes = (fecha.getMonth() + 1).toString().padStart(2, "0")
  const dia = fecha.getDate().toString().padStart(2, "0")
  const prefijo = `F${año}${mes}${dia}`

  // Obtener el último número de factura con este prefijo
  const [ultimaFactura] = await pool.query(
    "SELECT numero_factura FROM ventas WHERE numero_factura LIKE ? ORDER BY id DESC LIMIT 1",
    [`${prefijo}%`],
  )

  let numero = 1
  if (ultimaFactura.length > 0) {
    const ultimoNumero = Number.parseInt(ultimaFactura[0].numero_factura.split("-")[1])
    numero = ultimoNumero + 1
  }

  return `${prefijo}-${numero.toString().padStart(4, "0")}`
}

// Obtener todas las ventas
export const getVentas = async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, cliente_id, punto_venta_id, anuladas } = req.query

    let sql = `
            SELECT 
                v.id, 
                v.numero_factura, 
                v.fecha, 
                v.subtotal, 
                v.porcentaje_interes,
                v.monto_interes,
                v.porcentaje_descuento,
                v.monto_descuento,
                v.total,
                v.anulada,
                v.fecha_anulacion,
                v.motivo_anulacion,
                v.tiene_devoluciones,
                c.id AS cliente_id,
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                u.id AS usuario_id,
                u.nombre AS usuario_nombre,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta_nombre,
                v.tipo_pago AS tipo_pago_nombre
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            JOIN usuarios u ON v.usuario_id = u.id
            JOIN puntos_venta pv ON v.punto_venta_id = pv.id
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
    console.error("Error al obtener ventas:", error)
    res.status(500).json({ message: "Error al obtener ventas" })
  }
}

// Obtener una venta por ID con su detalle
export const getVentaById = async (req, res) => {
  try {
    const { id } = req.params

    // Obtener la información de la venta
    const [ventas] = await pool.query(
      `
            SELECT 
                v.id, 
                v.numero_factura, 
                v.fecha, 
                v.subtotal, 
                v.porcentaje_interes,
                v.monto_interes,
                v.porcentaje_descuento,
                v.monto_descuento,
                v.total,
                v.anulada,
                v.fecha_anulacion,
                v.motivo_anulacion,
                v.tiene_devoluciones,
                c.id AS cliente_id,
                c.nombre AS cliente_nombre,
                c.telefono AS cliente_telefono,
                u.id AS usuario_id,
                u.nombre AS usuario_nombre,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta_nombre,
                v.tipo_pago AS tipo_pago_nombre
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            JOIN usuarios u ON v.usuario_id = u.id
            JOIN puntos_venta pv ON v.punto_venta_id = pv.id
            WHERE v.id = ?
        `,
      [id],
    )

    if (ventas.length === 0) {
      return res.status(404).json({ message: "Venta no encontrada" })
    }

    // Obtener el detalle de la venta incluyendo información de devoluciones
    // Modificamos la consulta para excluir productos completamente devueltos
    // cuando no son productos de reemplazo
    const [detalles] = await pool.query(
      `
      SELECT 
          dv.id,
          dv.producto_id,
          p.codigo AS producto_codigo,
          p.nombre AS producto_nombre,
          dv.cantidad,
          dv.precio_unitario,
          dv.precio_con_descuento,
          dv.subtotal,
          dv.devuelto,
          dv.es_reemplazo,
          dv.devolucion_id,
          dv.fecha_devolucion,
          COALESCE(SUM(dd.cantidad), 0) AS cantidad_devuelta
      FROM detalle_ventas dv
      JOIN productos p ON dv.producto_id = p.id
      LEFT JOIN detalle_devoluciones dd ON dv.id = dd.detalle_venta_id AND dd.devolucion_id IN (
          SELECT id FROM devoluciones WHERE venta_id = ? AND anulada = 0
      )
      WHERE dv.venta_id = ? AND (dv.es_reemplazo = 1 OR dv.devuelto = 0)
      GROUP BY dv.id
  `,
      [id, id],
    )

    // Obtener los pagos asociados a esta venta
    const [pagos] = await pool.query(
      `
            SELECT 
                p.id,
                p.monto,
                p.fecha,
                p.anulado,
                p.tipo_pago AS tipo_pago_nombre
            FROM pagos p
            WHERE p.referencia_id = ? AND p.tipo_referencia = 'venta' AND p.anulado = 0
        `,
      [id],
    )

    // Construir la respuesta
    const venta = {
      ...ventas[0],
      detalles,
      pagos,
    }

    res.json(venta)
  } catch (error) {
    console.error("Error al obtener venta:", error)
    res.status(500).json({ message: "Error al obtener venta" })
  }
}

// Crear una nueva venta
export const createVenta = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const {
    cliente_id,
    punto_venta_id,
    tipo_pago,
    productos,
    porcentaje_interes = 0,
    porcentaje_descuento = 0,
    notas,
  } = req.body

  // Verificar si el usuario está autenticado y tiene un ID
  // IMPORTANTE: Usar req.user en lugar de req.usuario para consistencia
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

    // Verificar que hay productos en la venta
    if (!productos || productos.length === 0) {
      await connection.rollback()
      return res.status(400).json({ message: "La venta debe tener al menos un producto" })
    }

    // Calcular subtotal y verificar stock
    let subtotal = 0
    for (const producto of productos) {
      // Verificar que el producto existe
      const [productosDb] = await connection.query("SELECT * FROM productos WHERE id = ?", [producto.id])
      if (productosDb.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: `Producto con ID ${producto.id} no encontrado` })
      }

      // Verificar stock disponible
      const [inventario] = await connection.query(
        "SELECT stock FROM inventario WHERE producto_id = ? AND punto_venta_id = ?",
        [producto.id, punto_venta_id],
      )

      if (inventario.length === 0 || inventario[0].stock < producto.cantidad) {
        await connection.rollback()
        return res.status(400).json({
          message: `Stock insuficiente para el producto ${productosDb[0].nombre}`,
        })
      }

      // Calcular precio con descuento si existe
      let precioConDescuento = producto.precio
      if (producto.descuento && producto.descuento.porcentaje > 0) {
        precioConDescuento = producto.precio * (1 - producto.descuento.porcentaje / 100)
      }

      // Sumar al subtotal
      subtotal += precioConDescuento * producto.cantidad
    }

    // Calcular montos de interés y descuento
    // Guardamos el porcentaje de interés para referencia, pero no lo aplicamos al total
    // El monto de interés se calcula pero no se suma al total
    const montoInteres = (subtotal * porcentaje_interes) / 100
    const montoDescuento = (subtotal * porcentaje_descuento) / 100

    // El total no incluye el interés, solo se resta el descuento
    const total = subtotal - montoDescuento

    // Generar número de factura
    const numeroFactura = await generarNumeroFactura()

    // Insertar la venta
    const [resultVenta] = await connection.query(
      `INSERT INTO ventas (
                numero_factura, cliente_id, usuario_id, punto_venta_id, tipo_pago,
                subtotal, porcentaje_interes, monto_interes, porcentaje_descuento, monto_descuento, total,
                tiene_devoluciones
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroFactura,
        clienteId,
        usuario_id,
        punto_venta_id,
        tipo_pago,
        subtotal,
        porcentaje_interes, // Guardamos el porcentaje de interés para referencia
        montoInteres, // Guardamos el monto de interés para referencia
        porcentaje_descuento,
        montoDescuento,
        total, // El total no incluye el interés
        0, // tiene_devoluciones inicialmente en 0
      ],
    )

    const ventaId = resultVenta.insertId

    // Insertar el detalle de la venta y actualizar inventario
    for (const producto of productos) {
      // Calcular precio con descuento
      let precioConDescuento = producto.precio
      if (producto.descuento && producto.descuento.porcentaje > 0) {
        precioConDescuento = producto.precio * (1 - producto.descuento.porcentaje / 100)
      }

      // Insertar detalle
      await connection.query(
        `INSERT INTO detalle_ventas (
                    venta_id, producto_id, cantidad, precio_unitario, precio_con_descuento, subtotal,
                    devuelto, es_reemplazo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ventaId,
          producto.id,
          producto.cantidad,
          producto.precio,
          precioConDescuento,
          precioConDescuento * producto.cantidad,
          0, // devuelto inicialmente en 0
          0, // es_reemplazo inicialmente en 0
        ],
      )

      // Actualizar inventario
      await connection.query("UPDATE inventario SET stock = stock - ? WHERE producto_id = ? AND punto_venta_id = ?", [
        producto.cantidad,
        producto.id,
        punto_venta_id,
      ])
    }

    // Si el tipo de pago es cuenta corriente, registrar el movimiento
    const tipoPagoNombre = tipo_pago.toLowerCase()
    if (tipoPagoNombre === "cuenta corriente") {
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
          [clienteId, total],
        )
        cuentaCorrienteId = resultCuenta.insertId
      } else {
        cuentaCorrienteId = cuentasCorrientes[0].id

        // Verificar límite de crédito si existe
        if (
          cuentasCorrientes[0].limite_credito > 0 &&
          cuentasCorrientes[0].saldo + total > cuentasCorrientes[0].limite_credito
        ) {
          await connection.rollback()
          return res.status(400).json({
            message: "La venta excede el límite de crédito del cliente",
          })
        }

        // Actualizar saldo
        await connection.query(
          "UPDATE cuentas_corrientes SET saldo = saldo + ?, fecha_ultimo_movimiento = NOW() WHERE id = ?",
          [total, cuentaCorrienteId],
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
          total,
          cuentasCorrientes.length > 0 ? Number(cuentasCorrientes[0].saldo) : 0,
          cuentasCorrientes.length > 0 ? Number(cuentasCorrientes[0].saldo) + total : total,
          ventaId,
          "venta",
          usuario_id,
          "Venta a cuenta corriente",
        ],
      )
    } else {
      // Si no es cuenta corriente, registrar el pago normal usando la función centralizada
      await registrarPagoInterno(connection, {
        monto: total,
        tipo_pago: tipo_pago,
        referencia_id: ventaId,
        tipo_referencia: "venta",
        cliente_id: clienteId,
        usuario_id,
        punto_venta_id,
        notas: notas || "Pago de venta #" + numeroFactura,
      })
    }

    await connection.commit()

    res.status(201).json({
      id: ventaId,
      numero_factura: numeroFactura,
      total,
      message: "Venta registrada exitosamente",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear venta:", error)
    res.status(500).json({ message: "Error al crear venta: " + error.message })
  } finally {
    connection.release()
  }
}

// Anular una venta
export const anularVenta = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { id } = req.params
  const { motivo } = req.body
  const usuario_id = req.user.id // Usar req.user en lugar de req.usuario

  if (!motivo || motivo.trim() === "") {
    return res.status(400).json({ message: "El motivo de anulación es obligatorio" })
  }

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Verificar que la venta existe y no está anulada
    const [ventas] = await connection.query("SELECT v.* FROM ventas v WHERE v.id = ?", [id])

    if (ventas.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Venta no encontrada" })
    }

    const venta = ventas[0]

    if (venta.anulada) {
      await connection.rollback()
      return res.status(400).json({ message: "La venta ya está anulada" })
    }

    // Verificar si la venta tiene devoluciones
    if (venta.tiene_devoluciones) {
      // Obtener las devoluciones de la venta
      const [devoluciones] = await connection.query("SELECT * FROM devoluciones WHERE venta_id = ? AND anulada = 0", [
        id,
      ])

      // Anular cada devolución
      for (const devolucion of devoluciones) {
        // Obtener detalles de la devolución (productos devueltos)
        const [detallesDevoluciones] = await connection.query(
          "SELECT * FROM detalle_devoluciones WHERE devolucion_id = ?",
          [devolucion.id],
        )

        // Obtener detalles de reemplazos
        const [detallesReemplazos] = await connection.query(
          "SELECT * FROM detalle_reemplazos WHERE devolucion_id = ?",
          [devolucion.id],
        )

        // Restaurar inventario de productos de reemplazo (sumar)
        for (const detalleReemplazo of detallesReemplazos) {
          // Verificar si existe el registro de inventario
          const [inventario] = await connection.query(
            "SELECT * FROM inventario WHERE producto_id = ? AND punto_venta_id = ?",
            [detalleReemplazo.producto_id, venta.punto_venta_id],
          )

          if (inventario.length > 0) {
            // Sumar al inventario (porque se está anulando la devolución)
            await connection.query(
              "UPDATE inventario SET stock = stock + ? WHERE producto_id = ? AND punto_venta_id = ?",
              [detalleReemplazo.cantidad, detalleReemplazo.producto_id, venta.punto_venta_id],
            )
          } else {
            // Crear un nuevo registro de inventario
            await connection.query("INSERT INTO inventario (producto_id, punto_venta_id, stock) VALUES (?, ?, ?)", [
              detalleReemplazo.producto_id,
              venta.punto_venta_id,
              detalleReemplazo.cantidad,
            ])
          }

          // Registrar en log de inventario
          await connection.query(
            `INSERT INTO log_inventario (
              producto_id, punto_venta_id, cantidad, tipo_movimiento, 
              referencia_id, usuario_id, fecha, notas
            ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
            [
              detalleReemplazo.producto_id,
              venta.punto_venta_id,
              detalleReemplazo.cantidad,
              "anulacion_venta",
              id,
              usuario_id,
              `Anulación de venta #${venta.numero_factura}: ${motivo} - Producto de reemplazo restaurado`,
            ],
          )
        }

        // NO restauramos el inventario de productos devueltos, ya que eso ya se manejó durante la devolución
        for (const detalleDevolucion of detallesDevoluciones) {
          // Solo registramos en el log que no se modifica el stock
          await connection.query(
            `INSERT INTO log_inventario (
              producto_id, punto_venta_id, cantidad, tipo_movimiento, 
              referencia_id, usuario_id, fecha, notas
            ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
            [
              detalleDevolucion.producto_id,
              venta.punto_venta_id,
              0, // No modificamos el stock
              "anulacion_venta",
              id,
              usuario_id,
              `Anulación de venta #${venta.numero_factura}: ${motivo} - No se modifica stock de producto devuelto`,
            ],
          )
        }

        // Si la devolución tuvo diferencia y se registró en cuenta corriente, revertir
        if (devolucion.diferencia !== 0 && devolucion.cliente_id) {
          // Verificar si el cliente tiene cuenta corriente
          const [cuentas] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ?", [
            devolucion.cliente_id,
          ])

          if (cuentas.length > 0) {
            const cuenta = cuentas[0]
            const saldoAnterior = Number.parseFloat(cuenta.saldo)

            let nuevoSaldo
            if (devolucion.diferencia < 0) {
              // Si fue un crédito a favor, ahora sumamos al saldo
              nuevoSaldo = saldoAnterior + Math.abs(Number.parseFloat(devolucion.diferencia))
            } else {
              // Si fue un cargo, ahora restamos del saldo
              nuevoSaldo = saldoAnterior - Number.parseFloat(devolucion.diferencia)
            }

            // Actualizar el saldo de la cuenta corriente
            await connection.query(
              `
              UPDATE cuentas_corrientes 
              SET saldo = ?, fecha_ultimo_movimiento = NOW() 
              WHERE id = ?
            `,
              [nuevoSaldo, cuenta.id],
            )

            // Registrar el movimiento en la cuenta corriente
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
              ) VALUES (?, ?, ?, ?, ?, ?, 'anulacion_venta', NOW(), ?, ?)
            `,
              [
                cuenta.id,
                devolucion.diferencia < 0 ? "cargo" : "pago",
                Math.abs(Number.parseFloat(devolucion.diferencia)),
                saldoAnterior.toFixed(2),
                nuevoSaldo.toFixed(2),
                id,
                usuario_id,
                `Anulación de venta #${venta.numero_factura} - Reversión de devolución: ${motivo}`,
              ],
            )
          }
        }

        // Marcar la devolución como anulada
        await connection.query(
          "UPDATE devoluciones SET anulada = 1, fecha_anulacion = NOW(), motivo_anulacion = ? WHERE id = ?",
          [`Anulación de venta: ${motivo}`, devolucion.id],
        )
      }
    }

    // Obtener detalles de la venta
    const [detalles] = await connection.query("SELECT * FROM detalle_ventas WHERE venta_id = ?", [id])

    // Restaurar inventario de productos originales (solo los que no fueron devueltos)
    for (const detalle of detalles) {
      // Verificar si existe el registro de inventario
      const [inventario] = await connection.query(
        "SELECT * FROM inventario WHERE producto_id = ? AND punto_venta_id = ?",
        [detalle.producto_id, venta.punto_venta_id],
      )

      // Si el producto es un reemplazo, no restaurar su stock ya que se manejó en la sección de devoluciones
      if (detalle.es_reemplazo) {
        continue
      }

      // Si el producto está marcado como devuelto, no restaurar su stock
      if (detalle.devuelto) {
        continue
      }

      // Verificar si este producto tiene devoluciones parciales
      const [devolucionesParciales] = await connection.query(
        `SELECT COALESCE(SUM(dd.cantidad), 0) as cantidad_devuelta
         FROM detalle_devoluciones dd
         JOIN devoluciones d ON dd.devolucion_id = d.id
         WHERE dd.detalle_venta_id = ? AND d.anulada = 0`,
        [detalle.id],
      )

      // Calcular la cantidad a restaurar (cantidad original - cantidad devuelta)
      const cantidadDevuelta = devolucionesParciales[0].cantidad_devuelta || 0
      const cantidadARestaurar = detalle.cantidad - cantidadDevuelta

      // Solo restaurar si hay cantidad no devuelta
      if (cantidadARestaurar <= 0) {
        continue
      }

      if (inventario.length > 0) {
        // Actualizar el inventario existente
        await connection.query("UPDATE inventario SET stock = stock + ? WHERE producto_id = ? AND punto_venta_id = ?", [
          cantidadARestaurar,
          detalle.producto_id,
          venta.punto_venta_id,
        ])
      } else {
        // Crear un nuevo registro de inventario
        await connection.query("INSERT INTO inventario (producto_id, punto_venta_id, stock) VALUES (?, ?, ?)", [
          detalle.producto_id,
          venta.punto_venta_id,
          cantidadARestaurar,
        ])
      }

      // Registrar en log de inventario
      await connection.query(
        `INSERT INTO log_inventario (
                    producto_id, punto_venta_id, cantidad, tipo_movimiento, 
                    referencia_id, usuario_id, fecha, notas
                ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          detalle.producto_id,
          venta.punto_venta_id,
          cantidadARestaurar,
          "anulacion_venta",
          id,
          usuario_id,
          `Anulación de venta #${venta.numero_factura}: ${motivo} - Restauración de ${cantidadARestaurar} unidades no devueltas`,
        ],
      )
    }

    // Si la venta fue con cuenta corriente, revertir el movimiento
    const tipoPagoNombre = venta.tipo_pago.toLowerCase()
    if (venta.cliente_id && tipoPagoNombre === "cuenta corriente") {
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
          [venta.total, cuentaCorriente.id],
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
            venta.total,
            cuentaCorriente.saldo,
            cuentaCorriente.saldo - venta.total,
            id,
            "anulacion_venta",
            usuario_id,
            "Anulación de venta: " + motivo,
          ],
        )
      }
    } else {
      // Anular los pagos asociados a esta venta
      const [pagos] = await connection.query(
        "SELECT * FROM pagos WHERE referencia_id = ? AND tipo_referencia = 'venta' AND anulado = 0",
        [id],
      )

      for (const pago of pagos) {
        await connection.query(
          "UPDATE pagos SET anulado = 1, fecha_anulacion = NOW(), motivo_anulacion = ? WHERE id = ?",
          [`Anulación de venta: ${motivo}`, pago.id],
        )
      }
    }

    // Anular la venta
    await connection.query(
      "UPDATE ventas SET anulada = 1, fecha_anulacion = NOW(), motivo_anulacion = ? WHERE id = ?",
      [motivo, id],
    )

    await connection.commit()

    // Obtener la venta actualizada para devolver en la respuesta
    const [ventaActualizada] = await connection.query(
      `SELECT 
                v.id, 
                v.numero_factura, 
                v.fecha, 
                v.anulada,
                v.fecha_anulacion,
                v.motivo_anulacion
            FROM ventas v
            WHERE v.id = ?`,
      [id],
    )

    res.json({
      message: "Venta anulada exitosamente",
      venta: ventaActualizada[0],
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al anular venta:", error)
    res.status(500).json({ message: "Error al anular venta: " + error.message })
  } finally {
    connection.release()
  }
}

// Obtener estadísticas de ventas
export const getEstadisticasVentas = async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, punto_venta_id } = req.query

    let whereClause = "WHERE anulada = 0"
    const params = []

    // Filtrar por fecha de inicio
    if (fecha_inicio) {
      whereClause += " AND DATE(fecha) >= ?"
      params.push(fecha_inicio)
    }

    // Filtrar por fecha de fin
    if (fecha_fin) {
      whereClause += " AND DATE(fecha) <= ?"
      params.push(fecha_fin)
    }

    // Filtrar por punto de venta
    if (punto_venta_id) {
      whereClause += " AND punto_venta_id = ?"
      params.push(punto_venta_id)
    }

    // Total de ventas
    const [totalVentas] = await pool.query(
      `SELECT COUNT(*) as cantidad, SUM(total) as monto FROM ventas ${whereClause}`,
      params,
    )

    // Ventas por tipo de pago
    const [ventasPorMetodo] = await pool.query(
      `SELECT 
        v.tipo_pago as tipo_pago, 
        COUNT(v.id) as cantidad, 
        SUM(v.total) as monto 
      FROM ventas v
      ${whereClause}
      GROUP BY v.tipo_pago
      ORDER BY monto DESC`,
      params,
    )

    // Ventas por punto de venta
    const [ventasPorPunto] = await pool.query(
      `SELECT 
                pv.nombre as punto_venta, 
                COUNT(v.id) as cantidad, 
                SUM(v.total) as monto 
            FROM ventas v
            JOIN puntos_venta pv ON v.punto_venta_id = pv.id
            ${whereClause}
            GROUP BY v.punto_venta_id
            ORDER BY monto DESC`,
      params,
    )

    // Productos más vendidos
    const [productosMasVendidos] = await pool.query(
      `SELECT 
                p.id,
                p.codigo,
                p.nombre,
                SUM(dv.cantidad) as cantidad_vendida,
                SUM(dv.subtotal) as monto_total
            FROM detalle_ventas dv
            JOIN productos p ON dv.producto_id = p.id
            JOIN ventas v ON dv.venta_id = v.id
            ${whereClause}
            GROUP BY dv.producto_id
            ORDER BY cantidad_vendida DESC
            LIMIT 10`,
      params,
    )

    res.json({
      total_ventas: {
        cantidad: totalVentas[0].cantidad,
        monto: totalVentas[0].monto || 0,
      },
      ventas_por_metodo: ventasPorMetodo,
      ventas_por_punto: ventasPorPunto,
      productos_mas_vendidos: productosMasVendidos,
    })
  } catch (error) {
    console.error("Error al obtener estadísticas de ventas:", error)
    res.status(500).json({ message: "Error al obtener estadísticas de ventas" })
  }
}

// Obtener devoluciones de una venta
export const getDevolucionesByVenta = async (req, res) => {
  try {
    const { id } = req.params

    // Verificar que la venta existe
    const [ventas] = await pool.query("SELECT * FROM ventas WHERE id = ?", [id])
    if (ventas.length === 0) {
      return res.status(404).json({ message: "Venta no encontrada" })
    }

    // Obtener las devoluciones de la venta
    const [devoluciones] = await pool.query(
      `
      SELECT d.*, 
             u.nombre AS usuario_nombre,
             c.nombre AS cliente_nombre
      FROM devoluciones d
      LEFT JOIN usuarios u ON d.usuario_id = u.id
      LEFT JOIN clientes c ON d.cliente_id = c.id
      WHERE d.venta_id = ? AND d.anulada = 0
      ORDER BY d.fecha DESC
    `,
      [id],
    )

    // Para cada devolución, obtener los productos devueltos y los productos de reemplazo
    for (const devolucion of devoluciones) {
      // Obtener productos devueltos
      const [productosDevueltos] = await pool.query(
        `
        SELECT dd.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre
        FROM detalle_devoluciones dd
        JOIN productos p ON dd.producto_id = p.id
        WHERE dd.devolucion_id = ?
      `,
        [devolucion.id],
      )

      // Obtener productos de reemplazo
      const [productosReemplazo] = await pool.query(
        `
        SELECT dr.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre
        FROM detalle_reemplazos dr
        JOIN productos p ON dr.producto_id = p.id
        WHERE dr.devolucion_id = ?
      `,
        [devolucion.id],
      )

      devolucion.productos_devueltos = productosDevueltos
      devolucion.productos_reemplazo = productosReemplazo
    }

    res.json(devoluciones)
  } catch (error) {
    console.error("Error al obtener devoluciones de la venta:", error)
    res.status(500).json({ message: "Error al obtener devoluciones de la venta" })
  }
}
