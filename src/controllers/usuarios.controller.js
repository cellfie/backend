import bcrypt from "bcrypt"
import pool from "../db.js"
import { validationResult } from "express-validator"

// Devuelve lista de usuarios (admin)
export const getUsuarios = async (req, res) => {
  try {
    const { activo } = req.query
    const params = []

    let where = "WHERE 1=1"
    if (activo !== undefined && activo !== null && activo !== "" && activo !== "todos") {
      where += " AND activo = ?"
      params.push(Number(activo))
    }

    const [rows] = await pool.query(
      `SELECT id, nombre, rol, activo
       FROM usuarios
       ${where}
       ORDER BY activo DESC, nombre ASC`,
      params,
    )

    res.json(rows)
  } catch (error) {
    console.error("Error en getUsuarios:", error)
    res.status(500).json({ message: "Error al obtener usuarios" })
  }
}

export const createUsuario = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { nombre, password, rol, activo } = req.body

  try {
    const [userByName] = await pool.query("SELECT id FROM usuarios WHERE nombre = ?", [nombre])
    if (userByName.length > 0) {
      return res.status(400).json({ message: "El nombre de usuario ya está registrado" })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const usuarioRol = rol || "empleado"

    const newActivo = activo !== undefined ? (activo ? 1 : 0) : 1

    const [result] = await pool.query(
      "INSERT INTO usuarios (nombre, password, rol, activo) VALUES (?, ?, ?, ?)",
      [nombre, hashedPassword, usuarioRol, newActivo],
    )

    const [rows] = await pool.query("SELECT id, nombre, rol, activo FROM usuarios WHERE id = ?", [result.insertId])
    res.status(201).json(rows[0])
  } catch (error) {
    console.error("Error en createUsuario:", error)
    res.status(500).json({ message: "Error al crear usuario" })
  }
}

export const updateUsuario = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { id } = req.params
  const { nombre, password, rol, activo } = req.body

  try {
    const [users] = await pool.query("SELECT * FROM usuarios WHERE id = ?", [id])
    if (users.length === 0) return res.status(404).json({ message: "Usuario no encontrado" })

    const current = users[0]

    let newNombre = nombre !== undefined ? nombre : current.nombre
    let newRol = rol !== undefined ? rol : current.rol
    let newActivo = activo !== undefined ? (activo ? 1 : 0) : current.activo ?? 1

    if (newNombre !== current.nombre) {
      const [exists] = await pool.query("SELECT id FROM usuarios WHERE nombre = ? AND id <> ?", [
        newNombre,
        id,
      ])
      if (exists.length > 0) {
        return res.status(400).json({ message: "El nombre de usuario ya está en uso" })
      }
    }

    let hashedPassword = null
    if (password !== undefined && String(password).trim().length > 0) {
      hashedPassword = await bcrypt.hash(password, 10)
    }

    // Seguridad: no desactivar el último admin activo
    if (newActivo === 0 && (newRol === "admin" || current.rol === "admin")) {
      const [countAdmins] = await pool.query(
        "SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?",
        [id],
      )
      const total = Number(countAdmins?.[0]?.total || 0)
      if (total === 0) {
        return res.status(400).json({ message: "No podés desactivar el último administrador activo" })
      }
    }

    if (hashedPassword) {
      await pool.query(
        "UPDATE usuarios SET nombre = ?, password = ?, rol = ?, activo = ? WHERE id = ?",
        [newNombre, hashedPassword, newRol, newActivo, id],
      )
    } else {
      await pool.query("UPDATE usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ?", [
        newNombre,
        newRol,
        newActivo,
        id,
      ])
    }

    const [rows] = await pool.query("SELECT id, nombre, rol, activo FROM usuarios WHERE id = ?", [id])
    res.json(rows[0])
  } catch (error) {
    console.error("Error en updateUsuario:", error)
    res.status(500).json({ message: "Error al actualizar usuario" })
  }
}

export const deleteUsuario = async (req, res) => {
  const { id } = req.params

  try {
    // Reutilizamos update lógica: activo=0
    req.body = { ...req.body, activo: 0 }
    req.params = { ...req.params, id }
    // Pasamos por el mismo validador en updateUsuario: para no acoplar, duplicamos en forma segura aquí.

    const [users] = await pool.query("SELECT * FROM usuarios WHERE id = ?", [id])
    if (users.length === 0) return res.status(404).json({ message: "Usuario no encontrado" })

    const current = users[0]

    if ((current.rol || current.rol === "admin") && current.rol === "admin") {
      const [countAdmins] = await pool.query(
        "SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?",
        [id],
      )
      const total = Number(countAdmins?.[0]?.total || 0)
      if (total === 0) {
        return res.status(400).json({ message: "No podés desactivar el último administrador activo" })
      }
    }

    await pool.query("UPDATE usuarios SET activo = 0 WHERE id = ?", [id])

    const [rows] = await pool.query("SELECT id, nombre, rol, activo FROM usuarios WHERE id = ?", [id])
    res.json({ ...rows[0], message: "Usuario desactivado correctamente" })
  } catch (error) {
    console.error("Error en deleteUsuario:", error)
    res.status(500).json({ message: "Error al desactivar usuario" })
  }
}

