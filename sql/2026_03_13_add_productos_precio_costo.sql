-- Agrega precio de costo a productos sin afectar el precio de venta actual.
-- Compatible con datos existentes: los productos ya cargados quedan con costo 0.00.
ALTER TABLE productos
ADD COLUMN precio_costo DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER precio;
