-- Cuenta corriente para proveedores (deuda por compras a plazo y pagos posteriores)

CREATE TABLE IF NOT EXISTS cuentas_corrientes_proveedores (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  proveedor_id INT UNSIGNED NOT NULL,
  saldo DECIMAL(12,2) NOT NULL DEFAULT 0,
  fecha_ultimo_movimiento DATETIME NULL,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cc_proveedor (proveedor_id),
  KEY idx_cc_proveedor_saldo (saldo),
  CONSTRAINT fk_cc_proveedor_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS movimientos_cuenta_corriente_proveedor (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cuenta_corriente_proveedor_id INT UNSIGNED NOT NULL,
  proveedor_id INT UNSIGNED NOT NULL,
  compra_id INT UNSIGNED NULL,
  pago_id INT UNSIGNED NULL,
  tipo ENUM('cargo','pago') NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  saldo_anterior DECIMAL(12,2) NOT NULL,
  saldo_nuevo DECIMAL(12,2) NOT NULL,
  usuario_id INT UNSIGNED NOT NULL,
  notas VARCHAR(255) NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mov_cc_prov_proveedor_fecha (proveedor_id, fecha),
  KEY idx_mov_cc_prov_tipo (tipo),
  CONSTRAINT fk_mov_cc_prov_cuenta FOREIGN KEY (cuenta_corriente_proveedor_id) REFERENCES cuentas_corrientes_proveedores(id) ON DELETE CASCADE,
  CONSTRAINT fk_mov_cc_prov_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE,
  CONSTRAINT fk_mov_cc_prov_compra FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE SET NULL,
  CONSTRAINT fk_mov_cc_prov_pago FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE SET NULL,
  CONSTRAINT fk_mov_cc_prov_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

