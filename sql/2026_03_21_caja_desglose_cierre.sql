-- Desglose del conteo físico al cerrar caja (monto inicial separado de ventas, etc.)
ALTER TABLE caja_sesiones
  ADD COLUMN desglose_cierre_json JSON NULL DEFAULT NULL COMMENT 'Conteo al cerrar: monto_inicial, ventas, etc.' AFTER notas_cierre;
