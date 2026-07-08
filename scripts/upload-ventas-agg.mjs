#!/usr/bin/env node
// Sube los CSV agregados (generados por aggregate_ventas_tienda.py) a Supabase.
// Uso: node scripts/upload-ventas-agg.mjs <dir_con_los_csv>

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const m = /^([^#=]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1].trim()] = process.env[m[1].trim()] ?? m[2].trim();
  }
}
loadEnv(join(__dirname, "..", ".env.local"));

const dir = process.argv[2];
if (!dir) {
  console.error("Uso: node scripts/upload-ventas-agg.mjs <dir_con_los_csv>");
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function parseCsvLine(line) {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cols.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cols.push(cur);
  return cols;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  });
}

async function upsertTabla(tabla, filas, onConflict) {
  const BATCH = 500;
  let count = 0;
  for (let i = 0; i < filas.length; i += BATCH) {
    const batch = filas.slice(i, i + BATCH);
    const { error, data } = await admin.from(tabla).upsert(batch, { onConflict }).select("id");
    if (error) throw new Error(`${tabla}: ${error.message}`);
    count += data?.length ?? 0;
    process.stdout.write(`\r  ${tabla}: ${count}/${filas.length}`);
  }
  process.stdout.write("\n");
  return count;
}

const now = new Date().toISOString();

console.log("Leyendo ventas_articulo_agg.csv...");
const articuloRows = parseCsv(readFileSync(join(dir, "ventas_articulo_agg.csv"), "utf8")).map((r) => ({
  tienda: r.tienda,
  codigo: r.codigo,
  nombre: r.nombre,
  grupo: r.grupo || null,
  anio: parseInt(r.anio, 10),
  mes: parseInt(r.mes, 10),
  cantidad: parseFloat(r.cantidad),
  importe_neto: parseFloat(r.importe_neto),
  updated_at: now,
}));
console.log(`${articuloRows.length} filas a subir`);
const nArticulo = await upsertTabla("ventas_mensuales_articulo", articuloRows, "tienda,codigo,anio,mes");

console.log("Leyendo ventas_grupo_agg.csv...");
const grupoRows = parseCsv(readFileSync(join(dir, "ventas_grupo_agg.csv"), "utf8")).map((r) => ({
  tienda: r.tienda,
  grupo: r.grupo,
  anio: parseInt(r.anio, 10),
  mes: parseInt(r.mes, 10),
  cantidad: parseFloat(r.cantidad),
  importe_neto: parseFloat(r.importe_neto),
  updated_at: now,
}));
console.log(`${grupoRows.length} filas a subir`);
const nGrupo = await upsertTabla("ventas_mensuales_grupo", grupoRows, "tienda,grupo,anio,mes");

console.log(`\nListo: ${nArticulo} filas en ventas_mensuales_articulo, ${nGrupo} filas en ventas_mensuales_grupo.`);
