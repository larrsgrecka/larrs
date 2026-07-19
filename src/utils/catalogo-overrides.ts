export type Override = {
  id: string;
  catalogo: "food" | "sabores";
  tipo: "incluir" | "excluir";
  categoria: string;
  nombre: string;
  unidad: string;
  creado_en: string;
  creado_por: string;
};

function config() {
  const url = process.env.CATALOGO_APPS_SCRIPT_URL;
  const token = process.env.CATALOGO_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

// Cache muy corta: es una sola llamada liviana al Apps Script (a diferencia
// del catálogo de ventas de ~12k filas), así que preferimos que un admin vea
// su cambio reflejado casi al instante en vez de ahorrar esta consulta.
let cache: { data: Override[]; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 1000;

// Los overrides son un extra opcional sobre el catálogo real (ventas/CSV de
// producción) — cualquier falla acá (red, JSON inválido, Apps Script caído)
// NUNCA debe tumbar el catálogo base completo, así que todo error se traga
// y devuelve simplemente "sin overrides" en vez de propagar la excepción.
async function fetchOverrides(): Promise<Override[]> {
  try {
    const cfg = config();
    if (!cfg) return [];

    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;

    const url = new URL(cfg.url);
    url.searchParams.set("token", cfg.token);
    url.searchParams.set("action", "list");
    const resp = await fetch(url.toString());
    const data = await resp.json();
    if (!data.ok) return [];

    cache = { data: (data.items ?? []) as Override[], ts: Date.now() };
    return cache.data;
  } catch {
    return [];
  }
}

export async function getOverrides(catalogo: "food" | "sabores"): Promise<{
  incluir: Override[];
  excluirNombres: Set<string>;
}> {
  const all = await fetchOverrides();
  const deEsteCatalogo = all.filter((o) => o.catalogo === catalogo);
  return {
    incluir: deEsteCatalogo.filter((o) => o.tipo === "incluir"),
    excluirNombres: new Set(deEsteCatalogo.filter((o) => o.tipo === "excluir").map((o) => o.nombre)),
  };
}
