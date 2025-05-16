import { Router } from 'express';
import { check } from 'express-validator';
import { 
    getProductos, 
    getProductoById, 
    createProducto, 
    updateProducto, 
    deleteProducto,
    searchProductos
} from '../controllers/productos/producto.controller.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = Router();

// Middleware para verificar token en todas las rutas
router.use(verifyToken());

// Validaciones para crear/actualizar producto
const validateProducto = [
    check('codigo').notEmpty().withMessage('El código es obligatorio'),
    check('nombre').notEmpty().withMessage('El nombre es obligatorio'),
    check('precio').isNumeric().withMessage('El precio debe ser un número')
        .custom(value => value > 0).withMessage('El precio debe ser mayor a cero'),
];

// Rutas
router.get('/', getProductos);
router.get('/search', searchProductos);
router.get('/:id', getProductoById);
router.post('/', validateProducto, createProducto);
router.put('/:id', validateProducto, updateProducto);
router.delete('/:id', deleteProducto);

export default router;