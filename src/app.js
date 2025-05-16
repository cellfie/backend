import express from "express"
import cors from "cors"
import bodyParser from "body-parser"
import cookieParser from "cookie-parser"
import authRoutes from "./routes/auth.routes.js"
import productosRoutes from "./routes/productos.routes.js"
import categoriasRoutes from "./routes/categorias.routes.js"
import puntosVentaRoutes from "./routes/puntos-ventas.routes.js"
import inventarioRoutes from "./routes/invetario.routes.js"
import descuentosRoutes from "./routes/descuentos.routes.js"
import clientesRoutes from "./routes/clientes.routes.js"
import ventasRoutes from "./routes/ventas.routes.js"
import cuentasCorrientesRoutes from "./routes/cuentas-corrientes.routes.js"
import pagosRoutes from "./routes/pagos.routes.js"
// Nuevas rutas para equipos
import equiposRoutes from "./routes/equipos.routes.js"
import ventasEquiposRoutes from "./routes/ventas-equipos.routes.js"
import tipoCambioRoutes from "./routes/tipo-cambio.routes.js"
// Nuevas rutas para reparaciones
import reparacionesRoutes from "./routes/reparaciones.routes.js"
// Nuevas rutas para devoluciones
import devolucionesRoutes from "./routes/devoluciones.routes.js"
import perdidasRoutes from "./routes/perdidas.routes.js"
// Nuevas rutas para repuestos
import repuestosRoutes from "./routes/repuesto.routes.js"
import notasRoutes from "./routes/notas.routes.js"
import preciosCanjesRoutes from "./routes/precios-canjes.routes.js"

import { FRONTEND_URL, FRONTEND_URL_WWW, FRONTEND_URL_DEV } from "./config.js"

const app = express()

const allowedOrigins = [
  "http://localhost:5173", // Asegúrate de agregar el puerto 5173, donde está corriendo tu frontend
  "http://localhost:3000",
  FRONTEND_URL,
  FRONTEND_URL_WWW,
  FRONTEND_URL_DEV,
]

// Configuración de CORS
const corsOptions = {
  origin: (origin, callback) => {
    // Permitir solicitudes sin origen (como desde herramientas de prueba)
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error("No permitido por CORS"))
    }
  },
  methods: ["POST", "PUT", "DELETE", "GET", "OPTIONS"],
  credentials: true, // Permitir el envío de cookies
}

app.use(express.json())
app.use(cookieParser())
app.use(bodyParser.json())
app.use(cors(corsOptions))

// Rutas principales
app.use("/api/auth", authRoutes)
app.use("/api/productos", productosRoutes)
app.use("/api/categorias", categoriasRoutes)
app.use("/api/puntos-venta", puntosVentaRoutes)
app.use("/api/inventario", inventarioRoutes)
app.use("/api/descuentos", descuentosRoutes)
app.use("/api/clientes", clientesRoutes)
app.use("/api/ventas", ventasRoutes)
app.use("/api/cuentas-corrientes", cuentasCorrientesRoutes)
app.use("/api/pagos", pagosRoutes)
// Nuevas rutas para equipos
app.use("/api/equipos", equiposRoutes)
app.use("/api/ventas-equipos", ventasEquiposRoutes)
app.use("/api/tipo-cambio", tipoCambioRoutes)
// Nuevas rutas para reparaciones
app.use("/api/reparaciones", reparacionesRoutes)
// Nuevas rutas para devoluciones
app.use("/api/devoluciones", devolucionesRoutes)
app.use("/api/perdidas", perdidasRoutes)
// Nuevas rutas para repuestos
app.use("/api/repuestos", repuestosRoutes)
app.use("/api/notas", notasRoutes)
app.use("/api/precios-canjes", preciosCanjesRoutes)

// Middleware para manejar errores
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).send({ error: "¡Algo salió mal!" })
})

export default app