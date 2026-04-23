-- Guardar el precio de venta aplicado al momento de la compra por cada ítem.
-- Esto permite auditar histórico aunque luego cambie el precio del producto.
ALTER TABLE detalle_compras
ADD COLUMN precio_venta_unitario DECIMAL(10,2) NULL DEFAULT NULL AFTER costo_unitario;

