import pool from "../../db.js"
import { validationResult } from "express-validator"
import { registrarPagoInterno } from "../pago.controller.js"
import { formatearFechaParaDB } from "../../utils/dateUtils.js"

// Generar número de comprobante único para compras
const generarNumeroCompra = async () => {
  const fechaArgentina = formatearFechaParaDB()
  const fecha = new Date(fechaArgentina)

  const año = fecha.getFullYear().toString().substr(-2)
  const mes = (fecha.getMonth() + 1).toString().padStart(2, "0")
  const dia = fecha.getDate().toString().padStart(2, "0")
  const prefijo = `C${año}${mes}${dia}`

  const [ultimaCompra] = await pool.query(
    "SELECT numero_comprobante FROM compras WHERE numero_comprobante LIKE ? ORDER BY id DESC LIMIT 1",
    [`${prefijo}%`],
  )

  let numero = 1
  if (ultimaCompra.length > 0) {
    const ultimoNumero = Number.parseInt(ultimaCompra[0].numero_comprobante.split("-")[1])
    numero = ultimoNumero + 1
  }

  return `${prefijo}-${numero.toString().padStart(4, "0")}`
}

// Obtener compras con paginación básica y filtros
export const getComprasPaginadas = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      fecha_inicio,
      fecha_fin,
      proveedor_id,
      punto_venta_id,
      anuladas,
      search,
    } = req.query

    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    let sql = `
      SELECT 
        c.id,
        c.numero_comprobante,
        c.fecha,
        c.subtotal,
        c.porcentaje_descuento,
        c.monto_descuento,
        c.total,
        c.anulada,
        c.fecha_anulacion,
        c.motivo_anulacion,
        c.notas,
        p.id AS proveedor_id,
        p.nombre AS proveedor_nombre,
        p.telefono AS proveedor_telefono,
        p.cuit AS proveedor_cuit,
        u.id AS usuario_id,
        u.nombre AS usuario_nombre,
        pv.id AS punto_venta_id,
        pv.nombre AS punto_venta_nombre
      FROM compras c
      JOIN proveedores p ON c.proveedor_id = p.id
      JOIN usuarios u ON c.usuario_id = u.id
      JOIN puntos_venta pv ON c.punto_venta_id = pv.id
      WHERE 1=1
    `

    let countSql = `
      SELECT COUNT(*) AS total
      FROM compras c
      JOIN proveedores p ON c.proveedor_id = p.id
      JOIN usuarios u ON c.usuario_id = u.id
      JOIN puntos_venta pv ON c.punto_venta_id = pv.id
      WHERE 1=1
    `

    const params = []
    const countParams = []

    if (fecha_inicio) {
      sql += " AND DATE(c.fecha) >= ?"
      countSql += " AND DATE(c.fecha) >= ?"
      params.push(fecha_inicio)
      countParams.push(fecha_inicio)
    }

    if (fecha_fin) {
      sql += " AND DATE(c.fecha) <= ?"
      countSql += " AND DATE(c.fecha) <= ?"
      params.push(fecha_fin)
      countParams.push(fecha_fin)
    }

    if (proveedor_id) {
      sql += " AND c.proveedor_id = ?"
      countSql += " AND c.proveedor_id = ?"
      params.push(proveedor_id)
      countParams.push(proveedor_id)
    }

    if (punto_venta_id) {
      sql += " AND c.punto_venta_id = ?"
      countSql += " AND c.punto_venta_id = ?"
      params.push(punto_venta_id)
      countParams.push(punto_venta_id)
    }

    if (anuladas !== undefined) {
      const anuladaValue = anuladas === "true" ? 1 : 0
      sql += " AND c.anulada = ?"
      countSql += " AND c.anulada = ?"
      params.push(anuladaValue)
      countParams.push(anuladaValue)
    }

    if (search) {
      const pattern = `%${search}%`
      sql += " AND (c.numero_comprobante LIKE ? OR p.nombre LIKE ? OR p.cuit LIKE ?)"
      countSql += " AND (c.numero_comprobante LIKE ? OR p.nombre LIKE ? OR p.cuit LIKE ?)"
      params.push(pattern, pattern, pattern)
      countParams.push(pattern, pattern, pattern)
    }

    sql += " ORDER BY c.fecha DESC, c.id DESC LIMIT ? OFFSET ?"
    params.push(Number.parseInt(limit), Number.parseInt(offset))

    const [comprasResult, countResult] = await Promise.all([pool.query(sql, params), pool.query(countSql, countParams)])

    const compras = comprasResult[0]
    const total = countResult[0][0].total
    const totalPages = Math.ceil(total / Number.parseInt(limit))

    res.json({
      compras,
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
    console.error("Error al obtener compras paginadas:", error)
    res.status(500).json({ message: "Error al obtener compras paginadas" })
  }
}

