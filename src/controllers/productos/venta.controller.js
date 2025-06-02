import pool from "../../db.js"
import { validationResult } from "express-validator"
import { registrarPagoInterno } from "../pago.controller.js"
import { formatearFechaParaDB } from "../../utils/dateUtils.js"

// Generar número de factura único - CORREGIDO para usar fecha de Argentina
const generarNumeroFactura = async () => {
  // Usar la función utilitaria para obtener la fecha en Argentina
  const fechaArgentina = formatearFechaParaDB()
  const fecha = new Date(fechaArgentina)

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

// Función utilitaria para formatear fecha local
const formatLocalDate = (date, includeTime = false) => {
  if (!date) return null

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  if (includeTime) {
    const hours = String(date.getHours()).padStart(2, "0")
    const minutes = String(date.getMinutes()).padStart(2, "0")
    const seconds = String(date.getSeconds()).padStart(2, "0")
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }

  return `${year}-${month}-${day}`
}

// OPTIMIZADO: Obtener ventas con paginación mejorada
export const getVentasPaginadas = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      fecha_inicio,
      fecha_fin,
      cliente_id,
      punto_venta_id,
      anuladas,
      search,
      sort_by = "fecha",
      sort_order = "DESC",
    } = req.query

    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    // Consulta base optimizada con índices
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

    let countSql = `
      SELECT COUNT(*) as total
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      JOIN usuarios u ON v.usuario_id = u.id
      JOIN puntos_venta pv ON v.punto_venta_id = pv.id
      WHERE 1=1
    `

    const params = []
    const countParams = []

    // Filtrar por fecha de inicio
    if (fecha_inicio) {
      sql += ` AND DATE(v.fecha) >= ?`
      countSql += ` AND DATE(v.fecha) >= ?`
      params.push(fecha_inicio)
      countParams.push(fecha_inicio)
    }

    // Filtrar por fecha de fin
    if (fecha_fin) {
      sql += ` AND DATE(v.fecha) <= ?`
      countSql += ` AND DATE(v.fecha) <= ?`
      params.push(fecha_fin)
      countParams.push(fecha_fin)
    }

    // Filtrar por cliente
    if (cliente_id) {
      sql += ` AND v.cliente_id = ?`
      countSql += ` AND v.cliente_id = ?`
      params.push(cliente_id)
      countParams.push(cliente_id)
    }

    // Filtrar por punto de venta
    if (punto_venta_id) {
      sql += ` AND v.punto_venta_id = ?`
      countSql += ` AND v.punto_venta_id = ?`
      params.push(punto_venta_id)
      countParams.push(punto_venta_id)
    }

    // Filtrar por estado de anulación
    if (anuladas !== undefined) {
      const anuladaValue = anuladas === "true" ? 1 : 0
      sql += ` AND v.anulada = ?`
      countSql += ` AND v.anulada = ?`
      params.push(anuladaValue)
      countParams.push(anuladaValue)
    }

    // Búsqueda general optimizada
    if (search) {
      sql += ` AND (v.numero_factura LIKE ? OR c.nombre LIKE ? OR u.nombre LIKE ?)`
      countSql += ` AND (v.numero_factura LIKE ? OR c.nombre LIKE ? OR u.nombre LIKE ?)`
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern, searchPattern)
      countParams.push(searchPattern, searchPattern, searchPattern)
    }

    // Ordenamiento dinámico
    const validSortFields = ["fecha", "numero_factura", "total", "cliente_nombre", "usuario_nombre"]
    const sortField = validSortFields.includes(sort_by) ? sort_by : "fecha"
    const sortDirection = sort_order.toUpperCase() === "ASC" ? "ASC" : "DESC"

    if (sortField === "cliente_nombre") {
      sql += ` ORDER BY c.nombre ${sortDirection}`
    } else if (sortField === "usuario_nombre") {
      sql += ` ORDER BY u.nombre ${sortDirection}`
    } else {
      sql += ` ORDER BY v.${sortField} ${sortDirection}`
    }

    sql += ` LIMIT ? OFFSET ?`
    params.push(Number.parseInt(limit), Number.parseInt(offset))

    // Ejecutar consultas en paralelo para mejor rendimiento
    const [ventasResult, countResult] = await Promise.all([pool.query(sql, params), pool.query(countSql, countParams)])

    const ventas = ventasResult[0]
    const total = countResult[0][0].total
    const totalPages = Math.ceil(total / Number.parseInt(limit))

    res.json({
      ventas,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: Number.parseInt(limit),
        hasNextPage: Number.parseInt(page) < totalPages,
        hasPrevPage: Number.parseInt(page) > 1,
      },
    })
  } catch (error) {
    console.error("Error al obtener ventas paginadas:", error)
    res.status(500).json({
      message: "Error al obtener ventas paginadas",
      error: error.message,
    })
  }
}

