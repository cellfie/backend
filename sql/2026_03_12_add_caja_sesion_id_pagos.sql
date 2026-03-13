-- Vincula pagos de ventas a la sesión de caja abierta (para movimientos por sesión).
-- Si la columna caja_sesion_id ya existe en pagos, ejecutar solo las líneas que apliquen.

ALTER TABLE pagos
ADD COLUMN caja_sesion_id INT UNSIGNED NULL DEFAULT NULL AFTER punto_venta_id;

ALTER TABLE pagos
ADD KEY idx_pagos_caja_sesion (caja_sesion_id);

ALTER TABLE pagos
ADD CONSTRAINT fk_pagos_caja_sesion FOREIGN KEY (caja_sesion_id) REFERENCES caja_sesiones(id);
