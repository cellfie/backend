-- Script para crear las tablas de compras

CREATE TABLE IF NOT EXISTS compras (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero_comprobante VARCHAR(50) NOT NULL,
  proveedor_id INT UNSIGNED NOT NULL,
  usuario_id INT UNSIGNED NOT NULL,
  punto_venta_id INT UNSIGNED NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  porcentaje_descuento DECIMAL(5,2) NOT NULL DEFAULT 0,
  monto_descuento DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  anulada TINYINT(1) NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_anulacion DATETIME NULL,
  motivo_anulacion VARCHAR(255) NULL,
  notas TEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_compras_numero (numero_comprobante),
  KEY idx_compras_fecha (fecha),
  KEY idx_compras_proveedor (proveedor_id),
  CONSTRAINT fk_compras_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
  CONSTRAINT fk_compras_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  CONSTRAINT fk_compras_punto_venta FOREIGN KEY (punto_venta_id) REFERENCES puntos_venta(id)
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS detalle_compras (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  compra_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  cantidad INT UNSIGNED NOT NULL DEFAULT 0,
  costo_unitario DECIMAL(10,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_detalle_compras_compra (compra_id),
  KEY idx_detalle_compras_producto (producto_id),
  CONSTRAINT fk_detalle_compras_compra FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE,
  CONSTRAINT fk_detalle_compras_producto FOREIGN KEY (producto_id) REFERENCES productos(id)
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

