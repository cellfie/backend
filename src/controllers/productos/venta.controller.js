import pool from "../../db.js"
import { validationResult } from "express-validator"
import { registrarPagoInterno } from "../pago.controller.js" // Asumiendo que esta función existe y es correcta
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
  if (ultimaFactura.length > 0 && ultimaFactura[0].numero_factura) {
    const ultimoNumeroStr = ultimaFactura[0].numero_factura.split("-")[1]
    if (ultimoNumeroStr) {
      const ultimoNumero = Number.parseInt(ultimoNumeroStr)
      if (!isNaN(ultimoNumero)) {
        numero = ultimoNumero + 1
      }
    }
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

// OPTIMIZADO: Obtener ventas con paginación mejorada y búsqueda por productos
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
      producto_id,
      producto_nombre,
      sort_by = "fecha",
      sort_order = "DESC",
    } = req.query

    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    // Consulta base optimizada con índices
    let sql = `
      SELECT DISTINCT
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
        v.tipo_pago AS tipo_pago_nombre, -- Se mantiene para compatibilidad, pero los detalles están en tabla pagos
        GROUP_CONCAT(DISTINCT p.nombre SEPARATOR ', ') AS productos_nombres,
        COUNT(DISTINCT dv.id) AS cantidad_productos
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      JOIN usuarios u ON v.usuario_id = u.id
      JOIN puntos_venta pv ON v.punto_venta_id = pv.id
      LEFT JOIN detalle_ventas dv ON v.id = dv.venta_id
      LEFT JOIN productos p ON dv.producto_id = p.id
      WHERE 1=1
    `

    let countSql = `
      SELECT COUNT(DISTINCT v.id) as total
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      JOIN usuarios u ON v.usuario_id = u.id
      JOIN puntos_venta pv ON v.punto_venta_id = pv.id
      LEFT JOIN detalle_ventas dv ON v.id = dv.venta_id
      LEFT JOIN productos p ON dv.producto_id = p.id
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
      countSql += ` AND DATE(v.fecha) <= ?` // Corregido: debe ser <=
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

    // MEJORADO: Búsqueda por producto específico
    if (producto_id) {
      sql += ` AND EXISTS (
        SELECT 1 FROM detalle_ventas dv2 
        WHERE dv2.venta_id = v.id AND dv2.producto_id = ?
      )`
      countSql += ` AND EXISTS (
        SELECT 1 FROM detalle_ventas dv2 
        WHERE dv2.venta_id = v.id AND dv2.producto_id = ?
      )`
      params.push(producto_id)
      countParams.push(producto_id)
    }

    // NUEVO: Búsqueda por nombre de producto
    if (producto_nombre) {
      sql += ` AND EXISTS (
        SELECT 1 FROM detalle_ventas dv3 
        JOIN productos p3 ON dv3.producto_id = p3.id
        WHERE dv3.venta_id = v.id AND (p3.nombre LIKE ? OR p3.codigo LIKE ?)
      )`
      countSql += ` AND EXISTS (
        SELECT 1 FROM detalle_ventas dv3 
        JOIN productos p3 ON dv3.producto_id = p3.id
        WHERE dv3.venta_id = v.id AND (p3.nombre LIKE ? OR p3.codigo LIKE ?)
      )`
      const searchPattern = `%${producto_nombre}%`
      params.push(searchPattern, searchPattern)
      countParams.push(searchPattern, searchPattern)
    }

    // Búsqueda general optimizada
    if (search) {
      sql += ` AND (v.numero_factura LIKE ? OR c.nombre LIKE ? OR u.nombre LIKE ? OR p.nombre LIKE ? OR p.codigo LIKE ?)`
      countSql += ` AND (v.numero_factura LIKE ? OR c.nombre LIKE ? OR u.nombre LIKE ? OR p.nombre LIKE ? OR p.codigo LIKE ?)`
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
    }

    // Agrupar por venta para evitar duplicados
    sql += ` GROUP BY v.id, v.numero_factura, v.fecha, v.subtotal, v.porcentaje_interes,
             v.monto_interes, v.porcentaje_descuento, v.monto_descuento, v.total,
             v.anulada, v.fecha_anulacion, v.motivo_anulacion, v.tiene_devoluciones,
             c.id, c.nombre, c.telefono, u.id, u.nombre, pv.id, pv.nombre, v.tipo_pago`

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
      SELECT DISTINCT
        v.id,
        v.numero_factura,
        v.fecha,
        v.total,
        c.nombre AS cliente_nombre,
        pv.nombre AS punto_venta_nombre,
        v.anulada,
        GROUP_CONCAT(DISTINCT p.nombre SEPARATOR ', ') AS productos_nombres
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      JOIN puntos_venta pv ON v.punto_venta_id = pv.id
      LEFT JOIN detalle_ventas dv ON v.id = dv.venta_id
      LEFT JOIN productos p ON dv.producto_id = p.id
      WHERE (v.numero_factura LIKE ? OR c.nombre LIKE ? OR p.nombre LIKE ? OR p.codigo LIKE ?)
      GROUP BY v.id, v.numero_factura, v.fecha, v.total, c.nombre, pv.nombre, v.anulada
      ORDER BY v.fecha DESC
      LIMIT ?
    `

    const searchPattern = `%${q}%`
    const [ventas] = await pool.query(sql, [
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      Number.parseInt(limit),
    ])

    res.json(ventas)
  } catch (error) {
    console.error("Error en búsqueda rápida de ventas:", error)
    res.status(500).json({ message: "Error en búsqueda rápida de ventas" })
  }
}

