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