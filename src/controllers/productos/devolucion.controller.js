import pool from "../../db.js"
import { validationResult } from "express-validator"
import { formatearFechaParaDB } from "../../utils/dateUtils.js"

const esTipoPagoCuentaCorriente = (tipoPago) => {
  const t = String(tipoPago || "")
    .toLowerCase()
    .trim()
  return t === "cuenta" || t === "cuenta corriente" || t.includes("cuenta corriente")
}

const obtenerSesionCajaAbierta = async (connection, puntoVentaId) => {
  const [sesiones] = await connection.query(
    `SELECT id FROM caja_sesiones
     WHERE punto_venta_id = ? AND estado = 'abierta'
     ORDER BY fecha_apertura DESC LIMIT 1`,
    [puntoVentaId],
  )
  return sesiones.length > 0 ? sesiones[0].id : null
}

// Obtener todas las devoluciones
export const getDevoluciones = async (req, res) => {
  try {
    // Par?metros de filtrado opcionales
    const { fecha_inicio, fecha_fin, cliente_id, punto_venta_id } = req.query

    let query = `SELECT d.*, u.nombre AS usuario_nombre, c.nombre AS cliente_nombre, v.numero_factura FROM devoluciones d LEFT JOIN usuarios u ON d.usuario_id = u.id LEFT JOIN clientes c ON d.cliente_id = c.id LEFT JOIN ventas v ON d.venta_id = v.id WHERE 1=1`
    const queryParams = []

    // Aplicar filtros si se proporcionan
    if (fecha_inicio) {
      query += " AND DATE(d.fecha) >= ?"
      queryParams.push(fecha_inicio)
    }
    if (fecha_fin) {
      query += " AND DATE(d.fecha) <= ?"
      queryParams.push(fecha_fin)
    }
    if (cliente_id) {
      query += " AND d.cliente_id = ?"
      queryParams.push(cliente_id)
    }
    if (punto_venta_id) {
      query += " AND v.punto_venta_id = ?"
      queryParams.push(punto_venta_id)
    }

    query += " ORDER BY d.fecha DESC"

    const [devoluciones] = await pool.query(query, queryParams)

    // Para cada devoluci?n, obtener los productos devueltos y los productos de reemplazo
    for (const devolucion of devoluciones) {
      // Obtener productos devueltos
      const [productosDevueltos] = await pool.query(
        `SELECT dd.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre, dv.precio_con_descuento FROM detalle_devoluciones dd JOIN productos p ON dd.producto_id = p.id LEFT JOIN detalle_ventas dv ON dd.detalle_venta_id = dv.id WHERE dd.devolucion_id = ?`,
        [devolucion.id],
      )

      // Obtener productos de reemplazo
      const [productosReemplazo] = await pool.query(
        `SELECT dr.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre, p.precio FROM detalle_reemplazos dr JOIN productos p ON dr.producto_id = p.id WHERE dr.devolucion_id = ?`,
        [devolucion.id],
      )

      devolucion.productos_devueltos = productosDevueltos
      devolucion.productos_reemplazo = productosReemplazo
    }

    res.json(devoluciones)
  } catch (error) {
    console.error("Error al obtener devoluciones:", error)
    res.status(500).json({ message: "Error al obtener devoluciones" })
  }
}

// Obtener una devoluci?n por ID
export const getDevolucionById = async (req, res) => {
  try {
    const { id } = req.params

    const [devoluciones] = await pool.query(
      `SELECT d.*, u.nombre AS usuario_nombre, c.nombre AS cliente_nombre, v.numero_factura FROM devoluciones d LEFT JOIN usuarios u ON d.usuario_id = u.id LEFT JOIN clientes c ON d.cliente_id = c.id LEFT JOIN ventas v ON d.venta_id = v.id WHERE d.id = ?`,
      [id],
    )

    if (devoluciones.length === 0) {
      return res.status(404).json({ message: "Devoluci?n no encontrada" })
    }

    const devolucion = devoluciones[0]

    // Obtener productos devueltos
    const [productosDevueltos] = await pool.query(
      `SELECT dd.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre, dv.precio_con_descuento FROM detalle_devoluciones dd JOIN productos p ON dd.producto_id = p.id LEFT JOIN detalle_ventas dv ON dd.detalle_venta_id = dv.id WHERE dd.devolucion_id = ?`,
      [id],
    )

    // Obtener productos de reemplazo
    const [productosReemplazo] = await pool.query(
      `SELECT dr.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre, p.precio FROM detalle_reemplazos dr JOIN productos p ON dr.producto_id = p.id WHERE dr.devolucion_id = ?`,
      [id],
    )

    devolucion.productos_devueltos = productosDevueltos
    devolucion.productos_reemplazo = productosReemplazo

    res.json(devolucion)
  } catch (error) {
    console.error("Error al obtener devoluci?n:", error)
    res.status(500).json({ message: "Error al obtener devoluci?n" })
  }
}

