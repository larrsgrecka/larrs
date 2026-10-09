// Qué marca es cada producto de Grecka.
//
// La tabla de compras no guarda la marca —el importador la descartaba— y el
// dato solo existe en el Excel que manda Grecka. En vez de pedir una migración
// y recargar el histórico, se mantiene un mapa SKU → marca que cada importación
// actualiza: los SKUs nuevos se agregan y los existentes se corrigen si cambian.
//
// Un SKU sin marca conocida no se descarta ni se le inventa una: queda en "Sin
// marca", que es información honesta y además señala qué falta por importar.

import { guardarCopia, leerCopia } from "@/utils/cache-persistente";

const CLAVE = "grecka-marcas";
export const SIN_MARCA = "Sin marca";

type Mapa = Record<string, string>;

let cache: { mapa: Mapa; ts: number } | null = null;
const TTL_MS = 30 * 60 * 1000;

export async function marcasPorSku(): Promise<Mapa> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.mapa;
  const copia = await leerCopia<Mapa>(CLAVE);
  const mapa = copia?.datos ?? {};
  cache = { mapa, ts: Date.now() };
  return mapa;
}

/** Suma lo que trae una importación al mapa, sin perder lo ya conocido. */
export async function registrarMarcas(nuevas: Mapa): Promise<{ total: number; agregadas: number }> {
  const previas = (await leerCopia<Mapa>(CLAVE))?.datos ?? {};
  const mapa = { ...previas };
  let agregadas = 0;
  for (const [sku, marca] of Object.entries(nuevas)) {
    const limpia = (marca || "").trim();
    if (!sku || !limpia) continue;
    if (mapa[sku] !== limpia) {
      if (!mapa[sku]) agregadas++;
      mapa[sku] = limpia;
    }
  }
  await guardarCopia(CLAVE, mapa);
  cache = { mapa, ts: Date.now() };
  return { total: Object.keys(mapa).length, agregadas };
}
