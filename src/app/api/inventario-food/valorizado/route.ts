import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getPreciosPromedioPorProducto } from "@/utils/catalogo-productos";
import { getStockActualPorClave } from "@/utils/inventario-food-stock";

// Mismo cálculo pesado que /api/stock-alertas (ventas + conteos): 30s no alcanza
// cuando el Apps Script arranca en frío.
export const maxDuration = 60;

const TIENDAS = ["Costanera", "Dominicos", "Trapenses"];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin puede ver este cuadro" }, { status: 403 });
  }

  try {
    const [porClave, precios] = await Promise.all([
      getStockActualPorClave(),
      getPreciosPromedioPorProducto(),
    ]);

    const resultado: Record<string, { valor: number; conPrecio: number; sinPrecio: number }> = {};
    for (const t of TIENDAS) resultado[t] = { valor: 0, conPrecio: 0, sinPrecio: 0 };

    for (const r of Object.values(porClave)) {
      if (!(r.tienda in resultado)) continue;
      const precio = precios[r.producto];
      if (precio) {
        resultado[r.tienda].valor += Number(r.cantidad) * precio;
        resultado[r.tienda].conPrecio++;
      } else {
        resultado[r.tienda].sinPrecio++;
      }
    }

    return NextResponse.json({ ok: true, tiendas: resultado });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
