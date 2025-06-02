import pool from "../../db.js"
import { validationResult } from "express-validator"

// Obtener todos los equipos con información de punto de venta
export const getEquipos = async (req, res) => {
  try {
    const [equipos] = await pool.query(`
            SELECT 
                e.id, 
                e.marca, 
                e.modelo, 
                e.memoria, 
                e.color, 
                e.bateria, 
                e.precio, 
                e.descripcion, 
                e.imei, 
                e.fecha_ingreso,
                e.tipo_cambio,
                e.tipo_cambio_original,
                e.vendido,
                e.venta_id,
                e.es_canje,
                e.cliente_canje_id,
                e.venta_canje_id,
                c.nombre AS cliente_canje,
                v.numero_factura AS venta_canje,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta
            FROM equipos e
            JOIN puntos_venta pv ON e.punto_venta_id = pv.id
            LEFT JOIN clientes c ON e.cliente_canje_id = c.id
            LEFT JOIN ventas_equipos v ON e.venta_canje_id = v.id
            ORDER BY e.fecha_creacion DESC
        `)

    res.json(equipos)
  } catch (error) {
    console.error("Error al obtener equipos:", error)
    res.status(500).json({ message: "Error al obtener equipos" })
  }
}

// Obtener un equipo por ID
export const getEquipoById = async (req, res) => {
  try {
    const { id } = req.params

    const [equipos] = await pool.query(
      `
            SELECT 
                e.id, 
                e.marca, 
                e.modelo, 
                e.memoria, 
                e.color, 
                e.bateria, 
                e.precio, 
                e.descripcion, 
                e.imei, 
                e.fecha_ingreso,
                e.tipo_cambio,
                e.tipo_cambio_original,
                e.vendido,
                e.venta_id,
                e.es_canje,
                e.cliente_canje_id,
                e.venta_canje_id,
                c.nombre AS cliente_canje,
                v.numero_factura AS venta_canje,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta
            FROM equipos e
            JOIN puntos_venta pv ON e.punto_venta_id = pv.id
            LEFT JOIN clientes c ON e.cliente_canje_id = c.id
            LEFT JOIN ventas_equipos v ON e.venta_canje_id = v.id
            WHERE e.id = ?
        `,
      [id],
    )

    if (equipos.length === 0) {
      return res.status(404).json({ message: "Equipo no encontrado" })
    }

    res.json(equipos[0])
  } catch (error) {
    console.error("Error al obtener equipo:", error)
    res.status(500).json({ message: "Error al obtener equipo" })
  }
}

