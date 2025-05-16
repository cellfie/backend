import pool from "../db.js"
import { validationResult } from "express-validator"

// Obtener todas las pérdidas
export const getPerdidas = async (req, res) => {
  try {
    // Parámetros de filtrado opcionales
    const { fecha_inicio, fecha_fin, producto_id, repuesto_id, tipo } = req.query

    // Consulta base para pérdidas de productos
    let queryProductos = `
      SELECT 
        p.id, 
        'producto' as tipo,
        p.producto_id,
        p.repuesto_id,
        p.cantidad, 
        p.motivo,
        p.devolucion_id,
        p.usuario_id,
        p.fecha,
        p.punto_venta_id,
        pr.codigo AS producto_codigo, 
        pr.nombre AS producto_nombre,
        NULL AS repuesto_codigo,
        NULL AS repuesto_nombre,
        u.nombre AS usuario_nombre,
        pv.nombre AS punto_venta_nombre
      FROM perdidas p
      JOIN productos pr ON p.producto_id = pr.id
      JOIN usuarios u ON p.usuario_id = u.id
      LEFT JOIN puntos_venta pv ON p.punto_venta_id = pv.id
      WHERE p.producto_id IS NOT NULL
    `

    // Consulta base para pérdidas de repuestos
    let queryRepuestos = `
      SELECT 
        p.id, 
        'repuesto' as tipo,
        p.producto_id,
        p.repuesto_id,
        p.cantidad, 
        p.motivo,
        p.devolucion_id,
        p.usuario_id,
        p.fecha,
        p.punto_venta_id,
        NULL AS producto_codigo,
        NULL AS producto_nombre,
        r.codigo AS repuesto_codigo, 
        r.nombre AS repuesto_nombre,
        u.nombre AS usuario_nombre,
        pv.nombre AS punto_venta_nombre
      FROM perdidas p
      JOIN repuestos r ON p.repuesto_id = r.id
      JOIN usuarios u ON p.usuario_id = u.id
      LEFT JOIN puntos_venta pv ON p.punto_venta_id = pv.id
      WHERE p.repuesto_id IS NOT NULL
    `

    const queryParams = []
    const queryParamsRepuestos = []

    // Aplicar filtros si se proporcionan
    if (fecha_inicio) {
      queryProductos += " AND DATE(p.fecha) >= ?"
      queryRepuestos += " AND DATE(p.fecha) >= ?"
      queryParams.push(fecha_inicio)
      queryParamsRepuestos.push(fecha_inicio)
    }
    if (fecha_fin) {
      queryProductos += " AND DATE(p.fecha) <= ?"
      queryRepuestos += " AND DATE(p.fecha) <= ?"
      queryParams.push(fecha_fin)
      queryParamsRepuestos.push(fecha_fin)
    }
    if (producto_id) {
      queryProductos += " AND p.producto_id = ?"
      queryParams.push(producto_id)
    }
    if (repuesto_id) {
      queryRepuestos += " AND p.repuesto_id = ?"
      queryParamsRepuestos.push(repuesto_id)
    }

    // Filtrar por tipo si se especifica
    let resultados = []
    if (tipo === "producto") {
      // Solo obtener pérdidas de productos
      queryProductos += " ORDER BY p.fecha DESC"
      const [perdidas] = await pool.query(queryProductos, queryParams)
      resultados = perdidas
    } else if (tipo === "repuesto") {
      // Solo obtener pérdidas de repuestos
      queryRepuestos += " ORDER BY p.fecha DESC"
      const [perdidas] = await pool.query(queryRepuestos, queryParamsRepuestos)
      resultados = perdidas
    } else {
      // Obtener ambos tipos de pérdidas
      queryProductos += " ORDER BY p.fecha DESC"
      queryRepuestos += " ORDER BY p.fecha DESC"

      const [perdidasProductos] = await pool.query(queryProductos, queryParams)
      const [perdidasRepuestos] = await pool.query(queryRepuestos, queryParamsRepuestos)

      // Combinar resultados
      resultados = [...perdidasProductos, ...perdidasRepuestos]

      // Ordenar por fecha descendente
      resultados.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    }

    res.json(resultados)
  } catch (error) {
    console.error("Error al obtener pérdidas:", error)
    res.status(500).json({ message: "Error al obtener pérdidas" })
  }
}

