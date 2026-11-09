import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { unidadesVigentes } from "@/utils/grecka-unidad-vigente";

// Leer en qué unidad se pide cada producto no es una operación de admin:
// la usa el panel de Pedidos, que abren los jefes de tienda.
export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    return NextResponse.json({ ok: true, unidades: await unidadesVigentes() });
  } catch (e) {
    // El panel tiene que poder distinguir "no cambió nada" de "no se pudo
    // mirar": si esto se come el error, el panel muestra las unidades viejas
    // como si estuvieran verificadas.
    console.error("[grecka-unidades/vigentes] falló:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
