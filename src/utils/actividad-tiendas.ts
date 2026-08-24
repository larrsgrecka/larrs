// Última fecha de actividad por tienda en cada feature (Mermas, Inventario
// Food, Pesaje de producción, Recepción) — para un panel de monitoreo de
// cumplimiento, no de métricas. Cada fuente se consulta con su propio Apps
// Script tal como ya hacen sus paneles; ninguna falla rompe a las demás.

const TIENDAS = ["Costanera", "Dominicos", "Trapenses"] as const;

export type ActividadTienda = {
  mermas: string | null;
  inventario: string | null;
  pesaje: string | null;
  recepcion: string | null;
};

export type ActividadTiendas = Record<string, ActividadTienda>;

export type ModuloKey = keyof ActividadTienda;

// Una fuente que falla devuelve fechas en null + el motivo, para que el panel
// pueda decir "no pudimos consultar" en vez de mentir con "sin registros".
type FuenteResultado = {
  fechas: Record<string, string | null>;
  error: string | null;
};

// La primera consulta del día a cada Apps Script arranca en frío y Google puede
// tardar decenas de segundos (medido: >40 s con las cuatro fuentes en frío). El
// corte por fuente acota el total de la ruta —todas las esperas empiezan a la
// vez— para que nunca se pase del maxDuration y devuelva un error sin JSON.
const TIMEOUT_MS = 45_000;

function fechasVacias(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const t of TIENDAS) out[t] = null;
  return out;
}

function motivoFalla(e: unknown): string {
  const nombre = (e as Error)?.name;
  if (nombre === "TimeoutError" || nombre === "AbortError") {
    return `Google no respondió en ${TIMEOUT_MS / 1000} s (arranque en frío del Apps Script). Recarga para reintentar.`;
  }
  return `No se pudo consultar el servicio: ${(e as Error)?.message || "error desconocido"}`;
}

function maxFecha(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

async function ultimaFechaPorTienda(
  urlEnv: string,
  tokenEnv: string
): Promise<FuenteResultado> {
  const url = process.env[urlEnv];
  const token = process.env[tokenEnv];
  const fechas = fechasVacias();
  if (!url || !token) {
    return { fechas, error: `Falta configurar ${urlEnv} / ${tokenEnv}.` };
  }

  try {
    const u = new URL(url);
    u.searchParams.set("token", token);
    u.searchParams.set("action", "list");
    const resp = await fetch(u.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await resp.text();
    let data: { ok?: boolean; error?: string; items?: unknown };
    try {
      data = JSON.parse(text);
    } catch {
      console.error(`[actividad-tiendas] ${urlEnv} respondió sin JSON:`, resp.status, text.slice(0, 300));
      return { fechas, error: `El servicio respondió ${resp.status} sin JSON (falla temporal de Google).` };
    }
    if (!data.ok) return { fechas, error: data.error || "El servicio devolvió un error." };

    for (const item of (data.items ?? []) as { tienda?: string; fecha?: string }[]) {
      const tienda = item.tienda;
      const fecha = item.fecha;
      if (!tienda || !fecha || !(tienda in fechas)) continue;
      fechas[tienda] = maxFecha(fechas[tienda], fecha);
    }
  } catch (e) {
    console.error(`[actividad-tiendas] ${urlEnv} falló:`, e);
    return { fechas, error: motivoFalla(e) };
  }
  return { fechas, error: null };
}

function parseCSV(raw: string): string[][] {
  const text = raw.replace(/\r/g, "");
  const rows: string[][] = [];
  let inQ = false;
  let cur = "";
  let fields: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      fields.push(cur);
      cur = "";
    } else if (ch === "\n" && !inQ) {
      fields.push(cur);
      cur = "";
      if (fields.some((f) => f.trim())) rows.push(fields);
      fields = [];
    } else {
      cur += ch;
    }
  }
  if (cur || fields.length) {
    fields.push(cur);
    if (fields.some((f) => f.trim())) rows.push(fields);
  }
  return rows;
}

// Convierte "dd/mm/yyyy ..." a "yyyy-mm-dd" para poder comparar como texto.
function parseFechaDMY(s: string): string | null {
  if (!s) return null;
  const part = s.trim().split(" ")[0];
  const [d, m, y] = part.split("/");
  if (!d || !m || !y) return null;
  const yr = Number(y);
  if (!yr || yr < 2000 || yr > 2100) return null;
  return `${yr}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

async function ultimaFechaPesajePorTienda(): Promise<FuenteResultado> {
  const fechas = fechasVacias();

  const url = process.env.PRODUCCION_APPS_SCRIPT_URL;
  const token = process.env.PRODUCCION_APPS_SCRIPT_TOKEN;
  if (!url || !token) {
    return { fechas, error: "Falta configurar PRODUCCION_APPS_SCRIPT_URL / PRODUCCION_APPS_SCRIPT_TOKEN." };
  }

  try {
    const resp = await fetch(`${url}?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await resp.text();
    const rows = parseCSV(text);
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < 6) continue;
      const tienda = (row[2] || "").trim();
      if (!(tienda in fechas)) continue;
      const tipo = (row[5] || "").toLowerCase();
      if (!tipo.includes("fabricaci")) continue;
      const fecha = parseFechaDMY(row[3] || "");
      if (!fecha) continue;
      fechas[tienda] = maxFecha(fechas[tienda], fecha);
    }
  } catch (e) {
    console.error("[actividad-tiendas] PRODUCCION_APPS_SCRIPT_URL falló:", e);
    return { fechas, error: motivoFalla(e) };
  }
  return { fechas, error: null };
}

export type ActividadResultado = {
  actividad: ActividadTiendas;
  errores: Partial<Record<ModuloKey, string>>;
};

export async function getActividadTiendas(): Promise<ActividadResultado> {
  const [mermas, inventario, recepcion, pesaje] = await Promise.all([
    ultimaFechaPorTienda("MERMAS_APPS_SCRIPT_URL", "MERMAS_APPS_SCRIPT_TOKEN"),
    ultimaFechaPorTienda("INVENTARIO_FOOD_APPS_SCRIPT_URL", "INVENTARIO_FOOD_APPS_SCRIPT_TOKEN"),
    ultimaFechaPorTienda("RECEPCION_APPS_SCRIPT_URL", "RECEPCION_APPS_SCRIPT_TOKEN"),
    ultimaFechaPesajePorTienda(),
  ]);

  const actividad: ActividadTiendas = {};
  for (const t of TIENDAS) {
    actividad[t] = {
      mermas: mermas.fechas[t] ?? null,
      inventario: inventario.fechas[t] ?? null,
      pesaje: pesaje.fechas[t] ?? null,
      recepcion: recepcion.fechas[t] ?? null,
    };
  }

  const errores: Partial<Record<ModuloKey, string>> = {};
  const fuentes: [ModuloKey, FuenteResultado][] = [
    ["mermas", mermas],
    ["inventario", inventario],
    ["pesaje", pesaje],
    ["recepcion", recepcion],
  ];
  for (const [key, fuente] of fuentes) {
    if (fuente.error) errores[key] = fuente.error;
  }

  return { actividad, errores };
}
