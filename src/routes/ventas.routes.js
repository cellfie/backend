import { Router } from "express"
import { check } from "express-validator"
import {
  getVentas,
  getVentasPaginadas,
  searchVentasRapido,
  searchVentasByProducto,
  getVentaById,
  createVenta,
  anularVenta,
  getEstadisticasVentas,
  getDevolucionesByVenta,
  getMetodosPagoVentas,
  getTotalVentasFiltradas, // AGREGADO: Importar la nueva función
} from "../controllers/productos/venta.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear venta
const validateVenta = [
  check("punto_venta_id").isNumeric().withMessage("ID de punto de venta inválido"),
  // Se elimina la validación para 'tipo_pago' individual
  // Nueva validación para el array 'pagos'
  check("pagos")
    .isArray({ min: 1 })
    .withMessage("Se requiere al menos un método de pago."),
  check("pagos.*.monto")
    .isNumeric()
    .withMessage("El monto de cada pago debe ser un número.")
    .toFloat() // Convertir a float para validación
    .isFloat({ gt: 0 })
    .withMessage("El monto de cada pago debe ser mayor a cero."),
  check("pagos.*.tipo_pago").isString().notEmpty().withMessage("El tipo de pago es obligatorio para cada pago."),
  check("productos").isArray({ min: 1 }).withMessage("Debe incluir al menos un producto"),
  check("productos.*.id").isNumeric().withMessage("ID de producto inválido"),
  check("productos.*.cantidad")
    .isNumeric()
    .withMessage("La cantidad debe ser un número")
    .custom((value) => value > 0)
    .withMessage("La cantidad debe ser mayor a cero"),
  check("productos.*.precio")
    .isNumeric()
    .withMessage("El precio debe ser un número")
    .custom((value) => value > 0)
    .withMessage("El precio debe ser mayor a cero"),
]

// Validaciones para anular venta
const validateAnulacion = [check("motivo").notEmpty().withMessage("El motivo de anulación es obligatorio")]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getVentas)
router.get("/paginadas", verifyToken(["admin", "empleado"]), getVentasPaginadas)
router.get("/total-filtradas", verifyToken(["admin", "empleado"]), getTotalVentasFiltradas)
router.get("/metodos-pago", verifyToken(["admin", "empleado"]), getMetodosPagoVentas)
router.get("/search-rapido", verifyToken(["admin", "empleado"]), searchVentasRapido)
router.get("/search-by-producto", verifyToken(["admin", "empleado"]), searchVentasByProducto)
router.get("/estadisticas", verifyToken(["admin"]), getEstadisticasVentas)
router.get("/:id", verifyToken(["admin", "empleado"]), getVentaById)
router.get("/:id/devoluciones", verifyToken(["admin", "empleado"]), getDevolucionesByVenta)
router.post("/", verifyToken(["admin", "empleado"]), validateVenta, createVenta)
router.put("/:id/anular", verifyToken(["admin"]), validateAnulacion, anularVenta)

export default router
