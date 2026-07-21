import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getSaboresProduccion } from "@/utils/sabores-produccion";
import { getRecetarioCostos, matchCostos } from "@/utils/recetario-costos";

// El CSV de producción tarda ~7s en leerse (planilla grande) — el default
// de Vercel (10s) queda muy justo, damos más margen.
export const maxDuration = 30;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const [sabores, recetario] = await Promise.all([
      getSaboresProduccion(),
      getRecetarioCostos().catch(() => ({ recetas: [], sincronizadoEn: "" })),
    ]);
    const costos = matchCostos(sabores, recetario.recetas);
    return NextResponse.json({ ok: true, sabores, costos });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
