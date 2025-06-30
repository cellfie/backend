import { Router } from "express"
import { check } from "express-validator"
import {
  getCuentasCorrientes,
  getCuentaCorrienteByCliente,
  createOrUpdateCuentaCorriente,
  registrarPago,
  registrarAjuste,
  getMovimientosCuentaCorriente,
} from "../controllers/cuenta-corriente.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear/actualizar cuenta corriente
const validateCuentaCorriente = [check("cliente_id").isNumeric().withMessage("ID de cliente inválido")]

// Validaciones para registrar pago
const validatePago = [
  check("cliente_id").isNumeric().withMessage("ID de cliente inválido"),
  check("monto")
    .isNumeric()
    .withMessage("El monto debe ser un número")
    .custom((value) => value > 0)
    .withMessage("El monto debe ser mayor a cero"),
]

// Validaciones para registrar ajuste
const validateAjuste = [
  check("cliente_id").isNumeric().withMessage("ID de cliente inválido"),
  check("monto")
    .isNumeric()
    .withMessage("El monto debe ser un número")
    .custom((value) => value > 0)
    .withMessage("El monto debe ser mayor a cero"),
  check("tipo_ajuste").isIn(["pago", "cargo"]).withMessage('Tipo de ajuste inválido. Debe ser "pago" o "cargo"'),
  check("motivo")
    .notEmpty()
    .withMessage("El motivo es obligatorio")
    .isLength({ min: 5, max: 500 })
    .withMessage("El motivo debe tener entre 5 y 500 caracteres"),
]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getCuentasCorrientes)
router.get("/cliente/:cliente_id", verifyToken(["admin", "empleado"]), getCuentaCorrienteByCliente)
router.get("/:cuenta_id/movimientos", verifyToken(["admin", "empleado"]), getMovimientosCuentaCorriente)
router.post("/", validateCuentaCorriente, verifyToken(["admin", "empleado"]), createOrUpdateCuentaCorriente)
router.post("/pago", validatePago, verifyToken(["admin", "empleado"]), registrarPago)
router.post("/ajuste", validateAjuste, verifyToken(["admin", "empleado"]), registrarAjuste)

export default router
