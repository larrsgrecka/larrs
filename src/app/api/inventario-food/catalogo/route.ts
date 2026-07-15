import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getCatalogoProductos, type Categoria } from "@/utils/catalogo-productos";

// En Cafetería casi todo son preparaciones al momento (americano, latte, tés,
// syrups...) que no se cuentan como stock. Solo el café en grano/granel es
// un insumo físico contable — el resto queda fuera (allowlist, no blocklist,
// porque son la minoría).
const CAFETERIA_CONTABLES = new Set([
  "CAFE EN GRANO 100% ARABICA FORMATO 340 GRAMOS",
  "CAFE EN GRANO BRASILE FORMATO 340 GRAMOS",
  "CAFE EN GRANO DELICATO FORMATO 340 GRAMOS",
  "CAFE EN GRANO DESCAFEINADO KAVE FORMATO 0,5 KG",
  "CAFE EN GRANO INDIA FORMATO 340 GRAMOS",
  "CAFE FILICORI KILO",
  "CAFE GRANEL 250 GR.",
]);

// Productos puntuales que no encajan en un patrón (combinan con helado,
// o son ajustes de POS, no productos físicos en stock).
const EXCLUIR_EXACTO = new Set([
  "ART. CAMBIO",
  "CROISSANT CON HELADO (2 SABORES)",
]);

function esContable(grupo: string, nombre: string): boolean {
  if (grupo === "CAFETERIA") return CAFETERIA_CONTABLES.has(nombre);

  const n = nombre.toUpperCase();
  if (n.startsWith("AGREGADO ")) return false; // agregados/modificadores, no stock propio
  if (n.startsWith("HUEVO")) return false; // huevos revueltos, preparación al momento
  if (n.startsWith("SANDWICH")) return false; // se arman al pedido
  if (n.startsWith("TOSTADA")) return false; // se arman al pedido
  if (n.startsWith("PACK #")) return false; // combo de desayuno/almuerzo, no un producto en sí
  if (nombre.includes("+")) return false; // combos (ej. "Café 240 + Medialuna")
  if (EXCLUIR_EXACTO.has(nombre)) return false;

  return true;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const categorias = await getCatalogoProductos({ excluir: ["HELADERIA"] });
    const filtradas: Categoria[] = categorias
      .map((c) => ({
        ...c,
        productos: c.productos.filter((p) => esContable(c.value, p)),
      }))
      .filter((c) => c.productos.length > 0);

    return NextResponse.json({ ok: true, categorias: filtradas });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
