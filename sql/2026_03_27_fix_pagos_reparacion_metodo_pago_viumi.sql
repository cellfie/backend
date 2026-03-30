-- Permite métodos de pago nuevos (ej: viumi) en pagos de reparación.
-- En algunas bases la columna quedó como ENUM sin 'viumi', generando:
-- "Data truncated for column 'metodo_pago'".
ALTER TABLE pagos_reparacion
MODIFY COLUMN metodo_pago VARCHAR(100) NOT NULL;

