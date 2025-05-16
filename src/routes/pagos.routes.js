import { Router } from "express"
import { check } from "express-validator"
import { getPagos, getPagoById, createPago, anularPago } from "../controllers/pago.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear pago
const validatePago = [
  check("monto")
    .isNumeric()
    .withMessage("El monto debe ser un número")
    .custom((value) => value > 0)
    .withMessage("El monto debe ser mayor a cero"),
  // Cambiamos la validación de tipo_pago_id a tipo_pago
  check("tipo_pago")
    .isString()
    .withMessage("Tipo de pago inválido"),
  check("tipo_referencia").isIn(["venta", "cuenta_corriente"]).withMessage("Tipo de referencia inválido"),
  check("punto_venta_id").isNumeric().withMessage("ID de punto de venta inválido"),
]

// Validaciones para anular pago
const validateAnulacion = [check("motivo").notEmpty().withMessage("El motivo de anulación es obligatorio")]

// Rutas para pagos
router.get("/", verifyToken(["admin", "empleado"]), getPagos)
router.get("/:id", verifyToken(["admin", "empleado"]), getPagoById)
router.post("/", verifyToken(["admin", "empleado"]), validatePago, createPago)
router.put("/:id/anular", verifyToken(["admin", "empleado"]), validateAnulacion, anularPago)

export default router
