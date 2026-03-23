-- Evita errores "Data truncated for column tipo_referencia"
-- cuando se registran pagos de compras (u otros tipos nuevos).
-- Se pasa a VARCHAR(50) para no depender de un ENUM rígido.
ALTER TABLE pagos
MODIFY COLUMN tipo_referencia VARCHAR(50) NOT NULL;
