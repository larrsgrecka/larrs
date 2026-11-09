// En qué unidad se le pide hoy cada producto a Grecka, y cómo convertir una
// cantidad escrita en la unidad vieja.
//
// Existe porque el panel de Pedidos guardaba las unidades escritas a mano en el
// archivo. Grecka pasó de facturar el vaso de 93 ml por bolsa a facturarlo por
// caja y el panel siguió diciendo "bolsa" durante medio año, porque no había
// nada que lo mirara. Esto es ese algo.
//
// Lo que entrega no es solo la unidad: es la unidad MÁS la equivalencia. Si el
// panel trae "4 bolsas" y hoy se pide por caja, cambiar la palabra sin tocar el
// número pide ocho veces de más, que es peor que el error original. Por eso van
// juntas, y cuando no hay una equivalencia confiable se dice y no se adivina.

import { createAdminClient } from "@/utils/supabase/admin";
import { unidadHabitual } from "@/utils/pedido-sugerido";
import { unidadesCorregidas } from "@/utils/grecka-unidades";
import { claveUnidad, equivalenciasDe, type CompraParaEquivalencia } from "@/utils/proyeccion-insumos";

export type UnidadVigente = {
  /** Cómo se escribe, lista para mostrar: "Caja", "Bolsa". */
  unidad: string;
  /** true cuando la fijó una persona y no la dedujo el sistema. */
  corregida: boolean;
  /**
   * Cuántas unidades de la unidad vigente vale una unidad de cada otra.
   * Con la caja como unidad vigente, "bolsa" vale 0,125: ocho bolsas por caja.
   */
  equivalencias: Record<string, number>;
  /**
   * Las unidades que de verdad aparecen en las facturas de este producto.
   *
   * Sirve para separar dos cosas que se ven iguales desde afuera. Si un panel
   * dice "bolsa" y la bolsa está acá, es una unidad real de otro tamaño y la
   * cantidad hay que convertirla. Si dice "unidad" y la unidad NO está acá
   * —pasa en todas las pastas de Huechuraba, que se compran siempre en balde y
   * alguien escribió "UNIDAD" de relleno— entonces nunca fue un tamaño, fue un
   * nombre genérico, y solo hay que corregir la palabra.
   */
  unidadesVistas: string[];
};

// La unidad de un producto cambia una vez y para siempre, no de una hora a la
// otra, así que un día de caché sobra. Lo caro es leer la tabla entera.
const TTL_MS = 24 * 60 * 60 * 1000;
let cache: { mapa: Record<string, UnidadVigente>; ts: number } | null = null;

type Fila = CompraParaEquivalencia & { sku: string; descripcion: string };

export async function unidadesVigentes(): Promise<Record<string, UnidadVigente>> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.mapa;

  const supabase = createAdminClient();
  const PAGINA = 1000;
  const porSku = new Map<string, Fila[]>();
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("ventas_grecka")
      .select("sku, descripcion, unidad, fecha, cantidad, neto")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(`No se pudieron leer las compras a Grecka: ${error.message}`);
    if (!data?.length) break;
    for (const f of data as Fila[]) {
      const clave = f.sku || f.descripcion;
      if (!clave || !f.unidad) continue;
      if (!porSku.has(clave)) porSku.set(clave, []);
      porSku.get(clave)!.push({ ...f, cantidad: Number(f.cantidad), neto: Number(f.neto) });
    }
    if (data.length < PAGINA) break;
  }

  // La corrección manual gana sobre la deducción: quien hace el pedido sabe en
  // qué unidad se pide, y el historial a veces dice otra cosa.
  const correcciones = await unidadesCorregidas().catch(
    () => ({}) as Awaited<ReturnType<typeof unidadesCorregidas>>
  );

  const mapa: Record<string, UnidadVigente> = {};
  for (const [sku, compras] of porSku) {
    const corregida = correcciones[sku];
    const unidad = corregida?.unidad ?? unidadHabitual(compras);
    const equivalencias: Record<string, number> = {};
    for (const [u, factor] of equivalenciasDe(compras, unidad, corregida?.porCaja)) {
      equivalencias[u] = factor;
    }
    const unidadesVistas = [...new Set(compras.map((c) => claveUnidad(c.unidad)).filter(Boolean))];
    mapa[sku] = { unidad, corregida: !!corregida?.unidad, equivalencias, unidadesVistas };
  }

  cache = { mapa, ts: Date.now() };
  return mapa;
}

/** Para los tests y para quien necesite comparar dos unidades escritas distinto. */
export { claveUnidad };
