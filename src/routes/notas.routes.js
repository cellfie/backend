import { Router } from "express"
import { check } from "express-validator"
import { getNotas, createNota, updateNota, deleteNota, toggleNotaCompletada } from "../controllers/notas.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear/actualizar nota
const validateNota = [check("texto").notEmpty().withMessage("El texto de la nota es obligatorio")]

// Rutas para notas
router.get("/", getNotas)
router.post("/", validateNota, createNota)
router.put("/:id", validateNota, updateNota)
router.delete("/:id", deleteNota)
router.patch("/:id/toggle", toggleNotaCompletada)

export default router
