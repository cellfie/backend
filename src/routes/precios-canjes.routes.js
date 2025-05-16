// routes/precios-canjes.routes.js
import { Router } from "express"
import { check } from "express-validator"
import {
  getPreciosCanjes,
  createPrecioCanje,
  deletePrecioCanje
} from "../controllers/precios-canje.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear precio de canje
const validatePrecioCanje = [
  check("nombre").notEmpty().withMessage("El nombre es obligatorio"),
  check("precioNormal").isNumeric().withMessage("El precio normal debe ser un número"),
  check("precioCellfie").isNumeric().withMessage("El precio Cellfie debe ser un número"),
]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getPreciosCanjes)
router.post("/", verifyToken(["admin", "empleado"]), validatePrecioCanje, createPrecioCanje)
router.delete("/:id", verifyToken(["admin", "empleado"]), deletePrecioCanje)

export default router