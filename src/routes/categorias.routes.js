import { Router } from "express"
import { check } from "express-validator"
import {
  getCategorias,
  getCategoriaById,
  createCategoria,
  updateCategoria,
  deleteCategoria,
  getEstadisticasCategorias,
} from "../controllers/productos/categoria.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear/actualizar categoría
const validateCategoria = [check("nombre").notEmpty().withMessage("El nombre es obligatorio")]

// Rutas
router.get("/", getCategorias)
router.get("/estadisticas", getEstadisticasCategorias)
router.get("/:id", getCategoriaById)
router.post("/", validateCategoria, createCategoria)
router.put("/:id", validateCategoria, updateCategoria)
router.delete("/:id", deleteCategoria)

export default router
