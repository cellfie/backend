// Función mejorada para formatear fecha para la base de datos
// Siempre guarda la fecha en la zona horaria de Argentina (America/Argentina/Buenos_Aires)
// sin aplicar dobles conversiones que generen desfases de horas.
export const formatearFechaParaDB = (fecha = null) => {
  const fechaBase = fecha ? new Date(fecha) : new Date()

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })

  const partes = formatter.formatToParts(fechaBase)
  const get = (type) => partes.find((p) => p.type === type)?.value || "00"

  const year = get("year")
  const month = get("month")
  const day = get("day")
  const hour = get("hour")
  const minute = get("minute")
  const second = get("second")

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
};

/**
 * Convierte una fecha (Date o string MySQL) a ISO con offset Argentina (-03:00)
 * para que el frontend muestre la hora correcta sin desfase.
 *
 * Con mysql2 y `timezone: 'Z'` en el pool, las columnas DATETIME (sin TZ en MySQL)
 * se leen como Date cuyos componentes UTC coinciden con el calendario guardado
 * (ej. fila 09:58 → getUTCHours() === 9). Si aquí se formateara ese Date en zona
 * Argentina, se restarían 3 h respecto de lo guardado. Por eso, para Date usamos
 * getUTC* y etiquetamos como -03:00 (hora de negocio Argentina = dígitos de la BD).
 *
 * Si es string "YYYY-MM-DD HH:mm:ss" (sin TZ): se asume ya en Argentina y se devuelve con -03:00.
 */
export const fechaParaAPI = (value) => {
  if (value == null) return value
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return value
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, "0")
    const d = String(value.getUTCDate()).padStart(2, "0")
    const h = String(value.getUTCHours()).padStart(2, "0")
    const min = String(value.getUTCMinutes()).padStart(2, "0")
    const s = String(value.getUTCSeconds()).padStart(2, "0")
    return `${y}-${m}-${d}T${h}:${min}:${s}-03:00`
  }
  if (typeof value === "string") {
    const s = value.trim()
    if (s.includes("T") && (s.includes("-03:00") || s.includes("Z"))) return s
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/)
    if (match) return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}-03:00`
    return s
  }
  return value
}

// Función mejorada para mostrar fechas
export const formatearFechaParaMostrar = (fechaString) => {
  if (!fechaString) return "";
  
  // Si la fecha viene sin timezone, asumimos que está en Argentina
  let fecha;
  if (fechaString.includes('T') || fechaString.includes('+')) {
    // Ya tiene información de timezone
    fecha = new Date(fechaString);
  } else {
    // Fecha sin timezone, la tratamos como Argentina
    fecha = new Date(fechaString + ' GMT-0300');
  }
  
  return fecha.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit", 
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
};