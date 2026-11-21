-- Vincula repuestos del catálogo a líneas de reparación.
-- Al marcar la reparación como terminada se descuenta stock (puede quedar negativo).

ALTER TABLE detalles_reparacion
  ADD COLUMN repuesto_id INT UNSIGNED NULL AFTER precio,
  ADD COLUMN cantidad DECIMAL(10,2) NOT NULL DEFAULT 1 AFTER repuesto_id,
  ADD COLUMN stock_descontado TINYINT(1) NOT NULL DEFAULT 0 AFTER cantidad;

ALTER TABLE detalles_reparacion
  ADD KEY idx_detalles_rep_repuesto (repuesto_id),
  ADD KEY idx_detalles_rep_stock_desc (stock_descontado);
