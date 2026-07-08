import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getProfile } from "@/utils/auth";
import * as XLSX from "xlsx";

type Acc = { codigo: string; nombre: string; grupo?: string; anio: number; mes: number; cantidad: number; importe_neto: number };

const COLS = {
  almacen: "Nombre de almacén",
  fecha: "Fecha",
  articulo: "Artículo",
  descArticulo: "Desc.Artículo",
  grupo: "Nombre de grupo",
  cantidad: "Cantidad",
  neto: "Neto",
};

function parseFecha(raw: unknown): { anio: number; mes: number } | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    return { anio: raw.getFullYear(), mes: raw.getMonth() + 1 };
  }
  const s = String(raw).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  return { mes: parseInt(m[2], 10), anio: parseInt(m[3], 10) };
}

function toNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  const n = parseFloat(String(raw ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export async function POST(request: NextRequest) {
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
    return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
  }

  const header = rawRows[0].map((h) => String(h).trim());
  const idx: Record<keyof typeof COLS, number> = {
    almacen: header.indexOf(COLS.almacen),
    fecha: header.indexOf(COLS.fecha),
    articulo: header.indexOf(COLS.articulo),
    descArticulo: header.indexOf(COLS.descArticulo),
    grupo: header.indexOf(COLS.grupo),
    cantidad: header.indexOf(COLS.cantidad),
    neto: header.indexOf(COLS.neto),
  };
  for (const [key, i] of Object.entries(idx)) {
    if (i === -1) {
      return NextResponse.json({ error: `No se encontró la columna "${COLS[key as keyof typeof COLS]}"` }, { status: 400 });
    }
  }

  const porArticulo = new Map<string, Acc>();
  const porGrupo = new Map<string, Acc>();

  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    const tienda = String(row[idx.almacen] ?? "").trim();
    if (!tienda) continue;

    const fecha = parseFecha(row[idx.fecha]);
    if (!fecha) continue;

    const cantidad = toNumber(row[idx.cantidad]);
    const neto = toNumber(row[idx.neto]);

    const codigo = String(row[idx.articulo] ?? "").trim();
    const nombreArticulo = String(row[idx.descArticulo] ?? "").trim();
    const grupo = String(row[idx.grupo] ?? "").trim();
    if (codigo) {
      const key = `${tienda}|${codigo}|${fecha.anio}|${fecha.mes}`;
      const cur = porArticulo.get(key) ?? {
        codigo, nombre: nombreArticulo, grupo, anio: fecha.anio, mes: fecha.mes, cantidad: 0, importe_neto: 0,
      };
      cur.cantidad += cantidad;
      cur.importe_neto += neto;
      porArticulo.set(key, cur);
    }

    if (grupo) {
      const key = `${tienda}|${grupo}|${fecha.anio}|${fecha.mes}`;
      const cur = porGrupo.get(key) ?? {
        codigo: grupo, nombre: grupo, anio: fecha.anio, mes: fecha.mes, cantidad: 0, importe_neto: 0,
      };
      cur.cantidad += cantidad;
      cur.importe_neto += neto;
      porGrupo.set(key, cur);
    }
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const BATCH = 500;

  async function upsertTabla(
    tabla: string,
    map: Map<string, Acc>,
    keyToRow: (key: string, v: Acc) => object,
    onConflict: string
  ) {
    const filas = [...map.entries()].map(([key, v]) => keyToRow(key, v));
    let count = 0;
    for (let i = 0; i < filas.length; i += BATCH) {
      const batch = filas.slice(i, i + BATCH);
      const { error, data } = await admin.from(tabla).upsert(batch, { onConflict }).select("id");
      if (error) throw new Error(`${tabla}: ${error.message}`);
      count += data?.length ?? 0;
    }
    return count;
  }

  try {
    const articulosCount = await upsertTabla(
      "ventas_mensuales_articulo",
      porArticulo,
      (key, v) => ({ tienda: key.split("|")[0], codigo: v.codigo, nombre: v.nombre, grupo: v.grupo || null, anio: v.anio, mes: v.mes, cantidad: v.cantidad, importe_neto: v.importe_neto, updated_at: now }),
      "tienda,codigo,anio,mes"
    );
    const gruposCount = await upsertTabla(
      "ventas_mensuales_grupo",
      porGrupo,
      (key, v) => ({ tienda: key.split("|")[0], grupo: v.nombre, anio: v.anio, mes: v.mes, cantidad: v.cantidad, importe_neto: v.importe_neto, updated_at: now }),
      "tienda,grupo,anio,mes"
    );

    const periodos = [...porArticulo.values()].map((v) => v.anio * 12 + v.mes);
    const min = periodos.length ? Math.min(...periodos) : null;
    const max = periodos.length ? Math.max(...periodos) : null;

    return NextResponse.json({
      ok: true,
      filasArticulo: articulosCount,
      filasGrupo: gruposCount,
      desde: min ? { anio: Math.floor((min - 1) / 12), mes: ((min - 1) % 12) + 1 } : null,
      hasta: max ? { anio: Math.floor((max - 1) / 12), mes: ((max - 1) % 12) + 1 } : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
