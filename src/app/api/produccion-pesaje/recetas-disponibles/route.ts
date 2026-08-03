import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getRecetarioCostos, matchCostos } from "@/utils/recetario-costos";
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
type EventoFecha = { fecha: string; cantidad: number };

// Recepciones de Heladería por sabor, cada una con su fecha (sin sumar
// todavía — el corte de qué cuenta o no se aplica más abajo, una vez que se
// sabe cuál es el último conteo físico de cada sabor).
async function getRecepcionesPorSabor(tienda: string): Promise<Record<string, EventoFecha[]>> {
  const config = recepcionConfig();
  if (!config) return {};

  const url = new URL(config.url);
  url.searchParams.set("token", config.token);
  url.searchParams.set("action", "list");
  url.searchParams.set("tienda", tienda);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!data.ok) return {};

  const out: Record<string, EventoFecha[]> = {};
  for (const registro of (data.items ?? []) as RegistroRecepcion[]) {
    const fecha = registro.fecha || "";
    for (const item of registro.items ?? []) {
      if (item.categoria !== "HELADERIA" || !item.producto || !fecha) continue;
      if (!out[item.producto]) out[item.producto] = [];
      out[item.producto].push({ fecha, cantidad: Number(item.cantidad) || 0 });
    }
  }
  return out;
}

type ConteoRow = { categoria?: string; producto?: string; cantidad?: number; fecha?: string };

// Último conteo físico (en recetas enteras, no kg) de Heladería registrado en
// Inventario Food, por sabor — el más reciente por fecha.
async function getUltimoConteoHeladeriaPorSabor(
  tienda: string
): Promise<Record<string, EventoFecha>> {
  const config = inventarioFoodConfig();
  if (!config) return {};

  const url = new URL(config.url);
  url.searchParams.set("token", config.token);
  url.searchParams.set("action", "list");
  url.searchParams.set("tienda", tienda);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!data.ok) return {};

  const out: Record<string, EventoFecha> = {};
  for (const row of (data.items ?? []) as ConteoRow[]) {
    if (row.categoria !== "HELADERIA" || !row.producto || !row.fecha) continue;
    const cantidad = Number(row.cantidad) || 0;
    if (!out[row.producto] || row.fecha >= out[row.producto].fecha) {
      out[row.producto] = { fecha: row.fecha, cantidad };
    }
  }
  return out;
}

// Junta recepción + último conteo físico por tienda: el conteo físico más
// reciente (si existe) es la verdad conocida a esa fecha — reemplaza
// cualquier suma acumulada de antes, para que un recuento periódico corrija
// solo el desvío (mermas no registradas, redondeos, etc.) en vez de arrastrar
// error para siempre. Encima de ese conteo se suman las recepciones
// ocurridas desde esa fecha en adelante. Si un sabor nunca se ha contado,
// se usa la fecha de su primera recepción como corte (comportamiento previo:
// evita arrastrar consumo histórico de antes de que existiera este control).
async function getDatosTienda(
  tienda: string
): Promise<{ recibido: Record<string, number>; corte: Record<string, string> }> {
  const [recepcionesPorSabor, conteos] = await Promise.all([
    getRecepcionesPorSabor(tienda),
    getUltimoConteoHeladeriaPorSabor(tienda),
  ]);

  const saboresConocidos = new Set([...Object.keys(recepcionesPorSabor), ...Object.keys(conteos)]);

  const recibidoFinal: Record<string, number> = {};
  const corte: Record<string, string> = {};

  for (const sabor of saboresConocidos) {
    const eventos = recepcionesPorSabor[sabor] || [];
    const conteo = conteos[sabor];

    if (conteo) {
      corte[sabor] = conteo.fecha;
      const recibidasDespues = eventos
        .filter((e) => e.fecha >= conteo.fecha)
        .reduce((acc, e) => acc + e.cantidad, 0);
      recibidoFinal[sabor] = conteo.cantidad + recibidasDespues;
    } else {
      const primeraFecha = eventos.reduce(
        (min, e) => (!min || e.fecha < min ? e.fecha : min),
        "" as string
      );
      if (primeraFecha) corte[sabor] = primeraFecha;
      recibidoFinal[sabor] = eventos.reduce((acc, e) => acc + e.cantidad, 0);
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
      const datosPorTienda = await Promise.all(TIENDAS.map((t) => getDatosTienda(t)));

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
    const datos = await getDatosTienda(tienda);
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
