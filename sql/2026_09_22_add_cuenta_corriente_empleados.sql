-- Cuenta corriente de empleados (retiros de caja a liquidar / pagos posteriores)

CREATE TABLE IF NOT EXISTS cuentas_corrientes_empleados (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  saldo DECIMAL(12,2) NOT NULL DEFAULT 0,
  fecha_ultimo_movimiento DATETIME NULL,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cc_empleado_usuario (usuario_id),
  KEY idx_cc_empleado_saldo (saldo),
  CONSTRAINT fk_cc_empleado_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS movimientos_cuenta_corriente_empleado (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cuenta_corriente_empleado_id INT UNSIGNED NOT NULL,
  usuario_id INT UNSIGNED NOT NULL,
  caja_movimiento_id INT UNSIGNED NULL,
  tipo ENUM('cargo','pago') NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  saldo_anterior DECIMAL(12,2) NOT NULL,
  saldo_nuevo DECIMAL(12,2) NOT NULL,
  registrado_por_usuario_id INT UNSIGNED NOT NULL,
  notas VARCHAR(255) NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mov_cc_emp_usuario_fecha (usuario_id, fecha),
  KEY idx_mov_cc_emp_tipo (tipo),
  CONSTRAINT fk_mov_cc_emp_cuenta FOREIGN KEY (cuenta_corriente_empleado_id) REFERENCES cuentas_corrientes_empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_mov_cc_emp_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_mov_cc_emp_registrado FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuarios(id),
  CONSTRAINT fk_mov_cc_emp_caja_mov FOREIGN KEY (caja_movimiento_id) REFERENCES caja_movimientos(id) ON DELETE SET NULL
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;
