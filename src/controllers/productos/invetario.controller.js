import pool from '../../db.js';
import { validationResult } from 'express-validator';

// Obtener todo el inventario
export const getInventario = async (req, res) => {
    try {
        const [inventario] = await pool.query(`
            SELECT 
                i.producto_id,
                i.punto_venta_id,
                i.stock,
                p.codigo,
                p.nombre AS producto_nombre,
                p.precio,
                pv.nombre AS punto_venta_nombre
            FROM inventario i
            JOIN productos p ON i.producto_id = p.id
            JOIN puntos_venta pv ON i.punto_venta_id = pv.id
            ORDER BY p.nombre ASC
        `);
        
        res.json(inventario);
    } catch (error) {
        console.error('Error al obtener inventario:', error);
        res.status(500).json({ message: 'Error al obtener inventario' });
    }
};

// Obtener inventario por producto
export const getInventarioByProducto = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar si el producto existe
        const [productos] = await pool.query('SELECT * FROM productos WHERE id = ?', [id]);
        
        if (productos.length === 0) {
            return res.status(404).json({ message: 'Producto no encontrado' });
        }
        
        // Obtener el inventario del producto
        const [inventario] = await pool.query(`
            SELECT 
                i.punto_venta_id,
                i.stock,
                pv.nombre AS punto_venta_nombre
            FROM inventario i
            JOIN puntos_venta pv ON i.punto_venta_id = pv.id
            WHERE i.producto_id = ?
        `, [id]);
        
        res.json(inventario);
    } catch (error) {
        console.error('Error al obtener inventario por producto:', error);
        res.status(500).json({ message: 'Error al obtener inventario por producto' });
    }
};

// Actualizar inventario
export const updateInventario = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { producto_id, punto_venta_id, stock } = req.body;

    try {
        // Verificar si el producto existe
        const [productos] = await pool.query('SELECT * FROM productos WHERE id = ?', [producto_id]);
        
        if (productos.length === 0) {
            return res.status(404).json({ message: 'Producto no encontrado' });
        }
        
        // Verificar si el punto de venta existe
        const [puntosVenta] = await pool.query('SELECT * FROM puntos_venta WHERE id = ?', [punto_venta_id]);
        
        if (puntosVenta.length === 0) {
            return res.status(404).json({ message: 'Punto de venta no encontrado' });
        }
        
        // Verificar si ya existe un registro de inventario para este producto y punto de venta
        const [inventario] = await pool.query(
            'SELECT * FROM inventario WHERE producto_id = ? AND punto_venta_id = ?',
            [producto_id, punto_venta_id]
        );
        
        if (inventario.length > 0) {
            // Actualizar el inventario existente
            await pool.query(
                'UPDATE inventario SET stock = ? WHERE producto_id = ? AND punto_venta_id = ?',
                [stock, producto_id, punto_venta_id]
            );
        } else {
            // Crear un nuevo registro de inventario
            await pool.query(
                'INSERT INTO inventario (producto_id, punto_venta_id, stock) VALUES (?, ?, ?)',
                [producto_id, punto_venta_id, stock]
            );
        }
        
        res.json({ message: 'Inventario actualizado exitosamente' });
    } catch (error) {
        console.error('Error al actualizar inventario:', error);
        res.status(500).json({ message: 'Error al actualizar inventario' });
    }
};
