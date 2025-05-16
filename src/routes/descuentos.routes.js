import { Router } from 'express';
import { check } from 'express-validator';
import { 
    getDescuentos, 
    getDescuentosActivos,
    getDescuentosByProducto, 
    createDescuento, 
    updateDescuento, 
    deleteDescuento,
    desactivarDescuentosProducto
} from '../controllers/productos/descuentos.controller.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = Router();

// Middleware para verificar token en todas las rutas
router.use(verifyToken());

// Validaciones para crear/actualizar descuento
const validateDescuento = [
    check('producto_id').isNumeric().withMessage('ID de producto inválido'),
    check('porcentaje').isNumeric().withMessage('El porcentaje debe ser un número')
        .custom(value => value > 0 && value <= 100).withMessage('El porcentaje debe estar entre 1 y 100'),
    check('fecha_inicio').isDate().withMessage('Fecha de inicio inválida'),
    check('fecha_fin').isDate().withMessage('Fecha de fin inválida')
        .custom((value, { req }) => new Date(value) >= new Date(req.body.fecha_inicio))
        .withMessage('La fecha de fin debe ser posterior a la fecha de inicio'),
];

// Rutas
router.get('/', getDescuentos);
router.get('/activos', getDescuentosActivos);
router.get('/producto/:id', getDescuentosByProducto);
router.post('/', validateDescuento, createDescuento);
router.put('/:id', updateDescuento);
router.delete('/:id', deleteDescuento);
router.put('/producto/:id/desactivar', desactivarDescuentosProducto);

export default router;