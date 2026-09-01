// Respuestas de alto nivel para el servidor MCP (/api/mcp): las mismas cuentas
// que ya muestran los paneles, no las planillas crudas. La diferencia importa —
// preguntarle a Claude "qué le falta a Dominicos" solo sirve si la respuesta
// sale del mismo cálculo que el panel, no de una hoja sin procesar.

import { getStockMinimos, type ItemStockMinimo } from "@/utils/stock-minimos";
import { getActividadTiendas } from "@/utils/actividad-tiendas";
import { getRegistrosPesaje, type RegistroPesaje } from "@/utils/produccion-historial";
import { getStockActualPorClave } from "@/utils/inventario-food-stock";
import { getVentasPorTiendaProductoMes, getPreciosPromedioPorProducto } from "@/utils/catalogo-productos";

// Casi todo el catálogo se vende por unidades completas: pedir 7,3 alfajores no
// significa nada (misma regla que el panel de Stock y alertas).
const porUnidad = (it: ItemStockMinimo) => (it.unidad || "un") === "un";
const cant = (it: ItemStockMinimo, valor: number, haciaArriba = true) =>
  porUnidad(it)
    ? (haciaArriba ? Math.ceil(valor) : Math.round(valor))
    : Number(valor.toFixed(1));

export async function stockYFaltantes(opts: { tienda?: string; soloBajoMinimo?: boolean } = {}) {
  let items = await getStockMinimos();
  if (opts.tienda) items = items.filter((it) => it.tienda === opts.tienda);
  if (opts.soloBajoMinimo !== false) items = items.filter((it) => it.estado === "bajo_minimo");

  const productos = items
    .map((it) => ({
      tienda: it.tienda,
      categoria: it.categoria,
      producto: it.producto,
      unidad: it.unidad,
      stockActual: it.stockActual,
      minimoSugerido: it.mesesConDatos ? cant(it, it.stockMinimoSugerido) : null,
      faltaParaElMinimo: it.mesesConDatos ? cant(it, Math.max(0, it.stockMinimoSugerido - it.stockActual)) : null,
      ventaSemanalPromedio: it.mesesConDatos ? cant(it, it.ventaSemanalPromedio, false) : null,
      estado: it.estado,
      ultimoConteo: it.fechaUltimoConteo || null,
    }))
    .sort((a, b) => (b.faltaParaElMinimo ?? 0) - (a.faltaParaElMinimo ?? 0));

  return {
    productos,
    resumen: {
      total: productos.length,
      bajoMinimo: productos.filter((p) => p.estado === "bajo_minimo").length,
      unidadesQueFaltan: productos.reduce((s, p) => s + (p.faltaParaElMinimo ?? 0), 0),
    },
    comoSeCalcula:
      "Mínimo sugerido = venta semanal promedio de los últimos 6 meses completos × 2 semanas de respaldo. " +
      "El stock actual es el último conteo manual de Inventario Food, no un saldo en tiempo real.",
  };
}

// Lunes de la semana ISO de una fecha, en texto yyyy-mm-dd.
function lunesISO(fecha: string): string {
  const d = new Date(fecha + "T12:00:00");
  const dia = d.getDay() || 7; // domingo = 7
  d.setDate(d.getDate() - (dia - 1));
  return d.toISOString().slice(0, 10);
}

export async function produccionPorSemana(opts: { tienda?: string; semanas?: number } = {}) {
  // La producción se imputa a la "Fecha de recuento", que puede ser de días
  // antes de la carga: por eso se agrupa por esa fecha y no por la de envío.
  const registros = await getRegistrosPesaje(opts.tienda, 500);
  const cuantas = opts.semanas ?? 4;

  const porSemana: Record<string, Record<string, number>> = {};
  for (const r of registros) {
    const kg = r.items.reduce((s, i) => s + i.kg, 0);
    if (kg <= 0) continue;
    const semana = lunesISO(r.fecha);
    porSemana[semana] = porSemana[semana] || {};
    porSemana[semana][r.tienda] = (porSemana[semana][r.tienda] || 0) + kg;
  }

  const semanas = Object.keys(porSemana).sort().reverse().slice(0, cuantas).map((semana) => {
    const tiendas = porSemana[semana];
    const total = Object.values(tiendas).reduce((s, v) => s + v, 0);
    return {
      semanaDesde: semana,
      totalKg: Number(total.toFixed(1)),
      porTienda: Object.fromEntries(
        Object.entries(tiendas).sort((a, b) => b[1] - a[1]).map(([t, v]) => [t, Number(v.toFixed(1))])
      ),
    };
  });

  return { semanas, nota: "Los kg se imputan a la fecha de recuento que declara quien carga, no a la fecha de carga." };
}

