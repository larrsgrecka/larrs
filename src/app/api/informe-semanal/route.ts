import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { generarInformeSemanal } from "@/utils/informe-semanal";

// Cruza producción, stock, asistencia y cumplimiento: varias fuentes lentas.
export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin puede ver el informe" }, { status: 403 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await generarInformeSemanal()) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
