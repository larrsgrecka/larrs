// Lista cruda de pesajes registrados (una fila del CSV = un "Guardar pesaje"),
// para que un admin pueda revisar qué se pesó y por quién antes de decidir si
// hace una corrección — hoy esa info solo vivía en la planilla, invisible
// desde la app. Reimplementa el mismo parseo de columnas que ya usan
// produccion.html y produccion-recetas-consumidas.ts (misma fuente de datos).

const TIENDAS = ["Costanera", "Dominicos", "Trapenses"] as const;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type ItemPesaje = { sabor: string; kg: number };
export type RegistroPesaje = {
  marcaTemporal: string;
  tienda: string;
  fecha: string; // yyyy-mm-dd
  nombre: string;
  email: string;
  observaciones: string;
  items: ItemPesaje[];
};

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

function toKg(v: number): number {
  return v >= 100 ? v / 1000 : v;
}

function parseFechaDMY(s: string): string | null {
  if (!s) return null;
  const part = s.trim().split(" ")[0];
  const [d, m, y] = part.split("/");
  if (!d || !m || !y) return null;
  const yr = Number(y);
  if (!yr || yr < 2000 || yr > 2100) return null;
  return `${yr}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// "d/m/yyyy h:mm:ss" -> "yyyy-mm-dd hh:mm:ss", comparable como texto. La
// "Marca temporal" cruda no es ordenable directamente como string (día/mes
// sin ceros a la izquierda hace que "9/7/2026" > "30/7/2026" léxicamente).
function marcaTemporalKey(s: string): string {
  if (!s) return "";
  const [fechaParte, horaParte] = s.trim().split(" ");
  const fecha = parseFechaDMY(fechaParte);
  if (!fecha) return "";
  return `${fecha} ${horaParte || ""}`;
}

let cache: { registros: RegistroPesaje[]; ts: number } | null = null;

async function calcularRegistros(): Promise<RegistroPesaje[]> {
  const url = process.env.PRODUCCION_APPS_SCRIPT_URL;
  const token = process.env.PRODUCCION_APPS_SCRIPT_TOKEN;
  if (!url || !token) throw new Error("Apps Script de producción no configurado");

  const resp = await fetch(`${url}?token=${encodeURIComponent(token)}`);
  const text = await resp.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0];

  const flavorCols: { idx: number; name: string }[] = [];
  for (let i = 6; i < headers.length; i++) {
    if (headers[i].includes("#;")) {
      const hdr = headers[i];
      const cut = Math.min(
        hdr.includes("[") ? hdr.indexOf("[") : hdr.length,
        hdr.includes("#") ? hdr.indexOf("#") : hdr.length
      );
      flavorCols.push({ idx: i, name: hdr.slice(0, cut).trim() });
    }
  }
  const obsIdx = headers.findIndex((h) => h.includes("observaci"));

  const registros: RegistroPesaje[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < 6) continue;
    const tienda = (row[2] || "").trim();
    if (!(TIENDAS as readonly string[]).includes(tienda)) continue;
    const tipo = (row[5] || "").toLowerCase();
    if (!tipo.includes("fabricaci")) continue;
    const fecha = parseFechaDMY(row[3] || "");
    if (!fecha) continue;

    const items: ItemPesaje[] = [];
    for (const fc of flavorCols) {
      if (fc.idx >= row.length) continue;
      const raw = (row[fc.idx] || "").trim();
      if (!raw) continue;
      const val = parseFloat(raw.replace(",", "."));
      if (!val) continue;
      items.push({ sabor: fc.name, kg: toKg(val) });
    }
    if (items.length === 0) continue;

    registros.push({
      marcaTemporal: row[0] || "",
      tienda,
      fecha,
      nombre: (row[4] || "").trim(),
      email: (row[1] || "").trim(),
      observaciones: obsIdx >= 0 ? (row[obsIdx] || "").trim() : "",
      items,
    });
  }

  registros.sort((a, b) => {
    const ka = marcaTemporalKey(a.marcaTemporal);
    const kb = marcaTemporalKey(b.marcaTemporal);
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  return registros;
}

async function getRegistros(): Promise<RegistroPesaje[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.registros;
  const registros = await calcularRegistros();
  cache = { registros, ts: Date.now() };
  return registros;
}

// tienda: si se pasa, filtra solo esa tienda. limite: cuántos registros
// devolver como máximo (los más recientes primero).
export async function getRegistrosPesaje(tienda?: string, limite = 20): Promise<RegistroPesaje[]> {
  const todos = await getRegistros();
  const filtrados = tienda ? todos.filter((r) => r.tienda === tienda) : todos;
  return filtrados.slice(0, limite);
}
