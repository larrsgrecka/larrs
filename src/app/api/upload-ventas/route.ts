import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getProfile } from "@/utils/auth";
import * as XLSX from "xlsx";

const TIENDA_MAP: Record<string, string> = {
  "ANDRES BELLO": "Costanera",
  "BELLO 2447": "Costanera",
  "TRAPENSES": "Trapenses",
  "CAMINO EL ALBA": "Dominicos",
  "EL ALBA": "Dominicos",
  "CAMINO DEL CERRO": "Produccion",
};
const EXCLUIR = ["LUIS PASTEUR", "CHAMISERO", "FRANKLIN"];

function mapTienda(destino: string): string | null {
  const d = (destino || "").toUpperCase();
  if (EXCLUIR.some((x) => d.includes(x))) return null;
  for (const [key, tienda] of Object.entries(TIENDA_MAP)) {
    if (d.includes(key)) return tienda;
  }
  return null;
}

function parseDate(raw: unknown): string | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (s.includes("/")) {
    const [d, m, y] = s.split("/");
    if (y && m && d) return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const rows: object[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const nombreCli = (row[4] || "").toString().toUpperCase();
    if (!nombreCli.includes("CRISTIANO FERRERO") && !nombreCli.includes("FACTORIA DE HELADOS")) continue;

    const destinoRaw = (row[31] || "").toString();
    const tienda = mapTienda(destinoRaw);
    if (!tienda) continue;

    rows.push({
      ndoc: (row[1] || "").toString().trim(),
      tienda,
      fecha: parseDate(row[6]),
      sku: (row[13] || "").toString().trim(),
      descripcion: (row[14] || "").toString().trim(),
      grupo: (row[18] || "").toString().trim(),
      cantidad: parseFloat((row[19] || "0").toString()) || 0,
      unidad: (row[20] || "").toString().trim(),
      precio_unitario: parseFloat((row[21] || "0").toString()) || 0,
      neto: parseFloat((row[22] || "0").toString()) || 0,
      destino_raw: destinoRaw.trim(),
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "No se encontraron datos de Larrs en el archivo" }, { status: 400 });
  }

  // Upsert en lotes de 500 usando admin client (bypasa RLS)
  const adminClient = createAdminClient();
  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await adminClient
      .from("ventas_grecka")
      .upsert(batch, { onConflict: "ndoc,sku,cantidad,destino_raw", ignoreDuplicates: true })
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inserted += data?.length ?? 0;
  }

  const tiendaCount: Record<string, number> = {};
  for (const r of rows as { tienda: string }[]) {
    tiendaCount[r.tienda] = (tiendaCount[r.tienda] || 0) + 1;
  }

  return NextResponse.json({ ok: true, total: rows.length, porTienda: tiendaCount });
}
