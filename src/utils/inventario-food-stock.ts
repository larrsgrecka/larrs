// Stock físico actual por tienda+categoría+producto: el conteo más reciente
// registrado en Inventario Food (no un stock corrido con entradas/salidas, es
// una foto del último conteo manual). Compartido entre el cuadro de valor
// estimado y el de stock mínimo/alertas, para no desalinear el criterio de
// "cuál es el más reciente" entre ambos.

function appsScriptConfig() {
  const url = process.env.INVENTARIO_FOOD_APPS_SCRIPT_URL;
  const token = process.env.INVENTARIO_FOOD_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export type StockRow = {
  tienda: string;
  categoria: string;
  producto: string;
  cantidad: number;
  unidad?: string;
  ubicacion?: string;
  fecha?: string;
  creado_en?: string;
};

function tsFila(r: StockRow): number {
  return new Date(r.creado_en || r.fecha || 0).getTime();
}

// Deduplica a la fila más reciente por tienda+categoria+producto+ubicacion.
//
// Barra y Bodega son conteos independientes del mismo producto, así que cada
// combinación tiene su propia "última fila" y quien necesite el total de un
// producto suma todas las claves que compartan tienda+categoria+producto.
//
// Los conteos hechos antes de que existiera la ubicación no la tienen y
// representan el total del producto (barra y bodega juntas). Sumarlos junto a
// un Barra/Bodega posterior contaría dos veces el mismo stock, así que un
// conteo total sin ubicación y los conteos por ubicación se invalidan entre
// sí: para cada producto vale solo lo registrado después del último conteo
// total sin ubicación, y si ese total es lo más reciente, vale solo él.
export function dedupePorClaveUbicacion<T extends StockRow>(rows: T[]): Record<string, T> {
  const ordenadas = [...rows].sort((a, b) => tsFila(b) - tsFila(a));
  const claveProducto = (r: StockRow) => `${r.tienda}||${r.categoria}||${r.producto}`;

  const porClave: Record<string, T> = {};
  for (const r of ordenadas) {
    const clave = `${claveProducto(r)}||${r.ubicacion || ""}`;
    if (!(clave in porClave)) porClave[clave] = r;
  }

  // Por producto: cuándo fue el último conteo total (sin ubicación) y cuándo el
  // último por ubicación.
  const ultimoTotal: Record<string, number> = {};
  const ultimoPorUbicacion: Record<string, number> = {};
  for (const r of Object.values(porClave)) {
    const p = claveProducto(r);
    const destino = r.ubicacion ? ultimoPorUbicacion : ultimoTotal;
    destino[p] = Math.max(destino[p] ?? -Infinity, tsFila(r));
  }

  for (const [clave, r] of Object.entries(porClave)) {
    const p = claveProducto(r);
    const total = ultimoTotal[p] ?? -Infinity;
    const porUbic = ultimoPorUbicacion[p] ?? -Infinity;
    // El conteo total pierde si hay uno por ubicación más nuevo; los conteos por
    // ubicación anteriores a un total más nuevo ya están incluidos en ese total.
    const obsoleto = r.ubicacion ? tsFila(r) < total : tsFila(r) < porUbic;
    if (obsoleto) delete porClave[clave];
  }

  return porClave;
}

export async function getStockActualPorClave(): Promise<Record<string, StockRow>> {
  const config = appsScriptConfig();
  if (!config) return {};

  let data: { ok: boolean; items?: StockRow[] };
  try {
    const resp = await fetch(`${config.url}?token=${encodeURIComponent(config.token)}&action=list`);
    data = JSON.parse(await resp.text());
  } catch {
    return {};
  }
  if (!data.ok) return {};

  return dedupePorClaveUbicacion(data.items ?? []);
}
