import pool from '../db.js';
import { validationResult } from 'express-validator';

// Obtener todos los puntos de venta
export const getPuntosVenta = async (req, res) => {
    try {
        const [puntosVenta] = await pool.query(
            'SELECT * FROM puntos_venta ORDER BY nombre ASC'
        );
        res.json(puntosVenta);
    } catch (error) {
        console.error('Error al obtener puntos de venta:', error);
        res.status(500).json({ message: 'Error al obtener puntos de venta' });
    }
};

// Obtener un punto de venta por ID
export const getPuntoVentaById = async (req, res) => {
    try {
        const { id } = req.params;
        const [puntosVenta] = await pool.query('SELECT * FROM puntos_venta WHERE id = ?', [id]);
        
        if (puntosVenta.length === 0) {
            return res.status(404).json({ message: 'Punto de venta no encontrado' });
        }
        
        res.json(puntosVenta[0]);
    } catch (error) {
        console.error('Error al obtener punto de venta:', error);
        res.status(500).json({ message: 'Error al obtener punto de venta' });
    }
};

// Crear un nuevo punto de venta
export const createPuntoVenta = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { nombre, direccion } = req.body;

    try {
        // Verificar si ya existe un punto de venta con el mismo nombre
        const [existingPuntoVenta] = await pool.query('SELECT * FROM puntos_venta WHERE nombre = ?', [nombre]);
        
        if (existingPuntoVenta.length > 0) {
            return res.status(400).json({ message: 'Ya existe un punto de venta con ese nombre' });
        }
        
        // Insertar el nuevo punto de venta
        const [result] = await pool.query(
            'INSERT INTO puntos_venta (nombre, direccion) VALUES (?, ?)',
            [nombre, direccion || null]
        );
        
        res.status(201).json({ 
            id: result.insertId,
            message: 'Punto de venta creado exitosamente' 
        });
    } catch (error) {
        console.error('Error al crear punto de venta:', error);
        res.status(500).json({ message: 'Error al crear punto de venta' });
    }
};

// Actualizar un punto de venta
export const updatePuntoVenta = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { nombre, direccion } = req.body;

    try {
        // Verificar si el punto de venta existe
        const [puntosVenta] = await pool.query('SELECT * FROM puntos_venta WHERE id = ?', [id]);
        
        if (puntosVenta.length === 0) {
            return res.status(404).json({ message: 'Punto de venta no encontrado' });
        }
        
        // Verificar si ya existe otro punto de venta con el mismo nombre
        if (nombre) {
            const [existingPuntoVenta] = await pool.query(
                'SELECT * FROM puntos_venta WHERE nombre = ? AND id != ?', 
                [nombre, id]
            );
            
            if (existingPuntoVenta.length > 0) {
                return res.status(400).json({ message: 'Ya existe otro punto de venta con ese nombre' });
            }
        }
        
        // Actualizar el punto de venta
        await pool.query(
            'UPDATE puntos_venta SET nombre = ?, direccion = ? WHERE id = ?',
            [
                nombre || puntosVenta[0].nombre, 
                direccion !== undefined ? direccion : puntosVenta[0].direccion, 
                id
            ]
        );
        
        res.json({ message: 'Punto de venta actualizado exitosamente' });
    } catch (error) {
        console.error('Error al actualizar punto de venta:', error);
        res.status(500).json({ message: 'Error al actualizar punto de venta' });
    }
};

// Eliminar un punto de venta
export const deletePuntoVenta = async (req, res) => {
    const { id } = req.params;

    try {
        // Verificar si el punto de venta existe
        const [puntosVenta] = await pool.query('SELECT * FROM puntos_venta WHERE id = ?', [id]);
        
        if (puntosVenta.length === 0) {
            return res.status(404).json({ message: 'Punto de venta no encontrado' });
        }
        
        // Verificar si hay inventario asociado a este punto de venta
        const [inventario] = await pool.query('SELECT COUNT(*) as count FROM inventario WHERE punto_venta_id = ?', [id]);
        
        if (inventario[0].count > 0) {
            return res.status(400).json({ 
                message: 'No se puede eliminar el punto de venta porque tiene inventario asociado' 
            });
        }
        
        // Eliminar el punto de venta
        await pool.query('DELETE FROM puntos_venta WHERE id = ?', [id]);
        
        res.json({ message: 'Punto de venta eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar punto de venta:', error);
        res.status(500).json({ message: 'Error al eliminar punto de venta' });
    }
};

// Obtener inventario por punto de venta
export const getInventarioPorPuntoVenta = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar si el punto de venta existe
        const [puntosVenta] = await pool.query('SELECT * FROM puntos_venta WHERE id = ?', [id]);
        
        if (puntosVenta.length === 0) {
            return res.status(404).json({ message: 'Punto de venta no encontrado' });
        }
        
        // Obtener el inventario del punto de venta
        const [inventario] = await pool.query(`
            SELECT 
                i.producto_id,
                i.stock,
                p.codigo,
                p.nombre,
                p.descripcion,
                p.precio,
                c.nombre AS categoria
            FROM inventario i
            JOIN productos p ON i.producto_id = p.id
            LEFT JOIN categorias c ON p.categoria_id = c.id
            WHERE i.punto_venta_id = ?
            ORDER BY p.nombre ASC
        `, [id]);
        
        res.json(inventario);
    } catch (error) {
        console.error('Error al obtener inventario por punto de venta:', error);
        res.status(500).json({ message: 'Error al obtener inventario por punto de venta' });
    }
};