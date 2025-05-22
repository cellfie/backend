import { Router } from 'express';
import { getTipoCambio, setTipoCambio } from '../controllers/tipoCambio.controller.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { check } from 'express-validator';

const router = Router();

// Middleware para verificar token en todas las rutas
router.use(verifyToken());

// Validaciones para actualizar tipo de cambio
const validateTipoCambio = [
    check('valor').isNumeric().withMessage('El valor debe ser un número')
        .custom(value => value > 0).withMessage('El valor debe ser mayor a cero'),
    check('notas').optional().isString().withMessage('Las notas deben ser texto')
];

// Rutas
router.get('/', getTipoCambio);
router.put('/', validateTipoCambio, setTipoCambio);

export default router;