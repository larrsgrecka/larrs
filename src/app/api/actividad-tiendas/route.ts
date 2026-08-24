import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getActividadTiendas } from "@/utils/actividad-tiendas";

// Consulta cuatro Apps Scripts distintos; en frío Google puede tardar más de
// 40 s. Con 30 s la función se cortaba y la plataforma devolvía un error en
// texto plano que el panel no podía parsear como JSON.
export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin puede ver este panel" }, { status: 403 });
  }

  try {
    const { actividad, errores } = await getActividadTiendas();
    return NextResponse.json({ ok: true, actividad, errores });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
