import { Router } from "express"
import { check } from "express-validator"
import {
  getCajaActual,
  getSesionCajaPorId,
  abrirCaja,
  cerrarCaja,
  registrarMovimientoCaja,
  getSesionesCaja,
  getMovimientosCaja,
  getMovimientosCompletosCaja,
} from "../controllers/caja.controller.js"
import {
  getUsuariosParaRetiro,
  registrarRetiroEmpleado,
} from "../controllers/empleado-cuenta-corriente.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para abrir caja
const validateAbrirCaja = [
  check("punto_venta_id").isNumeric().withMessage("ID de punto de venta inválido"),
  check("monto_apertura")
    .isNumeric()
    .withMessage("El monto de apertura debe ser un número")
    .custom((value) => value >= 0)
    .withMessage("El monto de apertura no puede ser negativo"),
]

// Validaciones para cerrar caja
const validateCerrarCaja = [
  check("monto_cierre")
    .isNumeric()
    .withMessage("El monto de cierre debe ser un número")
    .custom((value) => value >= 0)
    .withMessage("El monto de cierre no puede ser negativo"),
]

// Validaciones para registrar movimiento
const validateMovimientoCaja = [
  check("caja_sesion_id").isNumeric().withMessage("ID de sesión de caja inválido"),
  check("tipo").isIn(["ingreso", "egreso"]).withMessage("Tipo de movimiento inválido"),
  check("concepto").notEmpty().withMessage("El concepto es obligatorio"),
  check("monto")
    .isNumeric()
    .withMessage("El monto debe ser un número")
    .custom((value) => value > 0)
    .withMessage("El monto debe ser mayor a cero"),
  check("origen")
    .optional()
    .isIn(["general", "ventas_productos", "ventas_equipos", "reparaciones"])
    .withMessage("Origen de movimiento inválido"),
]

const validateRetiroEmpleado = [
  check("caja_sesion_id").isNumeric().withMessage("ID de sesión de caja inválido"),
  check("empleado_usuario_id").isNumeric().withMessage("Empleado inválido"),
  check("monto")
    .isNumeric()
    .withMessage("El monto debe ser un número")
    .custom((value) => Number(value) > 0)
    .withMessage("El monto debe ser mayor a cero"),
]

// Rutas principales de caja
router.get("/actual", verifyToken(["admin", "empleado"]), getCajaActual)
router.get("/usuarios-retiro", verifyToken(["admin", "empleado"]), getUsuariosParaRetiro)
router.post(
  "/retiro-empleado",
  verifyToken(["admin", "empleado"]),
  validateRetiroEmpleado,
  registrarRetiroEmpleado,
)
router.get("/sesion/:id/movimientos-completos", verifyToken(["admin", "empleado"]), getMovimientosCompletosCaja)
router.get("/sesion/:id", verifyToken(["admin", "empleado"]), getSesionCajaPorId)
router.post("/abrir", verifyToken(["admin", "empleado"]), validateAbrirCaja, abrirCaja)
router.put("/:id/cerrar", verifyToken(["admin", "empleado"]), validateCerrarCaja, cerrarCaja)
router.post("/movimientos", verifyToken(["admin", "empleado"]), validateMovimientoCaja, registrarMovimientoCaja)
router.get("/sesiones", verifyToken(["admin", "empleado"]), getSesionesCaja)
router.get("/movimientos", verifyToken(["admin", "empleado"]), getMovimientosCaja)

export default router

