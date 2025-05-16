import { Router } from 'express';
import { check } from 'express-validator';
import { 
    getInventario, 
    getInventarioByProducto, 
    updateInventario,
} from '../controllers/productos/invetario.controller.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = Router();

// Middleware para verificar token en todas las rutas
router.use(verifyToken());

// Validaciones para actualizar inventario
const validateInventario = [
    check('producto_id').isNumeric().withMessage('ID de producto inválido'),
    check('punto_venta_id').isNumeric().withMessage('ID de punto de venta inválido'),
    check('stock').isNumeric().withMessage('El stock debe ser un número')
        .custom(value => value >= 0).withMessage('El stock no puede ser negativo'),
];

// Validaciones para transferir inventario
const validateTransferencia = [
    check('producto_id').isNumeric().withMessage('ID de producto inválido'),
    check('origen_id').isNumeric().withMessage('ID de punto de venta origen inválido'),
    check('destino_id').isNumeric().withMessage('ID de punto de venta destino inválido'),
    check('cantidad').isNumeric().withMessage('La cantidad debe ser un número')
        .custom(value => value > 0).withMessage('La cantidad debe ser mayor a cero'),
];

// Rutas
router.get('/', getInventario);
router.get('/producto/:id', getInventarioByProducto);
router.post('/actualizar', validateInventario, updateInventario);

export default router;