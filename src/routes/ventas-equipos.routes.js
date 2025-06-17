import { Router } from "express"
import { check } from "express-validator"
import {
  getVentasEquipos,
  getVentaEquipoById,
  createVentaEquipo,
  anularVentaEquipo,
  registrarPagoAdicionalVentaEquipo
} from "../controllers/equipos/venta-equipo.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear venta de equipo
const validateVentaEquipo = [
  check("punto_venta_id").isNumeric().withMessage("ID de punto de venta inválido"),
  check("tipo_pago").isString().withMessage("Tipo de pago inválido"),
  check("equipo_id").isNumeric().withMessage("ID de equipo inválido"),
]

// Validaciones para anular venta
const validateAnulacion = [check("motivo").notEmpty().withMessage("El motivo de anulación es obligatorio")]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getVentasEquipos)
router.get("/:id", verifyToken(["admin", "empleado"]), getVentaEquipoById)
router.post("/", verifyToken(["admin", "empleado"]), validateVentaEquipo, createVentaEquipo)
router.put("/:id/anular", verifyToken(["admin"]), validateAnulacion, anularVentaEquipo)

// Nueva ruta para registrar pagos adicionales a una venta de equipo
router.post("/:id/pagos", verifyToken(["admin", "empleado"]), registrarPagoAdicionalVentaEquipo);

export default router