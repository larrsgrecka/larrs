import { fetchAppsScriptJson, urlAppsScript } from "@/utils/apps-script";
import { conRespaldo } from "@/utils/cache-persistente";

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
// producción): una falla acá no debe tumbar el catálogo base completo. Pero
// devolver "sin overrides" ante cualquier error tampoco es inocuo — se pierden
// las exclusiones e inclusiones que cargó un admin, y el catálogo vuelve a
// mostrar productos que alguien sacó a propósito. Medido: la misma llamada dio
// 104 productos en un intento y 73 en el siguiente, según si el Apps Script
// respondía o no.
//
// Ahora se reintenta, se sirve la última copia buena si Google falla, y solo
// cuando no hay ni copia se cae a "sin overrides" — avisando que el resultado
// está degradado, para que nadie lo cachee como si fuera bueno.
async function fetchOverrides(): Promise<{ data: Override[]; degradado: boolean }> {
  const cfg = config();
  if (!cfg) return { data: [], degradado: false };

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return { data: cache.data, degradado: false };

  try {
    const r = await conRespaldo(
      "catalogo-overrides",
      async () => {
        const datos = await fetchAppsScriptJson(
          urlAppsScript(cfg.url, cfg.token, { action: "list" }),
          { servicio: "Catálogo" }
        );
        if (!datos.ok) throw new Error(String(datos.error || "El catálogo no respondió"));
        return (datos.items ?? []) as unknown as Override[];
      },
      // Una lista vacía puede ser legítima (nadie cargó overrides todavía),
      // así que se guarda igual: lo que no se guarda es una falla, y esa ya
      // llega como excepción.
      { esGuardable: () => true }
    );
    if (!r.desdeRespaldo) cache = { data: r.datos, ts: Date.now() };
    return { data: r.datos, degradado: false };
  } catch (e) {
    console.error("[catalogo-overrides] sin overrides y sin copia guardada:", (e as Error).message);
    return { data: [], degradado: true };
  }
}

export async function getOverrides(catalogo: "food" | "sabores"): Promise<{
  incluir: Override[];
  excluirNombres: Set<string>;
  /** true cuando no se pudieron leer: el catálogo resultante está incompleto. */
  degradado: boolean;
}> {
  const { data, degradado } = await fetchOverrides();
  const deEsteCatalogo = data.filter((o) => o.catalogo === catalogo);
  return {
    incluir: deEsteCatalogo.filter((o) => o.tipo === "incluir"),
    excluirNombres: new Set(deEsteCatalogo.filter((o) => o.tipo === "excluir").map((o) => o.nombre)),
    degradado,
  };
}
