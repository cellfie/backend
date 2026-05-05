-- Corrige "Data truncated for column tipo_referencia" al registrar pagos de cuenta corriente.
-- Algunos entornos quedaron con tipo_referencia como ENUM rígido.
-- Se normaliza a VARCHAR para permitir tipos actuales y futuros.

ALTER TABLE pagos
MODIFY COLUMN tipo_referencia VARCHAR(50) NOT NULL;

ALTER TABLE movimientos_cuenta_corriente
MODIFY COLUMN tipo_referencia VARCHAR(50) NULL;