// Crear una nueva devoluci?n
export const createDevolucion = async (req, res) => {
  // Validar los datos de entrada
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const {
      venta_id,
      productos_devueltos,
      productos_reemplazo = [],
      diferencia = 0,
      tipo_pago = null,
      pagos = [],
      cliente_id = null,
      // 'cuenta_corriente' (default) | 'efectivo'
      tipo_reembolso = "cuenta_corriente",
    } = req.body
    const diferenciaNum = Number(diferencia) || 0
    const modoReembolso =
      String(tipo_reembolso || "cuenta_corriente").toLowerCase() === "efectivo"
        ? "efectivo"
        : "cuenta_corriente"

    // Verificar que la venta existe y no est? anulada
    const [ventas] = await connection.query("SELECT * FROM ventas WHERE id = ? AND anulada = 0", [venta_id])
    if (ventas.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Venta no encontrada o anulada" })
    }

    const venta = ventas[0]

    // Usar la funci?n utilitaria para obtener la fecha actual en Argentina
    const fechaActual = formatearFechaParaDB()

    // Insertar la devoluci?n y obtener el ID con fecha correcta
    const [result] = await connection.query(
      `INSERT INTO devoluciones (venta_id, fecha, usuario_id, diferencia, cliente_id) VALUES (?, ?, ?, ?, ?)`,
      [venta_id, fechaActual, req.user.id, diferencia, cliente_id],
    )

    const devolucionId = result.insertId

    // Factor de lo realmente pagado: el descuento global de la venta se aplica al total,
    // no a cada l?nea (precio_con_descuento). As? la devoluci?n usa el precio pagado.
    const subtotalVenta = Number(venta.subtotal) || 0
    const totalVenta = Number(venta.total) || 0
    const factorPagado = subtotalVenta > 0.0001 ? totalVenta / subtotalVenta : 1

    // Verificar que los productos a devolver pertenecen a la venta y no han sido devueltos ya
    for (const producto of productos_devueltos) {
      // Verificar si es un producto original o un producto de reemplazo
      let detalleVenta
      let query
      let params

      // Si se proporciona un detalle_venta_id espec?fico, usarlo directamente
      if (producto.detalle_venta_id) {
        query = `SELECT dv.*, COALESCE(SUM(dd.cantidad), 0) AS cantidad_devuelta FROM detalle_ventas dv LEFT JOIN detalle_devoluciones dd ON dv.id = dd.detalle_venta_id WHERE dv.id = ? GROUP BY dv.id`
        params = [producto.detalle_venta_id]
      } else if (producto.es_reemplazo) {
        // Si es un producto de reemplazo, buscar en los detalles de venta con es_reemplazo = 1
        query = `SELECT dv.*, COALESCE(SUM(dd.cantidad), 0) AS cantidad_devuelta FROM detalle_ventas dv LEFT JOIN detalle_devoluciones dd ON dv.id = dd.detalle_venta_id WHERE dv.venta_id = ? AND dv.producto_id = ? AND dv.es_reemplazo = 1 GROUP BY dv.id ORDER BY dv.id DESC LIMIT 1`
        params = [venta_id, producto.producto_id]
      } else {
        // Si es un producto original, buscar en los detalles de venta normales
        query = `SELECT dv.*, COALESCE(SUM(dd.cantidad), 0) AS cantidad_devuelta FROM detalle_ventas dv LEFT JOIN detalle_devoluciones dd ON dv.id = dd.detalle_venta_id WHERE dv.venta_id = ? AND dv.producto_id = ? AND dv.es_reemplazo = 0 GROUP BY dv.id`
        params = [venta_id, producto.producto_id]
      }

      const [detalles] = await connection.query(query, params)

      if (detalles.length === 0) {
        await connection.rollback()
        return res.status(400).json({
          message: `El producto${producto.es_reemplazo ? " de reemplazo" : ""} con ID ${producto.producto_id} no se encuentra en esta venta`,
        })
      }

      detalleVenta = detalles[0]

      // Verificar si el producto ya ha sido devuelto completamente
      if (detalleVenta.devuelto) {
        await connection.rollback()
        return res.status(400).json({
          message: `El producto ${detalleVenta.producto_id} ya ha sido devuelto completamente y no puede devolverse nuevamente.`,
        })
      }

      const cantidadDisponible = detalleVenta.cantidad - (detalleVenta.cantidad_devuelta || 0)

      if (producto.cantidad > cantidadDisponible) {
        await connection.rollback()
        return res.status(400).json({
          message: `No se puede devolver ${producto.cantidad} unidades del producto ${producto.producto_id}. Solo hay ${cantidadDisponible} disponibles para devoluci?n.`,
        })
      }

      // Registrar el detalle de la devoluci?n con el precio efectivamente pagado
      const precioEfectivoPagado = Number(detalleVenta.precio_con_descuento || 0) * factorPagado

      await connection.query(
        `INSERT INTO detalle_devoluciones (devolucion_id, detalle_venta_id, producto_id, cantidad, precio, tipo_devolucion, es_reemplazo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          devolucionId,
          detalleVenta.id,
          producto.producto_id,
          producto.cantidad,
          precioEfectivoPagado,
          producto.tipo_devolucion,
          producto.es_reemplazo ? 1 : 0,
        ],
      )

      // Actualizar el estado del producto en detalle_ventas
      // Si se devuelve toda la cantidad, marcar como devuelto
      if (producto.cantidad >= cantidadDisponible) {
        await connection.query(
          `UPDATE detalle_ventas SET devuelto = 1, devolucion_id = ?, fecha_devolucion = ? WHERE id = ?`,
          [devolucionId, fechaActual, detalleVenta.id],
        )
      } else {
        // Si es devoluci?n parcial, no marcamos como devuelto pero guardamos la referencia
        await connection.query(`UPDATE detalle_ventas SET devolucion_id = ?, fecha_devolucion = ? WHERE id = ?`, [
          devolucionId,
          fechaActual,
          detalleVenta.id,
        ])
      }

      // Actualizar el inventario si la devoluci?n es normal (no defectuoso)
      if (producto.tipo_devolucion === "normal") {
        await connection.query(`UPDATE inventario SET stock = stock + ? WHERE producto_id = ? AND punto_venta_id = ?`, [
          producto.cantidad,
          producto.producto_id,
          venta.punto_venta_id,
        ])

        // Registrar el movimiento en el log de inventario
        await connection.query(
          `INSERT INTO log_inventario (producto_id, punto_venta_id, cantidad, tipo_movimiento, referencia_id, usuario_id, fecha, notas) VALUES (?, ?, ?, 'devolucion', ?, ?, ?, ?)`,
          [
            producto.producto_id,
            venta.punto_venta_id,
            producto.cantidad,
            devolucionId,
            req.user.id,
            fechaActual,
            `Devoluci?n de producto${producto.es_reemplazo ? " de reemplazo" : ""} - Venta #${venta.numero_factura}`,
          ],
        )
      } else if (producto.tipo_devolucion === "defectuoso") {
        // Registrar en la tabla de p?rdidas
        await connection.query(
          `INSERT INTO perdidas (producto_id, cantidad, motivo, devolucion_id, usuario_id, fecha) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            producto.producto_id,
            producto.cantidad,
            `Producto${producto.es_reemplazo ? " de reemplazo" : ""} defectuoso - Devoluci?n`,
            devolucionId,
            req.user.id,
            fechaActual,
          ],
        )
      }
    }

    // Registrar los productos de reemplazo
    for (const producto of productos_reemplazo) {
      // Obtener informaci?n del producto
      const [productos] = await connection.query("SELECT * FROM productos WHERE id = ?", [producto.producto_id])
      const productoInfo = productos[0]

      // Registrar el detalle del reemplazo
      await connection.query(
        `INSERT INTO detalle_reemplazos (devolucion_id, producto_id, cantidad, precio) VALUES (?, ?, ?, ?)`,
        [devolucionId, producto.producto_id, producto.cantidad, producto.precio],
      )

      // Actualizar el inventario
      await connection.query(`UPDATE inventario SET stock = stock - ? WHERE producto_id = ? AND punto_venta_id = ?`, [
        producto.cantidad,
        producto.producto_id,
        venta.punto_venta_id,
      ])

      // Registrar el movimiento en el log de inventario
      await connection.query(
        `INSERT INTO log_inventario (producto_id, punto_venta_id, cantidad, tipo_movimiento, referencia_id, usuario_id, fecha, notas) VALUES (?, ?, ?, 'devolucion', ?, ?, ?, ?)`,
        [
          producto.producto_id,
          venta.punto_venta_id,
          -producto.cantidad,
          devolucionId,
          req.user.id,
          fechaActual,
          `Producto de reemplazo - Devoluci?n de venta #${venta.numero_factura}`,
        ],
      )

      // Agregar el producto de reemplazo a la venta
      await connection.query(
        `INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, precio_con_descuento, subtotal, es_reemplazo, devolucion_id, fecha_devolucion) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          venta_id,
          producto.producto_id,
          producto.cantidad,
          productoInfo.precio,
          producto.precio,
          producto.precio * producto.cantidad,
          devolucionId,
          fechaActual,
        ],
      )
    }

    const [totalesResult] = await connection.query(
      `SELECT SUM(subtotal) as nuevo_subtotal FROM detalle_ventas WHERE venta_id = ? AND (devuelto = 0 OR es_reemplazo = 1)`,
      [venta_id],
    )

    const nuevoSubtotal = totalesResult[0].nuevo_subtotal || 0

    // Aplicar los mismos porcentajes de inter?s y descuento que ten?a la venta original
    const porcentajeInteres = Number(venta.porcentaje_interes) || 0
    const porcentajeDescuento = Number(venta.porcentaje_descuento) || 0

    const montoInteres = (nuevoSubtotal * porcentajeInteres) / 100
    const montoDescuento = (nuevoSubtotal * porcentajeDescuento) / 100
    const nuevoTotal = nuevoSubtotal + montoInteres - montoDescuento

    // Actualizar el total de la venta
    await connection.query(
      `UPDATE ventas SET subtotal = ?, monto_interes = ?, monto_descuento = ?, total = ? WHERE id = ?`,
      [nuevoSubtotal, montoInteres, montoDescuento, nuevoTotal, venta_id],
    )

    // Marcar la venta como que tiene devoluciones
    await connection.query(`UPDATE ventas SET tiene_devoluciones = 1 WHERE id = ?`, [venta_id])

    // Diferencia a favor del cliente (reembolso)
    if (diferenciaNum < 0) {
      const montoReembolso = Math.abs(diferenciaNum)

      if (modoReembolso === "efectivo") {
        const cajaSesionId = await obtenerSesionCajaAbierta(connection, venta.punto_venta_id)
        if (!cajaSesionId) {
          await connection.rollback()
          return res.status(400).json({
            message:
              "No hay caja abierta en este punto de venta. Abrí la caja para devolver efectivo o acreditá a cuenta corriente.",
          })
        }

        await connection.query(
          `INSERT INTO caja_movimientos (
            caja_sesion_id, tipo, concepto, monto, metodo_pago, origen,
            usuario_id, fecha, referencia_id, tipo_referencia
          ) VALUES (?, 'egreso', ?, ?, 'Efectivo', 'ventas_productos', ?, ?, ?, 'devolucion')`,
          [
            cajaSesionId,
            `Reembolso devolución - Venta #${venta.numero_factura}`,
            montoReembolso,
            req.user.id,
            fechaActual,
            devolucionId,
          ],
        )
      } else {
        if (!cliente_id) {
          await connection.rollback()
          return res.status(400).json({
            message: "Se requiere un cliente para acreditar el reembolso a cuenta corriente",
          })
        }

        const [cuentas] = await connection.query(
          "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
          [cliente_id],
        )

        if (cuentas.length > 0) {
          const cuenta = cuentas[0]
          const saldoAnterior = Number.parseFloat(cuenta.saldo)
          const nuevoSaldo = saldoAnterior - montoReembolso

          await connection.query(
            `UPDATE cuentas_corrientes SET saldo = ?, fecha_ultimo_movimiento = ? WHERE id = ?`,
            [nuevoSaldo, fechaActual, cuenta.id],
          )

          await connection.query(
            `INSERT INTO movimientos_cuenta_corriente (cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, referencia_id, tipo_referencia, fecha, usuario_id, notas) VALUES (?, 'pago', ?, ?, ?, ?, 'devolucion', ?, ?, ?)`,
            [
              cuenta.id,
              montoReembolso,
              saldoAnterior.toFixed(2),
              nuevoSaldo.toFixed(2),
              devolucionId,
              fechaActual,
              req.user.id,
              `Crédito por devolución - Venta #${venta.numero_factura}`,
            ],
          )
        } else {
          const saldoInicial = 0
          const nuevoSaldo = saldoInicial - montoReembolso

          const [resultCuenta] = await connection.query(
            "INSERT INTO cuentas_corrientes (cliente_id, saldo, activo) VALUES (?, ?, 1)",
            [cliente_id, nuevoSaldo],
          )

          await connection.query(
            `INSERT INTO movimientos_cuenta_corriente (cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, referencia_id, tipo_referencia, fecha, usuario_id, notas) VALUES (?, 'pago', ?, ?, ?, ?, 'devolucion', ?, ?, ?)`,
            [
              resultCuenta.insertId,
              montoReembolso,
              saldoInicial.toFixed(2),
              nuevoSaldo.toFixed(2),
              devolucionId,
              fechaActual,
              req.user.id,
              `Crédito por devolución - Venta #${venta.numero_factura}`,
            ],
          )
        }
      }
    }
    // Diferencia a cargo del cliente (cobra en caja, salvo cuenta corriente)
    else if (diferenciaNum > 0) {
      const pagosProcesar =
        Array.isArray(pagos) && pagos.length > 0
          ? pagos.map((p) => ({ tipo_pago: p.tipo_pago, monto: Number(p.monto || 0) }))
          : [{ tipo_pago, monto: diferenciaNum }]

      if (pagosProcesar.some((p) => !p.tipo_pago || String(p.tipo_pago).trim() === "")) {
        await connection.rollback()
        return res.status(400).json({ message: "Cada pago debe tener una forma de pago válida" })
      }

      const totalPagos = pagosProcesar.reduce((sum, p) => sum + Number(p.monto || 0), 0)
      if (Math.abs(totalPagos - diferenciaNum) > 0.01) {
        await connection.rollback()
        return res.status(400).json({
          message: `El total de los pagos (${totalPagos.toFixed(2)}) no coincide con la diferencia a pagar (${diferenciaNum.toFixed(2)})`,
        })
      }

      const hayPagoCaja = pagosProcesar.some(
        (p) => Number(p.monto || 0) > 0 && !esTipoPagoCuentaCorriente(p.tipo_pago),
      )
      let cajaSesionId = null
      if (hayPagoCaja) {
        cajaSesionId = await obtenerSesionCajaAbierta(connection, venta.punto_venta_id)
        if (!cajaSesionId) {
          await connection.rollback()
          return res.status(400).json({
            message:
              "No hay caja abierta en este punto de venta. Abrí la caja para cobrar la diferencia en efectivo/transferencia/tarjeta.",
          })
        }
      }

      for (const pagoItem of pagosProcesar) {
        const montoPago = Number(pagoItem.monto || 0)
        if (montoPago <= 0) continue

        const esCuenta = esTipoPagoCuentaCorriente(pagoItem.tipo_pago)

        await connection.query(
          `INSERT INTO pagos (
            monto, fecha, referencia_id, tipo_referencia, tipo_pago,
            cliente_id, usuario_id, punto_venta_id, notas, caja_sesion_id
          ) VALUES (?, ?, ?, 'devolucion', ?, ?, ?, ?, ?, ?)`,
          [
            montoPago,
            fechaActual,
            devolucionId,
            pagoItem.tipo_pago,
            cliente_id,
            req.user.id,
            venta.punto_venta_id,
            `Pago por diferencia en devolución - Venta #${venta.numero_factura}`,
            esCuenta ? null : cajaSesionId,
          ],
        )

        if (esCuenta && cliente_id) {
          const [cuentas] = await connection.query(
            "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
            [cliente_id],
          )

          if (cuentas.length > 0) {
            const cuenta = cuentas[0]
            const saldoAnterior = Number.parseFloat(cuenta.saldo)
            const nuevoSaldo = saldoAnterior + montoPago

            await connection.query(
              `UPDATE cuentas_corrientes SET saldo = ?, fecha_ultimo_movimiento = ? WHERE id = ?`,
              [nuevoSaldo, fechaActual, cuenta.id],
            )

            await connection.query(
              `INSERT INTO movimientos_cuenta_corriente (cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, referencia_id, tipo_referencia, fecha, usuario_id, notas) VALUES (?, 'cargo', ?, ?, ?, ?, 'devolucion', ?, ?, ?)`,
              [
                cuenta.id,
                montoPago,
                saldoAnterior.toFixed(2),
                nuevoSaldo.toFixed(2),
                devolucionId,
                fechaActual,
                req.user.id,
                `Cargo por diferencia en devolución - Venta #${venta.numero_factura}`,
              ],
            )
          } else {
            const saldoInicial = 0
            const nuevoSaldo = saldoInicial + montoPago

            const [resultCuenta] = await connection.query(
              "INSERT INTO cuentas_corrientes (cliente_id, saldo, activo) VALUES (?, ?, 1)",
              [cliente_id, nuevoSaldo],
            )

            await connection.query(
              `INSERT INTO movimientos_cuenta_corriente (cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, referencia_id, tipo_referencia, fecha, usuario_id, notas) VALUES (?, 'cargo', ?, ?, ?, ?, 'devolucion', ?, ?, ?)`,
              [
                resultCuenta.insertId,
                montoPago,
                saldoInicial.toFixed(2),
                nuevoSaldo.toFixed(2),
                devolucionId,
                fechaActual,
                req.user.id,
                `Cargo por diferencia en devolución - Venta #${venta.numero_factura}`,
              ],
            )
          }
        }
      }
    }

    await connection.commit()

    // Obtener la devoluci?n completa para devolverla en la respuesta
    const [devoluciones] = await pool.query(
      `SELECT d.*, u.nombre AS usuario_nombre, c.nombre AS cliente_nombre, v.numero_factura FROM devoluciones d LEFT JOIN usuarios u ON d.usuario_id = u.id LEFT JOIN clientes c ON d.cliente_id = c.id LEFT JOIN ventas v ON d.venta_id = v.id WHERE d.id = ?`,
      [devolucionId],
    )

    const devolucion = devoluciones[0]

    // Obtener productos devueltos
    const [productosDevueltosResult] = await pool.query(
      `SELECT dd.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre FROM detalle_devoluciones dd JOIN productos p ON dd.producto_id = p.id WHERE dd.devolucion_id = ?`,
      [devolucionId],
    )

    // Obtener productos de reemplazo
    const [productosReemplazoResult] = await pool.query(
      `SELECT dr.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre, p.precio FROM detalle_reemplazos dr JOIN productos p ON dr.producto_id = p.id WHERE dr.devolucion_id = ?`,
      [devolucionId],
    )

    devolucion.productos_devueltos = productosDevueltosResult
    devolucion.productos_reemplazo = productosReemplazoResult

    res.status(201).json(devolucion)
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear devoluci?n:", error)
    res.status(500).json({ message: "Error al crear devoluci?n" })
  } finally {
    connection.release()
  }
}

