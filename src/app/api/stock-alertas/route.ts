import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getStockMinimos } from "@/utils/stock-minimos";

// Pagina ~12k filas de ventas en Supabase (vía getVentasPorTiendaProductoMes)
// — puede tardar varios segundos, damos margen extra.
export const maxDuration = 30;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin puede ver este panel" }, { status: 403 });
  }

  try {
    const items = await getStockMinimos();
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