// Crear un nuevo equipo
export const createEquipo = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  // Obtener el tipo de cambio actual
  const [tcRows] = await pool.query(`SELECT valor FROM tipo_cambio ORDER BY fecha DESC LIMIT 1`)
  const currentTipoCambio = tcRows.length > 0 ? Number.parseFloat(tcRows[0].valor) : req.body.tipo_cambio || 1200.0

  const {
    marca,
    modelo,
    memoria,
    color,
    bateria,
    precio,
    descripcion,
    imei,
    fecha_ingreso,
    punto_venta_id,
    es_canje,
    cliente_canje_id,
    venta_canje_id,
  } = req.body

  try {
    // Verificar si ya existe un equipo con el mismo IMEI
    const [existingEquipos] = await pool.query("SELECT * FROM equipos WHERE imei = ?", [imei])

    if (existingEquipos.length > 0) {
      return res.status(400).json({ message: "Ya existe un equipo con ese IMEI" })
    }

    // Verificar que el punto de venta existe
    const [puntosVenta] = await pool.query("SELECT * FROM puntos_venta WHERE id = ?", [punto_venta_id])

    if (puntosVenta.length === 0) {
      return res.status(404).json({ message: "Punto de venta no encontrado" })
    }

    // Verificar que el cliente existe si se proporciona un ID
    if (cliente_canje_id) {
      const [clientes] = await pool.query("SELECT * FROM clientes WHERE id = ?", [cliente_canje_id])
      if (clientes.length === 0) {
        return res.status(404).json({ message: "Cliente de canje no encontrado" })
      }
    }

    // Insertar el equipo con el tipo de cambio actual y guardarlo como tipo_cambio_original
    const [result] = await pool.query(
      `INSERT INTO equipos (
                marca, modelo, memoria, color, bateria, precio, descripcion, 
                imei, fecha_ingreso, punto_venta_id, tipo_cambio, tipo_cambio_original, 
                vendido, venta_id, es_canje, cliente_canje_id, venta_canje_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        marca,
        modelo,
        memoria || null,
        color || null,
        bateria || null,
        precio,
        descripcion || null,
        imei,
        fecha_ingreso,
        punto_venta_id,
        currentTipoCambio,
        currentTipoCambio, // Guardar el tipo de cambio actual como original
        0, // No vendido por defecto
        null, // Sin venta asociada
        es_canje ? 1 : 0,
        cliente_canje_id || null,
        venta_canje_id || null,
      ],
    )

    res.status(201).json({
      id: result.insertId,
      message: "Equipo creado exitosamente",
    })
  } catch (error) {
    console.error("Error al crear equipo:", error)

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "El IMEI del equipo ya existe" })
    }

    res.status(500).json({ message: "Error al crear equipo" })
  }
}

// Actualizar un equipo - FUNCIÓN CORREGIDA
export const updateEquipo = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  // Obtener el tipo de cambio actual
  const [tcRows] = await pool.query(`SELECT valor FROM tipo_cambio ORDER BY fecha DESC LIMIT 1`)
  const currentTipoCambio = tcRows.length > 0 ? Number.parseFloat(tcRows[0].valor) : 1200.0

  const { id } = req.params
  const {
    marca,
    modelo,
    memoria,
    color,
    bateria,
    precio,
    descripcion,
    imei,
    fecha_ingreso,
    punto_venta_id,
    vendido,
    venta_id,
    // IMPORTANTE: No recibir es_canje, cliente_canje_id, venta_canje_id del body
    // para preservar los valores originales
  } = req.body

  try {
    // Verificar si el equipo existe y obtener sus datos actuales
    const [equipos] = await pool.query("SELECT * FROM equipos WHERE id = ?", [id])

    if (equipos.length === 0) {
      return res.status(404).json({ message: "Equipo no encontrado" })
    }

    const equipoActual = equipos[0]

    // Verificar si ya existe otro equipo con el mismo IMEI
    if (imei && imei !== equipoActual.imei) {
      const [existingEquipos] = await pool.query("SELECT * FROM equipos WHERE imei = ? AND id != ?", [imei, id])

      if (existingEquipos.length > 0) {
        return res.status(400).json({ message: "Ya existe otro equipo con ese IMEI" })
      }
    }

    // Verificar que el cliente existe si se proporciona un ID
    if (equipoActual.cliente_canje_id) {
      const [clientes] = await pool.query("SELECT * FROM clientes WHERE id = ?", [equipoActual.cliente_canje_id])
      if (clientes.length === 0) {
        return res.status(404).json({ message: "Cliente de canje no encontrado" })
      }
    }

    // Actualizar el equipo PRESERVANDO los campos de plan canje
    await pool.query(
      `UPDATE equipos SET 
                marca = ?, 
                modelo = ?, 
                memoria = ?, 
                color = ?, 
                bateria = ?, 
                precio = ?, 
                descripcion = ?, 
                imei = ?, 
                fecha_ingreso = ?,
                punto_venta_id = ?,
                tipo_cambio = ?,
                vendido = ?,
                venta_id = ?
                -- NOTA: NO actualizamos es_canje, cliente_canje_id, venta_canje_id
                -- para preservar la información del plan canje
            WHERE id = ?`,
      [
        marca || equipoActual.marca,
        modelo || equipoActual.modelo,
        memoria !== undefined ? memoria : equipoActual.memoria,
        color !== undefined ? color : equipoActual.color,
        bateria !== undefined ? bateria : equipoActual.bateria,
        precio !== undefined ? precio : equipoActual.precio,
        descripcion !== undefined ? descripcion : equipoActual.descripcion,
        imei || equipoActual.imei,
        fecha_ingreso || equipoActual.fecha_ingreso,
        punto_venta_id || equipoActual.punto_venta_id,
        currentTipoCambio,
        vendido !== undefined ? vendido : equipoActual.vendido,
        venta_id !== undefined ? venta_id : equipoActual.venta_id,
        id,
      ],
    )

    res.json({
      message: "Equipo actualizado exitosamente",
      preservedCanjeInfo: {
        es_canje: equipoActual.es_canje,
        cliente_canje_id: equipoActual.cliente_canje_id,
        venta_canje_id: equipoActual.venta_canje_id,
      },
    })
  } catch (error) {
    console.error("Error al actualizar equipo:", error)

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "El IMEI del equipo ya existe" })
    }

    res.status(500).json({ message: "Error al actualizar equipo" })
  }
}

export const searchEquipos = async (req, res) => {
  try {
    const {
      query,
      imei,
      punto_venta_id,
      min_precio,
      max_precio,
      min_bateria,
      max_bateria,
      fecha_inicio,
      fecha_fin,
      incluir_vendidos = "true", // Por defecto incluye vendidos en la búsqueda general
      solo_canjes = "false", // Por defecto no filtra solo por canjes
    } = req.query

    let sql = `
            SELECT 
                e.id, 
                e.marca, 
                e.modelo, 
                e.memoria, 
                e.color, 
                e.bateria, 
                e.precio, 
                e.descripcion, 
                e.imei, 
                e.fecha_ingreso,
                e.tipo_cambio,
                e.tipo_cambio_original,
                e.vendido,
                e.venta_id,
                e.es_canje,
                e.cliente_canje_id,
                e.venta_canje_id,
                c.nombre AS cliente_canje,
                v.numero_factura AS venta_canje,
                pv.id AS punto_venta_id,
                pv.nombre AS punto_venta
            FROM equipos e
            JOIN puntos_venta pv ON e.punto_venta_id = pv.id
            LEFT JOIN clientes c ON e.cliente_canje_id = c.id
            LEFT JOIN ventas_equipos v ON e.venta_canje_id = v.id
            WHERE 1=1
        `

    const params = []

    // Filtrar por IMEI si se proporciona
    if (imei) {
      sql += ` AND e.imei LIKE ?`
      params.push(`%${imei}%`)
    }

    // Filtrar por marca y modelo si se proporciona query
    if (query) {
      // Dividir la consulta en términos individuales
      const searchTerms = query.trim().split(/\s+/)

      if (searchTerms.length > 0) {
        // Crear condiciones para cada término
        const termConditions = searchTerms
          .map(() => `(e.marca LIKE ? OR e.modelo LIKE ? OR CONCAT(e.marca, ' ', e.modelo) LIKE ?)`)
          .join(" AND ")

        sql += ` AND (${termConditions})`

        // Agregar parámetros para cada término
        searchTerms.forEach((term) => {
          const searchPattern = `%${term}%`
          params.push(searchPattern, searchPattern, searchPattern)
        })
      }
    }

    // Filtrar por punto de venta
    if (punto_venta_id) {
      sql += ` AND e.punto_venta_id = ?`
      params.push(punto_venta_id)
    }

    // Filtrar por rango de precio
    if (min_precio !== undefined) {
      sql += ` AND e.precio >= ?`
      params.push(min_precio)
    }

    if (max_precio !== undefined) {
      sql += ` AND e.precio <= ?`
      params.push(max_precio)
    }

    // Filtrar por rango de batería
    if (min_bateria !== undefined) {
      sql += ` AND e.bateria >= ?`
      params.push(min_bateria)
    }

    if (max_bateria !== undefined) {
      sql += ` AND e.bateria <= ?`
      params.push(max_bateria)
    }

    // Filtrar por rango de fecha de ingreso
    if (fecha_inicio) {
      sql += ` AND e.fecha_ingreso >= ?`
      params.push(fecha_inicio)
    }

    if (fecha_fin) {
      sql += ` AND e.fecha_ingreso <= ?`
      params.push(fecha_fin)
    }

    // Filtrar equipos vendidos si se especifica
    if (incluir_vendidos === "false") {
      sql += ` AND e.vendido = 0`
    }

    // Filtrar solo equipos de canje si se especifica
    if (solo_canjes === "true") {
      sql += ` AND e.es_canje = 1`
    }

    // Ordenar por fecha de ingreso descendente
    sql += ` ORDER BY e.fecha_ingreso DESC`

    const [equipos] = await pool.query(sql, params)

    res.json(equipos)
  } catch (error) {
    console.error("Error al buscar equipos:", error)
    res.status(500).json({ message: "Error al buscar equipos" })
  }
}

// Eliminar un equipo
export const deleteEquipo = async (req, res) => {
  const { id } = req.params

  try {
    // Verificar si el equipo existe
    const [equipos] = await pool.query("SELECT * FROM equipos WHERE id = ?", [id])

    if (equipos.length === 0) {
      return res.status(404).json({ message: "Equipo no encontrado" })
    }

    // Verificar si el equipo está vendido
    if (equipos[0].vendido === 1) {
      return res.status(400).json({
        message: "No se puede eliminar el equipo porque ya ha sido vendido",
      })
    }

    // Eliminar el equipo
    await pool.query("DELETE FROM equipos WHERE id = ?", [id])

    res.json({ message: "Equipo eliminado exitosamente" })
  } catch (error) {
    console.error("Error al eliminar equipo:", error)
    res.status(500).json({ message: "Error al eliminar equipo" })
  }
}
