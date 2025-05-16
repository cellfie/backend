import pool from "../db.js"
import { validationResult } from "express-validator"

// Asegurarnos de que exista el cliente general
const ensureGeneralClient = async () => {
  const [rows] = await pool.query("SELECT id FROM clientes WHERE nombre = 'Cliente General' LIMIT 1")
  if (rows.length === 0) {
    await pool.query("INSERT INTO clientes (nombre, telefono) VALUES ('Cliente General', NULL)")
  }
}

// Obtener todos los clientes
export const getClientes = async (req, res) => {
  try {
    await ensureGeneralClient()
    const [clientes] = await pool.query("SELECT id, nombre, telefono, dni FROM clientes ORDER BY nombre ASC")
    res.json(clientes)
  } catch (error) {
    console.error("Error al obtener clientes:", error)
    res.status(500).json({ message: "Error al obtener clientes" })
  }
}

// Obtener un cliente por ID
export const getClienteById = async (req, res) => {
  try {
    const { id } = req.params
    const [clientes] = await pool.query("SELECT * FROM clientes WHERE id = ?", [id])

    if (clientes.length === 0) {
      return res.status(404).json({ message: "Cliente no encontrado" })
    }

    // Obtener información de cuenta corriente si existe
    const [cuentasCorrientes] = await pool.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ?", [id])

    const cliente = {
      ...clientes[0],
      cuenta_corriente: cuentasCorrientes.length > 0 ? cuentasCorrientes[0] : null,
    }

    res.json(cliente)
  } catch (error) {
    console.error("Error al obtener cliente:", error)
    res.status(500).json({ message: "Error al obtener cliente" })
  }
}

// Buscar clientes por nombre o teléfono
export const searchClientes = async (req, res) => {
  try {
    const { query } = req.query

    if (!query || query.trim() === "") {
      return res.status(400).json({ message: "El término de búsqueda es obligatorio" })
    }

    const searchTerm = `%${query}%`

    const [clientes] = await pool.query(
      `SELECT 
        id, 
        nombre, 
        telefono,
        dni,
        fecha_creacion 
      FROM clientes 
      WHERE nombre LIKE ? OR telefono LIKE ? OR dni LIKE ? 
      ORDER BY nombre ASC 
      LIMIT 10`,
      [searchTerm, searchTerm, searchTerm],
    )

    // Para cada cliente, verificar si tiene cuenta corriente
    for (const cliente of clientes) {
      const [cuentas] = await pool.query(
        "SELECT id, saldo FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
        [cliente.id],
      )

      if (cuentas.length > 0) {
        cliente.cuenta_corriente = {
          id: cuentas[0].id,
          saldo: cuentas[0].saldo,
        }
      }

      // Verificar si tiene reparaciones pendientes
      const [reparaciones] = await pool.query(
        `SELECT COUNT(*) as total 
        FROM reparaciones 
        WHERE cliente_id = ? AND estado IN ('pendiente', 'en_proceso')`,
        [cliente.id],
      )

      cliente.reparaciones_pendientes = reparaciones[0].total
    }

    res.json(clientes)
  } catch (error) {
    console.error("Error al buscar clientes:", error)
    res.status(500).json({ message: "Error al buscar clientes" })
  }
}

// Crear un nuevo cliente
export const createCliente = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  const { nombre, telefono, dni } = req.body
  try {
    const [result] = await pool.query("INSERT INTO clientes (nombre, telefono, dni) VALUES (?, ?, ?)", [
      nombre,
      telefono || null,
      dni || null,
    ])
    res.status(201).json({
      id: result.insertId,
      nombre,
      telefono: telefono || null,
      dni: dni || null,
      message: "Cliente creado exitosamente",
    })
  } catch (error) {
    console.error("Error al crear cliente:", error)
    res.status(500).json({ message: "Error al crear cliente" })
  }
}

// Actualizar un cliente
export const updateCliente = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { id } = req.params
  const { nombre, telefono, dni } = req.body

  try {
    // Verificar si el cliente existe
    const [clientes] = await pool.query("SELECT * FROM clientes WHERE id = ?", [id])

    if (clientes.length === 0) {
      return res.status(404).json({ message: "Cliente no encontrado" })
    }

    // Actualizar el cliente
    await pool.query("UPDATE clientes SET nombre = ?, telefono = ?, dni = ? WHERE id = ?", [
      nombre,
      telefono || null,
      dni || null,
      id,
    ])

    res.json({
      id: Number.parseInt(id),
      nombre,
      telefono,
      dni,
      message: "Cliente actualizado exitosamente",
    })
  } catch (error) {
    console.error("Error al actualizar cliente:", error)
    res.status(500).json({ message: "Error al actualizar cliente" })
  }
}

// Eliminar un cliente
export const deleteCliente = async (req, res) => {
  const { id } = req.params

  try {
    // Verificar si el cliente existe
    const [clientes] = await pool.query("SELECT * FROM clientes WHERE id = ?", [id])

    if (clientes.length === 0) {
      return res.status(404).json({ message: "Cliente no encontrado" })
    }

    // Verificar si el cliente tiene ventas asociadas
    const [ventas] = await pool.query("SELECT COUNT(*) as count FROM ventas WHERE cliente_id = ?", [id])

    if (ventas[0].count > 0) {
      return res.status(400).json({
        message: "No se puede eliminar el cliente porque tiene ventas asociadas",
      })
    }

    // Eliminar el cliente
    await pool.query("DELETE FROM clientes WHERE id = ?", [id])

    res.json({ message: "Cliente eliminado exitosamente" })
  } catch (error) {
    console.error("Error al eliminar cliente:", error)
    res.status(500).json({ message: "Error al eliminar cliente" })
  }
}

// Obtener cliente por ID con sus reparaciones
export const getClienteWithReparaciones = async (req, res) => {
  try {
    const { id } = req.params

    // Obtener información del cliente
    const [clientes] = await pool.query("SELECT id, nombre, telefono, fecha_creacion FROM clientes WHERE id = ?", [id])

    if (clientes.length === 0) {
      return res.status(404).json({ message: "Cliente no encontrado" })
    }

    const cliente = clientes[0]

    // Verificar si tiene cuenta corriente
    const [cuentas] = await pool.query(
      "SELECT id, saldo, limite_credito FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
      [id],
    )

    if (cuentas.length > 0) {
      cliente.cuenta_corriente = {
        id: cuentas[0].id,
        saldo: cuentas[0].saldo,
        limite_credito: cuentas[0].limite_credito,
      }
    }

    // Obtener reparaciones del cliente
    const [reparaciones] = await pool.query(
      `SELECT 
            r.id, 
            r.numero_ticket, 
            r.fecha_ingreso, 
            r.estado,
            er.marca,
            er.modelo
        FROM reparaciones r
        LEFT JOIN equipos_reparacion er ON r.id = er.reparacion_id
        WHERE r.cliente_id = ?
        ORDER BY r.fecha_ingreso DESC
        LIMIT 10`,
      [id],
    )

    cliente.reparaciones = reparaciones

    res.json(cliente)
  } catch (error) {
    console.error("Error al obtener cliente con reparaciones:", error)
    res.status(500).json({ message: "Error al obtener cliente con reparaciones" })
  }
}