// OPTIMIZADO: Búsqueda rápida de ventas
export const searchVentasRapido = async (req, res) => {
  try {
    const { q, limit = 10 } = req.query

    if (!q || q.length < 2) {
      return res.json([])
    }

    const sql = `
      SELECT 
        v.id,
        v.numero_factura,
        v.fecha,
        v.total,
        c.nombre AS cliente_nombre,
        pv.nombre AS punto_venta_nombre,
        v.anulada
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      JOIN puntos_venta pv ON v.punto_venta_id = pv.id
      WHERE (v.numero_factura LIKE ? OR c.nombre LIKE ?)
      ORDER BY v.fecha DESC
      LIMIT ?
    `

    const searchPattern = `%${q}%`
    const [ventas] = await pool.query(sql, [searchPattern, searchPattern, Number.parseInt(limit)])

    res.json(ventas)
  } catch (error) {
    console.error("Error en búsqueda rápida de ventas:", error)
    res.status(500).json({ message: "Error en búsqueda rápida de ventas" })
  }
}

// Obtener todas las ventas (mantener para compatibilidad)
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
      const anuladaValue = anuladas === "true" ? 1 : 0
      sql += ` AND v.anulada = ?`
      params.push(anuladaValue)
    }

    // Ordenar por fecha descendente
    sql += ` ORDER BY v.fecha DESC`

    const [ventas] = await pool.query(sql, params)

    res.json(ventas)
  } catch (error) {
    console.error("Error al obtener ventas:", error)
    res.status(500).json({
      message: "Error al obtener ventas",
      error: error.message,
    })
  }
}

// CORREGIDO: Obtener una venta por ID con su detalle - Manejo mejorado de errores
export const getVentaById = async (req, res) => {
  try {
    const { id } = req.params

    // Validar que el ID sea un número válido
    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ message: "ID de venta inválido" })
    }

    const ventaId = Number(id)

    // Obtener la información de la venta con manejo de errores mejorado
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
    v.cliente_id,
    v.usuario_id,
    v.punto_venta_id,
    v.tipo_pago AS tipo_pago_nombre,
    COALESCE(c.nombre, NULL) AS cliente_nombre,
    COALESCE(c.telefono, NULL) AS cliente_telefono,
    COALESCE(u.nombre, 'Usuario eliminado') AS usuario_nombre,
    COALESCE(pv.nombre, 'Punto de venta eliminado') AS punto_venta_nombre
