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
// tienda -> nombre -> "yyyy-mm" -> cantidad vendida ese mes.
export type VentasMensuales = Record<string, Record<string, Record<string, number>>>;

type CacheData = {
  data: Categoria[];
  codigos: Record<string, string>;
  preciosPromedio: Record<string, number>;
  ventasPorTiendaProductoMes: VentasMensuales;
  ts: number;
};
let cache: CacheData | null = null;
let inFlight: Promise<{
  categorias: Categoria[];
  codigos: Record<string, string>;
  preciosPromedio: Record<string, number>;
  ventasPorTiendaProductoMes: VentasMensuales;
}> | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchCatalogo(): Promise<{
  categorias: Categoria[];
  codigos: Record<string, string>;
  preciosPromedio: Record<string, number>;
  ventasPorTiendaProductoMes: VentasMensuales;
}> {
  const supabase = await createClient();
  const porGrupo = new Map<string, Set<string>>();
  const codigos: Record<string, string> = {};
  const sumaImporte: Record<string, number> = {};
  const sumaCantidad: Record<string, number> = {};
  const ventasPorTiendaProductoMes: VentasMensuales = {};

  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("ventas_mensuales_articulo")
      .select("grupo, nombre, codigo, cantidad, importe_neto, tienda, anio, mes")
      .order("grupo", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const grupo = (row.grupo as string | null)?.trim() || "OTROS";
      const nombre = row.nombre as string;
      if (!porGrupo.has(grupo)) porGrupo.set(grupo, new Set());
      porGrupo.get(grupo)!.add(nombre);
      if (row.codigo && !codigos[nombre]) {
        codigos[nombre] = row.codigo as string;
      }
      const cantidad = Number(row.cantidad) || 0;
      const importe = Number(row.importe_neto) || 0;
      if (cantidad > 0 && importe > 0) {
        sumaImporte[nombre] = (sumaImporte[nombre] || 0) + importe;
        sumaCantidad[nombre] = (sumaCantidad[nombre] || 0) + cantidad;
      }

      const tienda = (row.tienda as string | null)?.trim();
      const anio = Number(row.anio);
      const mes = Number(row.mes);
      if (tienda && anio && mes && cantidad > 0) {
        const clavePeriodo = `${anio}-${String(mes).padStart(2, "0")}`;
        if (!ventasPorTiendaProductoMes[tienda]) ventasPorTiendaProductoMes[tienda] = {};
        if (!ventasPorTiendaProductoMes[tienda][nombre]) ventasPorTiendaProductoMes[tienda][nombre] = {};
        ventasPorTiendaProductoMes[tienda][nombre][clavePeriodo] =
          (ventasPorTiendaProductoMes[tienda][nombre][clavePeriodo] || 0) + cantidad;
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

  const preciosPromedio: Record<string, number> = {};
  for (const nombre of Object.keys(sumaCantidad)) {
    preciosPromedio[nombre] = sumaImporte[nombre] / sumaCantidad[nombre];
  }

  return { categorias, codigos, preciosPromedio, ventasPorTiendaProductoMes };
}

// Deduplica llamadas concurrentes (ej. getCatalogoProductos() y
// getCodigosProductos() corriendo en el mismo Promise.all) para no pedir
// las ~12k filas dos veces cuando el cache está vencido.
async function getCache() {
  if (cache && Date.now() - cache.ts <= CACHE_TTL_MS) return cache;
  if (!inFlight) {
    inFlight = fetchCatalogo().finally(() => { inFlight = null; });
  }
  const { categorias, codigos, preciosPromedio, ventasPorTiendaProductoMes } = await inFlight;
  cache = { data: categorias, codigos, preciosPromedio, ventasPorTiendaProductoMes, ts: Date.now() };
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

// Precio de venta promedio por producto (importe_neto / cantidad, sumado
// sobre todo el historial de ventas) — nombre -> precio unitario. Es precio
// de VENTA, no costo — sirve para valorizar stock a precio de venta, no
// para márgenes ni costos reales.
export async function getPreciosPromedioPorProducto(): Promise<Record<string, number>> {
  const c = await getCache();
  return c.preciosPromedio;
}

// Cantidad vendida por mes ("yyyy-mm" -> cantidad), por tienda y producto —
// base para calcular un stock mínimo sugerido a partir de la venta histórica.
export async function getVentasPorTiendaProductoMes(): Promise<VentasMensuales> {
  const c = await getCache();
  return c.ventasPorTiendaProductoMes;
}
