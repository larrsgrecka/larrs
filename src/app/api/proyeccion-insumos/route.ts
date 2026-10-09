import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { proyeccionInsumos } from "@/utils/proyeccion-insumos";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin ve la proyección de compras" }, { status: 403 });
  }

  const p = request.nextUrl.searchParams;
  const meses = Math.min(Math.max(Number(p.get("meses")) || 3, 1), 12);
  const crecimientoPct = Math.min(Math.max(Number(p.get("crecimiento")) || 0, -50), 100);

  try {
    return NextResponse.json({ ok: true, ...(await proyeccionInsumos({ meses, crecimientoPct })) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
