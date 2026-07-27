import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getCatalogoFood } from "@/utils/catalogo-food";
import { getSaboresProduccion } from "@/utils/sabores-produccion";

// Pagina ~12k filas de ventas en Supabase — puede tardar varios segundos,
// el default de Vercel (10s) queda justo, damos más margen.
export const maxDuration = 30;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const [categorias, sabores] = await Promise.all([
      getCatalogoFood(),
      getSaboresProduccion().catch(() => [] as string[]),
    ]);

    // Conteo físico de helado en kilos (cuánto hay realmente en la vitrina/
    // bodega) — distinto del "recetas recibidas" de Recepción, esto es un
    // conteo de stock como cualquier otra categoría, solo que en kg.
    if (sabores.length > 0) {
      categorias.push({
        value: "HELADERIA",
        label: "Heladería (kg en tienda)",
        productos: sabores.map((nombre) => ({ nombre, unidad: "kg" })),
      });
    }

    return NextResponse.json({ ok: true, categorias });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
