import { Router } from "express"
import { check } from "express-validator"
import {
  getCompras,
  getComprasPaginadas,
  getCompraById,
  createCompra,
  anularCompra,
} from "../controllers/productos/compra.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear compra
const validateCompra = [
  check("proveedor_id").isNumeric().withMessage("ID de proveedor inválido"),
  check("punto_venta_id").isNumeric().withMessage("ID de punto de venta inválido"),
  check("productos").isArray({ min: 1 }).withMessage("Debe incluir al menos un producto"),
  check("productos.*.id").isNumeric().withMessage("ID de producto inválido"),
  check("productos.*.cantidad")
    .isNumeric()
    .withMessage("La cantidad debe ser un número")
    .custom((value) => value > 0)
    .withMessage("La cantidad debe ser mayor a cero"),
  check("productos.*.costo_unitario")
    .optional()
    .isNumeric()
    .withMessage("El costo unitario debe ser un número")
    .custom((value) => value >= 0)
    .withMessage("El costo unitario no puede ser negativo"),
  check("pagos")
    .optional()
    .isArray()
    .withMessage("Los pagos deben ser un arreglo"),
  check("pagos.*.monto")
    .optional()
    .isNumeric()
    .withMessage("El monto de cada pago debe ser un número")
    .custom((value) => value > 0)
    .withMessage("El monto de cada pago debe ser mayor a cero"),
  check("pagos.*.tipo_pago").optional().isString().notEmpty().withMessage("El tipo de pago es obligatorio para cada pago"),
]

// Validaciones para anular compra
const validateAnulacion = [check("motivo").notEmpty().withMessage("El motivo de anulación es obligatorio")]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getCompras)
router.get("/paginadas", verifyToken(["admin", "empleado"]), getComprasPaginadas)
router.get("/:id", verifyToken(["admin", "empleado"]), getCompraById)
router.post("/", verifyToken(["admin"]), validateCompra, createCompra)
router.put("/:id/anular", verifyToken(["admin"]), validateAnulacion, anularCompra)

export default router

