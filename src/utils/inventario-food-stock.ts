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
  fecha?: string;
  creado_en?: string;
};

// clave "tienda||categoria||producto" -> fila más reciente.
export async function getStockActualPorClave(): Promise<Record<string, StockRow>> {
  const config = appsScriptConfig();
  if (!config) return {};

  const resp = await fetch(`${config.url}?token=${encodeURIComponent(config.token)}&action=list`);
  const data = await resp.json();
  if (!data.ok) return {};

  const rows = (data.items ?? []) as StockRow[];
  rows.sort((a, b) => {
    const da = new Date(a.creado_en || a.fecha || 0).getTime();
    const db = new Date(b.creado_en || b.fecha || 0).getTime();
    return db - da;
  });

  const porClave: Record<string, StockRow> = {};
  for (const r of rows) {
    const clave = `${r.tienda}||${r.categoria}||${r.producto}`;
    if (!(clave in porClave)) porClave[clave] = r;
  }
  return porClave;
}
