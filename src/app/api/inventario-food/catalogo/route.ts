import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getCatalogoProductos } from "@/utils/catalogo-productos";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const categorias = await getCatalogoProductos({ excluir: ["HELADERIA"] });
    return NextResponse.json({ ok: true, categorias });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
