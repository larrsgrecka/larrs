import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getProfile } from "@/utils/auth";
import * as XLSX from "xlsx";
import {
  mapTienda, parseDate, ubicarColumnas, numero, leerCSV, formatoDe,
} from "@/utils/grecka-excel";
import { registrarMarcas } from "@/utils/grecka-marcas";
import { catalogoPorSku } from "@/utils/grecka-catalogo";

export const maxDuration = 60;

type Fila = {
  ndoc: string; tienda: string; fecha: string | null; sku: string;
  descripcion: string; grupo: string; cantidad: number; unidad: string;
  precio_unitario: number; neto: number; destino_raw: string;
};

export async function POST(request: NextRequest) {
  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  // El reporte de pedidos sale en .csv y el de facturas en .xlsx. El CSV no se
  // le pasa a la librería de Excel: viene con punto y coma, BOM y comillas
  // dentro de las descripciones, y cualquiera de esas cosas mal leída corre una
  // columna sin que se note hasta que los precios salen mal.
  const esCSV = /\.csv$/i.test(file.name) || file.type === "text/csv";
  let rawRows: unknown[][];
  if (esCSV) {
    rawRows = leerCSV(buffer.toString("utf-8"));
  } else {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  }

  if (rawRows.length < 2) {
    return NextResponse.json({ error: "El archivo no tiene filas de datos." }, { status: 400 });
  }

  // Las columnas se ubican por el nombre del encabezado y no por su posición.
  // El export de Grecka a veces trae una columna "#" de numeración al
  // principio: eso corre todo un lugar, y leyendo por posición el importador
  // buscaba el cliente donde había una celda vacía y descartaba el archivo
  // entero diciendo que no tenía datos de Larrs.
  const columnas = ubicarColumnas(rawRows[0]);
  if (columnas.faltantes.length) {
    return NextResponse.json(
      {
        error:
          `No se reconocieron estas columnas en el archivo: ${columnas.faltantes.join(", ")}. ` +
          `Los encabezados que sí se leyeron son: ${(rawRows[0] as unknown[]).map((h) => String(h).trim()).filter(Boolean).join(" | ")}. ` +
          `¿Es el reporte de compras que exporta Grecka?`,
      },
      { status: 400 }
    );
  }
  const col = columnas.indices;
  const formato = formatoDe(col);

  // El reporte de pedidos no dice qué es cada producto, así que se deduce del
  // histórico. El de facturas lo trae y no hace falta.
  const catalogo = formato === "pedidos" ? await catalogoPorSku() : {};

  const filas: Fila[] = [];
  const destinosIgnorados = new Set<string>();
  const marcas: Record<string, string> = {};
  const skusSinGrupo = new Set<string>();
  let filasDeLarrs = 0;
  let abiertos = 0;

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const nombreCli = (row[col.cliente] || "").toString().toUpperCase();
    if (!nombreCli.includes("CRISTIANO FERRERO") && !nombreCli.includes("FACTORIA DE HELADOS")) continue;
    filasDeLarrs++;

    // Un pedido "Abierto" todavía no se facturó: puede cambiar o no llegar
    // nunca. Dejarlo entrar metió $41 millones de equipos —un armario y una
    // cafetera— en las compras de agosto de Dominicos, que son 10 veces lo que
    // esa tienda compra en un mes y habrían deformado toda la proyección.
    if (col.estado !== undefined) {
      const estado = (row[col.estado] || "").toString().trim().toLowerCase();
      if (estado && estado !== "cerrado") { abiertos++; continue; }
    }

    // La marca se guarda aparte, por SKU: la tabla de compras no tiene esa
    // columna y agregarla obligaría a recargar todo el histórico.
    if (col.marca !== undefined) {
      const sku = (row[col.sku] || "").toString().trim();
      const marca = (row[col.marca] || "").toString().trim();
      if (sku && marca) marcas[sku] = marca;
    }

    const destinoRaw = (row[col.destino] || "").toString();
    const tienda = mapTienda(destinoRaw);
    if (!tienda) {
      if (destinoRaw.trim()) destinosIgnorados.add(destinoRaw.trim());
      continue;
    }

    const sku = (row[col.sku] || "").toString().trim();
    const ficha = catalogo[sku];
    const grupo = col.grupo !== undefined
      ? (row[col.grupo] || "").toString().trim()
      : ficha?.grupo ?? "";
    if (!grupo && sku) skusSinGrupo.add(sku);

    filas.push({
      ndoc: (row[col.ndoc] || "").toString().trim(),
      tienda,
      fecha: parseDate(row[col.fecha]),
      sku,
      descripcion: (row[col.descripcion] || "").toString().trim(),
      grupo,
      cantidad: numero(row[col.cantidad]),
      unidad: col.unidad !== undefined
        ? (row[col.unidad] || "").toString().trim()
        : ficha?.unidad ?? "",
      precio_unitario: numero(row[col.precio]),
      neto: numero(row[col.neto]),
      destino_raw: destinoRaw.trim(),
    });
  }

  if (filas.length === 0) {
    // Decir en cuál de los filtros se quedó todo: sin esto, el mismo mensaje
    // servía para un archivo equivocado, para uno con las columnas corridas y
    // para uno que solo trae sucursales que no son de Larrs.
    const detalle = filasDeLarrs === 0
      ? `Se leyeron ${rawRows.length - 1} filas, pero ninguna tiene a Cristiano Ferrero o Factoría de Helados como cliente.`
      : abiertos === filasDeLarrs
      ? `Las ${filasDeLarrs} filas de Larrs son pedidos todavía no facturados ("Abierto").`
      : `Hay ${filasDeLarrs} filas de Larrs, pero ningún destino corresponde a una tienda. Destinos encontrados: ${[...destinosIgnorados].join(", ") || "(vacíos)"}.`;
    return NextResponse.json({ error: `No se encontraron datos para importar. ${detalle}` }, { status: 400 });
  }

  const sinFecha = filas.filter((f) => !f.fecha).length;
  const conFecha = filas.filter((f) => f.fecha);
  if (!conFecha.length) {
    return NextResponse.json({ error: "Ninguna fila tiene una fecha que se pueda leer." }, { status: 400 });
  }
  const desde = conFecha.reduce((a, f) => (f.fecha! < a ? f.fecha! : a), conFecha[0].fecha!);
  const hasta = conFecha.reduce((a, f) => (f.fecha! > a ? f.fecha! : a), conFecha[0].fecha!);

  const supabase = createAdminClient();
  const reemplazo = formato === "pedidos"
    ? await reemplazarVentana(supabase, conFecha, desde, hasta)
    : null;

  const yaEstaban = formato === "facturas"
    ? await descartarYaCargadas(supabase, conFecha)
    : new Set<string>();
  const aInsertar = conFecha.filter(
    (f) => !yaEstaban.has(`${f.ndoc}|${f.sku}|${f.cantidad}`)
  );

  let insertadas = 0;
  const LOTE = 500;
  for (let i = 0; i < aInsertar.length; i += LOTE) {
    const lote = aInsertar.slice(i, i + LOTE);
    const { data, error } = await supabase
      .from("ventas_grecka")
      .upsert(lote, { onConflict: "ndoc,sku,cantidad,destino_raw", ignoreDuplicates: true })
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    insertadas += data?.length ?? 0;
  }

  const porTienda: Record<string, number> = {};
  for (const f of aInsertar) porTienda[f.tienda] = (porTienda[f.tienda] || 0) + 1;

  // Las marcas se guardan después: que falle esto no puede tirar abajo una
  // importación que ya quedó escrita.
  let marcasInfo: { total: number; agregadas: number } | null = null;
  if (Object.keys(marcas).length) {
    try { marcasInfo = await registrarMarcas(marcas); }
    catch (e) { console.error("[upload-ventas] no se pudieron guardar las marcas:", e); }
  }

  return NextResponse.json({
    ok: true,
    formato,
    periodo: { desde, hasta },
    total: insertadas,
    leidas: filas.length,
    porTienda,
    marcas: marcasInfo,
    // Lo que el archivo no pudo contar, dicho en vez de callado.
    avisos: {
      pedidosAbiertos: abiertos,
      sinFecha,
      repetidasEnElArchivo: aInsertar.length - insertadas,
      yaEstabanCargadas: yaEstaban.size,
      skusSinGrupo: [...skusSinGrupo],
      destinosIgnorados: [...destinosIgnorados],
      ...(reemplazo ?? {}),
    },
  });
}

