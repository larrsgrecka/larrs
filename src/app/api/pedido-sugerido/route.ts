import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { pedidoSugerido } from "@/utils/pedido-sugerido";

// Lee hasta ~1.000 compras de Supabase y las agrupa; no depende de Google.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin" && profile?.role !== "jefe_tienda") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const p = request.nextUrl.searchParams;
  // Un jefe de tienda solo ve la suya, como en el resto de la app.
  const tienda = profile.role === "jefe_tienda" && profile.tienda
    ? profile.tienda
    : p.get("tienda") || undefined;

  const semanas = Math.min(Math.max(Number(p.get("semanas")) || 8, 2), 26);
  const semanasDeCobertura = Math.min(Math.max(Number(p.get("cobertura")) || 1, 1), 4);

  try {
    const datos = await pedidoSugerido({ semanas, semanasDeCobertura, tienda });
    return NextResponse.json({ ok: true, ...datos });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
