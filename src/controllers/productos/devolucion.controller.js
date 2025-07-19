import pool from "../../db.js"
import { validationResult } from "express-validator"
import { formatearFechaParaDB } from "../../utils/dateUtils.js"

// Obtener todas las devoluciones
export const getDevoluciones = async (req, res) => {
  try {
    // Parámetros de filtrado opcionales
    const { fecha_inicio, fecha_fin, cliente_id, punto_venta_id } = req.query

    let query = `
      SELECT d.*, 
             u.nombre AS usuario_nombre,
             c.nombre AS cliente_nombre,
             v.numero_factura
      FROM devoluciones d
      LEFT JOIN usuarios u ON d.usuario_id = u.id
      LEFT JOIN clientes c ON d.cliente_id = c.id
      LEFT JOIN ventas v ON d.venta_id = v.id
      WHERE 1=1
    `
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

    // Para cada devolución, obtener los productos devueltos y los productos de reemplazo
    for (const devolucion of devoluciones) {
      // Obtener productos devueltos
      const [productosDevueltos] = await pool.query(
        `
  SELECT 
    dd.*,
    p.codigo AS producto_codigo,
    p.nombre AS producto_nombre,
    dv.precio_con_descuento
  FROM detalle_devoluciones dd
  JOIN productos p ON dd.producto_id = p.id
  LEFT JOIN detalle_ventas dv ON dd.detalle_venta_id = dv.id
  WHERE dd.devolucion_id = ?
`,
        [devolucion.id],
      )

      // Obtener productos de reemplazo
      const [productosReemplazo] = await pool.query(
        `
        SELECT dr.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre, p.precio
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
    console.error("Error al obtener devoluciones:", error)
    res.status(500).json({ message: "Error al obtener devoluciones" })
  }
}

// Obtener una devolución por ID
export const getDevolucionById = async (req, res) => {
  try {
    const { id } = req.params

    const [devoluciones] = await pool.query(
      `
      SELECT d.*, 
             u.nombre AS usuario_nombre,
             c.nombre AS cliente_nombre,
             v.numero_factura
      FROM devoluciones d
      LEFT JOIN usuarios u ON d.usuario_id = u.id
      LEFT JOIN clientes c ON d.cliente_id = c.id
      LEFT JOIN ventas v ON d.venta_id = v.id
      WHERE d.id = ?
    `,
      [id],
    )

    if (devoluciones.length === 0) {
      return res.status(404).json({ message: "Devolución no encontrada" })
    }

    const devolucion = devoluciones[0]

    // Obtener productos devueltos
    const [productosDevueltos] = await pool.query(
      `
  SELECT 
    dd.*,
    p.codigo AS producto_codigo,
    p.nombre AS producto_nombre,
    dv.precio_con_descuento
  FROM detalle_devoluciones dd
  JOIN productos p ON dd.producto_id = p.id
  LEFT JOIN detalle_ventas dv ON dd.detalle_venta_id = dv.id
  WHERE dd.devolucion_id = ?
`,
      [id],
    )

    // Obtener productos de reemplazo
    const [productosReemplazo] = await pool.query(
      `
  SELECT 
    dr.*,
    p.codigo AS producto_codigo,
    p.nombre AS producto_nombre,
    p.precio
  FROM detalle_reemplazos dr
  JOIN productos p ON dr.producto_id = p.id
  WHERE dr.devolucion_id = ?
`,
      [id],
    )

    devolucion.productos_devueltos = productosDevueltos
    devolucion.productos_reemplazo = productosReemplazo

    res.json(devolucion)
  } catch (error) {
    console.error("Error al obtener devolución:", error)
    res.status(500).json({ message: "Error al obtener devolución" })
  }
}

// Crear una nueva devolución
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
      cliente_id = null,
    } = req.body

    // Verificar que la venta existe y no está anulada
    const [ventas] = await connection.query("SELECT * FROM ventas WHERE id = ? AND anulada = 0", [venta_id])
    if (ventas.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Venta no encontrada o anulada" })
    }

    const venta = ventas[0]

    // Usar la función utilitaria para obtener la fecha actual en Argentina
    const fechaActual = formatearFechaParaDB()

    // Insertar la devolución y obtener el ID con fecha correcta
    const [result] = await connection.query(
      `
      INSERT INTO devoluciones (
        venta_id, 
        fecha, 
        usuario_id,
        diferencia,
        cliente_id
      ) VALUES (?, ?, ?, ?, ?)
    `,
      [venta_id, fechaActual, req.user.id, diferencia, cliente_id],
    )

    const devolucionId = result.insertId

    // Verificar que los productos a devolver pertenecen a la venta y no han sido devueltos ya
    for (const producto of productos_devueltos) {
      // Verificar si es un producto original o un producto de reemplazo
      let detalleVenta
      let query
      let params

      // Si se proporciona un detalle_venta_id específico, usarlo directamente
      if (producto.detalle_venta_id) {
        query = `
          SELECT dv.*, 
                 COALESCE(SUM(dd.cantidad), 0) AS cantidad_devuelta
          FROM detalle_ventas dv
          LEFT JOIN detalle_devoluciones dd ON dv.id = dd.detalle_venta_id
          WHERE dv.id = ?
          GROUP BY dv.id
        `
        params = [producto.detalle_venta_id]
      } else if (producto.es_reemplazo) {
        // Si es un producto de reemplazo, buscar en los detalles de venta con es_reemplazo = 1
        query = `
          SELECT dv.*, 
                 COALESCE(SUM(dd.cantidad), 0) AS cantidad_devuelta
          FROM detalle_ventas dv
          LEFT JOIN detalle_devoluciones dd ON dv.id = dd.detalle_venta_id
          WHERE dv.venta_id = ? AND dv.producto_id = ? AND dv.es_reemplazo = 1
          GROUP BY dv.id
          ORDER BY dv.id DESC LIMIT 1
        `
        params = [venta_id, producto.producto_id]
      } else {
        // Si es un producto original, buscar en los detalles de venta normales
        query = `
          SELECT dv.*, 
                 COALESCE(SUM(dd.cantidad), 0) AS cantidad_devuelta
          FROM detalle_ventas dv
          LEFT JOIN detalle_devoluciones dd ON dv.id = dd.detalle_venta_id
          WHERE dv.venta_id = ? AND dv.producto_id = ? AND dv.es_reemplazo = 0
          GROUP BY dv.id
        `
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
          message: `No se puede devolver ${producto.cantidad} unidades del producto ${producto.producto_id}. Solo hay ${cantidadDisponible} disponibles para devolución.`,
        })
      }

      // Registrar el detalle de la devolución
      await connection.query(
        `
        INSERT INTO detalle_devoluciones (
          devolucion_id, 
          detalle_venta_id, 
          producto_id, 
          cantidad, 
          precio, 
          tipo_devolucion,
          es_reemplazo
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [
          devolucionId,
          detalleVenta.id,
          producto.producto_id,
          producto.cantidad,
          detalleVenta.precio_con_descuento,
          producto.tipo_devolucion,
          producto.es_reemplazo ? 1 : 0,
        ],
      )

      // Actualizar el estado del producto en detalle_ventas
      // Si se devuelve toda la cantidad, marcar como devuelto
      if (producto.cantidad >= cantidadDisponible) {
        await connection.query(
          `
          UPDATE detalle_ventas 
          SET devuelto = 1, devolucion_id = ?, fecha_devolucion = ? 
          WHERE id = ?
        `,
          [devolucionId, fechaActual, detalleVenta.id],
        )
      } else {
        // Si es devolución parcial, no marcamos como devuelto pero guardamos la referencia
        await connection.query(
          `
          UPDATE detalle_ventas 
          SET devolucion_id = ?, fecha_devolucion = ? 
          WHERE id = ?
        `,
          [devolucionId, fechaActual, detalleVenta.id],
        )
      }

      // Actualizar el inventario si la devolución es normal (no defectuoso)
      if (producto.tipo_devolucion === "normal") {
        await connection.query(
          `
          UPDATE inventario 
          SET stock = stock + ? 
          WHERE producto_id = ? AND punto_venta_id = ?
        `,
          [producto.cantidad, producto.producto_id, venta.punto_venta_id],
        )

        // Registrar el movimiento en el log de inventario
        await connection.query(
          `
          INSERT INTO log_inventario (
            producto_id, 
            punto_venta_id, 
            cantidad, 
            tipo_movimiento, 
            referencia_id, 
            usuario_id, 
            fecha, 
            notas
          ) VALUES (?, ?, ?, 'devolucion', ?, ?, ?, ?)
        `,
          [
            producto.producto_id,
            venta.punto_venta_id,
            producto.cantidad,
            devolucionId,
            req.user.id,
            fechaActual,
            `Devolución de producto${producto.es_reemplazo ? " de reemplazo" : ""} - Venta #${venta.numero_factura}`,
          ],
        )
      } else if (producto.tipo_devolucion === "defectuoso") {
        // Registrar en la tabla de pérdidas
        await connection.query(
          `
          INSERT INTO perdidas (
            producto_id, 
            cantidad, 
            motivo, 
            devolucion_id, 
            usuario_id, 
            fecha
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
          [
            producto.producto_id,
            producto.cantidad,
            `Producto${producto.es_reemplazo ? " de reemplazo" : ""} defectuoso - Devolución`,
            devolucionId,
            req.user.id,
            fechaActual,
          ],
        )
      }
    }

    // Registrar los productos de reemplazo
    for (const producto of productos_reemplazo) {
      // Obtener información del producto
      const [productos] = await connection.query("SELECT * FROM productos WHERE id = ?", [producto.producto_id])
      const productoInfo = productos[0]

      // Registrar el detalle del reemplazo
      await connection.query(
        `
        INSERT INTO detalle_reemplazos (
          devolucion_id, 
          producto_id, 
          cantidad, 
          precio
        ) VALUES (?, ?, ?, ?)
      `,
        [devolucionId, producto.producto_id, producto.cantidad, producto.precio],
      )

      // Actualizar el inventario
      await connection.query(
        `
        UPDATE inventario 
        SET stock = stock - ? 
        WHERE producto_id = ? AND punto_venta_id = ?
      `,
        [producto.cantidad, producto.producto_id, venta.punto_venta_id],
      )

      // Registrar el movimiento en el log de inventario
      await connection.query(
        `
        INSERT INTO log_inventario (
          producto_id, 
          punto_venta_id, 
          cantidad, 
          tipo_movimiento, 
          referencia_id, 
          usuario_id, 
          fecha, 
          notas
        ) VALUES (?, ?, ?, 'devolucion', ?, ?, ?, ?)
      `,
        [
          producto.producto_id,
          venta.punto_venta_id,
          -producto.cantidad,
          devolucionId,
          req.user.id,
          fechaActual,
          `Producto de reemplazo - Devolución de venta #${venta.numero_factura}`,
        ],
      )

      // Agregar el producto de reemplazo a la venta
      await connection.query(
        `
        INSERT INTO detalle_ventas (
          venta_id,
          producto_id,
          cantidad,
          precio_unitario,
          precio_con_descuento,
          subtotal,
          es_reemplazo,
          devolucion_id,
          fecha_devolucion
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `,
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

    // Marcar la venta como que tiene devoluciones
    await connection.query(
      `
      UPDATE ventas 
      SET tiene_devoluciones = 1 
      WHERE id = ?
    `,
      [venta_id],
    )

    // Si hay diferencia y es a favor del cliente (diferencia < 0), registrar en cuenta corriente
    if (diferencia < 0 && cliente_id) {
      // Verificar si el cliente tiene cuenta corriente
      const [cuentas] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1", [
        cliente_id,
      ])

      if (cuentas.length > 0) {
        const cuenta = cuentas[0]
        const saldoAnterior = Number.parseFloat(cuenta.saldo)
        const montoAbono = Math.abs(Number.parseFloat(diferencia)) // Convertir a positivo para restar del saldo
        const nuevoSaldo = saldoAnterior - montoAbono

        // Actualizar el saldo de la cuenta corriente
        await connection.query(
          `
          UPDATE cuentas_corrientes 
          SET saldo = ?, fecha_ultimo_movimiento = ? 
          WHERE id = ?
        `,
          [nuevoSaldo, fechaActual, cuenta.id],
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
          ) VALUES (?, 'pago', ?, ?, ?, ?, 'devolucion', ?, ?, ?)
        `,
          [
            cuenta.id,
            montoAbono,
            saldoAnterior.toFixed(2),
            nuevoSaldo.toFixed(2),
            devolucionId,
            fechaActual,
            req.user.id,
            `Crédito por devolución - Venta #${venta.numero_factura}`,
          ],
        )
      } else {
        // Si el cliente no tiene cuenta corriente, crearla
        const saldoInicial = 0
        const montoAbono = Math.abs(Number.parseFloat(diferencia))
        const nuevoSaldo = saldoInicial - montoAbono

        const [resultCuenta] = await connection.query(
          "INSERT INTO cuentas_corrientes (cliente_id, saldo, activo) VALUES (?, ?, 1)",
          [cliente_id, nuevoSaldo], // Saldo negativo (a favor del cliente)
        )

        const cuentaCorrienteId = resultCuenta.insertId

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
          ) VALUES (?, 'pago', ?, ?, ?, ?, 'devolucion', ?, ?, ?)
        `,
          [
            cuentaCorrienteId,
            montoAbono,
            saldoInicial.toFixed(2), // Saldo anterior (cuenta nueva)
            nuevoSaldo.toFixed(2), // Nuevo saldo
            devolucionId,
            fechaActual,
            req.user.id,
            `Crédito por devolución - Venta #${venta.numero_factura}`,
          ],
        )
      }
    }
    // Si hay diferencia y es a cargo del cliente (diferencia > 0), registrar el pago
    else if (diferencia > 0) {
      // CORREGIDO: Usar 'devolucion' como tipo_referencia
      await connection.query(
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
        ) VALUES (?, ?, ?, 'devolucion', ?, ?, ?, ?, ?)
      `,
        [
          diferencia,
          fechaActual,
          devolucionId,
          tipo_pago,
          cliente_id,
          req.user.id,
          venta.punto_venta_id,
          `Pago por diferencia en devolución - Venta #${venta.numero_factura}`,
        ],
      )

      // Si el tipo de pago es cuenta corriente, actualizar el saldo
      if (tipo_pago && tipo_pago.toLowerCase().includes("cuenta") && cliente_id) {
        // Verificar si el cliente tiene cuenta corriente
        const [cuentas] = await connection.query(
          "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
          [cliente_id],
        )

        if (cuentas.length > 0) {
          const cuenta = cuentas[0]
          const saldoAnterior = Number.parseFloat(cuenta.saldo)
          const diferenciaNumerica = Number.parseFloat(diferencia)
          const nuevoSaldo = saldoAnterior + diferenciaNumerica // Aumentar el saldo (es un cargo)

          // Actualizar el saldo de la cuenta corriente
          await connection.query(
            `
            UPDATE cuentas_corrientes 
            SET saldo = ?, fecha_ultimo_movimiento = ? 
            WHERE id = ?
          `,
            [nuevoSaldo, fechaActual, cuenta.id],
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
            ) VALUES (?, 'cargo', ?, ?, ?, ?, 'devolucion', ?, ?, ?)
          `,
            [
              cuenta.id,
              diferenciaNumerica,
              saldoAnterior.toFixed(2),
              nuevoSaldo.toFixed(2),
              devolucionId,
              fechaActual,
              req.user.id,
              `Cargo por diferencia en devolución - Venta #${venta.numero_factura}`,
            ],
          )
        } else {
          // Si el cliente no tiene cuenta corriente, crearla
          const saldoInicial = 0
          const diferenciaNumerica = Number.parseFloat(diferencia)
          const nuevoSaldo = saldoInicial + diferenciaNumerica

          const [resultCuenta] = await connection.query(
            "INSERT INTO cuentas_corrientes (cliente_id, saldo, activo) VALUES (?, ?, 1)",
            [cliente_id, nuevoSaldo],
          )

          const cuentaCorrienteId = resultCuenta.insertId

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
            ) VALUES (?, 'cargo', ?, ?, ?, ?, 'devolucion', ?, ?, ?)
          `,
            [
              cuentaCorrienteId,
              diferenciaNumerica,
              saldoInicial.toFixed(2), // Saldo anterior (cuenta nueva)
              nuevoSaldo.toFixed(2), // Nuevo saldo
              devolucionId,
              fechaActual,
              req.user.id,
              `Cargo por diferencia en devolución - Venta #${venta.numero_factura}`,
            ],
          )
        }
      }
    }

    await connection.commit()

    // Obtener la devolución completa para devolverla en la respuesta
    const [devoluciones] = await pool.query(
      `
      SELECT d.*, 
             u.nombre AS usuario_nombre,
             c.nombre AS cliente_nombre,
             v.numero_factura
      FROM devoluciones d
      LEFT JOIN usuarios u ON d.usuario_id = u.id
      LEFT JOIN clientes c ON d.cliente_id = c.id
      LEFT JOIN ventas v ON d.venta_id = v.id
      WHERE d.id = ?
    `,
      [devolucionId],
    )

    const devolucion = devoluciones[0]

    // Obtener productos devueltos
    const [productosDevueltosResult] = await pool.query(
      `
      SELECT dd.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre
      FROM detalle_devoluciones dd
      JOIN productos p ON dd.producto_id = p.id
      WHERE dd.devolucion_id = ?
    `,
      [devolucionId],
    )

    // Obtener productos de reemplazo
    const [productosReemplazoResult] = await pool.query(
      `
      SELECT dr.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre, p.precio
      FROM detalle_reemplazos dr
      JOIN productos p ON dr.producto_id = p.id
      WHERE dr.devolucion_id = ?
    `,
      [devolucionId],
    )

    devolucion.productos_devueltos = productosDevueltosResult
    devolucion.productos_reemplazo = productosReemplazoResult

    res.status(201).json(devolucion)
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear devolución:", error)
    res.status(500).json({ message: "Error al crear devolución: " + error.message })
  } finally {
    connection.release()
  }
}

