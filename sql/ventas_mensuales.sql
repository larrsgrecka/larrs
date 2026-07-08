-- Ejecutar manualmente en el SQL editor de Supabase (no hay CLI de migraciones en este repo).
-- Tablas para el panel /analisis-ventas: ventas mensuales agregadas por tienda,
-- generadas a partir de "Ventas por tienda.xlsx" (extracto transaccional SAP).

create table if not exists ventas_mensuales_articulo (
  id bigint generated always as identity primary key,
  tienda text not null,                 -- 'Costanera' | 'Dominicos' | 'Trapenses' | 'Vitacura'
  codigo text not null,                 -- Artículo (SKU)
  nombre text not null,                 -- Desc.Artículo
  anio int not null,
  mes int not null check (mes between 1 and 12),
  periodo int generated always as (anio * 12 + mes) stored,
  cantidad numeric(14,3) not null default 0,
  importe_neto numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_ventas_articulo unique (tienda, codigo, anio, mes)
);
create index if not exists idx_vma_tienda_periodo on ventas_mensuales_articulo (tienda, periodo);
create index if not exists idx_vma_periodo on ventas_mensuales_articulo (periodo);

create table if not exists ventas_mensuales_grupo (
  id bigint generated always as identity primary key,
  tienda text not null,
  grupo text not null,                  -- Nombre de grupo (HELADERIA, PASTELERIA, ...)
  anio int not null,
  mes int not null check (mes between 1 and 12),
  periodo int generated always as (anio * 12 + mes) stored,
  cantidad numeric(14,3) not null default 0,
  importe_neto numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_ventas_grupo unique (tienda, grupo, anio, mes)
);
create index if not exists idx_vmg_tienda_periodo on ventas_mensuales_grupo (tienda, periodo);
create index if not exists idx_vmg_periodo on ventas_mensuales_grupo (periodo);

alter table ventas_mensuales_articulo enable row level security;
alter table ventas_mensuales_grupo enable row level security;

create policy "authenticated read articulo" on ventas_mensuales_articulo
  for select to authenticated using (true);
create policy "authenticated read grupo" on ventas_mensuales_grupo
  for select to authenticated using (true);
