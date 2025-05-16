import { Router } from "express"
import { check } from "express-validator"
import {
  getClientes,
  getClienteById,
  createCliente,
  updateCliente,
  deleteCliente,
  searchClientes,
  getClienteWithReparaciones
} from "../controllers/cliente.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear/actualizar cliente
const validateCliente = [
  check("nombre").notEmpty().withMessage("El nombre es obligatorio")
]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getClientes)
router.get("/search", verifyToken(["admin", "empleado"]), searchClientes)
router.get("/:id", verifyToken(["admin", "empleado"]), getClienteById)
router.get("/:id/reparaciones", verifyToken(["admin", "empleado"]), getClienteWithReparaciones)
router.post("/", verifyToken(["admin", "empleado"]), validateCliente, createCliente)
router.put("/:id", verifyToken(["admin", "empleado"]), validateCliente, updateCliente)
router.delete("/:id", verifyToken(["admin"]), deleteCliente)

export default router