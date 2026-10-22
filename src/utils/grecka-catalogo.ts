// Qué es cada producto de Grecka: su grupo (Insumos, Accesorios, Repuestos,
// Servicios) y la unidad en que se compra.
//
// El reporte de pedidos no trae ninguna de las dos, y las dos se usan: el grupo
// separa el consumo recurrente de los repuestos y servicios en el pedido
// sugerido y en la proyección, y la unidad es lo que hace que la recomendación
// diga "3 cajas" y no "3".
//
// En vez de pedirle a Gustavo un reporte que las traiga, se deducen del
// histórico: de los 161 productos que trae un archivo típico, 145 ya se
// compraron antes y la base sabe lo que son. Se toma el último valor conocido y
// no el primero, porque Grecka recategoriza productos de vez en cuando.
//
// Los 16 restantes quedan con grupo vacío a propósito. Inventarles uno sería
// meter un repuesto de $760.000 dentro de los insumos y verlo aparecer en la
// proyección de compras del mes que viene.

import { createAdminClient } from "@/utils/supabase/admin";

export type FichaSku = { grupo: string; unidad: string };

export async function catalogoPorSku(): Promise<Record<string, FichaSku>> {
  const supabase = createAdminClient();
  const ficha: Record<string, FichaSku> = {};

  // Se recorre en orden de fecha y lo nuevo pisa a lo viejo, así que al terminar
  // cada SKU quedó con su clasificación más reciente. Se pagina porque PostgREST
  // corta en 1.000 filas y el histórico son más de 8.000: pedirlo de una vez
  // devuelve el principio de la tabla sin decir que faltó el resto.
  const LOTE = 1000;
  for (let desde = 0; ; desde += LOTE) {
    const { data, error } = await supabase
      .from("ventas_grecka")
      .select("sku, grupo, unidad")
      .order("fecha", { ascending: true })
      .range(desde, desde + LOTE - 1);
    if (error) throw new Error(`No se pudo leer el histórico de productos: ${error.message}`);
    if (!data?.length) break;

    for (const fila of data as { sku: string; grupo: string | null; unidad: string | null }[]) {
      const sku = (fila.sku || "").trim();
      if (!sku) continue;
      const previa = ficha[sku] ?? { grupo: "", unidad: "" };
      ficha[sku] = {
        // Un grupo vacío en una compra posterior no borra el que ya se sabía.
        grupo: (fila.grupo || "").trim() || previa.grupo,
        unidad: (fila.unidad || "").trim() || previa.unidad,
      };
    }
    if (data.length < LOTE) break;
  }
  return ficha;
}