// Anular una devolución
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

    // Verificar que la devolución existe y no está anulada
    const [devoluciones] = await connection.query("SELECT * FROM devoluciones WHERE id = ? AND anulada = 0", [id])
    if (devoluciones.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Devolución no encontrada o ya anulada" })
    }

    const devolucion = devoluciones[0]

    // Obtener los productos devueltos
    const [productosDevueltos] = await connection.query(
      `
      SELECT dd.*, dv.venta_id, dv.id AS detalle_venta_id
      FROM detalle_devoluciones dd
      JOIN detalle_ventas dv ON dd.detalle_venta_id = dv.id
      WHERE dd.devolucion_id = ?
    `,
      [id],
    )

    // Obtener los productos de reemplazo
    const [productosReemplazo] = await connection.query("SELECT * FROM detalle_reemplazos WHERE devolucion_id = ?", [
      id,
    ])

    // Obtener información de la venta
    const [ventas] = await connection.query("SELECT * FROM ventas WHERE id = ?", [devolucion.venta_id])
    const venta = ventas[0]

    // Usar la función utilitaria para obtener la fecha actual en Argentina
    const fechaActual = formatearFechaParaDB()

    // Revertir los cambios en el inventario para los productos devueltos (tipo normal)
    for (const producto of productosDevueltos) {
      if (producto.tipo_devolucion === "normal") {
        // Restar del inventario
        await connection.query(
          `
          UPDATE inventario 
          SET stock = stock - ? 
          WHERE producto_id = ? AND punto_venta_id = ?
        `,
          [producto.cantidad, producto.producto_id, venta.punto_venta_id],
        )

        // Registrar el movimiento en el log de inventario
        await connection.query(
          `
          INSERT INTO log_inventario (
            producto_id, 
            punto_venta_id, 
            cantidad, 
            tipo_movimiento, 
            referencia_id, 
            usuario_id, 
            fecha, 
            notas
          ) VALUES (?, ?, ?, 'anulacion_devolucion', ?, ?, ?, ?)
        `,
          [
            producto.producto_id,
            venta.punto_venta_id,
            -producto.cantidad,
            id,
            req.user.id,
            fechaActual,
            `Anulación de devolución - Venta #${venta.numero_factura}`,
          ],
        )
      }

      // Actualizar el estado del producto en detalle_ventas
      await connection.query(
        `
        UPDATE detalle_ventas 
        SET devuelto = 0, devolucion_id = NULL, fecha_devolucion = NULL 
        WHERE id = ? AND devolucion_id = ?
      `,
        [producto.detalle_venta_id, id],
      )
    }

    // Revertir los cambios en el inventario para los productos de reemplazo
    for (const producto of productosReemplazo) {
      // Sumar al inventario
      await connection.query(
        `
        UPDATE inventario 
        SET stock = stock + ? 
        WHERE producto_id = ? AND punto_venta_id = ?
      `,
        [producto.cantidad, producto.producto_id, venta.punto_venta_id],
      )

      // Registrar el movimiento en el log de inventario
      await connection.query(
        `
        INSERT INTO log_inventario (
          producto_id, 
          punto_venta_id, 
          cantidad, 
          tipo_movimiento, 
          referencia_id, 
          usuario_id, 
          fecha, 
          notas
        ) VALUES (?, ?, ?, 'anulacion_devolucion', ?, ?, ?, ?)
      `,
        [
          producto.producto_id,
          venta.punto_venta_id,
          producto.cantidad,
          id,
          req.user.id,
          fechaActual,
          `Anulación de devolución - Venta #${venta.numero_factura}`,
        ],
      )

      // Eliminar los productos de reemplazo de la venta
      await connection.query(
        `
        DELETE FROM detalle_ventas 
        WHERE venta_id = ? AND producto_id = ? AND es_reemplazo = 1 AND devolucion_id = ?
      `,
        [venta.id, producto.producto_id, id],
      )
    }

    // Si hubo diferencia y se registró en cuenta corriente, revertir
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
          SET saldo = ?, fecha_ultimo_movimiento = ? 
          WHERE id = ?
        `,
          [nuevoSaldo, fechaActual, cuenta.id],
        )

        // Registrar movimiento en la cuenta corriente
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
          ) VALUES (?, ?, ?, ?, ?, ?, 'anulacion_devolucion', ?, ?, ?)
        `,
          [
            cuenta.id,
            devolucion.diferencia < 0 ? "cargo" : "pago",
            Math.abs(Number.parseFloat(devolucion.diferencia)),
            saldoAnterior.toFixed(2),
            nuevoSaldo.toFixed(2),
            id,
            fechaActual,
            req.user.id,
            `Anulación de devolución - Venta #${venta.numero_factura}: ${motivo}`,
          ],
        )
      }
    }

    // Anular la devolución
    await connection.query(
      `
      UPDATE devoluciones 
      SET anulada = 1, fecha_anulacion = ?, motivo_anulacion = ? 
      WHERE id = ?
    `,
      [fechaActual, motivo, id],
    )

    // Verificar si la venta tiene otras devoluciones activas
    const [otrasDevoluciones] = await connection.query(
      `
      SELECT COUNT(*) as total
      FROM devoluciones
      WHERE venta_id = ? AND anulada = 0 AND id != ?
    `,
      [venta.id, id],
    )

    // Si no hay otras devoluciones, actualizar el flag en la venta
    if (otrasDevoluciones[0].total === 0) {
      await connection.query(
        `
        UPDATE ventas
        SET tiene_devoluciones = 0
        WHERE id = ?
      `,
        [venta.id],
      )
    }

    await connection.commit()

    res.json({ message: "Devolución anulada correctamente" })
  } catch (error) {
    await connection.rollback()
    console.error("Error al anular devolución:", error)
    res.status(500).json({ message: "Error al anular devolución" })
  } finally {
    connection.release()
  }
}

