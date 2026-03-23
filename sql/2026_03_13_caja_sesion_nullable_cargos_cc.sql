-- Cargos en cuenta corriente (ventas fiadas) no deben exigir sesión de caja.
-- Ajustar columnas para permitir NULL si en tu BD estaban como NOT NULL.

-- Pagos de ventas de equipos: cargo CC sin sesión
ALTER TABLE pagos_ventas_equipos
  MODIFY COLUMN caja_sesion_id INT UNSIGNED NULL DEFAULT NULL;

-- Pagos de reparación: cargo a cuenta sin sesión
ALTER TABLE pagos_reparacion
  MODIFY COLUMN caja_sesion_id INT UNSIGNED NULL DEFAULT NULL;
