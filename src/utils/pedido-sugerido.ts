// Qué conviene pedirle a Grecka esta semana, por tienda.
//
// Las tres tiendas compran semanalmente —casi siempre el lunes, verificado en
// el historial— así que la unidad natural del cálculo es la semana: cuánto
// consume cada local por semana de cada producto, y cuánto hace que no lo pide.
//
// No inventa un stock que no tenemos: el Inventario Food cuenta otros productos
// y con otros nombres, así que esto es una sugerencia basada en el consumo real
// comprado, para que el jefe de local la ajuste, no un pedido automático.

import { TIENDAS_QUE_COMPRAN } from "@/utils/tiendas";
import { createAdminClient } from "@/utils/supabase/admin";
import { unidadesCorregidas } from "@/utils/grecka-unidades";
import { estacionalidadDe } from "@/utils/proyeccion-insumos";

// Repuestos y Servicios quedan fuera: son hechos puntuales (una reparación, un
// proyecto), no consumo que se repone. Meterlos arruinaría cualquier promedio.
const GRUPOS_DE_CONSUMO = ["Insumos", "Accesorios"];

const TIENDAS = TIENDAS_QUE_COMPRAN;

type FilaCompra = {
  tienda: string; fecha: string; sku: string; descripcion: string;
  grupo: string; cantidad: number; unidad: string; precio_unitario: number; neto: number;
};

export type ProductoSugerido = {
  sku: string;
  producto: string;
  unidad: string;
  grupo: string;
  /** Unidades compradas en todo el período analizado. */
  totalPeriodo: number;
  /** Promedio por semana, con un decimal, solo para explicar de dónde sale el sugerido. */
  promedioSemanal: number;
  /** Lo que se sugiere pedir, en unidades enteras: nada se vende por mitades. */
  sugerido: number;
  /** Cuántas veces se pidió en el período: separa lo recurrente de lo ocasional. */
  vecesPedido: number;
  ultimaCompra: string | null;
  diasSinPedir: number | null;
  /** Cada cuántos días suele pedirse, para saber si ya toca.
   *  Sale de todo el historial, no de la ventana del cálculo. */
  cadaCuantosDias: number | null;
  /** De dónde salió el ritmo: de las últimas semanas o del historial largo. */
  ritmoSegun: "ventana" | "historial";
  /** true cuando pasó más tiempo del habitual desde el último pedido. */
  toca: boolean;
  /** Variación entre la primera y la segunda mitad del período, en %. */
  tendenciaPct: number | null;
  precioUnitario: number;
  costoEstimado: number;
  /** Ajuste estacional aplicado al sugerido (1 = ninguno). */
  factorEstacional: number;
};

export type PedidoTienda = {
  tienda: string;
  productos: ProductoSugerido[];
  costoEstimado: number;
  ultimaCompra: string | null;
};

const dias = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

// "BOLSA", "Bolsa" y "bolsa" son la misma unidad; sin esto el mismo producto
// aparecería dos veces en el pedido.
export const unidadLinda = (u: string) => {
  const t = (u || "").trim();
  if (!t) return "un";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
};