// Anular una devoluci?n
export const anularDevolucion = async (req, res) => {
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

    // Verificar que la devoluci?n existe y no est? anulada
    const [devoluciones] = await connection.query("SELECT * FROM devoluciones WHERE id = ? AND anulada = 0", [id])
    if (devoluciones.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Devoluci?n no encontrada o ya anulada" })
    }

    const devolucion = devoluciones[0]

    // Obtener los productos devueltos
    const [productosDevueltos] = await connection.query(
      `SELECT dd.*, dv.venta_id, dv.id AS detalle_venta_id FROM detalle_devoluciones dd JOIN detalle_ventas dv ON dd.detalle_venta_id = dv.id WHERE dd.devolucion_id = ?`,
      [id],
    )

    // Obtener los productos de reemplazo
    const [productosReemplazo] = await connection.query("SELECT * FROM detalle_reemplazos WHERE devolucion_id = ?", [
      id,
    ])

    // Obtener informaci?n de la venta
    const [ventas] = await connection.query("SELECT * FROM ventas WHERE id = ?", [devolucion.venta_id])
    const venta = ventas[0]

    // Usar la funci?n utilitaria para obtener la fecha actual en Argentina
    const fechaActual = formatearFechaParaDB()

    // Revertir los cambios en el inventario para los productos devueltos (tipo normal)
    for (const producto of productosDevueltos) {
      if (producto.tipo_devolucion === "normal") {
        // Restar del inventario
        await connection.query(`UPDATE inventario SET stock = stock - ? WHERE producto_id = ? AND punto_venta_id = ?`, [
          producto.cantidad,
          producto.producto_id,
          venta.punto_venta_id,
        ])

        // Registrar el movimiento en el log de inventario
        await connection.query(
          `INSERT INTO log_inventario (producto_id, punto_venta_id, cantidad, tipo_movimiento, referencia_id, usuario_id, fecha, notas) VALUES (?, ?, ?, 'anulacion_devolucion', ?, ?, ?, ?)`,
          [
            producto.producto_id,
            venta.punto_venta_id,
            -producto.cantidad,
            id,
            req.user.id,
            fechaActual,
            `Anulaci?n de devoluci?n - Venta #${venta.numero_factura}`,
          ],
        )
      }

      // Actualizar el estado del producto en detalle_ventas
      await connection.query(
        `UPDATE detalle_ventas SET devuelto = 0, devolucion_id = NULL, fecha_devolucion = NULL WHERE id = ? AND devolucion_id = ?`,
        [producto.detalle_venta_id, id],
      )
    }

    // Revertir los cambios en el inventario para los productos de reemplazo
    for (const producto of productosReemplazo) {
      // Sumar al inventario
      await connection.query(`UPDATE inventario SET stock = stock + ? WHERE producto_id = ? AND punto_venta_id = ?`, [
        producto.cantidad,
        producto.producto_id,
        venta.punto_venta_id,
      ])

      // Registrar el movimiento en el log de inventario
      await connection.query(
        `INSERT INTO log_inventario (producto_id, punto_venta_id, cantidad, tipo_movimiento, referencia_id, usuario_id, fecha, notas) VALUES (?, ?, ?, 'anulacion_devolucion', ?, ?, ?, ?)`,
        [
          producto.producto_id,
          venta.punto_venta_id,
          producto.cantidad,
          id,
          req.user.id,
          fechaActual,
          `Anulaci?n de devoluci?n - Venta #${venta.numero_factura}`,
        ],
      )

      // Eliminar los productos de reemplazo de la venta
      await connection.query(
        `DELETE FROM detalle_ventas WHERE venta_id = ? AND producto_id = ? AND es_reemplazo = 1 AND devolucion_id = ?`,
        [venta.id, producto.producto_id, id],
      )
    }

    const diferenciaNum = Number(devolucion.diferencia) || 0

    // Anular pagos de diferencia (impactan caja si tenían caja_sesion_id)
    await connection.query(
      `UPDATE pagos SET anulado = 1
       WHERE tipo_referencia = 'devolucion' AND referencia_id = ? AND anulado = 0`,
      [id],
    )

    // Revertir egreso de reembolso en efectivo (si existió)
    await connection.query(
      `DELETE FROM caja_movimientos
       WHERE tipo_referencia = 'devolucion' AND referencia_id = ?`,
      [id],
    )

    // Revertir cuenta corriente solo si hubo movimientos CC de esta devolución
    const [movsCc] = await connection.query(
      `SELECT m.*, cc.cliente_id
       FROM movimientos_cuenta_corriente m
       JOIN cuentas_corrientes cc ON m.cuenta_corriente_id = cc.id
       WHERE m.tipo_referencia = 'devolucion' AND m.referencia_id = ?
       ORDER BY m.id ASC`,
      [id],
    )

    if (movsCc.length > 0 && devolucion.cliente_id) {
      const [cuentas] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ?", [
        devolucion.cliente_id,
      ])

      if (cuentas.length > 0) {
        const cuenta = cuentas[0]
        let saldo = Number.parseFloat(cuenta.saldo)

        // Revertir en orden inverso
        for (let i = movsCc.length - 1; i >= 0; i--) {
          const mov = movsCc[i]
          const monto = Number.parseFloat(mov.monto) || 0
          const saldoAnterior = saldo
          // cargo aumentó saldo → al anular restamos; pago/crédito bajó saldo → al anular sumamos
          if (mov.tipo === "cargo") {
            saldo = saldo - monto
          } else {
            saldo = saldo + monto
          }

          await connection.query(
            `INSERT INTO movimientos_cuenta_corriente (
              cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo,
              referencia_id, tipo_referencia, fecha, usuario_id, notas
            ) VALUES (?, ?, ?, ?, ?, ?, 'anulacion_devolucion', ?, ?, ?)`,
            [
              cuenta.id,
              mov.tipo === "cargo" ? "pago" : "cargo",
              monto,
              saldoAnterior.toFixed(2),
              saldo.toFixed(2),
              id,
              fechaActual,
              req.user.id,
              `Anulación de devolución - Venta #${venta.numero_factura}: ${motivo}`,
            ],
          )
        }

        await connection.query(
          `UPDATE cuentas_corrientes SET saldo = ?, fecha_ultimo_movimiento = ? WHERE id = ?`,
          [saldo, fechaActual, cuenta.id],
        )
      }
    } else if (diferenciaNum !== 0 && !Number.isNaN(diferenciaNum)) {
      // Sin movimientos CC ni egreso de caja: no hay nada más que revertir en dinero
    }

    // Anular la devolución
    await connection.query(
      `UPDATE devoluciones SET anulada = 1, fecha_anulacion = ?, motivo_anulacion = ? WHERE id = ?`,
      [fechaActual, motivo, id],
    )

    // Verificar si la venta tiene otras devoluciones activas
    const [otrasDevoluciones] = await connection.query(
      `SELECT COUNT(*) as total FROM devoluciones WHERE venta_id = ? AND anulada = 0 AND id != ?`,
      [venta.id, id],
    )

    // Si no hay otras devoluciones, actualizar el flag en la venta
    if (otrasDevoluciones[0].total === 0) {
      await connection.query(`UPDATE ventas SET tiene_devoluciones = 0 WHERE id = ?`, [venta.id])
    }

    await connection.commit()

    res.json({ message: "Devoluci?n anulada correctamente" })
  } catch (error) {
    await connection.rollback()
    console.error("Error al anular devoluci?n:", error)
    res.status(500).json({ message: "Error al anular devoluci?n" })
  } finally {
    connection.release()
  }
}

