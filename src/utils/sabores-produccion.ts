// Lee el CSV real de producción (mismo Apps Script que ya usa /produccion)
// y extrae solo los nombres de sabores terminados (columnas con "#;" en el
// header) — Bases ("$;") y PreRecetas/insumos ("[;") quedan fuera, igual
// que en produccion.html.
import { getOverrides } from "@/utils/catalogo-overrides";

function parseCsvFirstLine(text: string): string[] {
  const rows: string[][] = [];
  let inQ = false, cur = "", fields: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      fields.push(cur); cur = "";
    } else if (ch === "\n" && !inQ) {
      fields.push(cur); cur = "";
      rows.push(fields);
      fields = [];
      break; // solo necesitamos la primera fila (headers)
    } else {
      cur += ch;
    }
  }
  if (rows.length === 0 && (cur || fields.length)) {
    fields.push(cur);
    rows.push(fields);
  }
  return rows[0] || [];
}

function nombreSabor(header: string): string {
  const cutBracket = header.includes("[") ? header.indexOf("[") : header.length;
  const cutHash = header.includes("#") ? header.indexOf("#") : header.length;
  return header.slice(0, Math.min(cutBracket, cutHash)).trim();
}

let cache: { sabores: string[]; ts: number } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

async function getSaboresBase(): Promise<string[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.sabores;

  const url = process.env.PRODUCCION_APPS_SCRIPT_URL;
  const token = process.env.PRODUCCION_APPS_SCRIPT_TOKEN;
  if (!url || !token) throw new Error("Apps Script de producción no configurado");

  const resp = await fetch(`${url}?token=${encodeURIComponent(token)}`);
  const text = await resp.text();
  const headers = parseCsvFirstLine(text);

  const sabores = headers
    .filter((h) => h.includes("#;"))
    .map(nombreSabor)
    .sort((a, b) => a.localeCompare(b));

  cache = { sabores, ts: Date.now() };
  return sabores;
}

// Los admins pueden agregar/excluir sabores puntuales sin tocar código vía
// /catalogo (ver catalogo-overrides.ts). El CSV de producción es lento de
// leer (~7s, planilla grande) — se corre en paralelo con los overrides en
// vez de encadenarlos, para no sumar tiempo extra a un fetch ya lento.
export async function getSaboresProduccion(): Promise<string[]> {
  const [base, { incluir, excluirNombres }] = await Promise.all([
    getSaboresBase(),
    getOverrides("sabores"),
  ]);

  const conExclusiones = base.filter((s) => !excluirNombres.has(s));
  for (const ov of incluir) {
    if (!conExclusiones.includes(ov.nombre)) conExclusiones.push(ov.nombre);
  }
  return conExclusiones.sort((a, b) => a.localeCompare(b));
}
