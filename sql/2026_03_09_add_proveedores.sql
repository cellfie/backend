-- Script para crear la tabla de proveedores

CREATE TABLE IF NOT EXISTS proveedores (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(255) NOT NULL,
  telefono VARCHAR(50) NULL,
  email VARCHAR(150) NULL,
  cuit VARCHAR(20) NULL,
  direccion VARCHAR(255) NULL,
  contacto VARCHAR(150) NULL,
  notas TEXT NULL,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  INDEX idx_proveedores_nombre (nombre),
  INDEX idx_proveedores_cuit (cuit)
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

