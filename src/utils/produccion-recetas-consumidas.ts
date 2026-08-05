// Recorre el CSV histórico de Producción (mismo Apps Script que usa
// /produccion) y calcula, por fila, cuántas "recetas" de cada sabor se
// consumieron en cada tienda, convirtiendo kg pesados -> recetas usando el
// rendimiento por receta del Recetario (kilosReceta). El redondeo se hace
// por fila (cada evento de pesaje), no sobre el total agregado, para que una
// corrección en kg negativo también reste recetas consumidas correctamente.
//
// El consumo histórico (de antes de que existiera "recetas recibidas" en
// Recepción) NO debe restar del saldo — por eso esto solo cachea las filas
// crudas (tienda, sabor, fecha, recetas de esa fila); el filtro por fecha de
// corte (primera recepción registrada, por tienda+sabor) se aplica después,
// en cada request, para no tener que rehacer el parseo pesado del CSV cada
// vez que cambia el corte.
//
// Reimplementa en TS la misma lógica de parseo que ya usa
// src/panels/produccion.html (parseCSV/processCSV) — mismas columnas y
// mismos criterios de fila válida.

import { matchCostos, type RecetaCosto } from "./recetario-costos";

const TIENDAS = ["Costanera", "Dominicos", "Trapenses"] as const;
const CACHE_TTL_MS = 20 * 60 * 1000;

type FilaConsumo = { tienda: string; sabor: string; fecha: string; recetas: number };

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

// Convierte "dd/mm/yyyy ..." a "yyyy-mm-dd" para poder comparar como texto.
// fallbackYear (año de la "Marca temporal" de envío) corrige typos de año en
// la "Fecha de recuento" tipeada a mano — visto en producción real: alguien
// escribió "23/7/2024" el mismo día que envió el formulario en 2026 (día/mes
// correctos, año typo). La fecha de recuento siempre es "hoy" o "ayer" en
// este flujo, así que cualquier año a 2+ años del año de envío es un typo,
// no una fecha real.
function parseFechaDMY(s: string, fallbackYear?: number): string | null {
  if (!s) return null;
  const part = s.trim().split(" ")[0];
  const [d, m, y] = part.split("/");
  if (!d || !m || !y) return null;
  let yr = Number(y);
  if (!yr || yr < 2000 || yr > 2100) return null;
  if (fallbackYear && Math.abs(yr - fallbackYear) > 1) yr = fallbackYear;
  return `${yr}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

let cache: { filas: FilaConsumo[]; ts: number } | null = null;

async function calcularFilas(recetas: RecetaCosto[]): Promise<FilaConsumo[]> {
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

  const costos = matchCostos(flavorCols.map((fc) => fc.name), recetas);
  const filas: FilaConsumo[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < 6) continue;
    const tienda = (row[2] || "").trim();
    if (!(TIENDAS as readonly string[]).includes(tienda)) continue;
    const tipo = (row[5] || "").toLowerCase();
    if (!tipo.includes("fabricaci")) continue;
    const tsYear = parseFechaDMY(row[0] || "")?.slice(0, 4);
    const fecha = parseFechaDMY(row[3] || "", tsYear ? Number(tsYear) : undefined);
    if (!fecha) continue;

    for (const fc of flavorCols) {
      if (fc.idx >= row.length) continue;
      const val = parseFloat((row[fc.idx] || "").replace(",", "."));
      if (!val || val === 0) continue;
      const kilos = costos[fc.name]?.kilosReceta;
      if (!kilos) continue;
      const kg = toKg(val);
      const recetasConsumidas = Math.round(kg / kilos);
      if (recetasConsumidas === 0) continue;
      filas.push({ tienda, sabor: fc.name, fecha, recetas: recetasConsumidas });
    }
  }

  return filas;
}

async function getFilas(recetas: RecetaCosto[]): Promise<FilaConsumo[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.filas;
  const filas = await calcularFilas(recetas);
  cache = { filas, ts: Date.now() };
  return filas;
}

// cortePorTiendaYSabor: tienda -> sabor -> fecha (yyyy-mm-dd) de la PRIMERA
// recepción registrada para ese sabor en esa tienda. Solo se cuenta consumo
// de esa fecha en adelante — el consumo de antes (previo a que existiera
// "recetas recibidas") no debe restar del saldo. Si no hay corte para un
// sabor+tienda (nunca se ha recibido nada), el consumo de ese sabor en esa
// tienda no se cuenta (queda en 0, no en negativo).
export async function getRecetasConsumidasPorTiendaYSabor(
  recetas: RecetaCosto[],
  cortePorTiendaYSabor: Record<string, Record<string, string>>
): Promise<Record<string, Record<string, number>>> {
  const filas = await getFilas(recetas);
  const out: Record<string, Record<string, number>> = {};
  for (const t of TIENDAS) out[t] = {};

  for (const fila of filas) {
    const corte = cortePorTiendaYSabor[fila.tienda]?.[fila.sabor];
    if (!corte || fila.fecha < corte) continue;
    out[fila.tienda][fila.sabor] = (out[fila.tienda][fila.sabor] || 0) + fila.recetas;
  }

  return out;
}
