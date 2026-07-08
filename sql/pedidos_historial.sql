-- Historial de pedidos hechos por cada tienda, para poder mostrar "pedido anterior"
-- como referencia al armar el pedido de la semana siguiente.
create table if not exists pedidos_historial (
  id bigint generated always as identity primary key,
  tienda text not null,
  semana_lunes date not null,       -- lunes de la semana de entrega del pedido
  sku text not null,
  descripcion text not null,
  cantidad numeric(12,2) not null,
  um text,
  grupo text,
  created_at timestamptz not null default now(),
  constraint uq_pedido_historial unique (tienda, semana_lunes, sku)
);
create index if not exists idx_pedhist_tienda_sku on pedidos_historial (tienda, sku, semana_lunes desc);

alter table pedidos_historial enable row level security;
create policy "authenticated read pedidos_historial" on pedidos_historial
  for select to authenticated using (true);
