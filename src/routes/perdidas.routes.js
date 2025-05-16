import { Router } from "express"
import {
  getPerdidas, getPerdidaById, createPerdida, deletePerdida
} from "../controllers/perdida.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getPerdidas)
router.get("/:id", verifyToken(["admin", "empleado"]), getPerdidaById)
router.post("/", verifyToken(["admin", "empleado"]), createPerdida)
router.delete("/:id", verifyToken(["admin", "empleado"]), deletePerdida)

export default router