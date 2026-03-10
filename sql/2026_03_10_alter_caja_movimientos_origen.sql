-- Agrega la columna 'origen' a caja_movimientos para separar movimientos por tipo de ingreso

ALTER TABLE caja_movimientos
ADD COLUMN origen ENUM('general', 'ventas_productos', 'ventas_equipos', 'reparaciones') NOT NULL DEFAULT 'general'
AFTER metodo_pago;

