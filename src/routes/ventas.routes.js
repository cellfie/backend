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
} from "../controllers/productos/venta.controller.js" // Asegúrate que la ruta al controlador sea correcta
import { verifyToken } from "../middlewares/verifyToken.js" // Asegúrate que la ruta al middleware sea correcta

const router = Router()

// Middleware para verificar token en todas las rutas
router.use(verifyToken())

// Validaciones para crear venta (MODIFICADO para múltiples pagos)
const validateVenta = [
  check("punto_venta_id").isNumeric().withMessage("ID de punto de venta inválido"),
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
    .custom((value) => value >= 0) // Permitir precio 0 si es necesario
    .withMessage("El precio debe ser mayor o igual a cero"),
  check("pagos").isArray({ min: 1 }).withMessage("Debe incluir al menos un método de pago."),
  check("pagos.*.tipo_pago").notEmpty().isString().withMessage("Cada pago debe tener un tipo_pago válido."),
  check("pagos.*.monto")
    .isNumeric()
    .withMessage("El monto de cada pago debe ser numérico.")
    .custom((value) => value > 0)
    .withMessage("El monto de cada pago debe ser mayor a cero."),
  check("cliente_id").optional({ nullable: true }).isNumeric().withMessage("ID de cliente inválido si se proporciona."),
  check("porcentaje_descuento")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("El porcentaje de descuento debe estar entre 0 y 100."),
  // Ya no se valida un único tipo_pago aquí, se valida el array 'pagos'
]

// Validaciones para anular venta
const validateAnulacion = [check("motivo").notEmpty().withMessage("El motivo de anulación es obligatorio")]

// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getVentas)
router.get("/paginadas", verifyToken(["admin", "empleado"]), getVentasPaginadas)
router.get("/search-rapido", verifyToken(["admin", "empleado"]), searchVentasRapido)
router.get("/search-by-producto", verifyToken(["admin", "empleado"]), searchVentasByProducto)
router.get("/estadisticas", verifyToken(["admin"]), getEstadisticasVentas)
router.get("/:id", verifyToken(["admin", "empleado"]), getVentaById)
router.get("/:id/devoluciones", verifyToken(["admin", "empleado"]), getDevolucionesByVenta)
router.post("/", verifyToken(["admin", "empleado"]), validateVenta, createVenta)
router.put("/:id/anular", verifyToken(["admin"]), validateAnulacion, anularVenta)

export default router
