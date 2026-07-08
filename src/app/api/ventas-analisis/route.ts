import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { TIENDAS_VENTAS, esTiendaActiva } from "@/utils/tiendas";
import { nombreMes } from "@/utils/meses-es";

type Totales = { cantidad: number; importe_neto: number };
type Row = { tienda: string; codigo: string; nombre: string; periodo: number; cantidad: number; importe_neto: number };

function variacion(base: number | null | undefined, actual: number | null | undefined): number | null {
  if (base == null || actual == null || base === 0) return null;
  return ((actual - base) / base) * 100;
}

// Supabase/PostgREST limita cada respuesta a 1000 filas por defecto — con
// nivel "articulo" (muchos códigos x 24 meses) se supera fácil, así que hay
// que paginar con .range() hasta agotar los resultados.
async function fetchAllRows(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  const sp = request.nextUrl.searchParams;
  const nivel = sp.get("nivel") === "articulo" ? "articulo" : "grupo";
  const anio = parseInt(sp.get("anio") || "", 10);
  const mes = parseInt(sp.get("mes") || "", 10);
  const codigoFiltro = sp.get("codigo") || null;
  // Filtro por familia (grupo de artículos) — solo aplica a nivel "articulo",
  // la tabla de grupo ya está agrupada por familia (el "codigo" ES la familia).
  const familiaFiltro = nivel === "articulo" ? sp.get("familia") || null : null;
  if (!anio || !mes) return NextResponse.json({ error: "anio y mes son requeridos" }, { status: 400 });

  let tiendas: string[];
  if (profile?.role === "jefe_tienda") {
    if (!profile.tienda) return NextResponse.json({ error: "Tu usuario no tiene tienda asignada" }, { status: 403 });
    tiendas = [profile.tienda];
  } else {
    const t = sp.get("tienda");
    if (t) {
      tiendas = [t];
    } else {
      tiendas = [...TIENDAS_VENTAS]; // agregado admin: excluye Vitacura (cerrada) por defecto
    }
  }

  const tabla = nivel === "articulo" ? "ventas_mensuales_articulo" : "ventas_mensuales_grupo";
  const columnaCodigo = nivel === "articulo" ? "codigo" : "grupo";
  const selectCols = nivel === "articulo"
    ? "tienda, codigo, nombre, periodo, cantidad, importe_neto"
    : "tienda, grupo, periodo, cantidad, importe_neto";
  const periodoActual = anio * 12 + mes;
  // Ventana de 2 años calendario completos (anio-1 y anio) para poder graficar
  // año actual vs año anterior mes a mes, además de resolver MoM/YoY.
  const periodoInicio = (anio - 1) * 12 + 1;
  const periodoFin = anio * 12 + 12;

  let data: Record<string, unknown>[];
  try {
    data = await fetchAllRows((from, to) => {
      let q = supabase
        .from(tabla)
        .select(selectCols as "*")
        .gte("periodo", periodoInicio)
        .lte("periodo", periodoFin)
        .in("tienda", tiendas)
        .range(from, to);
      if (codigoFiltro) q = q.eq(columnaCodigo, codigoFiltro);
      if (familiaFiltro) q = q.eq("grupo", familiaFiltro);
      return q;
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const rows = data.map((r: Record<string, unknown>) => ({
    tienda: r.tienda as string,
    codigo: r[columnaCodigo] as string,
    nombre: (nivel === "articulo" ? r.nombre : r[columnaCodigo]) as string,
    periodo: r.periodo as number,
    cantidad: Number(r.cantidad),
    importe_neto: Number(r.importe_neto),
  })) as Row[];

  const porPeriodo = new Map<number, Totales>();
  for (const r of rows) {
    const cur = porPeriodo.get(r.periodo) ?? { cantidad: 0, importe_neto: 0 };
    cur.cantidad += r.cantidad;
    cur.importe_neto += r.importe_neto;
    porPeriodo.set(r.periodo, cur);
  }

  const get = (p: number): Totales | null => porPeriodo.get(p) ?? null;
  const actual = get(periodoActual);
  const mesAnterior = get(periodoActual - 1);
  const anioAnterior = get(periodoActual - 12);

  function serieAnio(a: number) {
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const v = get(a * 12 + m);
      return {
        mes: m,
        label: nombreMes(m).slice(0, 3),
        cantidad: v?.cantidad ?? null,
        importe_neto: v?.importe_neto ?? null,
      };
    });
  }
  const serieAnioActual = serieAnio(anio);
  const serieAnioAnterior = serieAnio(anio - 1);

  let desglose: Array<{
    codigo: string; nombre: string; cantidad: number; importe_neto: number;
    mom_pct: number | null; yoy_pct: number | null;
    cantidad_mom: number | null; cantidad_yoy: number | null;
  }> | null = null;
  if (!codigoFiltro) {
    const porCodigo = new Map<string, {
      nombre: string; actual: number; anterior: number; yoy: number;
      cantidad: number; cantidadAnterior: number | null; cantidadYoy: number | null;
    }>();
    for (const r of rows) {
      if (r.periodo !== periodoActual && r.periodo !== periodoActual - 1 && r.periodo !== periodoActual - 12) continue;
      const cur = porCodigo.get(r.codigo) ?? { nombre: r.nombre, actual: 0, anterior: 0, yoy: 0, cantidad: 0, cantidadAnterior: null, cantidadYoy: null };
      if (r.periodo === periodoActual) { cur.actual += r.importe_neto; cur.cantidad += r.cantidad; }
      if (r.periodo === periodoActual - 1) { cur.anterior += r.importe_neto; cur.cantidadAnterior = (cur.cantidadAnterior ?? 0) + r.cantidad; }
      if (r.periodo === periodoActual - 12) { cur.yoy += r.importe_neto; cur.cantidadYoy = (cur.cantidadYoy ?? 0) + r.cantidad; }
      porCodigo.set(r.codigo, cur);
    }
    desglose = [...porCodigo.entries()]
      .map(([codigo, v]) => ({
        codigo,
        nombre: v.nombre,
        cantidad: v.cantidad,
        importe_neto: v.actual,
        mom_pct: variacion(v.anterior, v.actual),
        yoy_pct: variacion(v.yoy, v.actual),
        cantidad_mom: v.cantidadAnterior == null ? null : v.cantidad - v.cantidadAnterior,
        cantidad_yoy: v.cantidadYoy == null ? null : v.cantidad - v.cantidadYoy,
      }))
      // Solo interesa lo que vendió algo este mes — un código sin venta actual
      // pero con historial en mes/año anterior no debería aparecer como "top".
      .filter((v) => v.cantidad !== 0 || v.importe_neto !== 0)
      .sort((a, b) => b.importe_neto - a.importe_neto)
      .slice(0, 15);
  }

  return NextResponse.json({
    ok: true,
    meta: {
      nivel,
      anio,
      mes,
      mesNombre: nombreMes(mes),
      tienda: tiendas.length === 1 ? tiendas[0] : "TODAS",
      esTiendaActiva: tiendas.length === 1 ? esTiendaActiva(tiendas[0]) : true,
      codigo: codigoFiltro,
      familia: familiaFiltro,
    },
    actual,
    mesAnterior,
    anioAnterior,
    mom: {
      cantidad_pct: variacion(mesAnterior?.cantidad, actual?.cantidad),
      importe_pct: variacion(mesAnterior?.importe_neto, actual?.importe_neto),
    },
    yoy: {
      cantidad_pct: variacion(anioAnterior?.cantidad, actual?.cantidad),
      importe_pct: variacion(anioAnterior?.importe_neto, actual?.importe_neto),
    },
    serieAnioActual,
    serieAnioAnterior,
    desglose,
  });
}
