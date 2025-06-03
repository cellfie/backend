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
} from "../controllers/productos/venta.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear venta
const validateVenta = [
  check("punto_venta_id").isNumeric().withMessage("ID de punto de venta inválido"),
  check("tipo_pago").isString().withMessage("Tipo de pago inválido"),
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
router.get("/", verifyToken(["admin", "empleado"]), getVentas) // Solo admin y empleados pueden ver ventas
router.get("/paginadas", verifyToken(["admin", "empleado"]), getVentasPaginadas) // Nueva ruta para paginación
router.get("/search-rapido", verifyToken(["admin", "empleado"]), searchVentasRapido) // Nueva ruta para búsqueda rápida
router.get("/search-by-producto", verifyToken(["admin", "empleado"]), searchVentasByProducto) // NUEVA: Búsqueda por producto
router.get("/estadisticas", verifyToken(["admin"]), getEstadisticasVentas) // Solo admin puede ver estadísticas
router.get("/:id", verifyToken(["admin", "empleado"]), getVentaById) // Solo admin y empleados pueden ver detalles de una venta
router.get("/:id/devoluciones", verifyToken(["admin", "empleado"]), getDevolucionesByVenta) // Obtener devoluciones de una venta
router.post("/", verifyToken(["admin", "empleado"]), validateVenta, createVenta) // Solo admin y empleados pueden crear ventas
router.put("/:id/anular", verifyToken(["admin"]), validateAnulacion, anularVenta) // Solo admin puede anular ventas

export default router
