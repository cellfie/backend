import { Router } from 'express';
import { check } from 'express-validator';
import { 
    getCuentasCorrientes, 
    getCuentaCorrienteByCliente, 
    createOrUpdateCuentaCorriente, 
    registrarPago,
    getMovimientosCuentaCorriente
} from '../controllers/cuenta-corriente.controller.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = Router();

// Middleware para verificar token en todas las rutas
router.use(verifyToken());

// Validaciones para crear/actualizar cuenta corriente
const validateCuentaCorriente = [
    check('cliente_id').isNumeric().withMessage('ID de cliente inválido'),
];

// Validaciones para registrar pago
const validatePago = [
    check('cliente_id').isNumeric().withMessage('ID de cliente inválido'),
    check('monto').isNumeric().withMessage('El monto debe ser un número')
        .custom(value => value > 0).withMessage('El monto debe ser mayor a cero'),
];

// Rutas
router.get('/',verifyToken(['admin', 'empleado']), getCuentasCorrientes);
router.get('/cliente/:cliente_id',verifyToken(['admin', 'empleado']), getCuentaCorrienteByCliente);
router.get('/:cuenta_id/movimientos',verifyToken(['admin', 'empleado']), getMovimientosCuentaCorriente);
router.post('/', validateCuentaCorriente,verifyToken(['admin', 'empleado']), createOrUpdateCuentaCorriente);
router.post('/pago', validatePago,verifyToken(['admin', 'empleado']), registrarPago);

export default router;