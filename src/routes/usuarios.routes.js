import { Router } from "express"
import { check } from "express-validator"
import { verifyToken } from "../middlewares/verifyToken.js"
import { getUsuarios, createUsuario, updateUsuario, deleteUsuario } from "../controllers/usuarios.controller.js"

const router = Router()

// Requiere token en todas las rutas
router.use(verifyToken())

const validateCreateUsuario = [
  check("nombre").notEmpty().withMessage("El nombre de usuario es obligatorio"),
  check("password").isLength({ min: 6 }).withMessage("La contraseña debe tener al menos 6 caracteres"),
  check("rol").isIn(["admin", "empleado"]).withMessage("Rol inválido"),
  check("activo")
    .optional()
    .isIn([0, 1, "0", "1", true, false])
    .withMessage("Activo inválido"),
]

const validateUpdateUsuario = [
  check("nombre").optional().notEmpty().withMessage("El nombre no puede ser vacío"),
  check("password")
    .optional()
    .custom((value) => value === undefined || String(value).trim().length === 0 || String(value).length >= 6)
    .withMessage("Si envías contraseña, debe tener al menos 6 caracteres"),
  check("rol").optional().isIn(["admin", "empleado"]).withMessage("Rol inválido"),
  check("activo").optional().isIn([0, 1, "0", "1", true, false]).withMessage("Activo inválido"),
]

router.get("/", verifyToken(["admin"]), getUsuarios)
router.post("/", verifyToken(["admin"]), validateCreateUsuario, createUsuario)
router.put("/:id", verifyToken(["admin"]), validateUpdateUsuario, updateUsuario)
router.delete("/:id", verifyToken(["admin"]), deleteUsuario)

export default router

