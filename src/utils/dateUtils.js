// Función mejorada para formatear fecha para la base de datos
export const formatearFechaParaDB = (fecha = null) => {
  let fechaAUsar;
  
  if (!fecha) {
    // Obtener fecha actual en timezone de Argentina
    fechaAUsar = new Date();
  } else {
    fechaAUsar = new Date(fecha);
  }
  
  // Siempre formatear en timezone de Argentina
  const argentinaTime = new Date(fechaAUsar.toLocaleString("en-US", { 
    timeZone: "America/Argentina/Buenos_Aires" 
  }));
  
  return argentinaTime.getFullYear() + '-' +
    String(argentinaTime.getMonth() + 1).padStart(2, '0') + '-' +
    String(argentinaTime.getDate()).padStart(2, '0') + ' ' +
    String(argentinaTime.getHours()).padStart(2, '0') + ':' +
    String(argentinaTime.getMinutes()).padStart(2, '0') + ':' +
    String(argentinaTime.getSeconds()).padStart(2, '0');
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