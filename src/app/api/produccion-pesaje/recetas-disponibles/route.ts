import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getRecetarioCostos, matchCostos, type RecetaCosto } from "@/utils/recetario-costos";
import { getRecetasConsumidasPorTiendaYSabor } from "@/utils/produccion-recetas-consumidas";

// El CSV de producción es grande y acá se recorre completo (no solo el
// header) — más lento que los otros catálogos, damos margen extra.
export const maxDuration = 30;

const TIENDAS = ["Costanera", "Dominicos", "Trapenses"];

function recepcionConfig() {
  const url = process.env.RECEPCION_APPS_SCRIPT_URL;
  const token = process.env.RECEPCION_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

function inventarioFoodConfig() {
  const url = process.env.INVENTARIO_FOOD_APPS_SCRIPT_URL;
  const token = process.env.INVENTARIO_FOOD_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

type ItemRecepcion = { categoria?: string; producto?: string; cantidad?: number };
type RegistroRecepcion = { items?: ItemRecepcion[]; fecha?: string };

// Fecha + cantidad recibida (en recetas) por sabor, y la fecha de la primera
// recepción de cada sabor (el consumo de antes de esa fecha no cuenta).
async function getRecibidoPorSabor(
  tienda: string
): Promise<{ recibido: Record<string, number>; primeraFecha: Record<string, string> }> {
  const config = recepcionConfig();
  if (!config) return { recibido: {}, primeraFecha: {} };

  const url = new URL(config.url);
  url.searchParams.set("token", config.token);
  url.searchParams.set("action", "list");
  url.searchParams.set("tienda", tienda);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!data.ok) return { recibido: {}, primeraFecha: {} };

  const recibido: Record<string, number> = {};
  const primeraFecha: Record<string, string> = {};
  for (const registro of (data.items ?? []) as RegistroRecepcion[]) {
    const fecha = registro.fecha || "";
    for (const item of registro.items ?? []) {
      if (item.categoria !== "HELADERIA" || !item.producto) continue;
      recibido[item.producto] = (recibido[item.producto] || 0) + (Number(item.cantidad) || 0);
      if (fecha && (!primeraFecha[item.producto] || fecha < primeraFecha[item.producto])) {
        primeraFecha[item.producto] = fecha;
      }
    }
  }
  return { recibido, primeraFecha };
}

type ConteoRow = { categoria?: string; producto?: string; cantidad?: number; fecha?: string };

// Primer conteo físico (kg) de Heladería registrado en Inventario Food, por
// sabor — la fecha más antigua encontrada, con su cantidad en kg.
async function getPrimerConteoHeladeriaPorSabor(
  tienda: string
): Promise<Record<string, { fecha: string; kg: number }>> {
  const config = inventarioFoodConfig();
  if (!config) return {};

  const url = new URL(config.url);
  url.searchParams.set("token", config.token);
  url.searchParams.set("action", "list");
  url.searchParams.set("tienda", tienda);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!data.ok) return {};

  const out: Record<string, { fecha: string; kg: number }> = {};
  for (const row of (data.items ?? []) as ConteoRow[]) {
    if (row.categoria !== "HELADERIA" || !row.producto || !row.fecha) continue;
    const kg = Number(row.cantidad) || 0;
    if (!out[row.producto] || row.fecha < out[row.producto].fecha) {
      out[row.producto] = { fecha: row.fecha, kg };
    }
  }
  return out;
}

