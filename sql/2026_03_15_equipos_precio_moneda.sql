-- Permitir precios de equipos en USD o ARS.
-- Equipos existentes quedan en USD (precio actual en dólares).

ALTER TABLE equipos
ADD COLUMN precio_moneda ENUM('USD','ARS') NOT NULL DEFAULT 'USD' AFTER tipo_cambio_original;
