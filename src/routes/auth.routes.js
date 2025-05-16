import { Router } from 'express';
import { check } from 'express-validator';
import { register, login, logout } from '../controllers/auth.controllers.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = Router();

// Validación de datos para el registro
const validateRegisterSchema = [
    check('nombre').notEmpty().withMessage('El nombre es obligatorio'),
    check('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
];

// Validación de datos para el login
const validateLoginSchema = [
    check('nombre').notEmpty().withMessage('Debe ser un nombre de usuario valido'),
    check('password').notEmpty().withMessage('La contraseña es obligatoria'),
];

// Ruta para chequear si el usuario tiene sesión activa
let lastLoggedUser = null; // Variable para almacenar el último usuario autenticado

router.get('/check-session', verifyToken(), (req, res) => {
    const currentUser = JSON.stringify(req.user); // Convertir el usuario actual a una cadena para comparación

    // Verificar si el mensaje actual es diferente al último registrado
    if (lastLoggedUser !== currentUser) {
        console.log('Usuario autenticado:', req.user);
        lastLoggedUser = currentUser; // Actualizar el último usuario registrado
    }

    res.status(200).json({
        message: 'Sesión activa',
        user: req.user, // Información del usuario del token
    });
});

// Rutas de autenticación
router.post('/register', validateRegisterSchema, register);
router.post('/login', validateLoginSchema, login);
router.post('/logout', logout);

export default router;
