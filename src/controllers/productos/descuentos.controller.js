import pool from '../../db.js';
import { validationResult } from 'express-validator';

// Obtener todos los descuentos
export const getDescuentos = async (req, res) => {
    try {
        const [descuentos] = await pool.query(`
            SELECT 
                d.id,
                d.producto_id,
                d.porcentaje,
                d.fecha_inicio,
                d.fecha_fin,
                d.activo,
                p.codigo AS producto_codigo,
                p.nombre AS producto_nombre,
                p.precio AS producto_precio
            FROM descuentos d
            JOIN productos p ON d.producto_id = p.id
            ORDER BY d.fecha_creacion DESC
        `);
        
        res.json(descuentos);
    } catch (error) {
        console.error('Error al obtener descuentos:', error);
        res.status(500).json({ message: 'Error al obtener descuentos' });
    }
};

// Obtener descuentos activos
export const getDescuentosActivos = async (req, res) => {
    try {
        const [descuentos] = await pool.query(`
            SELECT 
                d.id,
                d.producto_id,
                d.porcentaje,
                d.fecha_inicio,
                d.fecha_fin,
                p.codigo AS producto_codigo,
                p.nombre AS producto_nombre,
                p.precio AS producto_precio,
                (p.precio * (1 - d.porcentaje / 100)) AS precio_con_descuento
            FROM descuentos d
            JOIN productos p ON d.producto_id = p.id
            WHERE d.activo = 1
            AND d.fecha_inicio <= CURDATE()
            AND d.fecha_fin >= CURDATE()
            ORDER BY d.fecha_creacion DESC
        `);
        
        res.json(descuentos);
    } catch (error) {
        console.error('Error al obtener descuentos activos:', error);
        res.status(500).json({ message: 'Error al obtener descuentos activos' });
    }
};

// Obtener descuentos por producto
export const getDescuentosByProducto = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar si el producto existe
        const [productos] = await pool.query('SELECT * FROM productos WHERE id = ?', [id]);
        
        if (productos.length === 0) {
            return res.status(404).json({ message: 'Producto no encontrado' });
        }
        
        // Obtener los descuentos del producto
        const [descuentos] = await pool.query(`
            SELECT 
                id,
                porcentaje,
                fecha_inicio,
                fecha_fin,
                activo
            FROM descuentos
            WHERE producto_id = ?
            ORDER BY fecha_creacion DESC
        `, [id]);
        
        res.json(descuentos);
    } catch (error) {
        console.error('Error al obtener descuentos por producto:', error);
        res.status(500).json({ message: 'Error al obtener descuentos por producto' });
    }
};

// Crear un nuevo descuento
export const createDescuento = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { producto_id, porcentaje, fecha_inicio, fecha_fin } = req.body;

    try {
        // Verificar si el producto existe
        const [productos] = await pool.query('SELECT * FROM productos WHERE id = ?', [producto_id]);
        
        if (productos.length === 0) {
            return res.status(404).json({ message: 'Producto no encontrado' });
        }
        
        // Validar el porcentaje
        if (porcentaje <= 0 || porcentaje > 100) {
            return res.status(400).json({ message: 'El porcentaje debe estar entre 1 y 100' });
        }
        
        // Validar las fechas
        const fechaInicio = new Date(fecha_inicio);
        const fechaFin = new Date(fecha_fin);
        
        if (isNaN(fechaInicio.getTime()) || isNaN(fechaFin.getTime())) {
            return res.status(400).json({ message: 'Fechas inválidas' });
        }
        
        if (fechaInicio > fechaFin) {
            return res.status(400).json({ message: 'La fecha de inicio debe ser anterior a la fecha de fin' });
        }
        
        // Desactivar descuentos activos existentes para este producto
        await pool.query(
            'UPDATE descuentos SET activo = 0 WHERE producto_id = ? AND activo = 1',
            [producto_id]
        );
        
        // Insertar el nuevo descuento
        const [result] = await pool.query(
            'INSERT INTO descuentos (producto_id, porcentaje, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?)',
            [producto_id, porcentaje, fecha_inicio, fecha_fin]
        );
        
        res.status(201).json({ 
            id: result.insertId,
            message: 'Descuento creado exitosamente' 
        });
    } catch (error) {
        console.error('Error al crear descuento:', error);
        res.status(500).json({ message: 'Error al crear descuento' });
    }
};

// Actualizar un descuento
export const updateDescuento = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { porcentaje, fecha_inicio, fecha_fin, activo } = req.body;

    try {
        // Verificar si el descuento existe
        const [descuentos] = await pool.query('SELECT * FROM descuentos WHERE id = ?', [id]);
        
        if (descuentos.length === 0) {
            return res.status(404).json({ message: 'Descuento no encontrado' });
        }
        
        // Validar el porcentaje
        if (porcentaje && (porcentaje <= 0 || porcentaje > 100)) {
            return res.status(400).json({ message: 'El porcentaje debe estar entre 1 y 100' });
        }
        
        // Validar las fechas
        let fechaInicio = fecha_inicio ? new Date(fecha_inicio) : new Date(descuentos[0].fecha_inicio);
        let fechaFin = fecha_fin ? new Date(fecha_fin) : new Date(descuentos[0].fecha_fin);
        
        if (isNaN(fechaInicio.getTime()) || isNaN(fechaFin.getTime())) {
            return res.status(400).json({ message: 'Fechas inválidas' });
        }
        
        if (fechaInicio > fechaFin) {
            return res.status(400).json({ message: 'La fecha de inicio debe ser anterior a la fecha de fin' });
        }
        
        // Actualizar el descuento
        await pool.query(
            'UPDATE descuentos SET porcentaje = ?, fecha_inicio = ?, fecha_fin = ?, activo = ? WHERE id = ?',
            [
                porcentaje || descuentos[0].porcentaje, 
                fecha_inicio || descuentos[0].fecha_inicio, 
                fecha_fin || descuentos[0].fecha_fin, 
                activo !== undefined ? activo : descuentos[0].activo, 
                id
            ]
        );
        
        res.json({ message: 'Descuento actualizado exitosamente' });
    } catch (error) {
        console.error('Error al actualizar descuento:', error);
        res.status(500).json({ message: 'Error al actualizar descuento' });
    }
};

// Eliminar un descuento
export const deleteDescuento = async (req, res) => {
    const { id } = req.params;

    try {
        // Verificar si el descuento existe
        const [descuentos] = await pool.query('SELECT * FROM descuentos WHERE id = ?', [id]);
        
        if (descuentos.length === 0) {
            return res.status(404).json({ message: 'Descuento no encontrado' });
        }
        
        // Eliminar el descuento
        await pool.query('DELETE FROM descuentos WHERE id = ?', [id]);
        
        res.json({ message: 'Descuento eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar descuento:', error);
        res.status(500).json({ message: 'Error al eliminar descuento' });
    }
};

// Desactivar todos los descuentos de un producto
export const desactivarDescuentosProducto = async (req, res) => {
    const { id } = req.params;

    try {
        // Verificar si el producto existe
        const [productos] = await pool.query('SELECT * FROM productos WHERE id = ?', [id]);
        
        if (productos.length === 0) {
            return res.status(404).json({ message: 'Producto no encontrado' });
        }
        
        // Desactivar todos los descuentos del producto
        await pool.query('UPDATE descuentos SET activo = 0 WHERE producto_id = ?', [id]);
        
        res.json({ message: 'Descuentos desactivados exitosamente' });
    } catch (error) {
        console.error('Error al desactivar descuentos:', error);
        res.status(500).json({ message: 'Error al desactivar descuentos' });
    }
};