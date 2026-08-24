import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getRegistrosPesaje } from "@/utils/produccion-historial";

// Recorre el CSV histórico completo (no solo el header) y el Apps Script puede
// arrancar en frío: con 30 s la función se cortaba y la plataforma devolvía una
// página de error HTML que el panel no podía parsear como JSON.
export const maxDuration = 60;

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

  const limite = Math.min(Number(sp.get("limite")) || 20, 100);

  try {
    const registros = await getRegistrosPesaje(tienda, limite);
    return NextResponse.json({ ok: true, registros });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
