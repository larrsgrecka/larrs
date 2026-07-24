// Recorre el CSV histórico de Producción (mismo Apps Script que usa
// /produccion) y calcula cuántas "recetas" de cada sabor se consumieron en
// cada tienda, convirtiendo kg pesados -> recetas usando el rendimiento por
// receta del Recetario (kilosReceta). El redondeo se hace por fila (cada
// evento de pesaje), no sobre el total agregado, para que una corrección en
// kg negativo también reste recetas consumidas correctamente.
//
// Reimplementa en TS la misma lógica de parseo que ya usa
// src/panels/produccion.html (parseCSV/processCSV) — mismas columnas y
// mismos criterios de fila válida — pero sin acotar a una semana.

import { matchCostos, type RecetaCosto } from "./recetario-costos";

const TIENDAS = new Set(["Costanera", "Dominicos", "Trapenses"]);
const CACHE_TTL_MS = 20 * 60 * 1000;

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

type RecetasConsumidas = Record<string, Record<string, number>>; // tienda -> sabor -> recetas

let cache: { data: RecetasConsumidas; ts: number } | null = null;

async function calcular(recetas: RecetaCosto[]): Promise<RecetasConsumidas> {
  const url = process.env.PRODUCCION_APPS_SCRIPT_URL;
  const token = process.env.PRODUCCION_APPS_SCRIPT_TOKEN;
  if (!url || !token) throw new Error("Apps Script de producción no configurado");

  const resp = await fetch(`${url}?token=${encodeURIComponent(token)}`);
  const text = await resp.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return {};
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

  // kilosReceta por nombre de columna (mismo matching/alias que ya usa el
  // resto de la app para código y costo/kg — así un sabor que no matchea
  // ahí tampoco intenta convertirse acá).
  const costos = matchCostos(flavorCols.map((fc) => fc.name), recetas);

  const out: RecetasConsumidas = {};
  for (const t of TIENDAS) out[t] = {};

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < 6) continue;
    const tienda = (row[2] || "").trim();
    if (!TIENDAS.has(tienda)) continue;
    const tipo = (row[5] || "").toLowerCase();
    if (!tipo.includes("fabricaci")) continue;

    for (const fc of flavorCols) {
      if (fc.idx >= row.length) continue;
      const val = parseFloat((row[fc.idx] || "").replace(",", "."));
      if (!val || val === 0) continue;
      const kilos = costos[fc.name]?.kilosReceta;
      if (!kilos) continue; // sin receta conocida en el Recetario, no se puede convertir
      const kg = toKg(val);
      const recetasConsumidas = Math.round(kg / kilos);
      if (recetasConsumidas === 0) continue;
      out[tienda][fc.name] = (out[tienda][fc.name] || 0) + recetasConsumidas;
    }
  }

  return out;
}

export async function getRecetasConsumidasPorTiendaYSabor(
  recetas: RecetaCosto[]
): Promise<RecetasConsumidas> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
  const data = await calcular(recetas);
  cache = { data, ts: Date.now() };
  return data;
}
