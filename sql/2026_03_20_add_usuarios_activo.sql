-- Agrega columna `activo` a `usuarios` si no existe y fuerza unicidad en `nombre`.
-- Útil para implementar desactivar/activar usuarios desde el módulo de administración.

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'usuarios'
    AND column_name = 'activo'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE usuarios ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'usuarios'
    AND index_name = 'uk_usuarios_nombre'
);

SET @sql2 := IF(
  @idx_exists = 0,
  'ALTER TABLE usuarios ADD UNIQUE INDEX uk_usuarios_nombre (nombre)',
  'SELECT 1'
);

PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