/**
 * El reporte de pedidos manda sobre el período que cubre.
 *
 * Los dos reportes numeran distinto —el pedido 91259 es el documento 58355—,
 * así que cargar uno encima del otro no choca con nada y deja la misma compra
 * dos veces. Por eso, antes de insertar, se saca de la base lo que este archivo
 * vuelve a traer.
 *
 * No se borra el período completo: lo que la base tiene y el archivo no trae
 * —las notas de crédito, sobre todo, que el reporte de pedidos no muestra— se
 * queda donde está. Y solo se tocan las tiendas que vienen en el archivo, para
 * que subir un reporte de una sola tienda no borre las demás.
 */
async function reemplazarVentana(
  supabase: ReturnType<typeof createAdminClient>,
  filas: Fila[],
  desde: string,
  hasta: string
) {
  const tiendas = [...new Set(filas.map((f) => f.tienda))];

  const existentes: { id: number; ndoc: string; tienda: string; fecha: string; sku: string; cantidad: number }[] = [];
  const LOTE = 1000;
  for (let i = 0; ; i += LOTE) {
    const { data, error } = await supabase
      .from("ventas_grecka")
      .select("id, ndoc, tienda, fecha, sku, cantidad")
      .gte("fecha", desde).lte("fecha", hasta).in("tienda", tiendas)
      .order("id", { ascending: true })
      .range(i, i + LOTE - 1);
    if (error) throw new Error(`No se pudo revisar lo ya cargado: ${error.message}`);
    if (!data?.length) break;
    existentes.push(...(data as typeof existentes));
    if (data.length < LOTE) break;
  }

  // El archivo fecha el día del pedido y la base venía fechando el de la
  // factura, uno o dos días después —hasta nueve en los casos lentos—. Cruzar
  // por fecha exacta daría casi todo por distinto y duplicaría el período
  // entero, así que se cruza por tienda, producto y cantidad dentro de 20 días.
  const TOLERANCIA_DIAS = 20;
  const dia = 24 * 60 * 60 * 1000;
  const porClave = new Map<string, number[]>();
  for (const f of filas) {
    const k = `${f.tienda}|${f.sku}|${f.cantidad}`;
    const t = new Date(f.fecha!).getTime();
    porClave.set(k, [...(porClave.get(k) ?? []), t]);
  }

  // Las copias que dejó la carga doble de junio se van igual, las traiga o no
  // este archivo: si no, las dos líneas que el reporte de pedidos no muestra
  // —un actuador y una visita técnica, $831.000— se quedan contadas dos veces
  // para siempre, que es justo el error que esto viene a limpiar.
  const yaVisto = new Set<string>();
  const aBorrar: number[] = [];
  let copiasRepetidas = 0;
  for (const e of existentes) {
    const identidad = `${e.ndoc}|${e.fecha}|${e.sku}|${Number(e.cantidad)}`;
    if (yaVisto.has(identidad)) { aBorrar.push(e.id); copiasRepetidas++; continue; }
    yaVisto.add(identidad);

    const fechas = porClave.get(`${e.tienda}|${e.sku}|${Number(e.cantidad)}`);
    if (!fechas) continue;
    const t = new Date(e.fecha).getTime();
    if (fechas.some((f) => Math.abs(f - t) <= TOLERANCIA_DIAS * dia)) aBorrar.push(e.id);
  }

  for (let i = 0; i < aBorrar.length; i += LOTE) {
    const { error } = await supabase
      .from("ventas_grecka").delete().in("id", aBorrar.slice(i, i + LOTE));
    if (error) throw new Error(`No se pudo reemplazar el período: ${error.message}`);
  }

  return {
    reemplazadas: aBorrar.length - copiasRepetidas,
    copiasRepetidas,
    conservadas: existentes.length - aBorrar.length,
  };
}

