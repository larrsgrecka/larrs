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
