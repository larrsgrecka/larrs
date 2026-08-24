import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getStockMinimos, type ItemStockMinimo } from "@/utils/stock-minimos";
import * as XLSX from "xlsx";

// Mismo cálculo que /api/stock-alertas, con el mismo riesgo de pasarse de 30s.
export const maxDuration = 60;

const ESTADO_ES: Record<ItemStockMinimo["estado"], string> = {
  bajo_minimo: "Bajo mínimo",
  ok: "OK",
  sin_conteo: "Sin conteo",
  sin_datos_venta: "Sin datos de venta",
};

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin puede ver este panel" }, { status: 403 });
  }

  // "un" = paquetes/unidades enteras (casi todo el catálogo); "kg" es solo el
  // café a granel. Pedir 7,3 alfajores no existe, así que en unidades todo va
  // redondeado, y hacia arriba: quedarse corto es peor que traer uno de más.
  const porUnidad = (it: ItemStockMinimo): boolean => (it.unidad || "un") === "un";
  const redondear = (it: ItemStockMinimo, valor: number, haciaArriba = true): number =>
    porUnidad(it)
      ? (haciaArriba ? Math.ceil(valor) : Math.round(valor))
      : Number(valor.toFixed(1));

  // Cuánto hay que reponer para llegar al mínimo sugerido. Sin meses de venta
  // no hay mínimo que comparar, y si ya está sobre el mínimo no falta nada.
  const faltaParaMinimo = (it: ItemStockMinimo): number =>
    it.mesesConDatos ? redondear(it, Math.max(0, it.stockMinimoSugerido - it.stockActual)) : 0;

  // Se respetan los dos filtros de pantalla. Con una tienda elegida el archivo
  // trae solo esa hoja, para poder enviárselo a esa tienda sin los datos de las
  // demás; con "Todas" trae el cuadro completo más una hoja por tienda.
  const tiendaFiltro = request.nextUrl.searchParams.get("tienda") || "Todas";
  const soloAlertas = request.nextUrl.searchParams.get("solo") === "1";

  const ENCABEZADOS = [
    "Tienda", "Categoría", "Producto", "Stock actual", "Venta sem. prom.",
    "Mínimo sugerido", "Falta para el mínimo", "Estado", "Último conteo",
    "Meses con datos de venta",
  ];
  const ANCHOS = [
    { wch: 12 }, { wch: 16 }, { wch: 46 }, { wch: 12 }, { wch: 16 },
    { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 24 },
  ];

  function hoja(items: ItemStockMinimo[]) {
    // Lo que más falta arriba: la hoja se lee como una lista de reposición.
    const ordenados = [...items].sort((a, b) => {
      const fa = faltaParaMinimo(a), fb = faltaParaMinimo(b);
      if (fa !== fb) return fb - fa;
      return a.producto.localeCompare(b.producto);
    });
    const filas = ordenados.map((it) => {
      const falta = faltaParaMinimo(it);
      return {
        Tienda: it.tienda,
        Categoría: it.categoria,
        Producto: it.producto,
        "Stock actual": it.stockActual,
        // Sin meses de venta no hay promedio ni mínimo: se deja la celda vacía
        // en vez de un 0 que se leería como "no rota nada".
        "Venta sem. prom.": it.mesesConDatos ? redondear(it, it.ventaSemanalPromedio, false) : "",
        "Mínimo sugerido": it.mesesConDatos ? redondear(it, it.stockMinimoSugerido) : "",
        "Falta para el mínimo": it.mesesConDatos ? falta : "",
        Estado: ESTADO_ES[it.estado],
        "Último conteo": it.fechaUltimoConteo || "Nunca",
        "Meses con datos de venta": it.mesesConDatos,
      };
    });
    const ws = XLSX.utils.json_to_sheet(filas, { header: ENCABEZADOS });
    ws["!cols"] = ANCHOS;
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: ENCABEZADOS.length - 1 } }),
    };
    ws["!freeze"] = "A2";
    return ws;
  }

  try {
    let items = await getStockMinimos();
    if (tiendaFiltro !== "Todas") items = items.filter((it) => it.tienda === tiendaFiltro);
    if (soloAlertas) items = items.filter((it) => it.estado === "bajo_minimo");
    const tiendas = [...new Set(items.map((it) => it.tienda))].sort();

    const wb = XLSX.utils.book_new();
    if (tiendaFiltro === "Todas") {
      XLSX.utils.book_append_sheet(wb, hoja(items), "Todas las tiendas");
      for (const t of tiendas) {
        // Nombre de hoja: Excel corta en 31 caracteres.
        XLSX.utils.book_append_sheet(wb, hoja(items.filter((it) => it.tienda === t)), t.slice(0, 31));
      }
    } else {
      XLSX.utils.book_append_sheet(wb, hoja(items), tiendaFiltro.slice(0, 31));
    }

    const generado = new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" });
    const resumen = tiendas.map((t) => {
      const dt = items.filter((it) => it.tienda === t);
      const bajo = dt.filter((it) => it.estado === "bajo_minimo");
      const falta = bajo.reduce((s, it) => s + faltaParaMinimo(it), 0);
      return [t, dt.length, bajo.length, Math.round(falta)];
    });
    const totalBajo = items.filter((it) => it.estado === "bajo_minimo");
    const info = XLSX.utils.aoa_to_sheet([
      ["Stock y alertas — Larrs"],
      [""],
      ["Generado", generado],
      ["Tienda", tiendaFiltro === "Todas" ? "Todas las tiendas" : tiendaFiltro],
      ["Filtro", soloAlertas ? "Solo productos bajo el mínimo" : "Todos los productos"],
      ["Productos en el archivo", items.length],
      ["Bajo mínimo", totalBajo.length],
      [""],
      ["Hoja", "Productos", "Bajo mínimo", "Unidades que faltan para el mínimo"],
      ...(tiendaFiltro === "Todas"
        ? [["Todas las tiendas", items.length, totalBajo.length,
            Math.round(totalBajo.reduce((s, it) => s + faltaParaMinimo(it), 0))]]
        : []),
      ...resumen,
      [""],
      ["Cada hoja está ordenada por lo que más falta para llegar al mínimo."],
      [""],
      ["Cómo se calcula el mínimo sugerido"],
      ["Promedio de venta semanal de los últimos 6 meses completos × 2 semanas de respaldo."],
      ["No es un umbral cargado a mano: se recalcula solo a medida que hay más meses de venta."],
      ["Solo aplica a productos con venta registrada en el POS — envases e insumos aparecen sin cálculo."],
      [""],
      ["Falta para el mínimo"],
      ["Mínimo sugerido menos stock actual. Es la cantidad a reponer para quedar en el mínimo."],
      ["Los productos sin venta registrada no tienen mínimo, así que tampoco tienen faltante."],
      [""],
      ["Stock actual"],
      ["Es el último conteo manual de Inventario Food, no un saldo en tiempo real."],
      ['Un producto nunca contado queda como "Sin conteo" en vez de asumir 0 en stock.'],
    ]);
    info["!cols"] = [{ wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, info, "Metodología");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const hoy = new Date().toISOString().slice(0, 10);
    const quien = tiendaFiltro === "Todas" ? "todas" : tiendaFiltro.toLowerCase().replace(/\s+/g, "-");
    const nombre = `stock-alertas-${quien}-${soloAlertas ? "bajo-minimo" : "completo"}-${hoy}.xlsx`;

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
