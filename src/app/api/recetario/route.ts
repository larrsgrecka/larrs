import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getRecetarioCostos } from "@/utils/recetario-costos";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin puede ver los costos de recetas" }, { status: 403 });
  }

  const forzar = request.nextUrl.searchParams.get("forzar") === "1";

  try {
    const { recetas, sincronizadoEn } = await getRecetarioCostos(forzar);
    return NextResponse.json({ ok: true, recetas, sincronizado_en: sincronizadoEn });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al leer el Recetario desde SharePoint" },
      { status: 502 }
    );
  }
}