// Obtener una pérdida por ID
export const getPerdidaById = async (req, res) => {
  try {
    const { id } = req.params

    // Intentar obtener como pérdida de producto
    const [perdidasProducto] = await pool.query(
      `
      SELECT 
        p.*, 
        'producto' as tipo,
        pr.codigo AS producto_codigo, 
        pr.nombre AS producto_nombre,
        NULL AS repuesto_codigo,
        NULL AS repuesto_nombre,
        u.nombre AS usuario_nombre,
        pv.nombre AS punto_venta_nombre
      FROM perdidas p
      JOIN productos pr ON p.producto_id = pr.id
      JOIN usuarios u ON p.usuario_id = u.id
      LEFT JOIN puntos_venta pv ON p.punto_venta_id = pv.id
      WHERE p.id = ? AND p.producto_id IS NOT NULL
    `,
      [id],
    )

    // Si no se encuentra como producto, intentar como repuesto
    if (perdidasProducto.length === 0) {
      const [perdidasRepuesto] = await pool.query(
        `
        SELECT 
          p.*, 
          'repuesto' as tipo,
          NULL AS producto_codigo,
          NULL AS producto_nombre,
          r.codigo AS repuesto_codigo, 
          r.nombre AS repuesto_nombre,
          u.nombre AS usuario_nombre,
          pv.nombre AS punto_venta_nombre
        FROM perdidas p
        JOIN repuestos r ON p.repuesto_id = r.id
        JOIN usuarios u ON p.usuario_id = u.id
        LEFT JOIN puntos_venta pv ON p.punto_venta_id = pv.id
        WHERE p.id = ? AND p.repuesto_id IS NOT NULL
      `,
        [id],
      )

      if (perdidasRepuesto.length === 0) {
        return res.status(404).json({ message: "Pérdida no encontrada" })
      }

      return res.json(perdidasRepuesto[0])
    }

    res.json(perdidasProducto[0])
  } catch (error) {
    console.error("Error al obtener pérdida:", error)
    res.status(500).json({ message: "Error al obtener pérdida" })
  }
}

