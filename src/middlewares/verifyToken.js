import jwt from "jsonwebtoken"
import { JWT_SECRET } from "../config.js"

export const verifyToken = (roles = []) => {
  return (req, res, next) => {
    try {
      const token = req.cookies?.["token-jwt"] // Validación más segura
      if (!token) {
        return res.status(401).json({ message: "No autorizado, token faltante" })
      }

      const decoded = jwt.verify(token, JWT_SECRET)

      // Establecer tanto req.user como req.usuario para compatibilidad
      req.user = {
        ...decoded,
        rol: decoded.rol,
        role: decoded.role
      }
      req.usuario = {
        ...decoded,
        rol: decoded.rol,
        role: decoded.role
      }

      // Verificar roles, si se especificaron
      if (roles.length > 0 && !roles.includes(decoded.role)) {
        return res.status(403).json({ message: "Acceso denegado, rol insuficiente" })
      }

      next()
    } catch (error) {
      console.error("Error en verifyToken:", error)
      const statusCode = error.name === "TokenExpiredError" ? 401 : 403
      return res.status(statusCode).json({
        message: error.name === "TokenExpiredError" ? "El token ha expirado" : "Token inválido",
        error: error.message,
      })
    }
  }
}
