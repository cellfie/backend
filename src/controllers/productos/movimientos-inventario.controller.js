import pool from "../../db.js"

// Obtener movimientos de inventario con paginación y filtros básicos
export const getMovimientosInventario = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      tipo, // 'entrada' | 'salida'
      producto_id,
      punto_venta_id,
    } = req.query

    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    let baseWhere = "WHERE 1=1"
    const params = []
    const countParams = []

    if (producto_id) {
      baseWhere += " AND mi.producto_id = ?"
      params.push(producto_id)
      countParams.push(producto_id)
    }

    if (punto_venta_id) {
      baseWhere += " AND mi.punto_venta_id = ?"
      params.push(punto_venta_id)
      countParams.push(punto_venta_id)
    }

    if (tipo === "entrada") {
      baseWhere += " AND mi.cantidad > 0"
    } else if (tipo === "salida") {
      baseWhere += " AND mi.cantidad < 0"
    }

    const sql = `
      SELECT 
        mi.id,
        mi.producto_id,
        p.nombre AS producto_nombre,
        p.codigo AS producto_codigo,
        mi.punto_venta_id,
        pv.nombre AS punto_venta_nombre,
        mi.cantidad,
        mi.tipo_movimiento,
        mi.referencia_id,
        mi.usuario_id,
        u.nombre AS usuario_nombre,
        mi.fecha,
        mi.notas
      FROM log_inventario mi
      JOIN productos p ON mi.producto_id = p.id
      JOIN puntos_venta pv ON mi.punto_venta_id = pv.id
      LEFT JOIN usuarios u ON mi.usuario_id = u.id
      ${baseWhere}
      ORDER BY mi.fecha DESC, mi.id DESC
      LIMIT ? OFFSET ?
    `

    const countSql = `
      SELECT COUNT(*) AS total
      FROM log_inventario mi
      ${baseWhere}
    `

    const finalParams = [...params, Number.parseInt(limit), Number.parseInt(offset)]

    const [movimientosResult, countResult] = await Promise.all([
      pool.query(sql, finalParams),
      pool.query(countSql, countParams),
    ])

    const movimientos = movimientosResult[0]
    const total = countResult[0][0].total
    const totalPages = Math.ceil(total / Number.parseInt(limit))

    res.json({
      movimientos,
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
    })
  } catch (error) {
    console.error("Error al obtener movimientos de inventario:", error)
    res.status(500).json({ message: "Error al obtener movimientos de inventario" })
  }
}

