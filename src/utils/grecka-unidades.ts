// Cómo se cuenta cada producto de Grecka, corregido a mano.
//
// El sistema deduce la unidad del historial de compras, y a veces el historial
// no alcanza: Grecka factura el mismo vaso por bolsa durante tres años y pasa a
// facturarlo por caja en 2026, o tipea CAJA en tres de cuarenta compras. Quien
// sabe de verdad en qué unidad se pide es quien hace el pedido.
//
// Por eso estas correcciones mandan sobre cualquier deducción: si acá dice que
// 1BG164N se pide por bolsa y que vienen 10 en una caja, eso es lo que vale,
// aunque los datos sugieran otra cosa.

import { guardarCopia, leerCopia } from "@/utils/cache-persistente";

const CLAVE = "grecka-unidades";

export type UnidadCorregida = {
  /** Unidad en la que se pide: "Bolsa", "Caja", "Balde"… */
  unidad?: string;
  /** Cuántas unidades de ésas trae una caja, si aplica. */
  porCaja?: number;
  /**
   * El producto es de la sala de producción y no se le pide a las tiendas,
   * aunque Grecka lo haya facturado a una.
   *
   * Pasa de verdad: el detergente F865 para lavavajillas de aluminio figura
   * tres veces facturado a Trapenses y es de la sala de producción. Sin esto, el
   * pedido sugerido se lo iba a recomendar a la tienda en algún momento.
   */
  soloProduccion?: boolean;
  corregidoPor?: string;
  corregidoEn?: string;
};

type Mapa = Record<string, UnidadCorregida>;

let cache: { mapa: Mapa; ts: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function unidadesCorregidas(): Promise<Mapa> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.mapa;
  const copia = await leerCopia<Mapa>(CLAVE);
  const mapa = copia?.datos ?? {};
  cache = { mapa, ts: Date.now() };
  return mapa;
}

export async function corregirUnidad(
  sku: string,
  datos: { unidad: string; porCaja?: number; corregidoPor?: string }
): Promise<Mapa> {
  const previas = (await leerCopia<Mapa>(CLAVE))?.datos ?? {};
  const mapa = { ...previas };

  const unidad = (datos.unidad || "").trim();
  if (!sku || !unidad) throw new Error("Hacen falta el código y la unidad");

  mapa[sku.trim()] = {
    // Se conserva lo ya corregido de ese producto (por ejemplo, que sea de
    // producción) en vez de reemplazarlo entero.
    ...(mapa[sku.trim()] ?? {}),
    unidad: unidad.charAt(0).toUpperCase() + unidad.slice(1).toLowerCase(),
    ...(datos.porCaja && datos.porCaja > 1 ? { porCaja: Math.round(datos.porCaja) } : {}),
    corregidoPor: datos.corregidoPor,
    corregidoEn: new Date().toISOString(),
  };

  await guardarCopia(CLAVE, mapa);
  cache = { mapa, ts: Date.now() };
  return mapa;
}

/** Marca (o desmarca) un producto como de uso exclusivo de la sala de producción. */
export async function marcarSoloProduccion(
  sku: string,
  soloProduccion: boolean,
  corregidoPor?: string
): Promise<Mapa> {
  const previas = (await leerCopia<Mapa>(CLAVE))?.datos ?? {};
  const mapa = { ...previas };
  const clave = (sku || "").trim();
  if (!clave) throw new Error("Falta el código del producto");

  mapa[clave] = {
    ...(mapa[clave] ?? {}),
    soloProduccion,
    corregidoPor,
    corregidoEn: new Date().toISOString(),
  };

  await guardarCopia(CLAVE, mapa);
  cache = { mapa, ts: Date.now() };
  return mapa;
}

export async function borrarCorreccion(sku: string): Promise<Mapa> {
  const previas = (await leerCopia<Mapa>(CLAVE))?.datos ?? {};
  const mapa = { ...previas };
  delete mapa[sku];
  await guardarCopia(CLAVE, mapa);
  cache = { mapa, ts: Date.now() };
  return mapa;
}
