import pool from "../../db.js"
import { validationResult } from "express-validator"

// Obtener todas las categorías
export const getCategorias = async (req, res) => {
  try {
    const { incluir_inactivas } = req.query

    let query = `
            SELECT 
                c.*, 
                COUNT(p.id) as productos_count 
            FROM categorias c
            LEFT JOIN productos p ON c.id = p.categoria_id
        `

    // Si no se solicita incluir inactivas, filtrar solo las activas
    if (!incluir_inactivas || incluir_inactivas !== "true") {
      query += " WHERE c.activo = 1"
    }

    query += " GROUP BY c.id ORDER BY c.nombre ASC"

    const [categorias] = await pool.query(query)
    res.json(categorias)
  } catch (error) {
    console.error("Error al obtener categorías:", error)
    res.status(500).json({ message: "Error al obtener categorías" })
  }
}

// Obtener una categoría por ID
export const getCategoriaById = async (req, res) => {
  try {
    const { id } = req.params

    const [categorias] = await pool.query(
      `
            SELECT 
                c.*, 
                COUNT(p.id) as productos_count 
            FROM categorias c
            LEFT JOIN productos p ON c.id = p.categoria_id
            WHERE c.id = ?
            GROUP BY c.id
        `,
      [id],
    )

    if (categorias.length === 0) {
      return res.status(404).json({ message: "Categoría no encontrada" })
    }

    res.json(categorias[0])
  } catch (error) {
    console.error("Error al obtener categoría:", error)
    res.status(500).json({ message: "Error al obtener categoría" })
  }
}

// Crear una nueva categoría
export const createCategoria = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { nombre, descripcion, activo = 1 } = req.body

  try {
    // Verificar si ya existe una categoría con el mismo nombre
    const [existingCategoria] = await pool.query("SELECT * FROM categorias WHERE nombre = ?", [nombre])

    if (existingCategoria.length > 0) {
      return res.status(400).json({ message: "Ya existe una categoría con ese nombre" })
    }

    // Insertar la nueva categoría
    const [result] = await pool.query("INSERT INTO categorias (nombre, descripcion, activo) VALUES (?, ?, ?)", [
      nombre,
      descripcion || null,
      activo,
    ])

    // Obtener la categoría recién creada
    const [nuevaCategoria] = await pool.query("SELECT * FROM categorias WHERE id = ?", [result.insertId])

    res.status(201).json({
      id: result.insertId,
      categoria: nuevaCategoria[0],
      message: "Categoría creada exitosamente",
    })
  } catch (error) {
    console.error("Error al crear categoría:", error)
    res.status(500).json({ message: "Error al crear categoría" })
  }
}

// Actualizar una categoría
export const updateCategoria = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { id } = req.params
  const { nombre, descripcion, activo } = req.body

  try {
    // Verificar si la categoría existe
    const [categorias] = await pool.query("SELECT * FROM categorias WHERE id = ?", [id])

    if (categorias.length === 0) {
      return res.status(404).json({ message: "Categoría no encontrada" })
    }

    // Verificar si ya existe otra categoría con el mismo nombre
    if (nombre && nombre !== categorias[0].nombre) {
      const [existingCategoria] = await pool.query("SELECT * FROM categorias WHERE nombre = ? AND id != ?", [
        nombre,
        id,
      ])

      if (existingCategoria.length > 0) {
        return res.status(400).json({ message: "Ya existe otra categoría con ese nombre" })
      }
    }

    // Actualizar la categoría
    await pool.query("UPDATE categorias SET nombre = ?, descripcion = ?, activo = ? WHERE id = ?", [
      nombre || categorias[0].nombre,
      descripcion !== undefined ? descripcion : categorias[0].descripcion,
      activo !== undefined ? activo : categorias[0].activo,
      id,
    ])

    // Obtener la categoría actualizada
    const [categoriaActualizada] = await pool.query(
      `
            SELECT 
                c.*, 
                COUNT(p.id) as productos_count 
            FROM categorias c
            LEFT JOIN productos p ON c.id = p.categoria_id
            WHERE c.id = ?
            GROUP BY c.id
        `,
      [id],
    )

    res.json({
      message: "Categoría actualizada exitosamente",
      categoria: categoriaActualizada[0],
    })
  } catch (error) {
    console.error("Error al actualizar categoría:", error)
    res.status(500).json({ message: "Error al actualizar categoría" })
  }
}

// Eliminar una categoría (desactivar)
export const deleteCategoria = async (req, res) => {
  const { id } = req.params

  try {
    // Verificar si la categoría existe
    const [categorias] = await pool.query("SELECT * FROM categorias WHERE id = ?", [id])

    if (categorias.length === 0) {
      return res.status(404).json({ message: "Categoría no encontrada" })
    }

    // Verificar si hay productos asociados a esta categoría
    const [productos] = await pool.query("SELECT COUNT(*) as count FROM productos WHERE categoria_id = ?", [id])

    if (productos[0].count > 0) {
      // Si hay productos, desactivar la categoría en lugar de eliminarla
      await pool.query("UPDATE categorias SET activo = 0 WHERE id = ?", [id])
      return res.json({
        message: "Categoría desactivada exitosamente",
        desactivada: true,
      })
    }

    // Si no hay productos, eliminar la categoría
    await pool.query("DELETE FROM categorias WHERE id = ?", [id])

    res.json({
      message: "Categoría eliminada exitosamente",
      eliminada: true,
    })
  } catch (error) {
    console.error("Error al eliminar categoría:", error)
    res.status(500).json({ message: "Error al eliminar categoría" })
  }
}

// Obtener estadísticas de categorías
export const getEstadisticasCategorias = async (req, res) => {
  try {
    // Obtener cantidad de productos por categoría
    const [estadisticas] = await pool.query(`
            SELECT 
                c.id,
                c.nombre,
                c.activo,
                COUNT(p.id) as productos_count,
                SUM(CASE WHEN i.stock > 0 THEN 1 ELSE 0 END) as productos_con_stock
            FROM categorias c
            LEFT JOIN productos p ON c.id = p.categoria_id
            LEFT JOIN inventario i ON p.id = i.producto_id
            GROUP BY c.id
            ORDER BY productos_count DESC
        `)

    // Obtener productos sin categoría
    const [sinCategoria] = await pool.query(`
            SELECT 
                COUNT(p.id) as productos_count,
                SUM(CASE WHEN i.stock > 0 THEN 1 ELSE 0 END) as productos_con_stock
            FROM productos p
            LEFT JOIN inventario i ON p.id = i.producto_id
            WHERE p.categoria_id IS NULL
        `)

    res.json({
      categorias: estadisticas,
      sin_categoria: {
        id: null,
        nombre: "Sin categoría",
        productos_count: sinCategoria[0].productos_count,
        productos_con_stock: sinCategoria[0].productos_con_stock,
      },
    })
  } catch (error) {
    console.error("Error al obtener estadísticas de categorías:", error)
    res.status(500).json({ message: "Error al obtener estadísticas de categorías" })
  }
}