// Para agrupar: sin tildes, en minúscula y en singular, así "SACO" y "SACOS"
// cuentan como la misma unidad.
const claveUnidad = (u: string) => {
  const t = (u || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return t.endsWith("s") && t.length > 3 ? t.slice(0, -1) : t;
};

// La unidad de un producto es la que más se repite en su historial, no la de la
// última compra.
//
// Grecka tipea mal de vez en cuando: las paletas de degustación figuran como
// CAJA en 3 de 40 compras y como BOLSA en las otras 37, y los vasos
// compostables como CAJA en 28 de 181. Tomando la última fila, una sola de esas
// mandaba sobre decenas correctas y el pedido pedía cajas de algo que viene en
// bolsa — que es justo el tipo de error que hace llegar diez veces de más.
export function unidadHabitual(compras: { unidad: string }[]): string {
  const conteo = new Map<string, { n: number; textos: Map<string, number> }>();
  for (const c of compras) {
    const clave = claveUnidad(c.unidad);
    if (!clave) continue;
    if (!conteo.has(clave)) conteo.set(clave, { n: 0, textos: new Map() });
    const e = conteo.get(clave)!;
    e.n++;
    const txt = unidadLinda(c.unidad);
    e.textos.set(txt, (e.textos.get(txt) || 0) + 1);
  }
  if (!conteo.size) return "un";

  const [, ganadora] = [...conteo.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  // Dentro de la unidad ganadora, la forma escrita más usada ("Bolsa" y no "Bolsas").
  return [...ganadora.textos.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// La unidad se decide con TODO el historial del producto y no con las semanas
// del cálculo: en un tramo corto las tres filas mal tipeadas pueden ser mayoría
// y gana el error. Solo se leen dos columnas de toda la tabla, y el resultado
// se guarda un día porque la unidad de un producto no cambia.
const UNIDADES_TTL_MS = 24 * 60 * 60 * 1000;
let unidadesCache: { mapa: Map<string, string>; ts: number } | null = null;

type ClienteSupabase = ReturnType<typeof createAdminClient>;

async function unidadesHabituales(supabase: ClienteSupabase): Promise<Map<string, string>> {
  if (unidadesCache && Date.now() - unidadesCache.ts < UNIDADES_TTL_MS) return unidadesCache.mapa;

  const PAGINA = 1000;
  const porSku = new Map<string, { unidad: string }[]>();
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("ventas_grecka")
      .select("sku, descripcion, unidad")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(`No se pudieron leer las unidades: ${error.message}`);
    if (!data?.length) break;
    for (const f of data as { sku: string; descripcion: string; unidad: string }[]) {
      const clave = f.sku || f.descripcion;
      if (!clave) continue;
      if (!porSku.has(clave)) porSku.set(clave, []);
      porSku.get(clave)!.push({ unidad: f.unidad });
    }
    if (data.length < PAGINA) break;
  }

  const mapa = new Map<string, string>();
  for (const [sku, compras] of porSku) mapa.set(sku, unidadHabitual(compras));
  unidadesCache = { mapa, ts: Date.now() };
  return mapa;
}

// El índice estacional necesita dos años de historia, bastante más de lo que
// usa el pedido. Se piden dos columnas de toda la tabla y se guarda un día: la
// estación de un mes no cambia de una semana a otra.
const ESTACIONAL_TTL_MS = 24 * 60 * 60 * 1000;
let estacionalCache: { indices: { mes: number; indice: number }[]; ts: number } | null = null;

async function indiceEstacional(supabase: ReturnType<typeof createAdminClient>) {
  if (estacionalCache && Date.now() - estacionalCache.ts < ESTACIONAL_TTL_MS) return estacionalCache.indices;

  const compras: { fecha: string; neto: number }[] = [];
  const PAGINA = 1000;
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("ventas_grecka")
      .select("fecha, neto")
      .in("grupo", GRUPOS_DE_CONSUMO)
      .in("tienda", [...TIENDAS])
      .order("fecha", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(`No se pudo leer la estacionalidad: ${error.message}`);
    if (!data?.length) break;
    compras.push(...(data as { fecha: string; neto: number }[]));
    if (data.length < PAGINA) break;
  }

  const indices = estacionalidadDe(compras as Parameters<typeof estacionalidadDe>[0]);
  estacionalCache = { indices, ts: Date.now() };
  return indices;
}

/** Cuánto más (o menos) se consume en las semanas que el pedido va a cubrir,
 *  comparado con las semanas que se usaron para medir el ritmo.
 *
 *  Sin esto el pedido de fin de noviembre mira octubre y noviembre —1,09 y
 *  1,01— para abastecer diciembre, que es 1,36: un 30% corto en el mes de más
 *  venta del año. El resto del año el ajuste es de unos pocos puntos y no
 *  molesta.
 */
function factorEntre(
  indices: { mes: number; indice: number }[] | null,
  hoy: Date,
  fin: Date,
  semanasDeVentana: number
) {
  if (!indices?.length) return 1;
  const porMes = new Map(indices.map((i) => [i.mes, i.indice]));
  const promedioEntre = (desde: Date, hasta: Date) => {
    // Se promedia día por día: así una cobertura que cruza de mes pondera cada
    // mes por los días que le tocan, en vez de saltar de golpe.
    let suma = 0, n = 0;
    for (let t = desde.getTime(); t <= hasta.getTime(); t += 86400000) {
      suma += porMes.get(new Date(t).getMonth() + 1) ?? 1;
      n++;
    }
    return n ? suma / n : 1;
  };
  const inicioVentana = new Date(hoy.getTime() - semanasDeVentana * 7 * 86400000);
  const base = promedioEntre(inicioVentana, hoy);
  if (base <= 0) return 1;
  const factor = promedioEntre(hoy, fin) / base;
  // Se acota: el índice de un mes con pocos años de muestra no puede duplicar
  // un pedido ni dejarlo en la mitad.
  return Math.round(Math.min(Math.max(factor, 0.75), 1.5) * 100) / 100;
}

export async function pedidoSugerido(opciones: {
  semanas?: number;
  semanasDeCobertura?: number;
  semanasHistorial?: number;
  tienda?: string;
  hoy?: Date;
} = {}) {
  const {
    semanas = 8,
    semanasDeCobertura = 1,
    // Cada cuánto se pide un producto no se puede medir en la ventana del
    // cálculo. Medido sobre las compras reales, casi la mitad de los productos
    // de cada tienda se piden cada más de cuatro semanas —el jabón de Costanera
    // cada 92 días— y hacen falta tres compras para tener un intervalo: en ocho
    // semanas eso es imposible, así que todos esos caían en el "si lleva 21
    // días, toca" y aparecían atrasados cada tres semanas sin estarlo.
    semanasHistorial = 52,
    tienda,
    hoy = new Date(),
  } = opciones;

  const ventana = Math.min(semanas, semanasHistorial);
  const desde = new Date(hoy.getTime() - semanasHistorial * 7 * 86400000).toISOString().slice(0, 10);
  const desdeVentana = new Date(hoy.getTime() - ventana * 7 * 86400000).toISOString().slice(0, 10);
  const hasta = hoy.toISOString().slice(0, 10);

  const supabase = createAdminClient();
  const filas: FilaCompra[] = [];
  const PAGINA = 1000;
  for (let inicio = 0; ; inicio += PAGINA) {
    // Se traen todas las tiendas aunque se pida una sola: la unidad de un
    // producto se decide con su historial completo, y filtrando en la consulta
    // una tienda con pocas compras heredaría el error de tipeo de una fila.
    const consulta = supabase
      .from("ventas_grecka")
      .select("tienda, fecha, sku, descripcion, grupo, cantidad, unidad, precio_unitario, neto")
      .gte("fecha", desde)
      .in("grupo", GRUPOS_DE_CONSUMO)
      .order("fecha", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);

    const { data, error } = await consulta;
    if (error) throw new Error(`No se pudieron leer las compras a Grecka: ${error.message}`);
    if (!data?.length) break;
    filas.push(...(data as FilaCompra[]));
    if (data.length < PAGINA) break;
  }

  const [unidadPorSku, correcciones, estacional] = await Promise.all([
    unidadesHabituales(supabase),
    unidadesCorregidas().catch(() => ({}) as Awaited<ReturnType<typeof unidadesCorregidas>>),
    indiceEstacional(supabase).catch(() => null),
  ]);

  // El pedido de esta semana abastece las próximas, así que lo que importa no
  // es la estación del mes en curso sino la de las semanas que va a cubrir.
  const finCobertura = new Date(hoy.getTime() + semanasDeCobertura * 7 * 86400000);
  const factorEstacional = factorEntre(estacional, hoy, finCobertura, ventana);

  const tiendasAMostrar = tienda ? [tienda] : [...TIENDAS];
  const resultado: PedidoTienda[] = [];

  for (const t of tiendasAMostrar) {
    // Producción compra para todos y no se repone por local: nunca entra acá.
    const suyas = filas.filter((f) => f.tienda === t && f.cantidad > 0);
    const enVentana = (f: FilaCompra) => f.fecha >= desdeVentana;
    const porSku = new Map<string, FilaCompra[]>();
    for (const f of suyas) {
      const clave = f.sku || f.descripcion;
      if (!porSku.has(clave)) porSku.set(clave, []);
      porSku.get(clave)!.push(f);
    }

    const mitad = new Date(hoy.getTime() - (ventana / 2) * 7 * 86400000).toISOString().slice(0, 10);
    const productos: ProductoSugerido[] = [];

    for (const [sku, compras] of porSku) {
      // Productos que son de la sala de producción no se le piden a una tienda,
      // aunque Grecka los haya facturado a su nombre alguna vez.
      if (correcciones[sku]?.soloProduccion) continue;

      const fechas = [...new Set(compras.map((c) => c.fecha))].sort();
      const ultima = fechas[fechas.length - 1] ?? null;
      const reciente = compras[compras.length - 1];

      // Lo comprado en la ventana da el ritmo; el historial largo da el
      // intervalo y sirve de respaldo para los productos lentos, que pueden no
      // haberse pedido ni una vez en las últimas ocho semanas y aun así tocar.
      const deVentana = compras.filter(enVentana);
      const totalVentana = deVentana.reduce((s, c) => s + c.cantidad, 0);
      const totalHistorial = compras.reduce((s, c) => s + c.cantidad, 0);
      if (totalHistorial <= 0) continue;

      const ritmoSegun: "ventana" | "historial" = totalVentana > 0 ? "ventana" : "historial";
      const total = ritmoSegun === "ventana" ? totalVentana : totalHistorial;
      const promedio = ritmoSegun === "ventana"
        ? totalVentana / ventana
        : totalHistorial / semanasHistorial;

      // El intervalo típico sale de los días entre pedidos, no de dividir el
      // período: un producto que se pidió tres veces seguidas y nunca más no
      // "toca" cada dos semanas.
      //
      // Hacen falta tres pedidos (dos huecos) para que el promedio signifique
      // algo: con dos fechas seguidas daba "cada 3 días" para un saco de sal
      // que en realidad se pide una vez al mes, y lo marcaba como atrasado
      // todas las semanas.
      let cadaCuantos: number | null = null;
      if (fechas.length >= 3) {
        const huecos = fechas.slice(1).map((f, i) => dias(fechas[i], f));
        cadaCuantos = Math.round(huecos.reduce((s, h) => s + h, 0) / huecos.length);
      } else if (fechas.length === 2) {
        // Con un año de historial, dos compras separadas por meses sí dicen
        // algo: lo que no decía nada era ver dos semanas seguidas dentro de una
        // ventana de ocho. Por eso se acepta el hueco único solo si es largo.
        const hueco = dias(fechas[0], fechas[1]);
        if (hueco >= 21) cadaCuantos = hueco;
      }

      const sinPedir = ultima ? dias(ultima, hasta) : null;

      // Un producto que dejó de pedirse hace mucho no es parte del pedido de
      // esta semana: sin esto, algo comprado dos veces en enero seguiría
      // apareciendo todo el año solo porque el historial ahora es largo.
      const limiteActivo = cadaCuantos !== null ? Math.max(cadaCuantos * 2, 60) : 120;
      if (sinPedir !== null && sinPedir > limiteActivo) continue;

      const primeraMitad = deVentana.filter((c) => c.fecha < mitad).reduce((s, c) => s + c.cantidad, 0);
      const segundaMitad = totalVentana - primeraMitad;
      // Sobre una base de una o dos unidades cualquier variación da un número
      // enorme —salía "+2000%" por pasar de 1 a 21 bolsas de paletas— y eso no
      // es una tendencia, es ruido. Sin base suficiente, mejor no decir nada.
      const tendencia = primeraMitad >= 3
        ? Math.round(((segundaMitad - primeraMitad) / primeraMitad) * 100)
        : null;

      // Se redondea hacia arriba: quedarse corto en el local es peor que traer
      // una unidad de más, y estos productos no se venden fraccionados.
      const sugerido = Math.ceil(promedio * semanasDeCobertura * factorEstacional);
      if (sugerido <= 0) continue;

      productos.push({
        sku,
        producto: reciente.descripcion,
        // La corrección manual manda; después la deducción del historial.
        unidad: correcciones[sku]?.unidad ?? unidadPorSku.get(sku) ?? unidadLinda(reciente.unidad),
        grupo: reciente.grupo,
        totalPeriodo: Math.round(total * 10) / 10,
        promedioSemanal: Math.round(promedio * 10) / 10,
        sugerido,
        vecesPedido: fechas.length,
        ultimaCompra: ultima,
        diasSinPedir: sinPedir,
        cadaCuantosDias: cadaCuantos,
        ritmoSegun,
        // Con intervalo conocido, toca cuando se pasó de su propio ritmo.
        //
        // Sin intervalo, el umbral es de dos meses y no de tres semanas: un
        // producto con dos compras en un año es raro, no semanal, y marcarlo a
        // las tres semanas lo dejaba en rojo casi siempre.
        //
        // Y con una sola compra en todo el historial no se marca nunca: una
        // compra no es un patrón. La crema de leche de Trapenses son 36 litros
        // pedidos una vez en julio, y salía "toca pedir" solo por llevar 88
        // días —una alarma inventada sobre un dato suelto.
        toca:
          sinPedir === null || fechas.length < 2
            ? false
            : cadaCuantos !== null
            ? sinPedir >= cadaCuantos
            : sinPedir >= 60,
        tendenciaPct: tendencia,
        precioUnitario: Math.round(reciente.precio_unitario),
        costoEstimado: Math.round(reciente.precio_unitario * sugerido),
        factorEstacional,
      });
    }

    // Primero lo que ya toca pedir, y dentro de eso lo que más pesa en plata.
    productos.sort((a, b) =>
      a.toca === b.toca ? b.costoEstimado - a.costoEstimado : a.toca ? -1 : 1
    );

    const fechasTienda = suyas.map((f) => f.fecha).filter(Boolean).sort();
    resultado.push({
      tienda: t,
      productos,
      costoEstimado: productos.reduce((s, p) => s + p.costoEstimado, 0),
      ultimaCompra: fechasTienda[fechasTienda.length - 1] ?? null,
    });
  }

  // Si la última compra registrada es vieja, el archivo de Grecka está
  // desactualizado y media lista va a aparecer "atrasada" sin estarlo. Mejor
  // decirlo que dejar que alguien arme un pedido sobre datos incompletos.
  const ultimas = resultado.map((r) => r.ultimaCompra).filter(Boolean) as string[];
  const ultimaRegistrada = ultimas.sort()[ultimas.length - 1] ?? null;
  const diasDesdeUltimoDato = ultimaRegistrada ? dias(ultimaRegistrada, hasta) : null;

  return {
    periodo: { desde: desdeVentana, hasta, semanas: ventana, desdeHistorial: desde, semanasHistorial },
    semanasDeCobertura,
    factorEstacional,
    datos: {
      ultimaCompraRegistrada: ultimaRegistrada,
      diasDesdeUltimoDato,
      desactualizado: diasDesdeUltimoDato !== null && diasDesdeUltimoDato > 10,
    },
    tiendas: resultado,
    nota:
      `Cuánto pedir sale de lo que cada tienda le compró a Grecka en las últimas ${ventana} semanas; ` +
      `cada cuánto se pide, de ${semanasHistorial} semanas de historial, porque casi la mitad de los productos ` +
      `se piden cada más de un mes y en ocho semanas no alcanzan a mostrar su ritmo. ` +
      `(Grupos ${GRUPOS_DE_CONSUMO.join(" y ")}; repuestos y servicios quedan fuera por ser puntuales.) ` +
      (factorEstacional !== 1
        ? `Las cantidades van ajustadas ${factorEstacional > 1 ? "hacia arriba" : "hacia abajo"} por estación (×${factorEstacional}). `
        : "") +
      "No descuenta stock existente en la tienda, así que hay que revisarla contra lo que haya en bodega antes de enviarla." +
      (diasDesdeUltimoDato !== null && diasDesdeUltimoDato > 10
        ? ` ATENCIÓN: la última compra registrada es del ${ultimaRegistrada} (hace ${diasDesdeUltimoDato} días): falta subir el archivo de Grecka más reciente, así que varios productos van a figurar atrasados sin estarlo.`
        : ""),
  };
}
