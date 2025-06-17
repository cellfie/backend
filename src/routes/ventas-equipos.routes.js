import { Router } from "express"
import { check } from "express-validator"
import {
  getVentasEquipos,
  getVentaEquipoById,
  createVentaEquipo,
  anularVentaEquipo,
  registrarPagoAdicionalVentaEquipo // Importar la nueva función
} from "../controllers/equipos/venta-equipo.controller.js"
import { verifyToken } from "../middlewares/verifyToken.js"

const router = Router()

// Middleware para verificar token en todas las rutas
// Se aplica verifyToken() sin argumentos para que se ejecute en todas las rutas
// y luego se especifica el control de roles en cada ruta individual si es necesario.
router.use(verifyToken()) 

// Validaciones para crear venta de equipo
const validateCreateVentaEquipo = [
  check("punto_venta_id")
    .isNumeric().withMessage("ID de punto de venta inválido")
    .notEmpty().withMessage("El punto de venta es obligatorio"),
  check("equipo_id")
    .isNumeric().withMessage("ID de equipo inválido")
    .notEmpty().withMessage("El equipo es obligatorio"),
  check("pagos")
    .isArray({ min: 1 }).withMessage("Debe proporcionar al menos un método de pago")
    .custom((pagos) => {
      for (const pago of pagos) {
        if (typeof pago.tipo_pago !== 'string' || pago.tipo_pago.trim() === '') {
          throw new Error("Cada pago debe tener un tipo_pago válido.");
        }
        if (pago.monto_usd == null && pago.monto_ars == null) {
            throw new Error("Cada pago debe tener monto_usd o monto_ars.");
        }
        if (pago.monto_usd != null && (typeof pago.monto_usd !== 'number' || pago.monto_usd < 0)) {
            throw new Error("El monto_usd de cada pago debe ser un número no negativo.");
        }
        if (pago.monto_ars != null && (typeof pago.monto_ars !== 'number' || pago.monto_ars < 0)) {
            throw new Error("El monto_ars de cada pago debe ser un número no negativo.");
        }
      }
      return true;
    }),
  check("tipo_cambio")
    .isNumeric().withMessage("El tipo de cambio debe ser un número")
    .custom(value => value > 0).withMessage("El tipo de cambio debe ser mayor a cero"),
  // cliente_id es opcional, pero si se envía, debe ser numérico
  check("cliente_id").optional({ checkFalsy: true }).isNumeric().withMessage("ID de cliente inválido"),
  check("porcentaje_interes").optional().isNumeric().withMessage("Porcentaje de interés debe ser numérico"),
  check("porcentaje_descuento").optional().isNumeric().withMessage("Porcentaje de descuento debe ser numérico"),
  check("plan_canje").optional({ checkFalsy: true }).isObject().withMessage("Plan canje debe ser un objeto"),
  check("plan_canje.marca").optional({ checkFalsy: true }).isString().withMessage("Marca del equipo de canje inválida"),
  check("plan_canje.modelo").optional({ checkFalsy: true }).isString().withMessage("Modelo del equipo de canje inválido"),
  check("plan_canje.precio").optional({ checkFalsy: true }).isNumeric().withMessage("Precio del equipo de canje debe ser numérico"),
  check("plan_canje.imei").optional({ checkFalsy: true }).isString().withMessage("IMEI del equipo de canje inválido"),
];

// Validaciones para anular venta
const validateAnulacion = [
  check("motivo").notEmpty().withMessage("El motivo de anulación es obligatorio")
];

// Validaciones para registrar pago adicional
const validatePagoAdicional = [
  check("monto_usd")
    .optional({ checkFalsy: true })
    .isNumeric().withMessage("El monto en USD debe ser un número")
    .custom(value => value >= 0).withMessage("El monto en USD no puede ser negativo"),
  check("monto_ars")
    .optional({ checkFalsy: true })
    .isNumeric().withMessage("El monto en ARS debe ser un número")
    .custom(value => value >= 0).withMessage("El monto en ARS no puede ser negativo"),
  check("tipo_pago")
    .isString().withMessage("Tipo de pago inválido")
    .notEmpty().withMessage("El tipo de pago es obligatorio"),
  check("punto_venta_id")
    .isNumeric().withMessage("ID de punto de venta inválido")
    .notEmpty().withMessage("El punto de venta es obligatorio para el pago"),
  check("notas").optional().isString().withMessage("Las notas deben ser texto"),
  // Validar que al menos uno de los montos esté presente y sea mayor que cero
  body().custom((value, { req }) => {
    const { monto_usd, monto_ars } = req.body;
    if ((monto_usd == null || monto_usd === 0) && (monto_ars == null || monto_ars === 0)) {
      throw new Error('Debe proporcionar un monto_usd o monto_ars mayor que cero para el pago.');
    }
    if ((monto_usd != null && monto_usd < 0) || (monto_ars != null && monto_ars < 0)) {
        throw new Error('Los montos no pueden ser negativos.');
    }
    return true;
  })
];


// Rutas
router.get("/", verifyToken(["admin", "empleado"]), getVentasEquipos);
router.get("/:id", verifyToken(["admin", "empleado"]), getVentaEquipoById);
router.post("/", verifyToken(["admin", "empleado"]), validateCreateVentaEquipo, createVentaEquipo);
router.put("/:id/anular", verifyToken(["admin"]), validateAnulacion, anularVentaEquipo);

// Nueva ruta para registrar pagos adicionales a una venta de equipo
router.post("/:id/pagos", verifyToken(["admin", "empleado"]), validatePagoAdicional, registrarPagoAdicionalVentaEquipo);

export default router 