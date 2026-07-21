import { createClient } from "@/utils/supabase/server";

const LABELS: Record<string, string> = {
  HELADERIA: "Heladería",
  CAFETERIA: "Cafetería",
  PANADERIA: "Panadería",
  BOLLERIA: "Bollería",
  PASTELERIA: "Pastelería",
  GALLETERIA: "Galletería",
  CHOCOLATERIA: "Chocolatería",
  BEBIDAS: "Bebidas",
  ARTICULOS: "Artículos",
  "MATERIAS PRIMAS": "Materias primas",
};

const ORDEN = [
  "HELADERIA", "CAFETERIA", "PANADERIA", "BOLLERIA", "PASTELERIA",
  "GALLETERIA", "CHOCOLATERIA", "BEBIDAS", "ARTICULOS", "MATERIAS PRIMAS",
];

export type Categoria = { value: string; label: string; productos: string[] };

// Catálogo real de ventas (~12k filas): cambia poco, se cachea en memoria
// para no repaginar la tabla completa en cada carga de los paneles que lo usan.
let cache: { data: Categoria[]; codigos: Record<string, string>; ts: number } | null = null;
let inFlight: Promise<{ categorias: Categoria[]; codigos: Record<string, string> }> | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchCatalogo(): Promise<{ categorias: Categoria[]; codigos: Record<string, string> }> {
  const supabase = await createClient();
  const porGrupo = new Map<string, Set<string>>();
  const codigos: Record<string, string> = {};

  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("ventas_mensuales_articulo")
      .select("grupo, nombre, codigo")
      .order("grupo", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const grupo = (row.grupo as string | null)?.trim() || "OTROS";
      if (!porGrupo.has(grupo)) porGrupo.set(grupo, new Set());
      porGrupo.get(grupo)!.add(row.nombre as string);
      if (row.codigo && !codigos[row.nombre as string]) {
        codigos[row.nombre as string] = row.codigo as string;
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  const grupos = [...porGrupo.keys()].sort((a, b) => {
    const ia = ORDEN.indexOf(a), ib = ORDEN.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const categorias = grupos.map((grupo) => ({
    value: grupo,
    label: LABELS[grupo] || grupo.charAt(0) + grupo.slice(1).toLowerCase(),
    productos: [...porGrupo.get(grupo)!].sort((a, b) => a.localeCompare(b)),
  }));

  return { categorias, codigos };
}

// Deduplica llamadas concurrentes (ej. getCatalogoProductos() y
// getCodigosProductos() corriendo en el mismo Promise.all) para no pedir
// las ~12k filas dos veces cuando el cache está vencido.
async function getCache() {
  if (cache && Date.now() - cache.ts <= CACHE_TTL_MS) return cache;
  if (!inFlight) {
    inFlight = fetchCatalogo().finally(() => { inFlight = null; });
  }
  const { categorias, codigos } = await inFlight;
  cache = { data: categorias, codigos, ts: Date.now() };
  return cache;
}

export async function getCatalogoProductos(opts?: { excluir?: string[] }): Promise<Categoria[]> {
  const c = await getCache();
  const excluir = opts?.excluir || [];
  if (excluir.length === 0) return c.data;
  return c.data.filter((cat) => !excluir.includes(cat.value));
}

// Código real del producto (columna "codigo" de ventas_mensuales_articulo,
// el mismo SKU del POS) — nombre -> código. Un mismo nombre puede repetirse
// en varias tiendas/meses; se toma el primer código no vacío encontrado.
export async function getCodigosProductos(): Promise<Record<string, string>> {
  const c = await getCache();
  return c.codigos;
}
