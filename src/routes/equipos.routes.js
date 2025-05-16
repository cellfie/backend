import { Router } from 'express';
import { check } from 'express-validator';
import { 
    getEquipos, 
    getEquipoById, 
    createEquipo, 
    updateEquipo, 
    deleteEquipo,
    searchEquipos
} from '../controllers/equipos/equipo.controller.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = Router();

// Middleware para verificar token en todas las rutas
router.use(verifyToken());

// Validaciones para crear/actualizar equipo
const validateEquipo = [
    check('marca').notEmpty().withMessage('La marca es obligatoria'),
    check('modelo').notEmpty().withMessage('El modelo es obligatorio'),
    check('imei').notEmpty().withMessage('El IMEI es obligatorio'),
    check('precio').isNumeric().withMessage('El precio debe ser un número')
        .custom(value => value > 0).withMessage('El precio debe ser mayor a cero'),
    check('fecha_ingreso').notEmpty().withMessage('La fecha de ingreso es obligatoria'),
    check('punto_venta_id').isNumeric().withMessage('ID de punto de venta inválido')
];

// Rutas
router.get('/', getEquipos);
router.get('/search', searchEquipos);
router.get('/:id', getEquipoById);
router.post('/', validateEquipo, createEquipo);
router.put('/:id', validateEquipo, updateEquipo);
router.delete('/:id', deleteEquipo);

export default router;