// Crear una nueva pérdida manual
export const createPerdida = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const { tipo = "producto", producto_id, repuesto_id, cantidad, motivo, punto_venta_id } = req.body

    // Verificar que el punto de venta existe
    const [puntosVenta] = await connection.query("SELECT * FROM puntos_venta WHERE id = ?", [punto_venta_id])
    if (puntosVenta.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Punto de venta no encontrado" })
    }

    let perdidaId, itemId, tableName, inventarioTable, logTable

    // Manejar pérdida según el tipo
    if (tipo === "producto" && producto_id) {
      // Verificar que el producto existe
      const [productos] = await connection.query("SELECT * FROM productos WHERE id = ?", [producto_id])
      if (productos.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: "Producto no encontrado" })
      }

      // Verificar que hay stock suficiente
      const [inventario] = await connection.query(
        "SELECT * FROM inventario WHERE producto_id = ? AND punto_venta_id = ?",
        [producto_id, punto_venta_id],
      )

      if (inventario.length === 0 || inventario[0].stock < cantidad) {
        await connection.rollback()
        return res.status(400).json({ message: "No hay stock suficiente para registrar esta pérdida" })
      }

      // Registrar la pérdida de producto
      const [result] = await connection.query(
        `
        INSERT INTO perdidas (
          producto_id, 
          repuesto_id,
          cantidad, 
          motivo, 
          usuario_id, 
          fecha,
          punto_venta_id
        ) VALUES (?, NULL, ?, ?, ?, NOW(), ?)
      `,
        [producto_id, cantidad, motivo, req.user.id, punto_venta_id],
      )

      perdidaId = result.insertId
      itemId = producto_id
      tableName = "productos"
      inventarioTable = "inventario"
      logTable = "log_inventario"

      // Actualizar el inventario
      await connection.query("UPDATE inventario SET stock = stock - ? WHERE producto_id = ? AND punto_venta_id = ?", [
        cantidad,
        producto_id,
        punto_venta_id,
      ])

      // Registrar en log de inventario
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
        ) VALUES (?, ?, ?, 'perdida', ?, ?, NOW(), ?)
      `,
        [producto_id, punto_venta_id, -cantidad, perdidaId, req.user.id, motivo],
      )
    } else if (tipo === "repuesto" && repuesto_id) {
      // Verificar que el repuesto existe
      const [repuestos] = await connection.query("SELECT * FROM repuestos WHERE id = ?", [repuesto_id])
      if (repuestos.length === 0) {
        await connection.rollback()
        return res.status(404).json({ message: "Repuesto no encontrado" })
      }

      // Verificar que hay stock suficiente
      const [inventario] = await connection.query(
        "SELECT * FROM inventario_repuestos WHERE repuesto_id = ? AND punto_venta_id = ?",
        [repuesto_id, punto_venta_id],
      )

      if (inventario.length === 0 || inventario[0].stock < cantidad) {
        await connection.rollback()
        return res.status(400).json({ message: "No hay stock suficiente para registrar esta pérdida" })
      }

      // Registrar la pérdida de repuesto
      const [result] = await connection.query(
        `
        INSERT INTO perdidas (
          producto_id, 
          repuesto_id,
          cantidad, 
          motivo, 
          usuario_id, 
          fecha,
          punto_venta_id
        ) VALUES (NULL, ?, ?, ?, ?, NOW(), ?)
      `,
        [repuesto_id, cantidad, motivo, req.user.id, punto_venta_id],
      )

      perdidaId = result.insertId
      itemId = repuesto_id
      tableName = "repuestos"
      inventarioTable = "inventario_repuestos"
      logTable = "log_inventario_repuestos"

      // Actualizar el inventario
      await connection.query("UPDATE inventario_repuestos SET stock = stock - ? WHERE repuesto_id = ? AND punto_venta_id = ?", [
        cantidad,
        repuesto_id,
        punto_venta_id,
      ])

      // Registrar en log de inventario de repuestos (si existe)
      try {
        await connection.query(
          `
          INSERT INTO log_inventario_repuestos (
            repuesto_id, 
            punto_venta_id, 
            cantidad, 
            tipo_movimiento, 
            referencia_id, 
            usuario_id, 
            fecha, 
            notas
          ) VALUES (?, ?, ?, 'perdida', ?, ?, NOW(), ?)
        `,
          [repuesto_id, punto_venta_id, -cantidad, perdidaId, req.user.id, motivo],
        )
      } catch (error) {
        console.warn("No se pudo registrar en log_inventario_repuestos:", error)
        // Continuar incluso si no existe la tabla de log para repuestos
      }
    } else {
      await connection.rollback()
      return res.status(400).json({ message: "Debe especificar un producto_id o repuesto_id válido según el tipo" })
    }

    await connection.commit()

    // Obtener la pérdida completa para devolverla en la respuesta
    let perdidaCompleta
    if (tipo === "producto") {
      const [resultado] = await pool.query(
        `
        SELECT 
          p.*, 
          'producto' as tipo,
          pr.codigo AS producto_codigo, 
          pr.nombre AS producto_nombre,
          NULL AS repuesto_codigo,
          NULL AS repuesto_nombre,
          u.nombre AS usuario_nombre,
          pv.nombre AS punto_venta_nombre
        FROM perdidas p
        JOIN productos pr ON p.producto_id = pr.id
        JOIN usuarios u ON p.usuario_id = u.id
        LEFT JOIN puntos_venta pv ON p.punto_venta_id = pv.id
        WHERE p.id = ?
      `,
        [perdidaId],
      )
      perdidaCompleta = resultado[0]
    } else {
      const [resultado] = await pool.query(
        `
        SELECT 
          p.*, 
          'repuesto' as tipo,
          NULL AS producto_codigo,
          NULL AS producto_nombre,
          r.codigo AS repuesto_codigo, 
          r.nombre AS repuesto_nombre,
          u.nombre AS usuario_nombre,
          pv.nombre AS punto_venta_nombre
        FROM perdidas p
        JOIN repuestos r ON p.repuesto_id = r.id
        JOIN usuarios u ON p.usuario_id = u.id
        LEFT JOIN puntos_venta pv ON p.punto_venta_id = pv.id
        WHERE p.id = ?
      `,
        [perdidaId],
      )
      perdidaCompleta = resultado[0]
    }

    res.status(201).json(perdidaCompleta)
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear pérdida:", error)
    res.status(500).json({ message: "Error al crear pérdida: " + error.message })
  } finally {
    connection.release()
  }
}

// Eliminar una pérdida
export const deletePerdida = async (req, res) => {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const { id } = req.params

    // Primero, obtener la información de la pérdida
    const [perdidas] = await connection.query("SELECT * FROM perdidas WHERE id = ?", [id])

    if (perdidas.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Pérdida no encontrada" })
    }

    const perdida = perdidas[0]
    const { producto_id, repuesto_id, cantidad, punto_venta_id } = perdida

    // Determinar si es una pérdida de producto o repuesto
    if (producto_id) {
      // Restaurar el stock del producto
      await connection.query("UPDATE inventario SET stock = stock + ? WHERE producto_id = ? AND punto_venta_id = ?", [
        cantidad,
        producto_id,
        punto_venta_id,
      ])

      // Registrar en log de inventario
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
        ) VALUES (?, ?, ?, 'restauracion_perdida', ?, ?, NOW(), ?)
      `,
        [producto_id, punto_venta_id, cantidad, id, req.user.id, "Eliminación de pérdida"],
      )
    } else if (repuesto_id) {
      // Restaurar el stock del repuesto
      await connection.query("UPDATE inventario_repuestos SET stock = stock + ? WHERE repuesto_id = ? AND punto_venta_id = ?", [
        cantidad,
        repuesto_id,
        punto_venta_id,
      ])

      // Intentar registrar en log de inventario de repuestos
      try {
        await connection.query(
          `
          INSERT INTO log_inventario_repuestos (
            repuesto_id, 
            punto_venta_id, 
            cantidad, 
            tipo_movimiento, 
            referencia_id, 
            usuario_id, 
            fecha, 
            notas
          ) VALUES (?, ?, ?, 'restauracion_perdida', ?, ?, NOW(), ?)
        `,
          [repuesto_id, punto_venta_id, cantidad, id, req.user.id, "Eliminación de pérdida"],
        )
      } catch (error) {
        console.warn("No se pudo registrar en log_inventario_repuestos:", error)
        // Continuar incluso si no existe la tabla de log para repuestos
      }
    }

    // Eliminar la pérdida
    await connection.query("DELETE FROM perdidas WHERE id = ?", [id])

    await connection.commit()
    res.json({ message: "Pérdida eliminada correctamente" })
  } catch (error) {
    await connection.rollback()
    console.error("Error al eliminar pérdida:", error)
    res.status(500).json({ message: "Error al eliminar pérdida" })
  } finally {
    connection.release()
  }
}