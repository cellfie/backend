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

// Obtener estado de cuenta corriente de un proveedor
export const getCuentaCorrienteProveedor = async (req, res) => {
  try {
    const { id } = req.params
    const proveedorId = Number(id)
    if (!proveedorId || Number.isNaN(proveedorId)) {
      return res.status(400).json({ message: "ID de proveedor inválido" })
    }

    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores WHERE id = ?", [proveedorId])
    if (proveedores.length === 0) {
      return res.status(404).json({ message: "Proveedor no encontrado" })
    }

    const [cuentas] = await pool.query(
      "SELECT id, saldo, fecha_ultimo_movimiento, fecha_creacion FROM cuentas_corrientes_proveedores WHERE proveedor_id = ? LIMIT 1",
      [proveedorId],
    )

    const cuenta = cuentas[0] || {
      id: null,
      saldo: 0,
      fecha_ultimo_movimiento: null,
      fecha_creacion: null,
    }

    const [movimientos] = await pool.query(
      `SELECT
        id,
        compra_id,
        pago_id,
        tipo,
        monto,
        saldo_anterior,
        saldo_nuevo,
        notas,
        fecha,
        usuario_id
      FROM movimientos_cuenta_corriente_proveedor
      WHERE proveedor_id = ?
      ORDER BY fecha DESC, id DESC
      LIMIT 200`,
      [proveedorId],
    )

    res.json({
      proveedor: proveedores[0],
      cuenta_corriente: cuenta,
      movimientos,
    })
  } catch (error) {
    console.error("Error al obtener cuenta corriente de proveedor:", error)
    res.status(500).json({ message: "Error al obtener cuenta corriente del proveedor" })
  }
}

// Registrar pago de deuda a proveedor (disminuye saldo)
export const registrarPagoCuentaCorrienteProveedor = async (req, res) => {
  const { id } = req.params
  const { monto, punto_venta_id, notas, compra_id } = req.body
  const proveedorId = Number(id)

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Usuario no autenticado" })
  }

  const montoNumerico = Number(monto)
  if (!proveedorId || Number.isNaN(proveedorId)) {
    return res.status(400).json({ message: "ID de proveedor inválido" })
  }
  if (!Number.isFinite(montoNumerico) || montoNumerico <= 0) {
    return res.status(400).json({ message: "El monto debe ser mayor a cero" })
  }
  if (!punto_venta_id || Number.isNaN(Number(punto_venta_id))) {
    return res.status(400).json({ message: "punto_venta_id es obligatorio" })
  }
  if (!compra_id || Number.isNaN(Number(compra_id))) {
    return res.status(400).json({ message: "compra_id es obligatorio para imputar el pago" })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const [proveedores] = await connection.query("SELECT id, nombre FROM proveedores WHERE id = ? LIMIT 1", [proveedorId])
    if (proveedores.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Proveedor no encontrado" })
    }

    const [cuentas] = await connection.query(
      "SELECT id, saldo FROM cuentas_corrientes_proveedores WHERE proveedor_id = ? LIMIT 1",
      [proveedorId],
    )
    if (cuentas.length === 0) {
      await connection.rollback()
      return res.status(400).json({ message: "El proveedor no tiene deuda registrada" })
    }

    const [compras] = await connection.query("SELECT id, proveedor_id FROM compras WHERE id = ? LIMIT 1", [Number(compra_id)])
    if (compras.length === 0 || Number(compras[0].proveedor_id) !== proveedorId) {
      await connection.rollback()
      return res.status(400).json({ message: "La compra indicada no pertenece al proveedor seleccionado" })
    }

    const cuenta = cuentas[0]
    const saldoAnterior = Number(cuenta.saldo) || 0
    const saldoNuevo = saldoAnterior - montoNumerico

    await connection.query("UPDATE cuentas_corrientes_proveedores SET saldo = ?, fecha_ultimo_movimiento = NOW() WHERE id = ?", [
      saldoNuevo,
      cuenta.id,
    ])

    const [movResult] = await connection.query(
      `INSERT INTO movimientos_cuenta_corriente_proveedor (
        cuenta_corriente_proveedor_id,
        proveedor_id,
        compra_id,
        pago_id,
        tipo,
        monto,
        saldo_anterior,
        saldo_nuevo,
        usuario_id,
        notas,
        fecha
      ) VALUES (?, ?, ?, NULL, 'pago', ?, ?, ?, ?, ?, NOW())`,
      [
        cuenta.id,
        proveedorId,
        Number(compra_id),
        montoNumerico,
        saldoAnterior,
        saldoNuevo,
        req.user.id,
        notas || "Pago de deuda a proveedor",
      ],
    )

    const [pagoResult] = await connection.query(
      `INSERT INTO pagos (
        monto, tipo_pago, referencia_id, tipo_referencia,
        cliente_id, usuario_id, punto_venta_id, notas, fecha, caja_sesion_id
      ) VALUES (?, ?, ?, 'compra', NULL, ?, ?, ?, NOW(), NULL)`,
      [
        montoNumerico,
        "Pago cuenta corriente proveedor",
        Number(compra_id),
        req.user.id,
        Number(punto_venta_id),
        notas || `Pago de deuda a proveedor ${proveedores[0].nombre}`,
      ],
    )

    await connection.query(
      "UPDATE movimientos_cuenta_corriente_proveedor SET pago_id = ? WHERE id = ?",
      [pagoResult.insertId, movResult.insertId],
    )

    await connection.commit()

    res.status(201).json({
      message: "Pago de cuenta corriente del proveedor registrado",
      saldo_anterior: saldoAnterior,
      saldo_nuevo: saldoNuevo,
      pago_id: pagoResult.insertId,
      movimiento_id: movResult.insertId,
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al registrar pago de cuenta corriente proveedor:", error)
    res.status(500).json({ message: "Error al registrar pago de cuenta corriente proveedor" })
  } finally {
    connection.release()
  }
}

