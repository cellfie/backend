import { Router } from "express"
import { check } from "express-validator"
import {
  getDevoluciones,
  getDevolucionById,
  createDevolucion,
  anularDevolucion,
} from "../controllers/productos/devolucion.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear devolución
const validateDevolucion = [
  check("venta_id").isNumeric().withMessage("ID de venta inválido"),
  check("productos_devueltos").isArray({ min: 1 }).withMessage("Debe incluir al menos un producto a devolver"),
  check("productos_devueltos.*.producto_id").isNumeric().withMessage("ID de producto inválido"),
  check("productos_devueltos.*.cantidad")
    .isNumeric()
    .withMessage("La cantidad debe ser un número")
    .custom((value) => value > 0)
    .withMessage("La cantidad debe ser mayor a cero"),
  check("productos_devueltos.*.tipo_devolucion")
    .isIn(["normal", "defectuoso"])
    .withMessage("Tipo de devolución inválido"),
  // Los productos de reemplazo son opcionales
  check("productos_reemplazo").optional().isArray().withMessage("Formato inválido para productos de reemplazo"),
  check("productos_reemplazo.*.producto_id")
    .optional()
    .isNumeric()
    .withMessage("ID de producto de reemplazo inválido"),
  check("productos_reemplazo.*.cantidad")
    .optional()
    .isNumeric()
    .withMessage("La cantidad debe ser un número")
    .custom((value) => value > 0)
    .withMessage("La cantidad debe ser mayor a cero"),
]

// Validaciones para anular devolución
const validateAnulacion = [check("motivo").notEmpty().withMessage("El motivo de anulación es obligatorio")]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getDevoluciones)
router.get("/:id", verifyToken(["admin", "empleado"]), getDevolucionById)
router.post("/", verifyToken(["admin", "empleado"]), validateDevolucion, createDevolucion)
router.put("/:id/anular", verifyToken(["admin"]), validateAnulacion, anularDevolucion)

export default router