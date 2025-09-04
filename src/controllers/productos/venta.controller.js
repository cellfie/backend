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

// CORREGIDO: Obtener ventas con paginación mejorada y filtro de método de pago corregido
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
      tipo_pago, // CORREGIDO: Filtro por método de pago
      sort_by = "fecha",
      sort_order = "DESC",
    } = req.query

    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    // CORREGIDO: Consulta base optimizada que incluye información de pagos
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
        v.tipo_pago AS tipo_pago_nombre,
        GROUP_CONCAT(DISTINCT p.nombre SEPARATOR ', ') AS productos_nombres,
        COUNT(DISTINCT dv.id) AS cantidad_productos,
        -- NUEVO: Información de métodos de pago reales
        GROUP_CONCAT(DISTINCT pg.tipo_pago ORDER BY pg.tipo_pago SEPARATOR ', ') AS metodos_pago_reales,
        COUNT(DISTINCT pg.tipo_pago) AS cantidad_metodos_pago
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      JOIN usuarios u ON v.usuario_id = u.id
      JOIN puntos_venta pv ON v.punto_venta_id = pv.id
      LEFT JOIN detalle_ventas dv ON v.id = dv.venta_id
      LEFT JOIN productos p ON dv.producto_id = p.id
      -- NUEVO: JOIN con tabla de pagos para obtener métodos reales
      LEFT JOIN pagos pg ON v.id = pg.referencia_id AND pg.tipo_referencia = 'venta' AND pg.anulado = 0
      WHERE 1=1
    `

    // CORREGIDO: Consulta de conteo que incluye el filtro de método de pago
    let countSql = `
      SELECT COUNT(DISTINCT v.id) as total
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      JOIN usuarios u ON v.usuario_id = u.id
      JOIN puntos_venta pv ON v.punto_venta_id = pv.id
      LEFT JOIN detalle_ventas dv ON v.id = dv.venta_id
      LEFT JOIN productos p ON dv.producto_id = p.id
      LEFT JOIN pagos pg ON v.id = pg.referencia_id AND pg.tipo_referencia = 'venta' AND pg.anulado = 0
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

    // CORREGIDO: Filtro por método de pago mejorado
    if (tipo_pago && tipo_pago !== "todos") {
      // Para ventas con un solo método de pago, verificar el campo tipo_pago de la venta
      // Para ventas con múltiples métodos, verificar en la tabla de pagos
      sql += ` AND (
        (v.tipo_pago = ? AND v.tipo_pago != 'Múltiple') OR
        (v.tipo_pago = 'Múltiple' AND EXISTS (
          SELECT 1 FROM pagos pg2 
          WHERE pg2.referencia_id = v.id 
          AND pg2.tipo_referencia = 'venta' 
          AND pg2.anulado = 0 
          AND pg2.tipo_pago = ?
        ))
      )`
      countSql += ` AND (
        (v.tipo_pago = ? AND v.tipo_pago != 'Múltiple') OR
        (v.tipo_pago = 'Múltiple' AND EXISTS (
          SELECT 1 FROM pagos pg2 
          WHERE pg2.referencia_id = v.id 
          AND pg2.tipo_referencia = 'venta' 
          AND pg2.anulado = 0 
          AND pg2.tipo_pago = ?
        ))
      )`
      params.push(tipo_pago, tipo_pago)
      countParams.push(tipo_pago, tipo_pago)
    }

    // Búsqueda por producto específico
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

    // Búsqueda por nombre de producto
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
      sql += ` AND (v.numero_factura LIKE ? OR c.nombre LIKE ? OR u.nombre LIKE ?)`
      countSql += ` AND (v.numero_factura LIKE ? OR c.nombre LIKE ? OR u.nombre LIKE ?)`
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern, searchPattern)
      countParams.push(searchPattern, searchPattern, searchPattern)
    }

    // CORREGIDO: Agrupar por venta para evitar duplicados
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

    // MEJORADO: Respuesta con información de paginación más completa
    res.json({
      ventas,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: Number.parseInt(limit),
        hasNextPage: Number.parseInt(page) < totalPages,
        hasPrevPage: Number.parseInt(page) > 1,
        startItem: offset + 1,
        endItem: Math.min(offset + Number.parseInt(limit), total),
      },
      // NUEVO: Información adicional para debugging
      debug: {
        appliedFilters: {
          fecha_inicio,
          fecha_fin,
          cliente_id,
          punto_venta_id,
          anuladas,
          search,
          producto_id,
          producto_nombre,
          tipo_pago, // NUEVO: Incluir filtro de método de pago en debug
        },
        queryInfo: {
          totalVentasEncontradas: total,
          ventasMostradas: ventas.length,
          paginaActual: Number.parseInt(page),
          elementosPorPagina: Number.parseInt(limit),
        },
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

// NUEVA FUNCIÓN: Obtener métodos de pago únicos para el filtro
export const getMetodosPagoVentas = async (req, res) => {
  try {
    // Obtener métodos de pago únicos de ventas con un solo método
    const [metodosSimplesResult] = await pool.query(
      `SELECT DISTINCT v.tipo_pago as metodo FROM ventas v WHERE v.tipo_pago IS NOT NULL AND v.tipo_pago != '' AND v.tipo_pago != 'Múltiple' AND v.anulada = 0`,
    )

    // Obtener métodos de pago únicos de ventas múltiples
    const [metodosMultiplesResult] = await pool.query(
      `SELECT DISTINCT pg.tipo_pago as metodo FROM pagos pg JOIN ventas v ON pg.referencia_id = v.id WHERE pg.tipo_referencia = 'venta' AND pg.anulado = 0 AND v.anulada = 0 AND pg.tipo_pago IS NOT NULL AND pg.tipo_pago != ''`,
    )

    // Combinar y eliminar duplicados
    const metodosSet = new Set()

    metodosSimplesResult.forEach((row) => {
      if (row.metodo) metodosSet.add(row.metodo)
    })

    metodosMultiplesResult.forEach((row) => {
      if (row.metodo) metodosSet.add(row.metodo)
    })

    // Convertir a array y ordenar
    const metodos = Array.from(metodosSet)
      .sort()
      .map((metodo, index) => ({
        id: index + 1,
        nombre: metodo,
      }))

    res.json(metodos)
  } catch (error) {
    console.error("Error al obtener métodos de pago:", error)
    res.status(500).json({
      message: "Error al obtener métodos de pago",
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

    const sql = `SELECT DISTINCT v.id, v.numero_factura, v.fecha, v.total, c.nombre AS cliente_nombre, pv.nombre AS punto_venta_nombre, v.anulada, GROUP_CONCAT(DISTINCT p.nombre SEPARATOR ', ') AS productos_nombres FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id JOIN puntos_venta pv ON v.punto_venta_id = pv.id LEFT JOIN detalle_ventas dv ON v.id = dv.venta_id LEFT JOIN productos p ON dv.producto_id = p.id WHERE (v.numero_factura LIKE ? OR c.nombre LIKE ? OR p.nombre LIKE ? OR p.codigo LIKE ?) GROUP BY v.id, v.numero_factura, v.fecha, v.total, c.nombre, pv.nombre, v.anulada ORDER BY v.fecha DESC LIMIT ?`

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

    const sql = `SELECT DISTINCT v.id, v.numero_factura, v.fecha, v.total, c.nombre AS cliente_nombre, pv.nombre AS punto_venta_nombre, v.anulada, p.nombre AS producto_nombre, p.codigo AS producto_codigo, dv.cantidad, dv.precio_con_descuento FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id JOIN puntos_venta pv ON v.punto_venta_id = pv.id JOIN detalle_ventas dv ON v.id = dv.venta_id JOIN productos p ON dv.producto_id = p.id WHERE (p.nombre LIKE ? OR p.codigo LIKE ?) ORDER BY v.fecha DESC, p.nombre ASC LIMIT ?`

    const searchPattern = `%${producto_query}%`
    const [ventas] = await pool.query(sql, [searchPattern, searchPattern, Number.parseInt(limit)])

    res.json(ventas)
  } catch (error) {
    console.error("Error en búsqueda de ventas por producto:", error)
    res.status(500).json({ message: "Error en búsqueda de ventas por producto" })
  }
}

// NUEVO: Obtener totales filtrados considerando pagos múltiples (corregido)
export const getTotalVentasFiltradas = async (req, res) => {
  try {
    const {
      fecha_inicio,
      fecha_fin,
      cliente_id,
      punto_venta_id,
      anuladas,
      search,
      producto_id,
      producto_nombre,
      tipo_pago,
    } = req.query;

    // Construimos la subconsulta agregada de pagos (si se filtra por tipo, la limitamos)
    // IMPORTANTE: los placeholders (?) deben empujarse en el mismo orden en 'params'
    let sql = `
      SELECT
        COUNT(DISTINCT v.id) AS cantidad_ventas,
        COALESCE(SUM(
          CASE
            WHEN v.tipo_pago IS NOT NULL AND v.tipo_pago != 'Múltiple' THEN v.total
            ELSE COALESCE(pg_total.pagos_total, 0)
          END
        ),0) AS total_monto
      FROM ventas v
      LEFT JOIN (
        SELECT referencia_id, SUM(monto) AS pagos_total
        FROM pagos
        WHERE tipo_referencia = 'venta' AND anulado = 0
        ${tipo_pago && tipo_pago !== "todos" ? " AND tipo_pago = ?" : ""}
        GROUP BY referencia_id
      ) AS pg_total ON pg_total.referencia_id = v.id
      LEFT JOIN clientes c ON v.cliente_id = c.id
      JOIN usuarios u ON v.usuario_id = u.id
      JOIN puntos_venta pv ON v.punto_venta_id = pv.id
      WHERE 1=1
    `;

    const params = [];

    // Si la subconsulta llevó un placeholder (tipo_pago), debemos agregar su valor primero
    if (tipo_pago && tipo_pago !== "todos") {
      params.push(tipo_pago); // para el placeholder dentro de la subconsulta pg_total
    }

    // Filtros comunes (fechas, cliente, punto, anuladas)
    if (fecha_inicio) {
      sql += ` AND DATE(v.fecha) >= ?`;
      params.push(fecha_inicio);
    }
    if (fecha_fin) {
      sql += ` AND DATE(v.fecha) <= ?`;
      params.push(fecha_fin);
    }
    if (cliente_id) {
      sql += ` AND v.cliente_id = ?`;
      params.push(cliente_id);
    }
    if (punto_venta_id) {
      sql += ` AND v.punto_venta_id = ?`;
      params.push(punto_venta_id);
    }
    if (anuladas !== undefined) {
      sql += ` AND v.anulada = ?`;
      params.push(anuladas === "true" ? 1 : 0);
    }

    // Búsqueda por producto (si aplica) - mantenemos la lógica de existencia por detalle_ventas
    if (producto_id) {
      sql += ` AND EXISTS (SELECT 1 FROM detalle_ventas dv2 WHERE dv2.venta_id = v.id AND dv2.producto_id = ?)`;
      params.push(producto_id);
    }

    if (producto_nombre) {
      sql += ` AND EXISTS (
        SELECT 1 FROM detalle_ventas dv3
        JOIN productos p3 ON dv3.producto_id = p3.id
        WHERE dv3.venta_id = v.id AND (p3.nombre LIKE ? OR p3.codigo LIKE ?)
      )`;
      const searchPattern = `%${producto_nombre}%`;
      params.push(searchPattern, searchPattern);
    }

    // Búsqueda general
    if (search) {
      const searchPattern = `%${search}%`;
      sql += ` AND (v.numero_factura LIKE ? OR c.nombre LIKE ? OR u.nombre LIKE ?)`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    // Filtro por tipo de pago: mantener la misma lógica que getVentasPaginadas
    if (tipo_pago && tipo_pago !== "todos") {
      // Notar: aquí agregamos dos placeholders más (uno para la comparación directa y otro para el EXISTS)
      sql += ` AND (
        (v.tipo_pago = ? AND v.tipo_pago != 'Múltiple')
        OR (v.tipo_pago = 'Múltiple' AND EXISTS (
          SELECT 1 FROM pagos pg2
          WHERE pg2.referencia_id = v.id
            AND pg2.tipo_referencia = 'venta'
            AND pg2.anulado = 0
            AND pg2.tipo_pago = ?
        ))
      )`;
      params.push(tipo_pago, tipo_pago);
    }

    // Ejecutar consulta: devuelve una sola fila con cantidad_ventas y total_monto agregados
    const [rows] = await pool.query(sql, params);

    // rows puede ser [] si no hay coincidencias; manejamos safe
    const resultRow = (rows && rows[0]) || { cantidad_ventas: 0, total_monto: 0 };

    res.json({
      total_monto: Number(resultRow.total_monto) || 0,
      cantidad_ventas: Number(resultRow.cantidad_ventas) || 0,
      debug: {
        appliedFilters: { fecha_inicio, fecha_fin, cliente_id, punto_venta_id, anuladas, tipo_pago, producto_id, producto_nombre, search },
        finalQuery: sql,
        params,
      },
    });
  } catch (error) {
    console.error("Error al obtener totales filtrados:", error);
    res.status(500).json({ message: "Error al obtener totales filtrados", error: error.message });
  }
};



// Resto de funciones existentes...
export const getVentas = async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, cliente_id, punto_venta_id, anuladas } = req.query

    let sql = `SELECT v.id, v.numero_factura, v.fecha, v.subtotal, v.porcentaje_interes, v.monto_interes, v.porcentaje_descuento, v.monto_descuento, v.total, v.anulada, v.fecha_anulacion, v.motivo_anulacion, v.tiene_devoluciones, c.id AS cliente_id, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, u.id AS usuario_id, u.nombre AS usuario_nombre, pv.id AS punto_venta_id, pv.nombre AS punto_venta_nombre, v.tipo_pago AS tipo_pago_nombre FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id JOIN usuarios u ON v.usuario_id = u.id JOIN puntos_venta pv ON v.punto_venta_id = pv.id WHERE 1=1`

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

// MODIFICADO: Obtener una venta por ID con su detalle y sus pagos
export const getVentaById = async (req, res) => {
  try {
    const { id } = req.params

    // Validar que el ID sea un número válido
    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ message: "ID de venta inválido" })
    }

    const ventaId = Number(id)

    // Obtener la información de la venta
    const [ventas] = await pool.query(
      `SELECT v.id, v.numero_factura, v.fecha, v.subtotal, v.porcentaje_interes, v.monto_interes, v.porcentaje_descuento, v.monto_descuento, v.total, v.anulada, v.fecha_anulacion, v.motivo_anulacion, v.tiene_devoluciones, v.cliente_id, v.usuario_id, v.punto_venta_id, v.tipo_pago AS tipo_pago_nombre, COALESCE(c.nombre, NULL) AS cliente_nombre, COALESCE(c.telefono, NULL) AS cliente_telefono, COALESCE(u.nombre, 'Usuario eliminado') AS usuario_nombre, COALESCE(pv.nombre, 'Punto de venta eliminado') AS punto_venta_nombre FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id LEFT JOIN usuarios u ON v.usuario_id = u.id LEFT JOIN puntos_venta pv ON v.punto_venta_id = pv.id WHERE v.id = ?`,
      [ventaId],
    )

    if (!ventas || ventas.length === 0) {
      return res.status(404).json({ message: "Venta no encontrada" })
    }

    const venta = ventas[0]

    // Obtener el detalle de la venta
    const [detalles] = await pool.query(
      `SELECT dv.id, dv.producto_id, COALESCE(p.codigo, 'N/A') AS producto_codigo, COALESCE(p.nombre, 'Producto eliminado') AS producto_nombre, dv.cantidad, dv.precio_unitario, dv.precio_con_descuento, dv.subtotal, COALESCE(dv.devuelto, 0) AS devuelto, COALESCE(dv.es_reemplazo, 0) AS es_reemplazo, dv.devolucion_id, dv.fecha_devolucion, COALESCE(SUM(dd.cantidad), 0) AS cantidad_devuelta FROM detalle_ventas dv LEFT JOIN productos p ON dv.producto_id = p.id LEFT JOIN detalle_devoluciones dd ON dv.id = dd.detalle_venta_id AND dd.devolucion_id IN (SELECT id FROM devoluciones WHERE venta_id = ? AND COALESCE(anulada, 0) = 0) WHERE dv.venta_id = ? GROUP BY dv.id, dv.producto_id, p.codigo, p.nombre, dv.cantidad, dv.precio_unitario, dv.precio_con_descuento, dv.subtotal, dv.devuelto, dv.es_reemplazo, dv.devolucion_id, dv.fecha_devolucion ORDER BY dv.id`,
      [ventaId, ventaId],
    )
    venta.detalles = detalles || []

    // CORREGIDO: Obtener los pagos asociados a esta venta con mejor información
    const [pagos] = await pool.query(
      `SELECT p.id, p.monto, p.fecha, COALESCE(p.anulado, 0) AS anulado, p.tipo_pago AS tipo_pago_nombre, p.notas FROM pagos p WHERE p.referencia_id = ? AND p.tipo_referencia = 'venta' ORDER BY p.fecha DESC`,
      [ventaId],
    )
    venta.pagos = pagos || []

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

    // Procesar pagos para asegurar tipos correctos
    venta.pagos = venta.pagos.map((pago) => ({
      ...pago,
      monto: Number(pago.monto) || 0,
      anulado: Boolean(pago.anulado),
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

// MODIFICADO: Crear una nueva venta con múltiples pagos
export const createVenta = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const {
    cliente_id,
    punto_venta_id,
    pagos, // Se recibe un array de pagos
    productos,
    porcentaje_interes = 0,
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

    let clienteId = null
    if (cliente_id) {
      const [clientes] = await connection.query("SELECT * FROM clientes WHERE id = ?", [cliente_id])
      if (clientes.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: "Cliente no encontrado" })
      }
      clienteId = cliente_id
    }

    if (!productos || productos.length === 0) {
      await connection.rollback()
      return res.status(400).json({ message: "La venta debe tener al menos un producto" })
    }

    let subtotal = 0
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
        return res.status(400).json({
          message: `Stock insuficiente para el producto ${productosDb[0].nombre}`,
        })
      }

      let precioConDescuento = producto.precio
      if (producto.descuento && producto.descuento.porcentaje > 0) {
        precioConDescuento = producto.precio * (1 - producto.descuento.porcentaje / 100)
      }
      subtotal += precioConDescuento * producto.cantidad
    }

    const montoInteres = (subtotal * porcentaje_interes) / 100
    const montoDescuento = (subtotal * porcentaje_descuento) / 100
    const total = subtotal - montoDescuento

    // Validar que la suma de los pagos coincida con el total
    const totalPagado = pagos.reduce((sum, pago) => sum + Number(pago.monto), 0)
    if (Math.abs(totalPagado - total) > 0.01) {
      await connection.rollback()
      return res.status(400).json({
        message: `El monto total de los pagos (${totalPagado.toFixed(2)}) no coincide con el total de la venta (${total.toFixed(2)})`,
      })
    }

    const numeroFactura = await generarNumeroFactura()

    // CORREGIDO: Determinar el valor para la columna tipo_pago
    const tipoPagoDisplay = pagos.length > 1 ? "Múltiple" : pagos[0].tipo_pago

    const [resultVenta] = await connection.query(
      `INSERT INTO ventas (numero_factura, cliente_id, usuario_id, punto_venta_id, tipo_pago, subtotal, porcentaje_interes, monto_interes, porcentaje_descuento, monto_descuento, total, tiene_devoluciones, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroFactura,
        clienteId,
        usuario_id,
        punto_venta_id,
        tipoPagoDisplay,
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

    for (const producto of productos) {
      let precioConDescuento = producto.precio
      if (producto.descuento && producto.descuento.porcentaje > 0) {
        precioConDescuento = producto.precio * (1 - producto.descuento.porcentaje / 100)
      }

      await connection.query(
        `INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, precio_con_descuento, subtotal, devuelto, es_reemplazo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ventaId,
          producto.id,
          producto.cantidad,
          producto.precio,
          precioConDescuento,
          precioConDescuento * producto.cantidad,
          0,
          0,
        ],
      )

      await connection.query("UPDATE inventario SET stock = stock - ? WHERE producto_id = ? AND punto_venta_id = ?", [
        producto.cantidad,
        producto.id,
        punto_venta_id,
      ])
    }

    // Registrar cada pago utilizando la función centralizada
    for (const pago of pagos) {
      await registrarPagoInterno(connection, {
        monto: pago.monto,
        tipo_pago: pago.tipo_pago,
        referencia_id: ventaId,
        tipo_referencia: "venta",
        cliente_id: clienteId,
        usuario_id,
        punto_venta_id,
        notas: notas || `Pago de venta de productos #${numeroFactura}`,
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

// MODIFICADO: Anular una venta y sus pagos asociados
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

    const [ventas] = await connection.query("SELECT * FROM ventas WHERE id = ?", [id])
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
    const [detalles] = await connection.query("SELECT * FROM detalle_ventas WHERE venta_id = ?", [id])
    for (const detalle of detalles) {
      await connection.query("UPDATE inventario SET stock = stock + ? WHERE producto_id = ? AND punto_venta_id = ?", [
        detalle.cantidad,
        detalle.producto_id,
        venta.punto_venta_id,
      ])
    }

    // Anular pagos asociados y revertir movimientos de cuenta corriente
    const [pagosAsociados] = await connection.query(
      "SELECT * FROM pagos WHERE referencia_id = ? AND tipo_referencia = 'venta'",
      [id],
    )

    for (const pago of pagosAsociados) {
      if (pago.anulado) continue

      // Anular el pago
      await connection.query("UPDATE pagos SET anulado = 1, fecha_anulacion = ?, motivo_anulacion = ? WHERE id = ?", [
        fechaActual,
        `Anulación de venta #${venta.numero_factura}: ${motivo}`,
        pago.id,
      ])

      // Si el pago era de tipo 'cuenta corriente', revertir el saldo
      if (pago.tipo_pago.toLowerCase() === "cuenta corriente" && pago.cliente_id) {
        const [cuentas] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ?", [
          pago.cliente_id,
        ])
        if (cuentas.length > 0) {
          const cuenta = cuentas[0]
          // Al anular un pago, el saldo de la CC debe aumentar (se devuelve el cargo)
          const saldoAnterior = Number(cuenta.saldo)
          const nuevoSaldo = saldoAnterior - Number(pago.monto)

          await connection.query("UPDATE cuentas_corrientes SET saldo = ?, fecha_ultimo_movimiento = ? WHERE id = ?", [
            nuevoSaldo,
            fechaActual,
            cuenta.id,
          ])

          // Registrar el movimiento de reversión (como un cargo)
          await connection.query(
            `INSERT INTO movimientos_cuenta_corriente (cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, referencia_id, tipo_referencia, usuario_id, notas, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              cuenta.id,
              "pago", // Revertir un pago es un nuevo cargo a la deuda
              pago.monto,
              saldoAnterior,
              nuevoSaldo,
              pago.id,
              "ajuste",
              usuario_id,
              `Reversión por anulación de pago #${pago.id}`,
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
      `SELECT id, numero_factura, fecha, anulada, fecha_anulacion, motivo_anulacion FROM ventas WHERE id = ?`,
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

    // CORREGIDO: Ventas por tipo de pago mejorado
    const [ventasPorMetodo] = await pool.query(
      `SELECT CASE WHEN v.tipo_pago = 'Múltiple' THEN 'Múltiple' ELSE v.tipo_pago END as tipo_pago, COUNT(v.id) as cantidad, SUM(v.total) as monto FROM ventas v ${whereClause} GROUP BY CASE WHEN v.tipo_pago = 'Múltiple' THEN 'Múltiple' ELSE v.tipo_pago END ORDER BY monto DESC`,
      params,
    )

    // Ventas por punto de venta
    const [ventasPorPunto] = await pool.query(
      `SELECT pv.nombre as punto_venta, COUNT(v.id) as cantidad, SUM(v.total) as monto FROM ventas v JOIN puntos_venta pv ON v.punto_venta_id = pv.id ${whereClause} GROUP BY v.punto_venta_id ORDER BY monto DESC`,
      params,
    )

    // Productos más vendidos
    const [productosMasVendidos] = await pool.query(
      `SELECT p.id, p.codigo, p.nombre, SUM(dv.cantidad) as cantidad_vendida, SUM(dv.subtotal) as monto_total FROM detalle_ventas dv JOIN productos p ON dv.producto_id = p.id JOIN ventas v ON dv.venta_id = v.id ${whereClause} GROUP BY dv.producto_id ORDER BY cantidad_vendida DESC LIMIT 10`,
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
      `SELECT d.*, u.nombre AS usuario_nombre, c.nombre AS cliente_nombre FROM devoluciones d LEFT JOIN usuarios u ON d.usuario_id = u.id LEFT JOIN clientes c ON d.cliente_id = c.id WHERE d.venta_id = ? AND d.anulada = 0 ORDER BY d.fecha DESC`,
      [id],
    )

    // Para cada devolución, obtener los productos devueltos y los productos de reemplazo
    for (const devolucion of devoluciones) {
      // Obtener productos devueltos
      const [productosDevueltos] = await pool.query(
        `SELECT dd.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre FROM detalle_devoluciones dd JOIN productos p ON dd.producto_id = p.id WHERE dd.devolucion_id = ?`,
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
