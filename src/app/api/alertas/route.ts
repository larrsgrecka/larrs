import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { alertasGuardadas, refrescarAlertas } from "@/utils/alertas";

// Recalcular cruza todas las fuentes: en frío pasa del medio minuto.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin ve las alertas de todas las tiendas" }, { status: 403 });
  }

  try {
    // Por defecto se sirve lo que dejó listo el calentador, que es instantáneo.
    // El recálculo es explícito porque tarda, y así el botón "Actualizar" es una
    // decisión de quien mira y no una espera sorpresa al abrir la pantalla.
    if (request.nextUrl.searchParams.get("recalcular") === "1") {
      return NextResponse.json({ ok: true, hace: "recién", ...(await refrescarAlertas()) });
    }

    const guardadas = await alertasGuardadas();
    if (guardadas) return NextResponse.json({ ok: true, ...guardadas });

    // Primera vez, o el calentador todavía no corrió.
    return NextResponse.json({ ok: true, hace: "recién", ...(await refrescarAlertas()) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