// NUEVA FUNCIÓN: Búsqueda específica de ventas por producto
export const searchVentasByProducto = async (req, res) => {
  try {
    const { producto_query, limit = 20 } = req.query

    if (!producto_query || producto_query.length < 2) {
      return res.json([])
    }

    const sql = `
      SELECT DISTINCT
        v.id,
        v.numero_factura,
        v.fecha,
        v.total,
        c.nombre AS cliente_nombre,
        pv.nombre AS punto_venta_nombre,
        v.anulada,
        p.nombre AS producto_nombre,
        p.codigo AS producto_codigo,
        dv.cantidad,
        dv.precio_con_descuento
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      JOIN puntos_venta pv ON v.punto_venta_id = pv.id
      JOIN detalle_ventas dv ON v.id = dv.venta_id
      JOIN productos p ON dv.producto_id = p.id
      WHERE (p.nombre LIKE ? OR p.codigo LIKE ?)
      ORDER BY v.fecha DESC, p.nombre ASC
      LIMIT ?
    `

    const searchPattern = `%${producto_query}%`
    const [ventas] = await pool.query(sql, [searchPattern, searchPattern, Number.parseInt(limit)])

    res.json(ventas)
  } catch (error) {
    console.error("Error en búsqueda de ventas por producto:", error)
    res.status(500).json({ message: "Error en búsqueda de ventas por producto" })
  }
}

