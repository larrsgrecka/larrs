// Cuánto habrá que comprarle a Grecka en los próximos meses.
//
// Lo que hace útil a esta proyección es la estacionalidad, y no el promedio.
// Medida sobre cinco años completos de compras, noviembre es 2,6 veces un mes
// promedio y diciembre 2,0, mientras mayo y junio son 0,45. Proyectar el verano
// con el promedio de los últimos meses —septiembre está en 0,65— subestimaría
// noviembre por cuatro: se llegaría a la temporada alta sin insumos, que es
// exactamente el error que esto existe para evitar.
//
// El método, en una línea: a cada producto se le calcula su nivel de consumo
// limpio de estación, y después se lo vuelve a estacionalizar según el mes que
// viene.

import { createAdminClient } from "@/utils/supabase/admin";
import { unidadHabitual } from "@/utils/pedido-sugerido";
import { marcasPorSku, SIN_MARCA } from "@/utils/grecka-marcas";

const GRUPOS_DE_CONSUMO = ["Insumos", "Accesorios"];

// Doce meses de historia para el nivel: menos deja fuera una estación entera y
// más arrastra precios y volúmenes de cuando el negocio era otro.
const MESES_DE_NIVEL = 12;

type Compra = {
  fecha: string; tienda: string; sku: string; descripcion: string;
  grupo: string; cantidad: number; unidad: string; precio_unitario: number; neto: number;
};

export type ProductoProyectado = {
  sku: string;
  producto: string;
  unidad: string;
  grupo: string;
  marca: string;
  /** Consumo mensual limpio de estación, en unidades. */
  nivelMensual: number;
  precioUnitario: number;
  /** Una entrada por mes proyectado. */
  porMes: { mes: string; etiqueta: string; cantidad: number; cantidadExacta: number; monto: number }[];
  cantidadTotal: number;
  montoTotal: number;
  /** Meses distintos con compras en el último año: con dos o tres, el nivel es flojo. */
  mesesConCompras: number;
  /** true cuando hay tan poca historia que el número es apenas una referencia. */
  pocoHistorial: boolean;
  /** Compras que usaban una unidad sin equivalencia clara y no se contaron. */
  lineasIgnoradas: number;
};

export type Proyeccion = {
  generadoEn: string;
  desde: string;
  mesesProyectados: number;
  crecimientoAplicadoPct: number;
  /** Índice por mes del año: 1,00 es un mes promedio. */
  estacionalidad: { mes: number; nombre: string; indice: number; anios: number }[];
  meses: { mes: string; etiqueta: string; indice: number; monto: number; productos: number }[];
  productos: ProductoProyectado[];
  montoTotal: number;
  porGrupo: { grupo: string; monto: number }[];
  /** El corte que pidió Gustavo: cuánto por marca, y cuánto de esa marca cada mes. */
  porMarca: {
    marca: string; monto: number; productos: number;
    porMes: { mes: string; etiqueta: string; monto: number }[];
  }[];
  /** Productos sin marca conocida: su monto está en "Sin marca". */
  sinMarca: { productos: number; monto: number };
  nota: string;
};

const NOMBRE_MES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const ZONA = "America/Santiago";
const mesISO = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit" }).format(d);

