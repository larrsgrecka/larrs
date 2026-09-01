import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getCatalogoFood } from "@/utils/catalogo-food";
import { getSaboresProduccion } from "@/utils/sabores-produccion";

// Pagina ~12k filas de ventas en Supabase — puede tardar varios segundos,
// el default de Vercel (10s) queda justo, damos más margen.
export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const [categorias, sabores] = await Promise.all([
      getCatalogoFood(),
      getSaboresProduccion().catch(() => [] as string[]),
    ]);

    // Recetas de helado que llegan ya hechas desde el Centro de Producción
    // (no son "food" contable — se cuentan en recetas enteras, no kg, y no
    // suman a Inventario Food; alimentan el saldo de "recetas disponibles"
    // en Pesaje de producción).
    if (sabores.length > 0) {
      categorias.push({
        value: "HELADERIA",
        label: "Heladería (recetas del Centro de Producción)",
        productos: sabores.map((nombre) => ({ nombre, unidad: "receta" })),
      });
    }

    return NextResponse.json({ ok: true, categorias });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
