import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getSaboresProduccion } from "@/utils/sabores-produccion";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const sabores = await getSaboresProduccion();
    return NextResponse.json({ ok: true, sabores });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
