import { Router } from "express"
import { check } from "express-validator"
import {
  getVentasEquipos,
  getVentaEquipoById,
  createVentaEquipo,
  anularVentaEquipo,
} from "../controllers/equipos/venta-equipo.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// MODIFICACIÓN: Se actualizan las validaciones para aceptar múltiples pagos.
const validateVentaEquipo = [
  check("punto_venta_id").isNumeric().withMessage("ID de punto de venta inválido"),
  check("equipo_id").isNumeric().withMessage("ID de equipo inválido"),
  check("pagos").isArray({ min: 1 }).withMessage("Se requiere al menos un método de pago."),
  check("pagos.*.monto")
    .isNumeric()
    .withMessage("El monto de cada pago debe ser un número.")
    .toFloat()
    .isFloat({ gt: 0 })
    .withMessage("El monto de cada pago debe ser mayor a cero."),
  check("pagos.*.tipo_pago").isString().notEmpty().withMessage("El tipo de pago es obligatorio para cada pago."),
]

// Validaciones para anular venta
const validateAnulacion = [check("motivo").notEmpty().withMessage("El motivo de anulación es obligatorio")]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getVentasEquipos)
router.get("/:id", verifyToken(["admin", "empleado"]), getVentaEquipoById)
router.post("/", verifyToken(["admin", "empleado"]), validateVentaEquipo, createVentaEquipo)
router.put("/:id/anular", verifyToken(["admin"]), validateAnulacion, anularVentaEquipo)

export default router
