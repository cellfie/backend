// reparaciones.routes.js
import { Router } from "express"
import { check } from "express-validator"
import {
  getReparaciones,
  getReparacionById,
  createReparacion,
  updateReparacion,
  updateEstadoReparacion,
  registrarPagoReparacion,
  getEstadisticasReparaciones,
  cancelarReparacion,
} from "../controllers/reparacion.controller.js"
import { 
  getReparacionCompleta, 
  getHistorialAcciones,
  getReparacionesPorAccion 
} from "../controllers/historial-acciones.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear reparación
const validateReparacion = [
  check("equipo.marca").notEmpty().withMessage("La marca del equipo es obligatoria"),
  check("reparaciones").isArray({ min: 1 }).withMessage("Debe incluir al menos una reparación"),
  check("reparaciones.*.descripcion").notEmpty().withMessage("La descripción de la reparación es obligatoria"),
]

// Validaciones para actualizar reparación
const validateUpdateReparacion = [
  check("equipo.marca").optional().notEmpty().withMessage("La marca del equipo es obligatoria"),
  check("reparaciones").optional().isArray({ min: 1 }).withMessage("Debe incluir al menos una reparación"),
]

// Validaciones para actualizar estado
const validateEstado = [
  check("estado")
    .notEmpty()
    .withMessage("El estado es obligatorio")
    .isIn(["pendiente", "terminada", "entregada", "cancelada"])
    .withMessage("Estado no válido"),
]

// Validaciones para registrar pago
const validatePago = [
  check("monto")
    .isNumeric()
    .withMessage("El monto debe ser un número")
    .custom((value) => value > 0)
    .withMessage("El monto debe ser mayor a cero"),
  check("metodo_pago")
    .notEmpty()
    .withMessage("El método de pago es obligatorio")
    .isIn(["efectivo", "tarjeta", "transferencia", "cuentaCorriente"])
    .withMessage("Método de pago no válido"),
]

// Validaciones para cancelar reparación
const validateCancelacion = [check("motivo").optional().isString().withMessage("El motivo debe ser un texto")]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getReparaciones)
router.get("/estadisticas", verifyToken(["admin"]), getEstadisticasReparaciones)
router.get("/por-accion", verifyToken(["admin", "empleado"]), getReparacionesPorAccion)
router.get("/:id", verifyToken(["admin", "empleado"]), getReparacionById)
router.post("/", verifyToken(["admin", "empleado"]), validateReparacion, createReparacion)
router.put("/:id", verifyToken(["admin", "empleado"]), validateUpdateReparacion, updateReparacion)
router.put("/:id/estado", verifyToken(["admin", "empleado"]), validateEstado, updateEstadoReparacion)
router.post("/:id/pago", verifyToken(["admin", "empleado"]), validatePago, registrarPagoReparacion)
router.post("/:id/cancelar", verifyToken(["admin", "empleado"]), validateCancelacion, cancelarReparacion)

// Nuevas rutas para el historial de acciones
router.get("/:id/completa", verifyToken(["admin", "empleado"]), getReparacionCompleta)
router.get("/:id/historial", verifyToken(["admin", "empleado"]), getHistorialAcciones)

export default router