const claveUnidad = (u: string) => {
  const t = (u || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return t.endsWith("s") && t.length > 3 ? t.slice(0, -1) : t;
};

/** Precio por unidad base, tomando la mediana de las compras hechas en esa unidad. */
function precioDe(compras: Compra[], unidadBase: string): number {
  const base = claveUnidad(unidadBase);
  const precios = compras
    .filter((c) => claveUnidad(c.unidad) === base && Number(c.cantidad) > 0)
    .map((c) => Number(c.neto) / Number(c.cantidad))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (!precios.length) return 0;
  // Mediana y no promedio: un descuento puntual o un precio mal cargado no
  // debería mover el presupuesto de tres meses.
  return Math.round(precios[Math.floor(precios.length / 2)]);
}

// Cuántas unidades base trae cada otra unidad del mismo producto.
//
// Sale de los precios: el mismo vaso aparece como "1 CAJA $150.288" y como
// "8 BOLSA $18.786 cada una", así que la caja trae ocho bolsas. Sin esto, el
// precio de la caja se multiplicaba por una cantidad contada en bolsas.
function equivalenciasDe(compras: Compra[], unidadBase: string): Map<string, number> {
  const base = claveUnidad(unidadBase);
  const precioBase = precioDe(compras, unidadBase);
  const mapa = new Map<string, number>([[base, 1]]);
  if (!precioBase) return mapa;

  for (const otra of new Set(compras.map((c) => claveUnidad(c.unidad)))) {
    if (!otra || otra === base) continue;
    const precioOtra = precioDe(compras, otra);
    if (!precioOtra) continue;
    const razon = precioOtra / precioBase;
    const redondeada = Math.round(razon);
    // Solo se acepta un múltiplo entero y con poco error: si la razón es 7,4 no
    // hay una equivalencia real, hay dos productos distintos o un precio mal
    // cargado, y adivinar sería peor que dejar esas líneas afuera.
    if (redondeada >= 1 && redondeada <= 100 && Math.abs(razon - redondeada) / redondeada <= 0.08) {
      mapa.set(otra, redondeada);
    }
  }
  return mapa;
}

/** Índice estacional por mes, contra la media móvil centrada de doce meses.
 *
 * El método importa. Medir cada mes contra el promedio de su año calendario
 * parecía razonable y estaba sesgado: si el negocio crece durante el año, los
 * meses del final siempre quedan por encima del promedio anual, y el
 * crecimiento se disfraza de estación. Con cinco años de crecimiento seguido
 * eso daba noviembre en 2,60 —2,6 veces un mes normal— y proyectaba el doble de
 * lo que la empresa gastó de verdad el mismo trimestre del año anterior.
 *
 * La media móvil centrada se mueve con el negocio, así que lo que queda al
 * dividir es la estación y nada más. Es el método clásico para esto.
 */
export function estacionalidadDe(compras: Compra[]) {
  const netoPorMes = new Map<string, number>();
  for (const c of compras) {
    const m = c.fecha.slice(0, 7);
    netoPorMes.set(m, (netoPorMes.get(m) || 0) + (Number(c.neto) || 0));
  }

  // La serie tiene que ser continua: un mes sin compras es un cero, no un
  // agujero, o la media móvil se corre.
  const ordenados = [...netoPorMes.keys()].sort();
  if (ordenados.length < 24) {
    // Con menos de dos años no hay con qué separar estación de tendencia.
    return Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, nombre: NOMBRE_MES[i + 1], indice: 1, anios: 0 }));
  }

  const serie: { mes: string; valor: number }[] = [];
  const [a0, m0] = ordenados[0].split("-").map(Number);
  const [a1, m1] = ordenados[ordenados.length - 1].split("-").map(Number);
  for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? (a++, m = 1) : m++) {
    const clave = `${a}-${String(m).padStart(2, "0")}`;
    serie.push({ mes: clave, valor: netoPorMes.get(clave) || 0 });
  }

  const muestras = new Map<number, number[]>();
  for (let i = 6; i < serie.length - 6; i++) {
    // Media móvil centrada de 12 meses: medios pesos en los extremos, que es
    // lo que la mantiene centrada en un período par.
    let suma = (serie[i - 6].valor + serie[i + 6].valor) / 2;
    for (let j = i - 5; j <= i + 5; j++) suma += serie[j].valor;
    const media = suma / 12;
    if (media <= 0 || serie[i].valor <= 0) continue;
    const mes = Number(serie[i].mes.slice(5));
    if (!muestras.has(mes)) muestras.set(mes, []);
    muestras.get(mes)!.push(serie[i].valor / media);
  }

  const crudos: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const v = muestras.get(m) ?? [];
    // Mediana y no promedio: un noviembre con una compra grande por apertura de
    // local no debe definir la estación de todos los noviembres.
    const ordenada = [...v].sort((a, b) => a - b);
    crudos.push(ordenada.length ? ordenada[Math.floor(ordenada.length / 2)] : 1);
  }

  // Se normalizan para que los doce sumen 12: así reestacionalizar un nivel
  // mensual reproduce exactamente el consumo del año, sin inflarlo ni achicarlo.
  const suma = crudos.reduce((a, b) => a + b, 0);
  const escala = suma > 0 ? 12 / suma : 1;

  return crudos.map((v, i) => ({
    mes: i + 1,
    nombre: NOMBRE_MES[i + 1],
    indice: Math.round(v * escala * 100) / 100,
    anios: (muestras.get(i + 1) ?? []).length,
  }));
}

