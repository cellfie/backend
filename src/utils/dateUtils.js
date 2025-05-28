// Función para obtener la fecha actual en zona horaria de Argentina
export const getFechaArgentina = () => {
  const fecha = new Date();
  return new Date(fecha.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
};

// Función para formatear fecha para la base de datos (MySQL DATETIME)
export const formatearFechaParaDB = (fecha = null) => {
  const fechaAUsar = fecha || getFechaArgentina();
  return fechaAUsar.toISOString().slice(0, 19).replace('T', ' ');
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