// Junta recepción + primer conteo físico por tienda: el que haya pasado
// PRIMERO define desde cuándo se empieza a descontar consumo ("corte"). Si
// el primero en el tiempo es un conteo físico, sus kg (convertidos a
// recetas con el Recetario) se suman como saldo inicial — es la cantidad
// real que había ese día, no una recepción, pero cuenta igual para partir
// con un número real en vez de 0 a secas.
async function getDatosTienda(
  tienda: string,
  recetario: { recetas: RecetaCosto[] }
): Promise<{ recibido: Record<string, number>; corte: Record<string, string> }> {
  const [{ recibido, primeraFecha }, conteos] = await Promise.all([
    getRecibidoPorSabor(tienda),
    getPrimerConteoHeladeriaPorSabor(tienda),
  ]);

  const saboresConocidos = new Set([...Object.keys(recibido), ...Object.keys(conteos)]);
  const costosPorSabor = matchCostos([...saboresConocidos], recetario.recetas);

  const recibidoFinal: Record<string, number> = { ...recibido };
  const corte: Record<string, string> = { ...primeraFecha };

  for (const sabor of saboresConocidos) {
    const conteo = conteos[sabor];
    if (!conteo) continue;
    const fechaRecepcion = primeraFecha[sabor];
    if (fechaRecepcion && fechaRecepcion <= conteo.fecha) continue; // la recepción ya fue primero

    corte[sabor] = conteo.fecha;
    const kilos = costosPorSabor[sabor]?.kilosReceta;
    if (kilos) {
      recibidoFinal[sabor] = (recibidoFinal[sabor] || 0) + Math.round(conteo.kg / kilos);
    }
  }

  return { recibido: recibidoFinal, corte };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  const sp = request.nextUrl.searchParams;
  const tienda =
    (profile?.role === "jefe_tienda" || profile?.role === "operador") && profile.tienda
      ? profile.tienda
      : sp.get("tienda");

  if (!tienda) {
    return NextResponse.json({ error: "tienda es requerida" }, { status: 400 });
  }

  try {
    if (tienda === "Todas") {
      if (profile?.role !== "admin") {
        return NextResponse.json({ error: "Solo un admin puede ver todas las tiendas" }, { status: 403 });
      }

      const recetario = await getRecetarioCostos().catch(() => ({ recetas: [], sincronizadoEn: "" }));
      const datosPorTienda = await Promise.all(TIENDAS.map((t) => getDatosTienda(t, recetario)));

      const cortePorTiendaYSabor: Record<string, Record<string, string>> = {};
      TIENDAS.forEach((t, i) => { cortePorTiendaYSabor[t] = datosPorTienda[i].corte; });

      const consumidoPorTienda = await getRecetasConsumidasPorTiendaYSabor(recetario.recetas, cortePorTiendaYSabor);

      const sabores = new Set<string>();
      TIENDAS.forEach((_, i) => Object.keys(datosPorTienda[i].recibido).forEach((s) => sabores.add(s)));
      TIENDAS.forEach((t) => Object.keys(consumidoPorTienda[t] || {}).forEach((s) => sabores.add(s)));
      const costosPorSabor = matchCostos([...sabores], recetario.recetas);

      const items = [...sabores].map((sabor) => {
        const porTienda: Record<string, { recibido: number; consumido: number; saldo: number }> = {};
        let saldoTotal = 0;
        TIENDAS.forEach((t, i) => {
          const rec = datosPorTienda[i].recibido[sabor] || 0;
          const con = (consumidoPorTienda[t] || {})[sabor] || 0;
          porTienda[t] = { recibido: rec, consumido: con, saldo: rec - con };
          saldoTotal += rec - con;
        });
        return { sabor, codigo: costosPorSabor[sabor]?.codigo || "", porTienda, saldoTotal };
      }).sort((a, b) => a.saldoTotal - b.saldoTotal);

      return NextResponse.json({ ok: true, tiendas: TIENDAS, items });
    }

    const recetario = await getRecetarioCostos().catch(() => ({ recetas: [], sincronizadoEn: "" }));
    const datos = await getDatosTienda(tienda, recetario);
    const cortePorTiendaYSabor = { [tienda]: datos.corte };
    const consumidoPorTienda = await getRecetasConsumidasPorTiendaYSabor(recetario.recetas, cortePorTiendaYSabor);
    const consumido = consumidoPorTienda[tienda] || {};

    const sabores = [...new Set([...Object.keys(datos.recibido), ...Object.keys(consumido)])];
    const costosPorSabor = matchCostos(sabores, recetario.recetas);

    const items = sabores.map((sabor) => {
      const rec = datos.recibido[sabor] || 0;
      const con = consumido[sabor] || 0;
      return { sabor, codigo: costosPorSabor[sabor]?.codigo || "", recibido: rec, consumido: con, saldo: rec - con };
    }).sort((a, b) => a.saldo - b.saldo);

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
