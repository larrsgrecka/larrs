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

type ItemRecepcion = { categoria?: string; producto?: string; cantidad?: number };
type RegistroRecepcion = { items?: ItemRecepcion[]; fecha?: string };

// Trae, para una tienda, cuánto se ha recibido por sabor Y la fecha de la
// primera recepción de cada sabor — esa fecha es el "corte": el consumo de
// antes no cuenta contra el saldo (es consumo de antes de que existiera este
// registro, no se le puede pedir cuentas a nadie por eso).
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

      const [recetario, datosPorTienda] = await Promise.all([
        getRecetarioCostos().catch(() => ({ recetas: [], sincronizadoEn: "" })),
        Promise.all(TIENDAS.map((t) => getRecibidoPorSabor(t))),
      ]);

      const cortePorTiendaYSabor: Record<string, Record<string, string>> = {};
      TIENDAS.forEach((t, i) => { cortePorTiendaYSabor[t] = datosPorTienda[i].primeraFecha; });

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

    const [recetario, datos] = await Promise.all([
      getRecetarioCostos().catch(() => ({ recetas: [], sincronizadoEn: "" })),
      getRecibidoPorSabor(tienda),
    ]);
    const cortePorTiendaYSabor = { [tienda]: datos.primeraFecha };
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
