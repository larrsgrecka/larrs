import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getPreciosPromedioPorProducto } from "@/utils/catalogo-productos";

// Pagina ~12k filas de ventas en Supabase (vía getPreciosPromedioPorProducto)
// — puede tardar varios segundos, damos margen extra.
export const maxDuration = 30;

const TIENDAS = ["Costanera", "Dominicos", "Trapenses"];

function appsScriptConfig() {
  const url = process.env.INVENTARIO_FOOD_APPS_SCRIPT_URL;
  const token = process.env.INVENTARIO_FOOD_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

type StockRow = {
  tienda: string;
  categoria: string;
  producto: string;
  cantidad: number;
  fecha?: string;
  creado_en?: string;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin puede ver este cuadro" }, { status: 403 });
  }

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de inventario food no configurado" }, { status: 500 });
  }

  try {
    const [stockResp, precios] = await Promise.all([
      fetch(`${config.url}?token=${encodeURIComponent(config.token)}&action=list`),
      getPreciosPromedioPorProducto(),
    ]);
    const stockData = await stockResp.json();
    if (!stockData.ok) {
      return NextResponse.json({ error: stockData.error || "Error en Apps Script" }, { status: 502 });
    }

    // Más reciente por tienda+categoria+producto (mismo criterio que /api/inventario-food).
    const porClave: Record<string, StockRow> = {};
    const rows = (stockData.items ?? []) as StockRow[];
    rows.sort((a, b) => {
      const da = new Date(a.creado_en || a.fecha || 0).getTime();
      const db = new Date(b.creado_en || b.fecha || 0).getTime();
      return db - da;
    });
    for (const r of rows) {
      const clave = `${r.tienda}||${r.categoria}||${r.producto}`;
      if (!(clave in porClave)) porClave[clave] = r;
    }

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