export async function topSabores(opts: { tienda?: string; desde?: string; limite?: number } = {}) {
  const registros = await getRegistrosPesaje(opts.tienda, 500);
  const acumulado: Record<string, number> = {};
  for (const r of registros) {
    if (opts.desde && r.fecha < opts.desde) continue;
    for (const it of r.items) acumulado[it.sabor] = (acumulado[it.sabor] || 0) + it.kg;
  }
  const total = Object.values(acumulado).reduce((s, v) => s + v, 0);
  const sabores = Object.entries(acumulado)
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.limite ?? 10)
    .map(([sabor, kg]) => ({
      sabor,
      kg: Number(kg.toFixed(1)),
      porcentajeDelTotal: total > 0 ? Number(((kg / total) * 100).toFixed(1)) : 0,
    }));
  return { sabores, totalKgDelPeriodo: Number(total.toFixed(1)) };
}

export async function ultimosPesajes(opts: { tienda?: string; limite?: number } = {}) {
  const registros: RegistroPesaje[] = await getRegistrosPesaje(opts.tienda, opts.limite ?? 15);
  return {
    pesajes: registros.map((r) => ({
      fechaDeLaProduccion: r.fecha,
      cargadoEl: r.marcaTemporal,
      tienda: r.tienda,
      quienCargo: r.nombre,
      totalKg: Number(r.items.reduce((s, i) => s + i.kg, 0).toFixed(1)),
      sabores: r.items.map((i) => ({ sabor: i.sabor, kg: Number(i.kg.toFixed(1)) })),
      observaciones: r.observaciones || null,
    })),
  };
}

export async function cumplimientoPorTienda() {
  const { actividad, errores } = await getActividadTiendas();
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dias = (fecha: string | null) =>
    fecha ? Math.round((hoy.getTime() - new Date(fecha + "T00:00:00").getTime()) / 86400000) : null;

  return {
    tiendas: Object.entries(actividad).map(([tienda, m]) => ({
      tienda,
      mermas: { ultimaFecha: m.mermas, diasSinRegistrar: dias(m.mermas) },
      inventarioFood: { ultimaFecha: m.inventario, diasSinRegistrar: dias(m.inventario) },
      pesajeProduccion: { ultimaFecha: m.pesaje, diasSinRegistrar: dias(m.pesaje) },
      recepcion: { ultimaFecha: m.recepcion, diasSinRegistrar: dias(m.recepcion) },
    })),
    // Si una fuente falló, hay que decirlo: un null puede significar "no
    // registraron" o "no pudimos consultar", y confundirlos acusa a la tienda.
    fuentesQueFallaron: errores,
  };
}

export async function ultimosConteosDeInventario(opts: { tienda?: string } = {}) {
  const porClave = await getStockActualPorClave();
  let filas = Object.values(porClave);
  if (opts.tienda) filas = filas.filter((r) => r.tienda === opts.tienda);
  filas.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  return {
    conteos: filas.slice(0, 200).map((r) => ({
      tienda: r.tienda,
      categoria: r.categoria,
      producto: r.producto,
      cantidad: r.cantidad,
      unidad: r.unidad || "un",
      ubicacion: r.ubicacion || null,
      fecha: r.fecha || null,
    })),
    nota: "Es el último conteo por producto y ubicación, no un saldo corrido.",
  };
}

export async function ventasPorProducto(opts: { tienda?: string; mes?: string; limite?: number } = {}) {
  const [ventas, precios] = await Promise.all([
    getVentasPorTiendaProductoMes(),
    getPreciosPromedioPorProducto(),
  ]);

  const acumulado: Record<string, number> = {};
  for (const [tienda, porProducto] of Object.entries(ventas)) {
    if (opts.tienda && tienda !== opts.tienda) continue;
    for (const [producto, porMes] of Object.entries(porProducto)) {
      for (const [mes, unidades] of Object.entries(porMes)) {
        if (opts.mes && mes !== opts.mes) continue;
        acumulado[producto] = (acumulado[producto] || 0) + (unidades || 0);
      }
    }
  }

  const productos = Object.entries(acumulado)
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.limite ?? 25)
    .map(([producto, unidades]) => ({
      producto,
      unidades: Math.round(unidades),
      precioPromedio: precios[producto] ? Math.round(precios[producto]) : null,
      ventaEstimada: precios[producto] ? Math.round(unidades * precios[producto]) : null,
    }));

  const mesesDisponibles = [...new Set(
    Object.values(ventas).flatMap((p) => Object.values(p).flatMap((m) => Object.keys(m)))
  )].sort();

  return { productos, mesesDisponibles };
}
