import pool from "../db.js"
import { validationResult } from "express-validator"

// Obtener todos los proveedores
export const getProveedores = async (req, res) => {
  try {
    const [proveedores] = await pool.query(
      `SELECT id, nombre, telefono, email, cuit, contacto, activo 
       FROM proveedores 
       ORDER BY nombre ASC`,
    )
    res.json(proveedores)
  } catch (error) {
    console.error("Error al obtener proveedores:", error)
    res.status(500).json({ message: "Error al obtener proveedores" })
  }
}

// Obtener un proveedor por ID
export const getProveedorById = async (req, res) => {
  try {
    const { id } = req.params
    const [proveedores] = await pool.query("SELECT * FROM proveedores WHERE id = ?", [id])

    if (proveedores.length === 0) {
      return res.status(404).json({ message: "Proveedor no encontrado" })
    }

    res.json(proveedores[0])
  } catch (error) {
    console.error("Error al obtener proveedor:", error)
    res.status(500).json({ message: "Error al obtener proveedor" })
  }
}

// Buscar proveedores por nombre, teléfono, email o CUIT
export const searchProveedores = async (req, res) => {
  try {
    const { query } = req.query

    if (!query || query.trim() === "") {
      return res.status(400).json({ message: "El término de búsqueda es obligatorio" })
    }

    const searchTerm = `%${query}%`

    const [proveedores] = await pool.query(
      `SELECT 
        id,
        nombre,
        telefono,
        email,
        cuit,
        contacto,
        fecha_creacion,
        activo
      FROM proveedores
      WHERE nombre LIKE ? 
        OR telefono LIKE ? 
        OR email LIKE ? 
        OR cuit LIKE ?
      ORDER BY nombre ASC
      LIMIT 20`,
      [searchTerm, searchTerm, searchTerm, searchTerm],
    )

    res.json(proveedores)
  } catch (error) {
    console.error("Error al buscar proveedores:", error)
    res.status(500).json({ message: "Error al buscar proveedores" })
  }
}

// Crear un nuevo proveedor
export const createProveedor = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { nombre, telefono, email, cuit, direccion, contacto, notas } = req.body

  try {
    const [result] = await pool.query(
      `INSERT INTO proveedores (nombre, telefono, email, cuit, direccion, contacto, notas) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nombre, telefono || null, email || null, cuit || null, direccion || null, contacto || null, notas || null],
    )

    res.status(201).json({
      id: result.insertId,
      nombre,
      telefono: telefono || null,
      email: email || null,
      cuit: cuit || null,
      direccion: direccion || null,
      contacto: contacto || null,
      notas: notas || null,
      activo: 1,
      message: "Proveedor creado exitosamente",
    })
  } catch (error) {
    console.error("Error al crear proveedor:", error)
    res.status(500).json({ message: "Error al crear proveedor" })
  }
}

// Actualizar un proveedor
export const updateProveedor = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { id } = req.params
  const { nombre, telefono, email, cuit, direccion, contacto, notas, activo } = req.body

  try {
    const [proveedores] = await pool.query("SELECT * FROM proveedores WHERE id = ?", [id])

    if (proveedores.length === 0) {
      return res.status(404).json({ message: "Proveedor no encontrado" })
    }

    await pool.query(
      `UPDATE proveedores 
       SET nombre = ?, telefono = ?, email = ?, cuit = ?, direccion = ?, contacto = ?, notas = ?, activo = ? 
       WHERE id = ?`,
      [
        nombre,
        telefono || null,
        email || null,
        cuit || null,
        direccion || null,
        contacto || null,
        notas || null,
        activo !== undefined ? (activo ? 1 : 0) : proveedores[0].activo,
        id,
      ],
    )

    res.json({
      id: Number.parseInt(id),
      nombre,
      telefono: telefono || null,
      email: email || null,
      cuit: cuit || null,
      direccion: direccion || null,
      contacto: contacto || null,
      notas: notas || null,
      activo: activo !== undefined ? (activo ? 1 : 0) : proveedores[0].activo,
      message: "Proveedor actualizado exitosamente",
    })
  } catch (error) {
    console.error("Error al actualizar proveedor:", error)
    res.status(500).json({ message: "Error al actualizar proveedor" })
  }
}

// Eliminar un proveedor
export const deleteProveedor = async (req, res) => {
  const { id } = req.params

  try {
    const [proveedores] = await pool.query("SELECT * FROM proveedores WHERE id = ?", [id])

    if (proveedores.length === 0) {
      return res.status(404).json({ message: "Proveedor no encontrado" })
    }

    // En esta etapa no validamos compras asociadas
    await pool.query("DELETE FROM proveedores WHERE id = ?", [id])

    res.json({ message: "Proveedor eliminado exitosamente" })
  } catch (error) {
    console.error("Error al eliminar proveedor:", error)
    res.status(500).json({ message: "Error al eliminar proveedor" })
  }
}

