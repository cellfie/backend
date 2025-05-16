import { Router } from 'express';
import { check } from 'express-validator';
import { 
    getPuntosVenta, 
    getPuntoVentaById, 
    createPuntoVenta, 
    updatePuntoVenta, 
    deletePuntoVenta,
    getInventarioPorPuntoVenta
} from '../controllers/puntos-venta.controller.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = Router();

// Middleware para verificar token en todas las rutas
router.use(verifyToken());

// Validaciones para crear/actualizar punto de venta
const validatePuntoVenta = [
    check('nombre').notEmpty().withMessage('El nombre es obligatorio'),
];

// Rutas
router.get('/', getPuntosVenta);
router.get('/:id', getPuntoVentaById);
router.get('/:id/inventario', getInventarioPorPuntoVenta);
router.post('/', validatePuntoVenta, createPuntoVenta);
router.put('/:id', validatePuntoVenta, updatePuntoVenta);
router.delete('/:id', deletePuntoVenta);

export default router;