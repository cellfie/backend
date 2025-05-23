import { Router } from "express"
import { check } from "express-validator"
import {
  getRepuestos,
  getRepuestoById,
  createRepuesto,
  updateRepuesto,
  deleteRepuesto,
  searchRepuestos,
} from "../controllers/repuestos/repuesto.controller.js"
import {
  actualizarInventario,
  descontarRepuestos,
  getHistorialInventario,
} from "../controllers/repuestos/inventario-repuesto.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones actualizadas para el modelo simplificado (solo nombre es obligatorio)
const validateRepuesto = [check("nombre").notEmpty().withMessage("El nombre es obligatorio")]

// Validaciones para actualizar inventario
const validateInventario = [
  check("repuesto_id").isInt().withMessage("ID de repuesto inválido"),
  check("punto_venta_id").isInt().withMessage("ID de punto de venta inválido"),
  check("cantidad").isInt({ min: 0 }).withMessage("La cantidad debe ser un número no negativo"),
]

// Validaciones para descontar repuestos
const validateDescontarRepuestos = [
  check("repuestos").isArray({ min: 1 }).withMessage("Debe proporcionar al menos un repuesto"),
  check("repuestos.*.id").isInt().withMessage("ID de repuesto inválido"),
  check("repuestos.*.punto_venta_id").isInt().withMessage("ID de punto de venta inválido"),
  check("repuestos.*.cantidad").isInt({ min: 1 }).withMessage("La cantidad debe ser mayor a cero"),
  check("reparacion_id").isInt().withMessage("ID de reparación inválido"),
]

// Rutas para repuestos
router.get("/", getRepuestos)
router.get("/search", searchRepuestos)
router.get("/:id", getRepuestoById)
router.post("/", validateRepuesto, createRepuesto)
router.put("/:id", validateRepuesto, updateRepuesto)
router.delete("/:id", deleteRepuesto)

// Rutas para inventario de repuestos
router.post("/inventario", validateInventario, actualizarInventario)
router.post("/descontar", validateDescontarRepuestos, descontarRepuestos)
router.get("/historial", getHistorialInventario)

export default router
