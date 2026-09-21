// Qué conviene pedirle a Grecka esta semana, por tienda.
//
// Las tres tiendas compran semanalmente —casi siempre el lunes, verificado en
// el historial— así que la unidad natural del cálculo es la semana: cuánto
// consume cada local por semana de cada producto, y cuánto hace que no lo pide.
//
// No inventa un stock que no tenemos: el Inventario Food cuenta otros productos
// y con otros nombres, así que esto es una sugerencia basada en el consumo real
// comprado, para que el jefe de local la ajuste, no un pedido automático.

import { createAdminClient } from "@/utils/supabase/admin";

// Repuestos y Servicios quedan fuera: son hechos puntuales (una reparación, un
// proyecto), no consumo que se repone. Meterlos arruinaría cualquier promedio.
const GRUPOS_DE_CONSUMO = ["Insumos", "Accesorios"];

const TIENDAS = ["Costanera", "Dominicos", "Trapenses"] as const;

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
  /** Cada cuántos días suele pedirse, para saber si ya toca. */
  cadaCuantosDias: number | null;
  /** true cuando pasó más tiempo del habitual desde el último pedido. */
  toca: boolean;
  /** Variación entre la primera y la segunda mitad del período, en %. */
  tendenciaPct: number | null;
  precioUnitario: number;
  costoEstimado: number;
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
const unidadLinda = (u: string) => {
  const t = (u || "").trim();
  if (!t) return "un";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
};

export async function pedidoSugerido(opciones: {
  semanas?: number;
  semanasDeCobertura?: number;
  tienda?: string;
  hoy?: Date;
} = {}) {
  const { semanas = 8, semanasDeCobertura = 1, tienda, hoy = new Date() } = opciones;

  const desde = new Date(hoy.getTime() - semanas * 7 * 86400000).toISOString().slice(0, 10);
  const hasta = hoy.toISOString().slice(0, 10);

  const supabase = createAdminClient();
  const filas: FilaCompra[] = [];
  const PAGINA = 1000;
  for (let inicio = 0; ; inicio += PAGINA) {
    let consulta = supabase
      .from("ventas_grecka")
      .select("tienda, fecha, sku, descripcion, grupo, cantidad, unidad, precio_unitario, neto")
      .gte("fecha", desde)
      .in("grupo", GRUPOS_DE_CONSUMO)
      .order("fecha", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (tienda) consulta = consulta.eq("tienda", tienda);

    const { data, error } = await consulta;
    if (error) throw new Error(`No se pudieron leer las compras a Grecka: ${error.message}`);
    if (!data?.length) break;
    filas.push(...(data as FilaCompra[]));
    if (data.length < PAGINA) break;
  }

  const tiendasAMostrar = tienda ? [tienda] : [...TIENDAS];
  const resultado: PedidoTienda[] = [];

  for (const t of tiendasAMostrar) {
    // Producción compra para todos y no se repone por local: nunca entra acá.
    const suyas = filas.filter((f) => f.tienda === t && f.cantidad > 0);
    const porSku = new Map<string, FilaCompra[]>();
    for (const f of suyas) {
      const clave = f.sku || f.descripcion;
      if (!porSku.has(clave)) porSku.set(clave, []);
      porSku.get(clave)!.push(f);
    }

    const mitad = new Date(hoy.getTime() - (semanas / 2) * 7 * 86400000).toISOString().slice(0, 10);
    const productos: ProductoSugerido[] = [];

    for (const [sku, compras] of porSku) {
      const total = compras.reduce((s, c) => s + c.cantidad, 0);
      if (total <= 0) continue;

      const fechas = [...new Set(compras.map((c) => c.fecha))].sort();
      const ultima = fechas[fechas.length - 1] ?? null;
      const reciente = compras[compras.length - 1];

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
      }

      const sinPedir = ultima ? dias(ultima, hasta) : null;
      const promedio = total / semanas;

      const primeraMitad = compras.filter((c) => c.fecha < mitad).reduce((s, c) => s + c.cantidad, 0);
      const segundaMitad = total - primeraMitad;
      // Sobre una base de una o dos unidades cualquier variación da un número
      // enorme —salía "+2000%" por pasar de 1 a 21 bolsas de paletas— y eso no
      // es una tendencia, es ruido. Sin base suficiente, mejor no decir nada.
      const tendencia = primeraMitad >= 3
        ? Math.round(((segundaMitad - primeraMitad) / primeraMitad) * 100)
        : null;

      // Se redondea hacia arriba: quedarse corto en el local es peor que traer
      // una unidad de más, y estos productos no se venden fraccionados.
      const sugerido = Math.ceil(promedio * semanasDeCobertura);
      if (sugerido <= 0) continue;

      productos.push({
        sku,
        producto: reciente.descripcion,
        unidad: unidadLinda(reciente.unidad),
        grupo: reciente.grupo,
        totalPeriodo: Math.round(total * 10) / 10,
        promedioSemanal: Math.round(promedio * 10) / 10,
        sugerido,
        vecesPedido: fechas.length,
        ultimaCompra: ultima,
        diasSinPedir: sinPedir,
        cadaCuantosDias: cadaCuantos,
        // Sin intervalo confiable, "toca" solo si lleva tres semanas sin pedirse:
        // más vale no marcar nada que marcar todo.
        toca: sinPedir === null ? false : cadaCuantos !== null ? sinPedir >= cadaCuantos : sinPedir >= 21,
        tendenciaPct: tendencia,
        precioUnitario: Math.round(reciente.precio_unitario),
        costoEstimado: Math.round(reciente.precio_unitario * sugerido),
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
    periodo: { desde, hasta, semanas },
    semanasDeCobertura,
    datos: {
      ultimaCompraRegistrada: ultimaRegistrada,
      diasDesdeUltimoDato,
      desactualizado: diasDesdeUltimoDato !== null && diasDesdeUltimoDato > 10,
    },
    tiendas: resultado,
    nota:
      `Sugerencia calculada sobre lo que cada tienda le compró a Grecka en las últimas ${semanas} semanas ` +
      `(grupos ${GRUPOS_DE_CONSUMO.join(" y ")}; repuestos y servicios quedan fuera por ser puntuales). ` +
      "No descuenta stock existente en la tienda, así que hay que revisarla contra lo que haya en bodega antes de enviarla." +
      (diasDesdeUltimoDato !== null && diasDesdeUltimoDato > 10
        ? ` ATENCIÓN: la última compra registrada es del ${ultimaRegistrada} (hace ${diasDesdeUltimoDato} días): falta subir el archivo de Grecka más reciente, así que varios productos van a figurar atrasados sin estarlo.`
        : ""),
  };
}