// Modificar la función getDevolucionesByVenta para incluir información sobre productos de reemplazo
export const getDevolucionesByVenta = async (req, res) => {
  try {
    const { ventaId } = req.params

    const [devoluciones] = await pool.query(
      `
      SELECT d.*, 
             u.nombre AS usuario_nombre,
             c.nombre AS cliente_nombre
      FROM devoluciones d
      LEFT JOIN usuarios u ON d.usuario_id = u.id
      LEFT JOIN clientes c ON d.cliente_id = c.id
      WHERE d.venta_id = ?
      ORDER BY d.fecha ASC
    `,
      [ventaId],
    )

    // Para cada devolución, obtener los productos devueltos y los productos de reemplazo
    for (const devolucion of devoluciones) {
      // Obtener productos devueltos
      const [productosDevueltos] = await pool.query(
        `
        SELECT 
          dd.*,
          p.codigo AS producto_codigo,
          p.nombre AS producto_nombre,
          dv.precio_con_descuento
        FROM detalle_devoluciones dd
        JOIN productos p ON dd.producto_id = p.id
        LEFT JOIN detalle_ventas dv ON dd.detalle_venta_id = dv.id
        WHERE dd.devolucion_id = ?
      `,
        [devolucion.id],
      )

      // Obtener productos de reemplazo
      const [productosReemplazo] = await pool.query(
        `
        SELECT 
          dr.*,
          p.codigo AS producto_codigo,
          p.nombre AS producto_nombre
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
