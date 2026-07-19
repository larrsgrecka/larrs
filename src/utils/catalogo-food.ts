import { getCatalogoProductos } from "@/utils/catalogo-productos";
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
  productos: { nombre: string; unidad: string }[];
};

// Catálogo de productos "food" contables (usado por Inventario Food y
// Recepción de productos) — mismas reglas de curación para ambos, así no
// se desalinean con el tiempo. Los admins pueden agregar/excluir artículos
// puntuales sin tocar código vía /catalogo (ver catalogo-overrides.ts).
export async function getCatalogoFood(): Promise<CategoriaFood[]> {
  const [categorias, { incluir, excluirNombres }] = await Promise.all([
    getCatalogoProductos({
      excluir: ["HELADERIA", "CHOCOLATERIA", "ARTICULOS", "MATERIAS PRIMAS"],
    }),
    getOverrides("food"),
  ]);
  const base: CategoriaFood[] = categorias
    .map((c) => ({
      value: c.value,
      label: c.label,
      productos: c.productos
        .filter((p) => esContable(c.value, p))
        .map((nombre) => ({ nombre, unidad: unidadDe(nombre) })),
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

  return conExclusiones.filter((c) => c.productos.length > 0);
}
