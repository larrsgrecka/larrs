import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getProfile } from "@/utils/auth";

type Item = { sku: string; descripcion: string; cantidad: number; um?: string; grupo?: string };

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  const body = await request.json();
  const tienda = profile?.role === "jefe_tienda" && profile.tienda ? profile.tienda : body.tienda;
  const semanaLunes = body.semanaLunes as string;
  const items = (body.items ?? []) as Item[];

  if (!tienda || !semanaLunes) {
    return NextResponse.json({ error: "tienda y semanaLunes son requeridos" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semanaLunes)) {
    return NextResponse.json({ error: "semanaLunes debe tener formato YYYY-MM-DD" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ ok: true, filas: 0 });
  }

  const filas = items
    .filter((it) => it.sku && it.cantidad > 0)
    .map((it) => ({
      tienda,
      semana_lunes: semanaLunes,
      sku: it.sku,
      descripcion: it.descripcion || it.sku,
      cantidad: it.cantidad,
      um: it.um || null,
      grupo: it.grupo || null,
    }));

  const admin = createAdminClient();
  const { error, data } = await admin
    .from("pedidos_historial")
    .upsert(filas, { onConflict: "tienda,semana_lunes,sku" })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, filas: data?.length ?? 0 });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  const sp = request.nextUrl.searchParams;
  const tienda = profile?.role === "jefe_tienda" && profile.tienda ? profile.tienda : sp.get("tienda");
  const antes = sp.get("antes"); // YYYY-MM-DD — solo pedidos de semanas estrictamente anteriores

  if (!tienda) return NextResponse.json({ error: "tienda es requerida" }, { status: 400 });

  let query = supabase
    .from("pedidos_historial")
    .select("sku, cantidad, semana_lunes")
    .eq("tienda", tienda)
    .order("semana_lunes", { ascending: false });
  if (antes) query = query.lt("semana_lunes", antes);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Nos quedamos con la fila más reciente por sku (la primera que aparece, ya que viene ordenado desc).
  const porSku: Record<string, { cantidad: number; semana_lunes: string }> = {};
  for (const r of data ?? []) {
    if (!(r.sku in porSku)) {
      porSku[r.sku] = { cantidad: Number(r.cantidad), semana_lunes: r.semana_lunes as string };
    }
  }

  return NextResponse.json({ ok: true, porSku });
}
