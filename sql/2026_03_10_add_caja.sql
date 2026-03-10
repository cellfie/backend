-- Script para crear las tablas de caja (sesiones y movimientos)

CREATE TABLE IF NOT EXISTS caja_sesiones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  punto_venta_id INT UNSIGNED NOT NULL,
  usuario_apertura_id INT UNSIGNED NOT NULL,
  fecha_apertura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  monto_apertura DECIMAL(10,2) NOT NULL DEFAULT 0,
  usuario_cierre_id INT UNSIGNED NULL,
  fecha_cierre DATETIME NULL,
  monto_cierre DECIMAL(10,2) NULL,
  diferencia DECIMAL(10,2) NULL,
  estado ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
  notas_apertura VARCHAR(255) NULL,
  notas_cierre VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_caja_sesiones_pv (punto_venta_id),
  KEY idx_caja_sesiones_estado (estado),
  CONSTRAINT fk_caja_sesiones_pv FOREIGN KEY (punto_venta_id) REFERENCES puntos_venta(id),
  CONSTRAINT fk_caja_sesiones_usuario_apertura FOREIGN KEY (usuario_apertura_id) REFERENCES usuarios(id),
  CONSTRAINT fk_caja_sesiones_usuario_cierre FOREIGN KEY (usuario_cierre_id) REFERENCES usuarios(id)
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

-- Para asegurar que solo haya una sesión abierta por punto de venta,
-- se puede agregar un índice parcial en motores que lo soporten.
-- En MySQL estándar usaremos una CONSTRAINT lógica en el backend.

CREATE TABLE IF NOT EXISTS caja_movimientos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  caja_sesion_id INT UNSIGNED NOT NULL,
  tipo ENUM('ingreso','egreso') NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  metodo_pago VARCHAR(100) NULL,
  usuario_id INT UNSIGNED NOT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  referencia_id INT UNSIGNED NULL,
  tipo_referencia VARCHAR(50) NULL,
  PRIMARY KEY (id),
  KEY idx_caja_movimientos_sesion (caja_sesion_id),
  KEY idx_caja_movimientos_fecha (fecha),
  CONSTRAINT fk_caja_movimientos_sesion FOREIGN KEY (caja_sesion_id) REFERENCES caja_sesiones(id),
  CONSTRAINT fk_caja_movimientos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

