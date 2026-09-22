import { conRespaldo } from "@/utils/cache-persistente";
import { getCatalogoProductos, getCodigosProductos } from "@/utils/catalogo-productos";
import { getOverrides } from "@/utils/catalogo-overrides";

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
  "JENGIBRE",
  "LIMONADA LÄRRS",
  "MENTA",
  "NATURAL",
]);

// Excepciones a la regla "PACK* = combo de productos ya contados por
// separado": estos "PACK" son en realidad el único formato en que ese
// producto existe (no hay una versión individual del mismo artículo en
// otra parte del catálogo), así que sí son stock contable propio.
const PACK_CONTABLE = new Set([
  "PACK BARQUILLOS RELLENO NUTELLA",
  "PACK GALLETAS CHIP CHOCOLATE",
  "PACK GALLETAS CHIP CHOCOLATE 30G.",
  "PACK GALLETAS DANESAS LÄRRS",
  "PACK MINI GALLETAS DANESAS LÄRRS",
]);

// Unidad por defecto: "un" (se cuenta en paquetes/unidades enteras). Solo el
// café vendido/pesado suelto por kilo admite decimales — los demás formatos
// de café (340 gramos, 0,5 kg, 250 gr.) son bolsas cerradas, se cuentan de a una.
const UNIDAD_POR_PRODUCTO: Record<string, string> = {
  "CAFE FILICORI KILO": "kg",
};

function unidadDe(nombre: string): string {
  return UNIDAD_POR_PRODUCTO[nombre] || "un";
}

function esContable(grupo: string, nombre: string): boolean {
  if (grupo === "CAFETERIA") return CAFETERIA_CONTABLES.has(nombre);

  const n = nombre.toUpperCase();
  if (n.startsWith("AGREGADO ")) return false; // agregados/modificadores, no stock propio
  if (n.startsWith("HUEVO")) return false; // huevos revueltos, preparación al momento
  if (n.startsWith("SANDWICH")) return false; // se arman al pedido
  if (n.startsWith("TOSTADA")) return false; // se arman al pedido
  if (PACK_CONTABLE.has(nombre)) return true;
  if (n.startsWith("PACK")) return false; // pack/combo de productos ya contados por separado
  if (n.startsWith("CAJA")) return false; // caja multi-unidad de productos ya contados por separado
  if (n.startsWith("GOOD BAG")) return false; // bolsa sorpresa antidesperdicio, no stock propio
  if (n.includes("UBER")) return false; // combo/empaque específico de delivery
  if (n.startsWith("JUGO")) return false; // jugo natural exprimido al momento, no stock
  if (nombre.includes("+")) return false; // combos (ej. "Café 240 + Medialuna")
  if (EXCLUIR_EXACTO.has(nombre)) return false;

  return true;
}

export type CategoriaFood = {
  value: string;
  label: string;
  productos: { nombre: string; unidad: string; codigo?: string }[];
};

// Catálogo de productos "food" contables (usado por Inventario Food y
// Recepción de productos) — mismas reglas de curación para ambos, así no
// se desalinean con el tiempo. Los admins pueden agregar/excluir artículos
// puntuales sin tocar código vía /catalogo (ver catalogo-overrides.ts).
// Armarlo cuesta 33-37 segundos medidos —tres fuentes, una de ellas un Apps
// Script de Google— y además el resultado variaba entre llamadas seguidas (104
// productos y después 73), porque alguna fuente falla de a ratos y devuelve de
// menos. En la lectura de la foto de una guía eso es doblemente caro: se suma a
// los ~28 s del modelo y se pasa del minuto que da la plataforma, y encima
// cambia el catálogo contra el que se emparejan los productos.
// 30 minutos y no 10: el calentador lo toca cada 15, así nunca está frío
// cuando alguien sube la foto de una guía.
const CATALOGO_TTL_MS = 30 * 60 * 1000;
let catalogoCache: { datos: CategoriaFood[]; ts: number } | null = null;

// Un catálogo armado sin los overrides no es el catálogo: le sobran los
// productos que un admin excluyó y le faltan los que agregó. Se marca con este
// error para que la última copia buena le gane, y para que nunca quede cacheado
// media hora como si fuera correcto.
class CatalogoIncompleto extends Error {
  constructor(readonly parcial: CategoriaFood[]) {
    super("El catálogo se armó sin los overrides");
  }
}

export async function getCatalogoFood(): Promise<CategoriaFood[]> {
  if (catalogoCache && Date.now() - catalogoCache.ts < CATALOGO_TTL_MS) return catalogoCache.datos;

  try {
    const r = await conRespaldo(
      "catalogo-food",
      async () => {
        const { catalogo, degradado } = await construirCatalogoFood();
        if (degradado) throw new CatalogoIncompleto(catalogo);
        return catalogo;
      },
      {
        // Un catálogo vacío o casi vacío es una fuente caída, no un catálogo: si
        // se guardara, la copia quedaría inservible y la foto se leería contra
        // nada.
        esGuardable: (c) => c.reduce((n, x) => n + x.productos.length, 0) >= 20,
      }
    );
    if (!r.desdeRespaldo) catalogoCache = { datos: r.datos, ts: Date.now() };
    return r.datos;
  } catch (e) {
    // Sin overrides y sin copia guardada: se devuelve lo que hay, porque un
    // catálogo incompleto sirve más que ninguno, pero sin cachearlo — el
    // próximo intento vuelve a buscar el bueno.
    if (e instanceof CatalogoIncompleto) {
      console.error("[catalogo-food] devuelto sin overrides y sin cachear");
      return e.parcial;
    }
    throw e;
  }
}

async function construirCatalogoFood(): Promise<{ catalogo: CategoriaFood[]; degradado: boolean }> {
  const [categorias, { incluir, excluirNombres, degradado }, codigos] = await Promise.all([
    getCatalogoProductos({
      excluir: ["HELADERIA", "CHOCOLATERIA", "ARTICULOS", "MATERIAS PRIMAS"],
    }),
    getOverrides("food"),
    getCodigosProductos(),
  ]);
  const base: CategoriaFood[] = categorias
    .map((c) => ({
      value: c.value,
      label: c.label,
      productos: c.productos
        .filter((p) => esContable(c.value, p))
        .map((nombre) => ({ nombre, unidad: unidadDe(nombre), codigo: codigos[nombre] })),
    }))
    .filter((c) => c.productos.length > 0);

  const conExclusiones = base.map((c) => ({
    ...c,
    productos: c.productos.filter((p) => !excluirNombres.has(p.nombre)),
  }));

  for (const ov of incluir) {
    let grupo = conExclusiones.find((c) => c.value === ov.categoria);
    if (!grupo) {
      grupo = { value: ov.categoria, label: ov.categoria, productos: [] };
      conExclusiones.push(grupo);
    }
    if (!grupo.productos.some((p) => p.nombre === ov.nombre)) {
      grupo.productos.push({ nombre: ov.nombre, unidad: ov.unidad || "un" });
    }
  }

  return { catalogo: conExclusiones.filter((c) => c.productos.length > 0), degradado };
}