// Modificar la funci?n getDevolucionesByVenta para incluir informaci?n sobre productos de reemplazo
export const getDevolucionesByVenta = async (req, res) => {
  try {
    const { ventaId } = req.params

    const [devoluciones] = await pool.query(
      `SELECT d.*, u.nombre AS usuario_nombre, c.nombre AS cliente_nombre FROM devoluciones d LEFT JOIN usuarios u ON d.usuario_id = u.id LEFT JOIN clientes c ON d.cliente_id = c.id WHERE d.venta_id = ? ORDER BY d.fecha ASC`,
      [ventaId],
    )

    // Para cada devoluci?n, obtener los productos devueltos y los productos de reemplazo
    for (const devolucion of devoluciones) {
      // Obtener productos devueltos
      const [productosDevueltos] = await pool.query(
        `SELECT dd.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre, dv.precio_con_descuento FROM detalle_devoluciones dd JOIN productos p ON dd.producto_id = p.id LEFT JOIN detalle_ventas dv ON dd.detalle_venta_id = dv.id WHERE dd.devolucion_id = ?`,
        [devolucion.id],
      )

      // Obtener productos de reemplazo
      const [productosReemplazo] = await pool.query(
        `SELECT dr.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre FROM detalle_reemplazos dr JOIN productos p ON dr.producto_id = p.id WHERE dr.devolucion_id = ?`,
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
