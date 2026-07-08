-- Agrega la familia/grupo de artículos a la tabla de ventas por artículo,
-- para poder filtrar el panel /analisis-ventas por familia (Cafetería, Heladería, etc).
alter table ventas_mensuales_articulo add column if not exists grupo text;
create index if not exists idx_vma_grupo on ventas_mensuales_articulo (grupo);
