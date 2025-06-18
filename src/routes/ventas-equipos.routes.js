import { Router } from "express"
import { check, body } from "express-validator" // Importamos 'body' para validaciones más específicas
import {
  getVentasEquipos,
  getVentaEquipoById,
  createVentaEquipo,
  anularVentaEquipo,
} from "../controllers/equipos/venta-equipo.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas (ya estaba, se mantiene)
// router.use(verifyToken()); // Comentado si verifyToken se aplica individualmente

// Validaciones para crear venta de equipo (MODIFICADO)
const validateVentaEquipo = [
  check("punto_venta_id")
    .isNumeric()
    .withMessage("ID de punto de venta inválido"),
  check("equipo_id")
    .isNumeric()
    .withMessage("ID de equipo inválido"),
  // Ya no validamos 'tipo_pago' a nivel raíz.
  // Nueva validación para el array 'pagos'
  body("pagos")
    .isArray({ min: 1 })
    .withMessage("Se debe proporcionar al menos un método de pago en un array."),
  body("pagos.*.tipo_pago") // El asterisco (*) indica que se aplica a cada elemento del array
    .notEmpty()
    .isString()
    .withMessage("Cada pago debe tener un tipo_pago (string) no vacío."),
  body("pagos.*.monto_usd")
    .isNumeric()
    .toFloat() // Convertir a float para la validación
    .isFloat({ min: 0 })
    .withMessage("Cada pago debe tener un monto_usd numérico mayor o igual a 0."),
  body("pagos.*.monto_ars")
    .isNumeric()
    .toFloat()
    .isFloat({ min: 0 })
    .withMessage("Cada pago debe tener un monto_ars numérico mayor o igual a 0."),
  body("pagos.*.tipo_cambio_pago")
    .isNumeric()
    .toFloat()
    .isFloat({ gt: 0 }) // gt: greater than 0
    .withMessage("Cada pago debe tener un tipo_cambio_pago numérico mayor que 0."),
  body("pagos.*.descripcion")
    .optional()
    .isString()
    .withMessage("La descripción del pago, si se proporciona, debe ser un string."),
  check("cliente_id")
    .optional({ nullable: true }) // Permite que cliente_id sea null o no esté presente
    .isNumeric()
    .withMessage("ID de cliente inválido si se proporciona."),
  check("porcentaje_interes")
    .optional()
    .isNumeric()
    .withMessage("Porcentaje de interés debe ser numérico."),
  check("porcentaje_descuento")
    .optional()
    .isNumeric()
    .withMessage("Porcentaje de descuento debe ser numérico."),
  check("notas")
    .optional()
    .isString()
    .withMessage("Las notas deben ser un string."),
  // Validación para plan_canje (si se incluye)
  check("plan_canje.marca")
    .optional()
    .isString()
    .withMessage("La marca del equipo de canje debe ser un string."),
  check("plan_canje.modelo")
    .optional()
    .isString()
    .withMessage("El modelo del equipo de canje debe ser un string."),
  check("plan_canje.precio")
    .optional()
    .isNumeric()
    .withMessage("El precio del equipo de canje debe ser numérico."),
]

// Validaciones para anular venta (sin cambios)
const validateAnulacion = [
  check("motivo")
    .notEmpty()
    .withMessage("El motivo de anulación es obligatorio"),
]

// Rutas
// Aplicamos verifyToken individualmente para mayor claridad en los permisos
router.get("/", verifyToken(["admin", "empleado"]), getVentasEquipos)
router.get("/:id", verifyToken(["admin", "empleado"]), getVentaEquipoById)
router.post(
  "/",
  verifyToken(["admin", "empleado"]),
  validateVentaEquipo,
  createVentaEquipo,
)
router.put(
  "/:id/anular",
  verifyToken(["admin"]), // Solo admin puede anular
  validateAnulacion,
  anularVentaEquipo,
)

export default router