import { Router } from "express"
import { check } from "express-validator"
import {
  getProveedores,
  getProveedorById,
  createProveedor,
  updateProveedor,
  deleteProveedor,
  searchProveedores,
} from "../controllers/proveedor.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear/actualizar proveedor
const validateProveedor = [check("nombre").notEmpty().withMessage("El nombre es obligatorio")]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getProveedores)
router.get("/search", verifyToken(["admin", "empleado"]), searchProveedores)
router.get("/:id", verifyToken(["admin", "empleado"]), getProveedorById)
router.post("/", verifyToken(["admin"]), validateProveedor, createProveedor)
router.put("/:id", verifyToken(["admin"]), validateProveedor, updateProveedor)
router.delete("/:id", verifyToken(["admin"]), deleteProveedor)

export default router

