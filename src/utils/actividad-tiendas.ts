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

function maxFecha(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

async function ultimaFechaPorTienda(
  urlEnv: string,
  tokenEnv: string
): Promise<Record<string, string | null>> {
  const url = process.env[urlEnv];
  const token = process.env[tokenEnv];
  const out: Record<string, string | null> = {};
  for (const t of TIENDAS) out[t] = null;
  if (!url || !token) return out;

  try {
    const u = new URL(url);
    u.searchParams.set("token", token);
    u.searchParams.set("action", "list");
    const resp = await fetch(u.toString());
    const data = await resp.json();
    if (!data.ok) return out;

    for (const item of (data.items ?? []) as { tienda?: string; fecha?: string }[]) {
      const tienda = item.tienda;
      const fecha = item.fecha;
      if (!tienda || !fecha || !(tienda in out)) continue;
      out[tienda] = maxFecha(out[tienda], fecha);
    }
  } catch {
    // deja todo en null si falla — no debe tumbar el resto del panel
  }
  return out;
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

async function ultimaFechaPesajePorTienda(): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const t of TIENDAS) out[t] = null;

  const url = process.env.PRODUCCION_APPS_SCRIPT_URL;
  const token = process.env.PRODUCCION_APPS_SCRIPT_TOKEN;
  if (!url || !token) return out;

  try {
    const resp = await fetch(`${url}?token=${encodeURIComponent(token)}`);
    const text = await resp.text();
    const rows = parseCSV(text);
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < 6) continue;
      const tienda = (row[2] || "").trim();
      if (!(tienda in out)) continue;
      const tipo = (row[5] || "").toLowerCase();
      if (!tipo.includes("fabricaci")) continue;
      const fecha = parseFechaDMY(row[3] || "");
      if (!fecha) continue;
      out[tienda] = maxFecha(out[tienda], fecha);
    }
  } catch {
    // deja todo en null si falla
  }
  return out;
}

export async function getActividadTiendas(): Promise<ActividadTiendas> {
  const [mermas, inventario, recepcion, pesaje] = await Promise.all([
    ultimaFechaPorTienda("MERMAS_APPS_SCRIPT_URL", "MERMAS_APPS_SCRIPT_TOKEN"),
    ultimaFechaPorTienda("INVENTARIO_FOOD_APPS_SCRIPT_URL", "INVENTARIO_FOOD_APPS_SCRIPT_TOKEN"),
    ultimaFechaPorTienda("RECEPCION_APPS_SCRIPT_URL", "RECEPCION_APPS_SCRIPT_TOKEN"),
    ultimaFechaPesajePorTienda(),
  ]);

  const out: ActividadTiendas = {};
  for (const t of TIENDAS) {
    out[t] = {
      mermas: mermas[t] ?? null,
      inventario: inventario[t] ?? null,
      pesaje: pesaje[t] ?? null,
      recepcion: recepcion[t] ?? null,
    };
  }
  return out;
}
