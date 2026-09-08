import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getSaboresProduccion } from "@/utils/sabores-produccion";
import { getRecetarioCostos, matchCostos, precioKgReferencia } from "@/utils/recetario-costos";

// El CSV de producción tarda ~7s en leerse (planilla grande) — el default
// de Vercel (10s) queda muy justo, damos más margen.
export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // El operador (cuenta compartida por tienda) ve la vitrina para saber el
  // orden, pero no debe recibir datos de costo — ni siquiera en la
  // respuesta cruda, no solo ocultos en la UI.
  const profile = await getProfile();
  const puedeVerCostos = profile?.role !== "operador";

  try {
    if (!puedeVerCostos) {
      const sabores = await getSaboresProduccion();
      return NextResponse.json({ ok: true, sabores, costos: {} });
    }

    const [sabores, recetario] = await Promise.all([
      getSaboresProduccion(),
      getRecetarioCostos().catch(() => ({ recetas: [], tarifas: [], sincronizadoEn: "" })),
    ]);
    const costos = matchCostos(sabores, recetario.recetas);

    // Precio de venta por kilo del formato de referencia: el margen de cada
    // sabor se calcula contra este número, porque el precio no varía por sabor.
    const referencia = precioKgReferencia(recetario.tarifas);
    const precioKg = referencia
      ? { formato: referencia.formato, pesoGramos: referencia.pesoGramos, tarifa: referencia.tarifa, porKilo: Math.round(referencia.precioKg) }
      : null;

    return NextResponse.json({ ok: true, sabores, costos, precioKg });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
