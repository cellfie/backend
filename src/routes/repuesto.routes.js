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
  getInventarioRepuestos,
  getInventarioByRepuesto,
  updateInventarioRepuesto,
} from "../controllers/repuestos/inventario-repuesto.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear/actualizar repuesto (nombre, código y marca son obligatorios)
const validateRepuesto = [
  check("codigo").notEmpty().withMessage("El código es obligatorio"),
  check("nombre").notEmpty().withMessage("El nombre es obligatorio"),
  check("marca").notEmpty().withMessage("La marca es obligatoria"),
]

// Validaciones para actualizar inventario
const validateInventario = [
  check("repuesto_id").isInt().withMessage("ID de repuesto inválido"),
  check("punto_venta_id").isInt().withMessage("ID de punto de venta inválido"),
  check("stock").isInt({ min: 0 }).withMessage("El stock debe ser un número no negativo"),
]

// Rutas para repuestos
router.get("/", getRepuestos)
router.get("/search", searchRepuestos)
router.get("/:id", getRepuestoById)
router.post("/", validateRepuesto, createRepuesto)
router.put("/:id", validateRepuesto, updateRepuesto)
router.delete("/:id", deleteRepuesto)

// Rutas para inventario de repuestos
router.get("/inventario", getInventarioRepuestos)
router.get("/:id/inventario", getInventarioByRepuesto)
router.post("/inventario", validateInventario, updateInventarioRepuesto)

export default router
