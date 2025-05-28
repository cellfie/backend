// Función para obtener la fecha actual en zona horaria de Argentina
export const getFechaArgentina = () => {
  // Create a date object with the current UTC time
  const fecha = new Date();
  
  // Format the date in Argentina timezone
  const options = { timeZone: "America/Argentina/Buenos_Aires" };
  const argentinaTimeStr = fecha.toLocaleString("en-US", options);
  
  // Create a new Date object from the formatted string
  return new Date(argentinaTimeStr);
};

// Función para formatear fecha para la base de datos (MySQL DATETIME)
export const formatearFechaParaDB = (fecha = null) => {
  // If no date is provided, get the current date in Argentina's timezone
  if (!fecha) {
    // Get current date in UTC
    const now = new Date();
    
    // Convert to Argentina timezone
    const argentinaTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
    
    // Format as YYYY-MM-DD HH:MM:SS
    return argentinaTime.getFullYear() + '-' +
      String(argentinaTime.getMonth() + 1).padStart(2, '0') + '-' +
      String(argentinaTime.getDate()).padStart(2, '0') + ' ' +
      String(argentinaTime.getHours()).padStart(2, '0') + ':' +
      String(argentinaTime.getMinutes()).padStart(2, '0') + ':' +
      String(argentinaTime.getSeconds()).padStart(2, '0');
  }
  
  // If a date is provided, format it
  return fecha.toISOString().slice(0, 19).replace('T', ' ');
};

// Función para formatear fecha para mostrar al usuario
export const formatearFechaParaMostrar = (fechaString) => {
  if (!fechaString) return "";
  
  const fecha = new Date(fechaString);
  
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