import * as XLSX from "xlsx";
import { descargarArchivoSharePoint } from "./microsoft-graph";

const SHAREPOINT_SITE = "grecka-my.sharepoint.com:/personal/rodrigo_puente_grecka_cl";
const SHAREPOINT_FILE_PATH = "EXCEL_PBI/Recetario Larrs.xlsx";
const SHEET_NAME = "Costo Recetas Helados";
const CACHE_TTL_MS = 10 * 60 * 1000;

export type RecetaCosto = {
  codigo: string;
  nombre: string;
  kilosReceta: number;
  costoTotal: number;
  costoLeche: number;
  costoCrema: number;
  costoSinLecheCrema: number;
  costoKg: number;
};

let cache: { data: RecetaCosto[]; sincronizadoEn: string; expiresAt: number } | null = null;

export async function getRecetarioCostos(
  forzar = false
): Promise<{ recetas: RecetaCosto[]; sincronizadoEn: string }> {
  if (!forzar && cache && Date.now() < cache.expiresAt) {
    return { recetas: cache.data, sincronizadoEn: cache.sincronizadoEn };
  }

  const buffer = await descargarArchivoSharePoint(SHAREPOINT_SITE, SHAREPOINT_FILE_PATH);
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`No se encontró la hoja "${SHEET_NAME}" en el Recetario`);

  const rows = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as (string | number)[][]).slice(1);
  const recetas: RecetaCosto[] = rows
    .filter((r) => r[0] && r[1])
    .map((r) => {
      const kilosReceta = Number(r[2]) || 0;
      const costoTotal = Number(r[3]) || 0;
      return {
        codigo: String(r[0]),
        nombre: String(r[1]),
        kilosReceta,
        costoTotal,
        costoLeche: Number(r[4]) || 0,
        costoCrema: Number(r[5]) || 0,
        costoSinLecheCrema: Number(r[6]) || 0,
        costoKg: kilosReceta > 0 ? costoTotal / kilosReceta : 0,
      };
    });

  const sincronizadoEn = new Date().toISOString();
  cache = { data: recetas, sincronizadoEn, expiresAt: Date.now() + CACHE_TTL_MS };
  return { recetas, sincronizadoEn };
}

function normalizarNombre(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type CostoSabor = { codigo: string; costoKg: number };

// Sabores del CSV de producción que no matchean ni siquiera normalizados
// contra "Nombre Receta" del Recetario, pero se confirmó a mano que
// corresponden a la misma receta con otro nombre.
const ALIAS_SABOR: Record<string, string> = {
  "Chocolate BIG o S/A": "Chocolate BIG",
  "Pistacho Larrs(Pasta Natura 20/80 Qbo)": "Pistacho Larrs (Pasta Natura 20/80 Frutos Secos)",
  "Yogurt Vet. Guinda (Megamarena)": "Yogurt Vet. Guinda",
};

// Empareja nombres de sabor (del CSV de producción, que no siempre calzan
// letra por letra con "Nombre Receta" del Recetario) contra el costo real
// por kilo de cada receta.
export function matchCostos(sabores: string[], recetas: RecetaCosto[]): Record<string, CostoSabor> {
  const porNombreNorm = new Map(recetas.map((r) => [normalizarNombre(r.nombre), r]));
  const out: Record<string, CostoSabor> = {};
  for (const s of sabores) {
    const nombreBuscado = ALIAS_SABOR[s] || s;
    const receta = porNombreNorm.get(normalizarNombre(nombreBuscado));
    if (receta) out[s] = { codigo: receta.codigo, costoKg: receta.costoKg };
  }
  return out;
}

// Trae el Recetario y hace el match — nunca lanza, si el Recetario no está
// disponible (SharePoint caído, credenciales, etc.) devuelve un mapa vacío
// en vez de romper el catálogo de sabores que sí funciona. Cuando el
// caller también necesita hacer fetch de los sabores, mejor correr
// getRecetarioCostos() en paralelo (Promise.all) y llamar matchCostos()
// directo, para no encadenar dos fetches lentos uno tras otro.
export async function getCostosPorSabor(sabores: string[]): Promise<Record<string, CostoSabor>> {
  try {
    const { recetas } = await getRecetarioCostos();
    return matchCostos(sabores, recetas);
  } catch {
    return {};
  }
}
