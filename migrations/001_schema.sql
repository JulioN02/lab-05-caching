-- LAB-05 Caching
-- Migración 001: tabla única para el experimento de caché.
--
-- R18: deliberadamente SIN índice sobre `category`. La variable que se estudia
-- es la caché (evitar recomputar el agregado), no el índice (tema de LAB-03).
-- El UNIQUE en `sku` crea un índice implícito necesario para el path de
-- escritura (UPDATE ... WHERE sku = $1), pero `category` queda sin índice.

CREATE TABLE IF NOT EXISTS stock_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE stock_items IS 'Datos fuente del agregado de stock (LAB-05). Sin índice sobre category (R18, deliberado).';
COMMENT ON COLUMN stock_items.sku IS 'Identificador de producto único (índice implícito por UNIQUE).';
COMMENT ON COLUMN stock_items.category IS 'Categoría del producto; SIN índice (R18).';
COMMENT ON COLUMN stock_items.quantity IS 'Unidades disponibles (>= 0).';