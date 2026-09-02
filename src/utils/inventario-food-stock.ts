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

// El listado completo son ~3.500 filas y 1,2 MB, y el Apps Script tarda entre 4
// y 10 segundos en entregarlo. Varias rutas lo piden (stock y alertas, su Excel,
// el valor de stock, el servidor MCP), así que se cachea en memoria: la primera
// llamada paga el costo y las siguientes salen al instante.
const STOCK_TTL_MS = 5 * 60 * 1000;
let stockCache: { porClave: Record<string, StockRow>; ts: number } | null = null;

export async function getStockActualPorClave(): Promise<Record<string, StockRow>> {
  if (stockCache && Date.now() - stockCache.ts < STOCK_TTL_MS) return stockCache.porClave;

  const config = appsScriptConfig();
  if (!config) throw new Error("Apps Script de Inventario Food no configurado");

  let data: { ok: boolean; error?: string; items?: StockRow[] };
  try {
    // Corte propio para no consumir todo el presupuesto de la función y dejar
    // que la plataforma la mate sin mensaje.
    const resp = await fetch(`${config.url}?token=${encodeURIComponent(config.token)}&action=list`, {
      signal: AbortSignal.timeout(40_000),
    });
    const texto = await resp.text();
    data = JSON.parse(texto);
  } catch (e) {
    // Antes esto devolvía {} en silencio, y quien lo consumía concluía "no hay
    // conteos" en vez de "no pude leer los conteos" — un panel de alertas
    // mostrando cero productos bajo mínimo es peor que uno mostrando un error.
    if (stockCache) return stockCache.porClave;  // mejor un dato de hace minutos
    const timeout = (e as Error)?.name === "TimeoutError";
    throw new Error(
      timeout
        ? "El Apps Script de Inventario Food no respondió en 40 s"
        : `No se pudo leer Inventario Food: ${(e as Error)?.message || "error desconocido"}`
    );
  }
  if (!data.ok) {
    if (stockCache) return stockCache.porClave;
    throw new Error(`Inventario Food devolvió un error: ${data.error || "sin detalle"}`);
  }

  const porClave = dedupePorClaveUbicacion(data.items ?? []);
  stockCache = { porClave, ts: Date.now() };
  return porClave;
}