// Obtener compras sin paginación (para selects simples)
export const getCompras = async (req, res) => {
  try {
    const [compras] = await pool.query(
      `SELECT c.id, c.numero_comprobante, c.fecha, c.total, c.anulada,
              p.id AS proveedor_id, p.nombre AS proveedor_nombre
       FROM compras c
       JOIN proveedores p ON c.proveedor_id = p.id
       ORDER BY c.fecha DESC, c.id DESC
       LIMIT 500`,
    )

    res.json(compras)
  } catch (error) {
    console.error("Error al obtener compras:", error)
    res.status(500).json({ message: "Error al obtener compras" })
  }
}

// Obtener una compra por ID con detalles y pagos
export const getCompraById = async (req, res) => {
  try {
    const { id } = req.params

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ message: "ID de compra inválido" })
    }

    const compraId = Number(id)

    const [compras] = await pool.query(
      `SELECT 
          c.id,
          c.numero_comprobante,
          c.fecha,
          c.subtotal,
          c.porcentaje_descuento,
          c.monto_descuento,
          c.total,
          c.anulada,
          c.fecha_anulacion,
          c.motivo_anulacion,
          c.notas,
          c.proveedor_id,
          c.usuario_id,
          c.punto_venta_id,
          p.nombre AS proveedor_nombre,
          p.telefono AS proveedor_telefono,
          p.cuit AS proveedor_cuit,
          u.nombre AS usuario_nombre,
          pv.nombre AS punto_venta_nombre
        FROM compras c
        JOIN proveedores p ON c.proveedor_id = p.id
        JOIN usuarios u ON c.usuario_id = u.id
        JOIN puntos_venta pv ON c.punto_venta_id = pv.id
        WHERE c.id = ?`,
      [compraId],
    )

    if (!compras || compras.length === 0) {
      return res.status(404).json({ message: "Compra no encontrada" })
    }

    const compra = compras[0]

    const [detalles] = await pool.query(
      `SELECT 
          dc.id,
          dc.producto_id,
          p.codigo AS producto_codigo,
          p.nombre AS producto_nombre,
          dc.cantidad,
          dc.costo_unitario,
          dc.subtotal
        FROM detalle_compras dc
        JOIN productos p ON dc.producto_id = p.id
        WHERE dc.compra_id = ?
        ORDER BY dc.id`,
      [compraId],
    )

    compra.detalles = detalles || []

    const [pagos] = await pool.query(
      `SELECT 
          pg.id,
          pg.monto,
          pg.fecha,
          COALESCE(pg.anulado, 0) AS anulado,
          pg.tipo_pago AS tipo_pago_nombre,
          pg.notas
        FROM pagos pg
        WHERE pg.referencia_id = ? AND pg.tipo_referencia = 'compra'
        ORDER BY pg.fecha DESC`,
      [compraId],
    )

    compra.pagos = pagos || []

    res.json(compra)
  } catch (error) {
    console.error("Error al obtener compra por ID:", error)
    res.status(500).json({ message: "Error interno al obtener la compra" })
  }
}