export async function proyeccionInsumos(opciones: {
  meses?: number;
  /** Crecimiento esperado sobre el nivel histórico, en %. */
  crecimientoPct?: number;
  hoy?: Date;
} = {}): Promise<Proyeccion> {
  const { meses: cuantos = 3, crecimientoPct = 0, hoy = new Date() } = opciones;

  const supabase = createAdminClient();
  const compras: Compra[] = [];
  const PAGINA = 1000;
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("ventas_grecka")
      .select("fecha, tienda, sku, descripcion, grupo, cantidad, unidad, precio_unitario, neto")
      .in("grupo", GRUPOS_DE_CONSUMO)
      .order("fecha", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(`No se pudieron leer las compras a Grecka: ${error.message}`);
    if (!data?.length) break;
    compras.push(...(data as Compra[]));
    if (data.length < PAGINA) break;
  }
  if (!compras.length) throw new Error("No hay compras a Grecka cargadas todavía.");

  const marcas = await marcasPorSku().catch(() => ({} as Record<string, string>));
  const estacionalidad = estacionalidadDe(compras);
  const indiceDe = (mes: number) => estacionalidad[mes - 1]?.indice || 1;

  // Ventana de nivel: los últimos doce meses cerrados, sin contar el mes en
  // curso, que está a medias y tiraría todo para abajo.
  const mesActual = mesISO(hoy);
  const corte = new Date(hoy);
  corte.setMonth(corte.getMonth() - MESES_DE_NIVEL);
  const desdeNivel = mesISO(corte);

  const porSku = new Map<string, Compra[]>();
  for (const c of compras) {
    const clave = c.sku || c.descripcion;
    if (!clave) continue;
    if (!porSku.has(clave)) porSku.set(clave, []);
    porSku.get(clave)!.push(c);
  }

  // Los meses a proyectar, empezando por el próximo.
  const mesesFuturos: { mes: string; etiqueta: string; indice: number }[] = [];
  for (let i = 1; i <= cuantos; i++) {
    const d = new Date(hoy);
    d.setMonth(d.getMonth() + i);
    const mes = mesISO(d);
    const n = Number(mes.slice(5));
    mesesFuturos.push({ mes, etiqueta: `${NOMBRE_MES[n]} ${mes.slice(0, 4)}`, indice: indiceDe(n) });
  }

  const factor = 1 + crecimientoPct / 100;
  const productos: ProductoProyectado[] = [];

  for (const [sku, todas] of porSku) {
    const enVentana = todas.filter((c) => {
      const m = c.fecha.slice(0, 7);
      return m >= desdeNivel && m < mesActual && Number(c.cantidad) > 0;
    });
    if (!enVentana.length) continue;  // no se compra desde hace más de un año

    // Nivel desestacionalizado: cada mes se divide por su índice antes de
    // promediar, así un producto que se compró solo en noviembre no proyecta
    // como si ese volumen fuera su normal.
    const unidadBase = unidadHabitual(todas);
    const equivalencias = equivalenciasDe(todas, unidadBase);

    const porMesCantidad = new Map<string, number>();
    let ignoradas = 0;
    for (const c of enVentana) {
      const factor = equivalencias.get(claveUnidad(c.unidad));
      // Sin equivalencia confiable no se suma: mezclar cajas con bolsas en el
      // mismo total es lo que multiplicaba la proyección por ocho.
      if (factor === undefined) { ignoradas++; continue; }
      const m = c.fecha.slice(0, 7);
      porMesCantidad.set(m, (porMesCantidad.get(m) || 0) + Number(c.cantidad) * factor);
    }
    if (!porMesCantidad.size) continue;
    // El nivel es el promedio mensual simple de los últimos doce meses.
    //
    // Antes dividía cada mes por su índice y promediaba, lo que parecía más
    // fino y estaba mal: dividir por un índice de 0,44 multiplica por 2,3, así
    // que un producto comprado en meses flojos terminaba con un nivel inflado.
    // Como los doce índices suman 12, el promedio simple ya es el nivel limpio
    // de estación, y reestacionalizarlo conserva el total del año.
    let suma = 0;
    for (const cant of porMesCantidad.values()) suma += cant;
    const nivel = suma / MESES_DE_NIVEL;
    if (nivel <= 0) continue;

    const ultima = enVentana[enVentana.length - 1];
    const precio = precioDe(todas, unidadBase);

    const porMes = mesesFuturos.map((m) => {
      // El monto va con la cantidad exacta y la cantidad mostrada se redondea
      // normal. Redondear hacia arriba cada producto en cada mes —162 por 12—
      // infló el presupuesto anual un 15%: un producto de 0,3 por mes pasaba a
      // 1 todos los meses. Quedarse corto importa al armar un pedido concreto,
      // no al presupuestar un trimestre.
      const exacta = nivel * m.indice * factor;
      return {
        mes: m.mes,
        etiqueta: m.etiqueta,
        cantidad: Math.round(exacta),
        cantidadExacta: Math.round(exacta * 10) / 10,
        monto: Math.round(exacta * precio),
      };
    });

    const exactaTotal = porMes.reduce((s, m) => s + m.cantidadExacta, 0);

    productos.push({
      sku,
      producto: ultima.descripcion,
      unidad: unidadBase,
      grupo: ultima.grupo,
      marca: marcas[sku] || SIN_MARCA,
      lineasIgnoradas: ignoradas,
      nivelMensual: Math.round(nivel * 10) / 10,
      precioUnitario: precio,
      porMes,
      // El total sí se redondea hacia arriba: es lo que habría que comprar, y
      // ahí una unidad de más es mejor que una de menos.
      cantidadTotal: Math.ceil(exactaTotal),
      montoTotal: porMes.reduce((s, m) => s + m.monto, 0),
      mesesConCompras: porMesCantidad.size,
      // Con dos meses de historia el nivel es una referencia, no una
      // proyección: hay que poder distinguirlo en pantalla.
      pocoHistorial: porMesCantidad.size <= 2,
    });
  }

  productos.sort((a, b) => b.montoTotal - a.montoTotal);

  const meses = mesesFuturos.map((m) => ({
    ...m,
    monto: productos.reduce((s, p) => s + (p.porMes.find((x) => x.mes === m.mes)?.monto ?? 0), 0),
    productos: productos.filter((p) => (p.porMes.find((x) => x.mes === m.mes)?.cantidad ?? 0) > 0).length,
  }));

  const grupos = new Map<string, number>();
  for (const p of productos) grupos.set(p.grupo, (grupos.get(p.grupo) || 0) + p.montoTotal);

  const marcasAgrupadas = new Map<string, { monto: number; productos: number; porMes: Map<string, number> }>();
  for (const p of productos) {
    if (!marcasAgrupadas.has(p.marca)) {
      marcasAgrupadas.set(p.marca, { monto: 0, productos: 0, porMes: new Map() });
    }
    const m = marcasAgrupadas.get(p.marca)!;
    m.monto += p.montoTotal;
    m.productos++;
    for (const x of p.porMes) m.porMes.set(x.mes, (m.porMes.get(x.mes) || 0) + x.monto);
  }

  const porMarca = [...marcasAgrupadas.entries()]
    .map(([marca, v]) => ({
      marca,
      monto: Math.round(v.monto),
      productos: v.productos,
      porMes: mesesFuturos.map((f) => ({ mes: f.mes, etiqueta: f.etiqueta, monto: Math.round(v.porMes.get(f.mes) || 0) })),
    }))
    // "Sin marca" al final aunque pese: es un pendiente de datos, no un proveedor.
    .sort((a, b) =>
      a.marca === SIN_MARCA ? 1 : b.marca === SIN_MARCA ? -1 : b.monto - a.monto
    );

  const sinMarcaItems = productos.filter((p) => p.marca === SIN_MARCA);

  return {
    generadoEn: new Date().toISOString(),
    desde: desdeNivel,
    mesesProyectados: cuantos,
    crecimientoAplicadoPct: crecimientoPct,
    estacionalidad,
    meses,
    productos,
    montoTotal: productos.reduce((s, p) => s + p.montoTotal, 0),
    porGrupo: [...grupos.entries()].map(([grupo, monto]) => ({ grupo, monto })).sort((a, b) => b.monto - a.monto),
    porMarca,
    sinMarca: {
      productos: sinMarcaItems.length,
      monto: Math.round(sinMarcaItems.reduce((s2, p) => s2 + p.montoTotal, 0)),
    },
    nota:
      `Cada producto se proyecta con su consumo de los últimos ${MESES_DE_NIVEL} meses, limpiado de estación y ` +
      "vuelto a ajustar por el mes que viene. Los precios son los de la última compra de cada producto: si Grecka " +
      "ajusta lista, los montos cambian. Son compras de insumos y accesorios; repuestos y servicios quedan fuera. " +
      "La marca sale de los archivos de Grecka ya importados: un producto cuya marca todavía no se cargó aparece " +
      "en \"Sin marca\", y se corrige subiendo un archivo que lo incluya.",
  };
}
