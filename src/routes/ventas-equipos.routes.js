import { Router } from "express"
import { check } from "express-validator"
import {
  getVentasEquipos,
  getVentaEquipoById,
  createVentaEquipo,
  anularVentaEquipo,
  registrarPagoAdicionalVentaEquipo,
  getTiposPago,
} from "../controllers/equipos/venta-equipo.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear venta de equipo
const validateVentaEquipo = [
  check("cliente_id").isNumeric().withMessage("ID de cliente inválido"),
  check("punto_venta_id").isNumeric().withMessage("ID de punto de venta inválido"),
  check("equipo_id").isNumeric().withMessage("ID de equipo inválido"),
  check("porcentaje_interes").optional().isFloat({ min: 0 }).withMessage("Porcentaje de interés inválido"),
  check("porcentaje_descuento").optional().isFloat({ min: 0 }).withMessage("Porcentaje de descuento inválido"),
  check("pagos").optional().isArray().withMessage("Los pagos deben ser un array"),
  check("marcar_como_incompleta").optional().isBoolean().withMessage("marcar_como_incompleta debe ser booleano"),
]

// Validaciones para anular venta
const validateAnulacion = [check("motivo").notEmpty().withMessage("El motivo de anulación es obligatorio")]

// Validaciones para pago adicional
const validatePagoAdicional = [
  check("monto_usd").optional().isFloat({ min: 0 }).withMessage("Monto USD inválido"),
  check("monto_ars").optional().isFloat({ min: 0 }).withMessage("Monto ARS inválido"),
  check("tipo_pago").notEmpty().withMessage("Tipo de pago es obligatorio"),
  check("punto_venta_id_pago").isNumeric().withMessage("ID de punto de venta para pago inválido"),
]

// ✅ NUEVA RUTA: Obtener tipos de pago
router.get("/tipos-pago", verifyToken(["admin", "empleado"]), getTiposPago)

// Rutas existentes
router.get("/", verifyToken(["admin", "empleado"]), getVentasEquipos)
router.get("/:id", verifyToken(["admin", "empleado"]), getVentaEquipoById)
router.post("/", verifyToken(["admin", "empleado"]), validateVentaEquipo, createVentaEquipo)
router.put("/:id/anular", verifyToken(["admin"]), validateAnulacion, anularVentaEquipo)
router.post("/:id/pagos", verifyToken(["admin", "empleado"]), validatePagoAdicional, registrarPagoAdicionalVentaEquipo)

export default router
