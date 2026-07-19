import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getCatalogoProductos } from "@/utils/catalogo-productos";

// Pagina ~12k filas de ventas en Supabase — puede tardar varios segundos,
// el default de Vercel (10s) queda justo, damos más margen.
export const maxDuration = 30;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const categorias = await getCatalogoProductos();
    return NextResponse.json({ ok: true, categorias });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
