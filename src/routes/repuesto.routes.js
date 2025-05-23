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

// Validaciones actualizadas para el modelo simplificado (solo nombre es obligatorio)
const validateRepuesto = [
  check("nombre")
    .notEmpty()
    .withMessage("El nombre es obligatorio"),
  // Ya no validamos código ni marca porque los hemos eliminado del modelo
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