/**
 * Qué líneas del reporte de facturas ya están en la base.
 *
 * El candado de la tabla incluye el destino, y Grecka escribe el mismo destino
 * de dos maneras ("HUECHURABA" y "CAMINO DEL CERRO 4966 HUECHURABA CHILE"), así
 * que al cambiar el formato del reporte el candado no reconoció nada: junio de
 * 2026 quedó cargado dos veces, 148 líneas y $19 millones de más, repartidos en
 * la proyección de compras sin que nada lo mostrara. Acá el cruce ignora el
 * destino, que es lo único que cambiaba.
 */
async function descartarYaCargadas(
  supabase: ReturnType<typeof createAdminClient>,
  filas: Fila[]
) {
  const ndocs = [...new Set(filas.map((f) => f.ndoc).filter(Boolean))];
  const ya = new Set<string>();
  const LOTE = 200;
  for (let i = 0; i < ndocs.length; i += LOTE) {
    const { data, error } = await supabase
      .from("ventas_grecka")
      .select("ndoc, sku, cantidad")
      .in("ndoc", ndocs.slice(i, i + LOTE));
    if (error) throw new Error(`No se pudo revisar lo ya cargado: ${error.message}`);
    for (const r of (data ?? []) as { ndoc: string; sku: string; cantidad: number }[]) {
      ya.add(`${r.ndoc}|${r.sku}|${Number(r.cantidad)}`);
    }
  }
  return ya;
}