// Crear una nueva compra
export const createCompra = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { proveedor_id, punto_venta_id, productos, pagos = [], porcentaje_descuento = 0, notas } = req.body

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

    const [proveedores] = await connection.query("SELECT * FROM proveedores WHERE id = ?", [proveedor_id])
    if (proveedores.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Proveedor no encontrado" })
    }

    if (!productos || productos.length === 0) {
      await connection.rollback()
      return res.status(400).json({ message: "La compra debe tener al menos un producto" })
    }

    let subtotal = 0
    const detalleProductos = []

    for (const item of productos) {
      const [productosDb] = await connection.query("SELECT * FROM productos WHERE id = ?", [item.id])
      if (productosDb.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: `Producto con ID ${item.id} no encontrado` })
      }

      const cantidad = Number(item.cantidad)
      const costo = Number(item.costo_unitario ?? item.costo ?? item.precio ?? 0)

      if (Number.isNaN(cantidad) || cantidad <= 0 || Number.isNaN(costo) || costo < 0) {
        await connection.rollback()
        return res
          .status(400)
          .json({ message: `Cantidad o costo inválido para el producto ${productosDb[0].nombre}` })
      }

      detalleProductos.push({
        nombre: productosDb[0].nombre,
        cantidad,
      })

      subtotal += costo * cantidad
    }

    const montoDescuento = (subtotal * Number(porcentaje_descuento || 0)) / 100
    const total = subtotal - montoDescuento

    if (pagos && pagos.length > 0) {
      const totalPagado = pagos.reduce((sum, pago) => sum + Number(pago.monto || 0), 0)
      if (Math.abs(totalPagado - total) > 0.01) {
        await connection.rollback()
        return res.status(400).json({
          message: `El monto total de los pagos (${totalPagado.toFixed(2)}) no coincide con el total de la compra (${total.toFixed(2)})`,
        })
      }
    }

    const numeroComprobante = await generarNumeroCompra()

    const [resultCompra] = await connection.query(
      `INSERT INTO compras (
          numero_comprobante,
          proveedor_id,
          usuario_id,
          punto_venta_id,
          subtotal,
          porcentaje_descuento,
          monto_descuento,
          total,
          anulada,
          fecha,
          notas
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        numeroComprobante,
        proveedor_id,
        usuario_id,
        punto_venta_id,
        subtotal,
        porcentaje_descuento || 0,
        montoDescuento,
        total,
        fechaActual,
        notas || null,
      ],
    )

    const compraId = resultCompra.insertId

    for (const item of productos) {
      const cantidad = Number(item.cantidad)
      const costo = Number(item.costo_unitario ?? item.costo ?? item.precio ?? 0)

      await connection.query(
        `INSERT INTO detalle_compras (compra_id, producto_id, cantidad, costo_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [compraId, item.id, cantidad, costo, costo * cantidad],
      )

      await connection.query("UPDATE inventario SET stock = stock + ? WHERE producto_id = ? AND punto_venta_id = ?", [
        cantidad,
        item.id,
        punto_venta_id,
      ])
    }

    if (pagos && pagos.length > 0) {
      for (const pago of pagos) {
        await registrarPagoInterno(connection, {
          monto: pago.monto,
          tipo_pago: pago.tipo_pago,
          referencia_id: compraId,
          tipo_referencia: "compra",
          cliente_id: null,
          usuario_id,
          punto_venta_id,
          notas: notas || `Pago de compra #${numeroComprobante}`,
          detalle_productos: detalleProductos,
        })
      }
    }

    await connection.commit()

    res.status(201).json({
      id: compraId,
      numero_comprobante: numeroComprobante,
      total,
      message: "Compra registrada exitosamente",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear compra:", error)
    res.status(500).json({ message: "Error al crear compra: " + error.message })
  } finally {
    connection.release()
  }
}

// Anular una compra y revertir stock / pagos
export const anularCompra = async (req, res) => {
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

    const [compras] = await connection.query("SELECT * FROM compras WHERE id = ?", [id])
    if (compras.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Compra no encontrada" })
    }
    const compra = compras[0]

    if (compra.anulada) {
      await connection.rollback()
      return res.status(400).json({ message: "La compra ya está anulada" })
    }

    const [detalles] = await connection.query("SELECT * FROM detalle_compras WHERE compra_id = ?", [id])
    for (const detalle of detalles) {
      await connection.query("UPDATE inventario SET stock = stock - ? WHERE producto_id = ? AND punto_venta_id = ?", [
        detalle.cantidad,
        detalle.producto_id,
        compra.punto_venta_id,
      ])
    }

    const [pagosAsociados] = await connection.query(
      "SELECT * FROM pagos WHERE referencia_id = ? AND tipo_referencia = 'compra'",
      [id],
    )

    for (const pago of pagosAsociados) {
      if (pago.anulado) continue

      await connection.query("UPDATE pagos SET anulado = 1, fecha_anulacion = ?, motivo_anulacion = ? WHERE id = ?", [
        fechaActual,
        `Anulación de compra #${compra.numero_comprobante}: ${motivo}`,
        pago.id,
      ])
    }

    await connection.query(
      "UPDATE compras SET anulada = 1, fecha_anulacion = ?, motivo_anulacion = ?, notas = CONCAT(IFNULL(notas, ''), ?) WHERE id = ?",
      [
        fechaActual,
        motivo,
        `\n[Anulada por usuario ${usuario_id} el ${fechaActual}: ${motivo}]`,
        id,
      ],
    )

    await connection.commit()

    const [compraActualizada] = await connection.query(
      "SELECT id, numero_comprobante, fecha, anulada, fecha_anulacion, motivo_anulacion FROM compras WHERE id = ?",
      [id],
    )

    res.json({
      message: "Compra anulada exitosamente",
      compra: compraActualizada[0],
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al anular compra:", error)
    res.status(500).json({ message: "Error al anular compra: " + error.message })
  } finally {
    connection.release()
  }
}

