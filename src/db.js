import mysql from 'mysql2/promise';
import { MYSQL_PUBLIC_URL } from './config.js';

let pool;

try {
     // Crear un pool de conexiones
     pool = mysql.createPool({
        uri: MYSQL_PUBLIC_URL,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        timezone: 'Z', 
    });

    // Forzar la zona horaria de Argentina (UTC-3) en cada conexión del pool.
    // Así NOW(), CURRENT_TIMESTAMP y los DEFAULT de las tablas guardan siempre
    // la hora "de pared" argentina, sin depender de la zona horaria del servidor
    // (Railway/otros corren en UTC). Combinado con `timezone: 'Z'` de mysql2, los
    // dígitos guardados se leen tal cual y luego se etiquetan como -03:00.
    pool.on('connection', (connection) => {
        connection.query("SET time_zone = '-03:00'");
    });

     // Probar la conexión
     const testConnection = async () => {
        try {
            const connection = await pool.getConnection();
            console.log('Conexión a la base de datos establecida correctamente');
            connection.release(); // Liberar la conexión al pool
        } catch (err) {
            console.error('Error al conectar a la base de datos:', err.message);
            process.exit(1); // Detener el servidor si no se puede conectar
        }
    };

    testConnection();
} catch (err) {
    console.error('Error al configurar el pool de conexiones:', err.message);
    process.exit(1); // Detener el servidor si ocurre un error crítico al configurar el pool
}

// Exportar el pool
export default pool;
