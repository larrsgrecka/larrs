import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getProfile } from "@/utils/auth";
import * as XLSX from "xlsx";
import { mapTienda, parseDate, ubicarColumnas } from "@/utils/grecka-excel";

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

  if (rawRows.length < 2) {
    return NextResponse.json({ error: "El archivo no tiene filas de datos." }, { status: 400 });
  }

  // Las columnas se ubican por el nombre del encabezado y no por su posición.
  // El export de Grecka a veces trae una columna "#" de numeración al
  // principio: eso corre todo un lugar, y leyendo por posición el importador
  // buscaba el cliente donde había una celda vacía y descartaba el archivo
  // entero diciendo que no tenía datos de Larrs.
  const columnas = ubicarColumnas(rawRows[0]);
  if (columnas.faltantes.length) {
    return NextResponse.json(
      {
        error:
          `No se reconocieron estas columnas en el archivo: ${columnas.faltantes.join(", ")}. ` +
          `Los encabezados que sí se leyeron son: ${(rawRows[0] as unknown[]).map((h) => String(h).trim()).filter(Boolean).join(" | ")}. ` +
          `¿Es el reporte de facturación que exporta Grecka?`,
      },
      { status: 400 }
    );
  }
  const col = columnas.indices;

  const rows: object[] = [];
  const destinosIgnorados = new Set<string>();
  let filasDeLarrs = 0;

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const nombreCli = (row[col.cliente] || "").toString().toUpperCase();
    if (!nombreCli.includes("CRISTIANO FERRERO") && !nombreCli.includes("FACTORIA DE HELADOS")) continue;
    filasDeLarrs++;

    const destinoRaw = (row[col.destino] || "").toString();
    const tienda = mapTienda(destinoRaw);
    if (!tienda) {
      if (destinoRaw.trim()) destinosIgnorados.add(destinoRaw.trim());
      continue;
    }

    rows.push({
      ndoc: (row[col.ndoc] || "").toString().trim(),
      tienda,
      fecha: parseDate(row[col.fecha]),
      sku: (row[col.sku] || "").toString().trim(),
      descripcion: (row[col.descripcion] || "").toString().trim(),
      grupo: (row[col.grupo] || "").toString().trim(),
      cantidad: parseFloat((row[col.cantidad] || "0").toString()) || 0,
      unidad: (row[col.unidad] || "").toString().trim(),
      precio_unitario: parseFloat((row[col.precio] || "0").toString()) || 0,
      neto: parseFloat((row[col.neto] || "0").toString()) || 0,
      destino_raw: destinoRaw.trim(),
    });
  }

  if (rows.length === 0) {
    // Decir en cuál de los dos filtros se quedó todo: sin esto, el mismo
    // mensaje servía para un archivo equivocado, para uno con las columnas
    // corridas y para uno que solo trae sucursales que no son de Larrs.
    const detalle = filasDeLarrs === 0
      ? `Se leyeron ${rawRows.length - 1} filas, pero ninguna tiene a Cristiano Ferrero o Factoría de Helados como cliente.`
      : `Hay ${filasDeLarrs} filas de Larrs, pero ningún destino corresponde a una tienda. Destinos encontrados: ${[...destinosIgnorados].join(", ") || "(vacíos)"}.`;
    return NextResponse.json({ error: `No se encontraron datos para importar. ${detalle}` }, { status: 400 });
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