// Resto de funciones existentes...
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
        v.tipo_pago AS tipo_pago_nombre -- Se mantiene para compatibilidad
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
        v.tipo_pago AS tipo_pago_nombre, -- Se mantiene para compatibilidad
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
      const [pagosRegistrados] = await pool.query(
        // Renombrado para evitar conflicto con req.body.pagos
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

      venta.pagos = pagosRegistrados || [] // Asignar los pagos recuperados a la propiedad venta.pagos
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

// MODIFICADO: Crear una nueva venta para soportar múltiples pagos
export const createVenta = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const {
    cliente_id,
    punto_venta_id,
    productos,
    pagos, // Array de pagos: [{ tipo_pago: string, monto: number }]
    porcentaje_interes = 0, // Interés general (visual, no afecta el total a pagar directamente aquí)
    porcentaje_descuento = 0,
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

    const [puntosVenta] = await connection.query("SELECT * FROM puntos_venta WHERE id = ?", [punto_venta_id])
    if (puntosVenta.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Punto de venta no encontrado" })
    }

    const clienteId = cliente_id ? Number(cliente_id) : null
    if (clienteId) {
      const [clientes] = await connection.query("SELECT * FROM clientes WHERE id = ?", [clienteId])
      if (clientes.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: "Cliente no encontrado" })
      }
    }

    if (!productos || productos.length === 0) {
      await connection.rollback()
      return res.status(400).json({ message: "La venta debe tener al menos un producto" })
    }
    if (!pagos || pagos.length === 0) {
      await connection.rollback()
      return res.status(400).json({ message: "La venta debe tener al menos un método de pago" })
    }

    let subtotalVenta = 0
    for (const producto of productos) {
      const [productosDb] = await connection.query("SELECT * FROM productos WHERE id = ?", [producto.id])
      if (productosDb.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: `Producto con ID ${producto.id} no encontrado` })
      }
      const [inventario] = await connection.query(
        "SELECT stock FROM inventario WHERE producto_id = ? AND punto_venta_id = ?",
        [producto.id, punto_venta_id],
      )
      if (inventario.length === 0 || inventario[0].stock < producto.cantidad) {
        await connection.rollback()
        return res.status(400).json({ message: `Stock insuficiente para ${productosDb[0].nombre}` })
      }
      let precioConDescuentoProducto = Number(producto.precio)
      if (producto.descuento && Number(producto.descuento.porcentaje) > 0) {
        precioConDescuentoProducto = Number(producto.precio) * (1 - Number(producto.descuento.porcentaje) / 100)
      }
      subtotalVenta += precioConDescuentoProducto * Number(producto.cantidad)
    }

    const montoDescuentoGeneral = (subtotalVenta * Number(porcentaje_descuento)) / 100
    const totalVenta = subtotalVenta - montoDescuentoGeneral
    // El `porcentaje_interes` general es visual y no se suma al `totalVenta` que se guarda en la BD.
    // El interés de tarjeta se maneja a nivel de pago individual si es necesario, pero no aquí.

    const totalPagado = pagos.reduce((acc, pago) => acc + Number(pago.monto), 0)
    if (Math.abs(totalPagado - totalVenta) > 0.01) {
      // Permitir una pequeña diferencia por redondeo
      await connection.rollback()
      return res.status(400).json({
        message: `El total de los pagos (${totalPagado.toFixed(2)}) no coincide con el total de la venta (${totalVenta.toFixed(2)})`,
      })
    }

    const numeroFactura = await generarNumeroFactura()

    // Determinar el `tipo_pago` para la tabla `ventas`
    // Si hay múltiples pagos, se guarda "Múltiple". Si solo hay uno, se guarda ese.
    const tipoPagoParaTablaVentas = pagos.length > 1 ? "Múltiple" : pagos[0].tipo_pago

    const [resultVenta] = await connection.query(
      `INSERT INTO ventas (
        numero_factura, cliente_id, usuario_id, punto_venta_id, tipo_pago,
        subtotal, porcentaje_interes, monto_interes, porcentaje_descuento, monto_descuento, total,
        tiene_devoluciones, fecha, notas
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroFactura,
        clienteId,
        usuario_id,
        punto_venta_id,
        tipoPagoParaTablaVentas, // Tipo de pago principal o "Múltiple"
        subtotalVenta,
        Number(porcentaje_interes), // Guardar el interés general visual si se desea
        (subtotalVenta * Number(porcentaje_interes)) / 100, // Calcular monto de interés general
        Number(porcentaje_descuento),
        montoDescuentoGeneral,
        totalVenta,
        0, // tiene_devoluciones
        fechaActual,
        notas,
      ],
    )
    const ventaId = resultVenta.insertId

    for (const producto of productos) {
      let precioConDescuentoProducto = Number(producto.precio)
      if (producto.descuento && Number(producto.descuento.porcentaje) > 0) {
        precioConDescuentoProducto = Number(producto.precio) * (1 - Number(producto.descuento.porcentaje) / 100)
      }
      await connection.query(
        `INSERT INTO detalle_ventas (
          venta_id, producto_id, cantidad, precio_unitario, precio_con_descuento, subtotal
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          ventaId,
          producto.id,
          producto.cantidad,
          producto.precio,
          precioConDescuentoProducto,
          precioConDescuentoProducto * producto.cantidad,
        ],
      )
      await connection.query("UPDATE inventario SET stock = stock - ? WHERE producto_id = ? AND punto_venta_id = ?", [
        producto.cantidad,
        producto.id,
        punto_venta_id,
      ])
    }

    // Registrar cada pago
    for (const pago of pagos) {
      const montoPago = Number(pago.monto)
      const tipoPagoNombre = pago.tipo_pago.toLowerCase()

      if (tipoPagoNombre === "cuenta corriente" || tipoPagoNombre === "cuenta") {
        if (!clienteId) {
          await connection.rollback()
          return res.status(400).json({ message: "Se requiere un cliente para pagos con Cuenta Corriente" })
        }
        const [cuentasCorrientes] = await connection.query(
          "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
          [clienteId],
        )
        let cuentaCorrienteId
        let saldoAnteriorCC = 0

        if (cuentasCorrientes.length === 0) {
          const [resultCuenta] = await connection.query(
            "INSERT INTO cuentas_corrientes (cliente_id, saldo, fecha_ultimo_movimiento) VALUES (?, ?, ?)",
            [clienteId, montoPago, fechaActual],
          )
          cuentaCorrienteId = resultCuenta.insertId
        } else {
          cuentaCorrienteId = cuentasCorrientes[0].id
          saldoAnteriorCC = Number(cuentasCorrientes[0].saldo)
          if (
            cuentasCorrientes[0].limite_credito > 0 &&
            saldoAnteriorCC + montoPago > cuentasCorrientes[0].limite_credito
          ) {
            await connection.rollback()
            return res
              .status(400)
              .json({ message: `El pago con Cuenta Corriente excede el límite de crédito del cliente` })
          }
          await connection.query(
            "UPDATE cuentas_corrientes SET saldo = saldo + ?, fecha_ultimo_movimiento = ? WHERE id = ?",
            [montoPago, fechaActual, cuentaCorrienteId],
          )
        }
        await connection.query(
          `INSERT INTO movimientos_cuenta_corriente (
            cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, 
            referencia_id, tipo_referencia, usuario_id, notas, fecha
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cuentaCorrienteId,
            "cargo", // Un pago a la venta es un cargo a la CC del cliente
            montoPago,
            saldoAnteriorCC,
            saldoAnteriorCC + montoPago,
            ventaId,
            "venta",
            usuario_id,
            `Pago de venta #${numeroFactura}`,
            fechaActual,
          ],
        )
        // También registrar en la tabla 'pagos' para consistencia
        await registrarPagoInterno(connection, {
          monto: montoPago,
          tipo_pago: pago.tipo_pago, // Usar el nombre original del tipo de pago
          referencia_id: ventaId,
          tipo_referencia: "venta",
          cliente_id: clienteId,
          usuario_id,
          punto_venta_id,
          notas: `Pago (Cuenta Corriente) de venta #${numeroFactura}`,
          fecha: fechaActual,
        })
      } else {
        // Para otros tipos de pago, usar registrarPagoInterno
        await registrarPagoInterno(connection, {
          monto: montoPago,
          tipo_pago: pago.tipo_pago,
          referencia_id: ventaId,
          tipo_referencia: "venta",
          cliente_id: clienteId,
          usuario_id,
          punto_venta_id,
          notas: `Pago de venta #${numeroFactura}`,
          fecha: fechaActual,
        })
      }
    }

    await connection.commit()
    res.status(201).json({
      id: ventaId,
      numero_factura: numeroFactura,
      total: totalVenta,
      message: "Venta registrada exitosamente con múltiples pagos",
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

    const fechaActual = formatearFechaParaDB()

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

    // Revertir stock de productos
    const [detallesVenta] = await connection.query("SELECT * FROM detalle_ventas WHERE venta_id = ?", [id])
    for (const detalle of detallesVenta) {
      // Solo revertir stock si no fue devuelto previamente en una devolución no anulada
      if (!detalle.devuelto) {
        await connection.query("UPDATE inventario SET stock = stock + ? WHERE producto_id = ? AND punto_venta_id = ?", [
          detalle.cantidad,
          detalle.producto_id,
          venta.punto_venta_id,
        ])
      }
    }

    // Anular pagos asociados a la venta
    const [pagosAnteriores] = await connection.query(
      "SELECT * FROM pagos WHERE referencia_id = ? AND tipo_referencia = 'venta' AND anulado = 0",
      [id],
    )

    for (const pago of pagosAnteriores) {
      await connection.query("UPDATE pagos SET anulado = 1, fecha_anulacion = ?, motivo_anulacion = ? WHERE id = ?", [
        fechaActual,
        `Anulación de venta #${venta.numero_factura}: ${motivo}`,
        pago.id,
      ])

      // Si el pago fue a cuenta corriente, revertir el movimiento
      const tipoPagoNombre = pago.tipo_pago.toLowerCase()
      if ((tipoPagoNombre === "cuenta corriente" || tipoPagoNombre === "cuenta") && venta.cliente_id) {
        const [cuentasCorrientes] = await connection.query(
          "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
          [venta.cliente_id],
        )
        if (cuentasCorrientes.length > 0) {
          const cuentaCorriente = cuentasCorrientes[0]
          const saldoAnteriorCC = Number(cuentaCorriente.saldo)
          const nuevoSaldoCC = saldoAnteriorCC - Number(pago.monto) // Restar el monto del pago

          await connection.query("UPDATE cuentas_corrientes SET saldo = ?, fecha_ultimo_movimiento = ? WHERE id = ?", [
            nuevoSaldoCC,
            fechaActual,
            cuentaCorriente.id,
          ])
          await connection.query(
            `INSERT INTO movimientos_cuenta_corriente (
                        cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo,
                        referencia_id, tipo_referencia, usuario_id, notas, fecha
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              cuentaCorriente.id,
              "abono", // Es un abono porque se revierte un cargo previo
              Number(pago.monto),
              saldoAnteriorCC,
              nuevoSaldoCC,
              id, // Referencia a la venta anulada
              "anulacion_venta",
              usuario_id,
              `Anulación pago de venta #${venta.numero_factura}`,
              fechaActual,
            ],
          )
        }
      }
    }

    // Anular la venta
    await connection.query("UPDATE ventas SET anulada = 1, fecha_anulacion = ?, motivo_anulacion = ? WHERE id = ?", [
      fechaActual,
      motivo,
      id,
    ])

    await connection.commit()

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

    let whereClause = "WHERE v.anulada = 0" // Modificado para referenciar la tabla ventas con 'v'
    const params = []

    // Filtrar por fecha de inicio
    if (fecha_inicio) {
      const fechaInicioFormatted = formatLocalDate(new Date(fecha_inicio), true)
      whereClause += " AND v.fecha >= ?" // Modificado para referenciar la tabla ventas con 'v'
      params.push(fechaInicioFormatted)
    }

    // Filtrar por fecha de fin
    if (fecha_fin) {
      const fechaFinDate = new Date(fecha_fin)
      fechaFinDate.setHours(23, 59, 59, 999)
      const fechaFinFormatted = formatLocalDate(fechaFinDate, true)
      whereClause += " AND v.fecha <= ?" // Modificado para referenciar la tabla ventas con 'v'
      params.push(fechaFinFormatted)
    }

    // Filtrar por punto de venta
    if (punto_venta_id) {
      whereClause += " AND v.punto_venta_id = ?" // Modificado para referenciar la tabla ventas con 'v'
      params.push(punto_venta_id)
    }

    // Total de ventas
    const [totalVentas] = await pool.query(
      `SELECT COUNT(v.id) as cantidad, SUM(v.total) as monto FROM ventas v ${whereClause}`, // Modificado para referenciar la tabla ventas con 'v'
      params,
    )

    // Ventas por tipo de pago (ahora desde la tabla pagos)
    const [ventasPorMetodo] = await pool.query(
      `SELECT 
        p.tipo_pago as tipo_pago, 
        COUNT(DISTINCT v.id) as cantidad_ventas, -- Contar ventas únicas
        SUM(p.monto) as monto 
      FROM pagos p
      JOIN ventas v ON p.referencia_id = v.id AND p.tipo_referencia = 'venta'
      ${whereClause} AND p.anulado = 0
      GROUP BY p.tipo_pago
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
        pr.id,
        pr.codigo,
        pr.nombre,
        SUM(dv.cantidad) as cantidad_vendida,
        SUM(dv.subtotal) as monto_total
      FROM detalle_ventas dv
      JOIN productos pr ON dv.producto_id = pr.id -- Cambiado 'p' a 'pr' para evitar conflicto
      JOIN ventas v ON dv.venta_id = v.id
      ${whereClause}
      GROUP BY dv.producto_id, pr.id, pr.codigo, pr.nombre -- Agregado pr.id, pr.codigo, pr.nombre al GROUP BY
      ORDER BY cantidad_vendida DESC
      LIMIT 10`,
      params,
    )

    res.json({
      total_ventas: {
        cantidad: totalVentas[0].cantidad || 0,
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