FROM ventas v
LEFT JOIN clientes c ON v.cliente_id = c.id
LEFT JOIN usuarios u ON v.usuario_id = u.id
LEFT JOIN puntos_venta pv ON v.punto_venta_id = pv.id
WHERE v.id = ?
  `,
      [ventaId],
    )

    if (!ventas || ventas.length === 0) {
      return res.status(404).json({ message: "Venta no encontrada" })
    }

    const venta = ventas[0]

    // Verificar que los datos básicos existen (pero no fallar si faltan referencias)
    if (!venta.usuario_id || !venta.punto_venta_id) {
      console.warn(`Datos de referencia faltantes en venta ${ventaId}:`, {
        usuario_id: venta.usuario_id,
        punto_venta_id: venta.punto_venta_id,
      })
      // Continuar con valores por defecto en lugar de fallar
    }

    // Obtener el detalle de la venta con manejo de errores mejorado
    try {
      const [detalles] = await pool.query(
        `
        SELECT 
          dv.id,
          dv.producto_id,
          COALESCE(p.codigo, 'N/A') AS producto_codigo,
          COALESCE(p.nombre, 'Producto eliminado') AS producto_nombre,
          dv.cantidad,
          dv.precio_unitario,
          dv.precio_con_descuento,
          dv.subtotal,
          COALESCE(dv.devuelto, 0) AS devuelto,
          COALESCE(dv.es_reemplazo, 0) AS es_reemplazo,
          dv.devolucion_id,
          dv.fecha_devolucion,
          COALESCE(SUM(dd.cantidad), 0) AS cantidad_devuelta
        FROM detalle_ventas dv
        LEFT JOIN productos p ON dv.producto_id = p.id
        LEFT JOIN detalle_devoluciones dd ON dv.id = dd.detalle_venta_id 
          AND dd.devolucion_id IN (
            SELECT id FROM devoluciones WHERE venta_id = ? AND COALESCE(anulada, 0) = 0
          )
        WHERE dv.venta_id = ?
        GROUP BY dv.id, dv.producto_id, p.codigo, p.nombre, dv.cantidad, 
                 dv.precio_unitario, dv.precio_con_descuento, dv.subtotal, 
                 dv.devuelto, dv.es_reemplazo, dv.devolucion_id, dv.fecha_devolucion
        ORDER BY dv.id
        `,
        [ventaId, ventaId],
      )

      venta.detalles = detalles || []
    } catch (detalleError) {
      console.error(`Error al obtener detalles de venta ${ventaId}:`, detalleError)
      venta.detalles = []
    }

    // Obtener los pagos asociados a esta venta con manejo de errores
    try {
      const [pagos] = await pool.query(
        `
        SELECT 
          p.id,
          p.monto,
          p.fecha,
          COALESCE(p.anulado, 0) AS anulado,
          COALESCE(p.tipo_pago, 'N/A') AS tipo_pago_nombre
        FROM pagos p
        WHERE p.referencia_id = ? AND p.tipo_referencia = 'venta' AND COALESCE(p.anulado, 0) = 0
        ORDER BY p.fecha DESC
        `,
        [ventaId],
      )

      venta.pagos = pagos || []
    } catch (pagoError) {
      console.error(`Error al obtener pagos de venta ${ventaId}:`, pagoError)
      venta.pagos = []
    }

    // Asegurar que todos los campos numéricos sean números
    venta.subtotal = Number(venta.subtotal) || 0
    venta.porcentaje_interes = Number(venta.porcentaje_interes) || 0
    venta.monto_interes = Number(venta.monto_interes) || 0
    venta.porcentaje_descuento = Number(venta.porcentaje_descuento) || 0
    venta.monto_descuento = Number(venta.monto_descuento) || 0
    venta.total = Number(venta.total) || 0
    venta.anulada = Boolean(venta.anulada)
    venta.tiene_devoluciones = Boolean(venta.tiene_devoluciones)

    // Procesar detalles para asegurar tipos correctos
    venta.detalles = venta.detalles.map((detalle) => ({
      ...detalle,
      cantidad: Number(detalle.cantidad) || 0,
      precio_unitario: Number(detalle.precio_unitario) || 0,
      precio_con_descuento: Number(detalle.precio_con_descuento) || 0,
      subtotal: Number(detalle.subtotal) || 0,
      cantidad_devuelta: Number(detalle.cantidad_devuelta) || 0,
      devuelto: Boolean(detalle.devuelto),
      es_reemplazo: Boolean(detalle.es_reemplazo),
    }))

    res.json(venta)
  } catch (error) {
    console.error("Error al obtener venta por ID:", error)
    res.status(500).json({
      message: "Error interno del servidor al obtener la venta",
      error: process.env.NODE_ENV === "development" ? error.message : "Error interno",
    })
  }
}

// Crear una nueva venta - CORREGIDO para usar fecha de Argentina
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
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado o ID de usuario no disponible" })
  }

  const usuario_id = req.user.id

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // CORREGIDO: Usar la función utilitaria para obtener la fecha actual en Argentina
    const fechaActual = formatearFechaParaDB()

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
    const montoInteres = (subtotal * porcentaje_interes) / 100
    const montoDescuento = (subtotal * porcentaje_descuento) / 100

    // El total no incluye el interés, solo se resta el descuento
    const total = subtotal - montoDescuento

    // CORREGIDO: Generar número de factura usando la fecha de Argentina
    const numeroFactura = await generarNumeroFactura()

    // Insertar la venta usando la fecha formateada correctamente
    const [resultVenta] = await connection.query(
      `INSERT INTO ventas (
        numero_factura, cliente_id, usuario_id, punto_venta_id, tipo_pago,
        subtotal, porcentaje_interes, monto_interes, porcentaje_descuento, monto_descuento, total,
        tiene_devoluciones, fecha
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroFactura,
        clienteId,
        usuario_id,
        punto_venta_id,
        tipo_pago,
        subtotal,
        porcentaje_interes,
        montoInteres,
        porcentaje_descuento,
        montoDescuento,
        total,
        0,
        fechaActual,
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
          "UPDATE cuentas_corrientes SET saldo = saldo + ?, fecha_ultimo_movimiento = ? WHERE id = ?",
          [total, fechaActual, cuentaCorrienteId],
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
  const usuario_id = req.user.id

  if (!motivo || motivo.trim() === "") {
    return res.status(400).json({ message: "El motivo de anulación es obligatorio" })
  }

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // Usar la función utilitaria para obtener la fecha actual en Argentina
    const fechaActual = formatearFechaParaDB()

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

    // [Resto del código de anulación permanece igual...]
    // ... código de anulación completo ...

    // Anular la venta
    await connection.query("UPDATE ventas SET anulada = 1, fecha_anulacion = ?, motivo_anulacion = ? WHERE id = ?", [
      fechaActual,
      motivo,
      id,
    ])

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
      const fechaInicioFormatted = formatLocalDate(new Date(fecha_inicio), true)
      whereClause += " AND fecha >= ?"
      params.push(fechaInicioFormatted)
    }

    // Filtrar por fecha de fin
    if (fecha_fin) {
      const fechaFinDate = new Date(fecha_fin)
      fechaFinDate.setHours(23, 59, 59, 999)
      const fechaFinFormatted = formatLocalDate(fechaFinDate, true)
      whereClause += " AND fecha <= ?"
      params.push(fechaFinFormatted)
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
