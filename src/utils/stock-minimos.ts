// Stock mínimo sugerido por tienda+producto, calculado desde la venta
// histórica real (ventas_mensuales_articulo) — no es un umbral que alguien
// cargue a mano, se recalcula solo a medida que hay más meses de venta.
//
// Metodología: promedio de unidades vendidas por semana en los últimos
// MESES_HISTORIAL meses COMPLETOS (se excluye el mes en curso porque viene
// parcial y subestimaría el promedio), multiplicado por SEMANAS_BUFFER
// (cuántas semanas de respaldo se quiere tener en stock). Es una sugerencia
// de partida — no reemplaza el criterio de quien compra, pero da una señal
// objetiva de qué productos están por debajo de lo que históricamente rota.

import { getVentasPorTiendaProductoMes } from "@/utils/catalogo-productos";
import { getStockActualPorClave } from "@/utils/inventario-food-stock";
import { getCatalogoFood } from "@/utils/catalogo-food";

const MESES_HISTORIAL = 6;
const SEMANAS_BUFFER = 2;
const SEMANAS_POR_MES = 4.345;

function mesesCompletosRecientes(cantidad: number): string[] {
  const ahora = new Date();
  const meses: string[] = [];
  // Empieza en el mes anterior al actual (el actual va parcial).
  for (let i = 1; i <= cantidad; i++) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return meses;
}

export type ItemStockMinimo = {
  tienda: string;
  categoria: string;
  producto: string;
  stockActual: number;
  fechaUltimoConteo: string;
  ventaSemanalPromedio: number;
  mesesConDatos: number;
  stockMinimoSugerido: number;
  estado: "bajo_minimo" | "ok" | "sin_conteo" | "sin_datos_venta";
};

export async function getStockMinimos(): Promise<ItemStockMinimo[]> {
  const [ventasPorTiendaProductoMes, stockPorClave, categorias] = await Promise.all([
    getVentasPorTiendaProductoMes(),
    getStockActualPorClave(),
    getCatalogoFood(),
  ]);

  // El stock ahora se cuenta por Barra y Bodega por separado (claves distintas
  // en stockPorClave) — acá interesa el TOTAL del producto sin importar dónde
  // está, así que se suman todas las ubicaciones de un mismo tienda+categoria+
  // producto, y se toma la fecha más reciente entre ellas para mostrar.
  const stockPorProducto: Record<string, { cantidad: number; fecha: string }> = {};
  for (const row of Object.values(stockPorClave)) {
    const clave = `${row.tienda}||${row.categoria}||${row.producto}`;
    const fecha = row.fecha || row.creado_en || "";
    if (!stockPorProducto[clave]) stockPorProducto[clave] = { cantidad: 0, fecha: "" };
    stockPorProducto[clave].cantidad += Number(row.cantidad) || 0;
    if (fecha > stockPorProducto[clave].fecha) stockPorProducto[clave].fecha = fecha;
  }

  const mesesAConsiderar = mesesCompletosRecientes(MESES_HISTORIAL);

  // Todo producto contable del catálogo food, con su categoría — así también
  // aparecen productos que nunca se han contado (stockActual 0) o que se
  // vendieron pero no tienen conteo reciente, no solo los que sí tienen conteo.
  const productosPorTienda: Record<string, { categoria: string; producto: string }[]> = {};
  for (const cat of categorias) {
    for (const p of cat.productos) {
      for (const tienda of Object.keys(ventasPorTiendaProductoMes)) {
        if (!productosPorTienda[tienda]) productosPorTienda[tienda] = [];
        productosPorTienda[tienda].push({ categoria: cat.value, producto: p.nombre });
      }
    }
  }

  const items: ItemStockMinimo[] = [];
  for (const [tienda, productos] of Object.entries(productosPorTienda)) {
    for (const { categoria, producto } of productos) {
      const ventasPorMes = ventasPorTiendaProductoMes[tienda]?.[producto] || {};
      const mesesConVenta = mesesAConsiderar.filter((m) => ventasPorMes[m] != null);
      const totalVendido = mesesConVenta.reduce((acc, m) => acc + (ventasPorMes[m] || 0), 0);

      const clave = `${tienda}||${categoria}||${producto}`;
      const stockRow = stockPorProducto[clave];
      const stockActual = stockRow ? stockRow.cantidad : 0;

      let ventaSemanalPromedio = 0;
      let stockMinimoSugerido = 0;
      if (mesesConVenta.length > 0) {
        const promedioMensual = totalVendido / mesesConVenta.length;
        ventaSemanalPromedio = promedioMensual / SEMANAS_POR_MES;
        stockMinimoSugerido = ventaSemanalPromedio * SEMANAS_BUFFER;
      }

      // Un producto sin conteo NUNCA se marca "bajo mínimo": en Inventario Food
      // se cuenta lo que hay en el momento, no una checklist fija — la enorme
      // mayoría de productos (sobre todo panadería/pastelería) simplemente
      // nunca aparecen en ningún conteo puntual, y tratar eso como "0 en stock"
      // generaba una alerta en ~90% del catálogo. Sin conteo = sin dato, no alerta.
      let estado: ItemStockMinimo["estado"];
      if (!stockRow) {
        if (mesesConVenta.length === 0) continue; // ni venta ni conteo: no aporta nada
        estado = "sin_conteo";
      } else if (mesesConVenta.length === 0) {
        estado = "sin_datos_venta";
      } else {
        estado = stockActual < stockMinimoSugerido ? "bajo_minimo" : "ok";
      }

      items.push({
        tienda,
        categoria,
        producto,
        stockActual,
        fechaUltimoConteo: stockRow?.fecha || "",
        ventaSemanalPromedio,
        mesesConDatos: mesesConVenta.length,
        stockMinimoSugerido,
        estado,
      });
    }
  }

  items.sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === "bajo_minimo" ? -1 : b.estado === "bajo_minimo" ? 1 : 0;
    return a.producto.localeCompare(b.producto);
  });

  return items;
}
