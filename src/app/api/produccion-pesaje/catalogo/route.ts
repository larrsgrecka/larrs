import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getSaboresProduccion, getSaboresEnPlanilla } from "@/utils/sabores-produccion";
import { getRecetarioCostos, matchCostos } from "@/utils/recetario-costos";

// El CSV de producción tarda ~7s en leerse (planilla grande) — el default
// de Vercel (10s) queda muy justo, damos más margen.
export const maxDuration = 30;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const [sabores, enPlanilla, recetario] = await Promise.all([
      getSaboresProduccion(),
      getSaboresEnPlanilla(),
      getRecetarioCostos().catch(() => ({ recetas: [], sincronizadoEn: "" })),
    ]);
    const costos = matchCostos(sabores, recetario.recetas);

    // Sabores agregados a mano en /catalogo que no tienen columna en la
    // planilla: el panel los ofrece pero el Apps Script no puede escribirlos,
    // así que hay que marcarlos antes de que alguien pese sobre ellos.
    const columnas = new Set(enPlanilla);
    const sinColumna = sabores.filter((s) => !columnas.has(s));

    return NextResponse.json({ ok: true, sabores, costos, sinColumna });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
