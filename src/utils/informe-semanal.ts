// Informe semanal por tienda: qué pasó la semana pasada y qué se ve raro.
//
// No inventa fuentes nuevas: reusa las mismas que alimentan los paneles, para
// que los números del informe y los de la app no puedan discrepar.

import { getRegistrosPesaje } from "@/utils/produccion-historial";
import { getStockMinimos, type ItemStockMinimo } from "@/utils/stock-minimos";
import { getActividadTiendas } from "@/utils/actividad-tiendas";
import { atrasosYAusencias, horasTrabajadas } from "@/utils/geovictoria";

const TIENDAS = ["Costanera", "Dominicos", "Trapenses"] as const;

export type Alerta = {
  tienda: string;
  tipo: "sin_registrar" | "produccion" | "stock" | "asistencia";
  gravedad: "alta" | "media";
  mensaje: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Lunes de la semana de una fecha (semana ISO: lunes a domingo).
function lunesDe(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const dia = d.getDay() || 7;
  d.setDate(d.getDate() - (dia - 1));
  return d;
}

export type SemanaInforme = { desde: string; hasta: string; etiqueta: string };

// Por defecto, la semana cerrada anterior: el lunes se informa lo que pasó de
// lunes a domingo, no la semana en curso que recién empieza.
// Por defecto informa la semana cerrada, que es para lo que existe: el lunes
// temprano, mirar qué pasó. Pero mirándolo un martes parece que no se registró
// nada, porque lo de ayer y hoy todavía no entra en ninguna semana informada.
// Con "en-curso" se ve la semana que está pasando, comparada con la anterior.
export function semanaAInformar(
  hoy = new Date(),
  cual: "cerrada" | "en-curso" = "cerrada"
): { semana: SemanaInforme; previa: SemanaInforme } {
  const lunesEsta = lunesDe(hoy);
  const lunesPasado = new Date(lunesEsta); lunesPasado.setDate(lunesEsta.getDate() - 7);
  const domingoPasado = new Date(lunesEsta); domingoPasado.setDate(lunesEsta.getDate() - 1);
  const lunesPrevio = new Date(lunesPasado); lunesPrevio.setDate(lunesPasado.getDate() - 7);
  const domingoPrevio = new Date(lunesPasado); domingoPrevio.setDate(lunesPasado.getDate() - 1);

  const etiqueta = (a: Date, b: Date) =>
    `${a.getDate()} ${a.toLocaleDateString("es-CL", { month: "short" })} – ${b.getDate()} ${b.toLocaleDateString("es-CL", { month: "short" })}`;

  const cerrada = { desde: iso(lunesPasado), hasta: iso(domingoPasado), etiqueta: etiqueta(lunesPasado, domingoPasado) };
  if (cual === "en-curso") {
    return {
      // La semana en curso se corta en hoy: contar hasta el domingo daría días
      // que todavía no pasaron, y la comparación con la semana anterior
      // parecería una caída cuando solo faltan días por ocurrir.
      semana: {
        desde: iso(lunesEsta),
        hasta: iso(hoy),
        etiqueta: `${etiqueta(lunesEsta, hoy)} (semana en curso)`,
      },
      previa: cerrada,
    };
  }

  return {
    semana: cerrada,
    previa: { desde: iso(lunesPrevio), hasta: iso(domingoPrevio), etiqueta: etiqueta(lunesPrevio, domingoPrevio) },
  };
}

function kgPorTienda(registros: Awaited<ReturnType<typeof getRegistrosPesaje>>, desde: string, hasta: string) {
  const out: Record<string, { kg: number; dias: Set<string>; sabores: Record<string, number> }> = {};
  for (const t of TIENDAS) out[t] = { kg: 0, dias: new Set(), sabores: {} };
  for (const r of registros) {
    if (r.fecha < desde || r.fecha > hasta) continue;
    const t = out[r.tienda];
    if (!t) continue;
    for (const it of r.items) {
      t.kg += it.kg;
      t.sabores[it.sabor] = (t.sabores[it.sabor] || 0) + it.kg;
    }
    if (r.items.length) t.dias.add(r.fecha);
  }
  return out;
}

export async function generarInformeSemanal(
  hoy = new Date(),
  cual: "cerrada" | "en-curso" = "cerrada"
) {
  const { semana, previa } = semanaAInformar(hoy, cual);

  // Cada fuente se pide con su propio catch: si la asistencia falla, el informe
  // sale igual con producción y stock, diciendo qué faltó.
  const fallas: string[] = [];
  const conFallback = async <T>(nombre: string, fn: () => Promise<T>, vacio: T): Promise<T> => {
    try { return await fn(); } catch (e) { fallas.push(`${nombre}: ${(e as Error)?.message || "error"}`); return vacio; }
  };

  const [registros, stock, actividad, atrasos, horas] = await Promise.all([
    conFallback("producción", () => getRegistrosPesaje(undefined, 800), []),
    conFallback("stock y alertas", () => getStockMinimos(), [] as ItemStockMinimo[]),
    conFallback("actividad por tienda", () => getActividadTiendas(), { actividad: {}, errores: {}, respaldos: {} }),
    conFallback("atrasos", () => atrasosYAusencias({ desde: semana.desde, hasta: semana.hasta }), { personas: [], periodo: { desde: "", hasta: "" }, resumen: { atrasoTotalDelEquipo: "", personasConAlgunAtraso: 0, ausenciasSinJustificar: 0 } }),
    conFallback("horas trabajadas", () => horasTrabajadas({ desde: semana.desde, hasta: semana.hasta }), { personas: [], periodo: { desde: "", hasta: "" }, porTienda: {} }),
  ]);

  const estaSemana = kgPorTienda(registros, semana.desde, semana.hasta);
  const semanaPrevia = kgPorTienda(registros, previa.desde, previa.hasta);

  const hoyCero = new Date(hoy); hoyCero.setHours(0, 0, 0, 0);
  const diasDesde = (f: string | null) =>
    f ? Math.round((hoyCero.getTime() - new Date(f + "T00:00:00").getTime()) / 86400000) : null;

  const alertas: Alerta[] = [];
  const tiendas = TIENDAS.map((tienda) => {
    const act = estaSemana[tienda];
    const prev = semanaPrevia[tienda];
    const variacion = prev.kg > 0 ? (act.kg - prev.kg) / prev.kg : null;

    // Producción: sin nada en la semana, o un salto que conviene mirar.
    if (act.kg === 0 && prev.kg > 0) {
      alertas.push({ tienda, tipo: "produccion", gravedad: "alta", mensaje: `No registró producción en toda la semana (la anterior fueron ${prev.kg.toFixed(0)} kg).` });
    } else if (variacion !== null && variacion <= -0.3) {
      alertas.push({ tienda, tipo: "produccion", gravedad: "alta", mensaje: `Produjo ${Math.abs(variacion * 100).toFixed(0)}% menos que la semana anterior (${act.kg.toFixed(0)} kg contra ${prev.kg.toFixed(0)} kg).` });
    } else if (variacion !== null && variacion >= 0.5) {
      alertas.push({ tienda, tipo: "produccion", gravedad: "media", mensaje: `Produjo ${(variacion * 100).toFixed(0)}% más que la semana anterior (${act.kg.toFixed(0)} kg contra ${prev.kg.toFixed(0)} kg): vale revisar que no sea una carga duplicada.` });
    }

    // Módulos sin registrar.
    const mod = (actividad.actividad as Record<string, Record<string, string | null>>)[tienda] || {};
    const erroresActividad = (actividad.errores ?? {}) as Record<string, string>;
    const etiquetas: Record<string, string> = { mermas: "Mermas", inventario: "Inventario Food", pesaje: "Pesaje de producción", recepcion: "Recepción" };
    const sinRegistrar: { modulo: string; dias: number | null; sinDatos?: boolean }[] = [];
    for (const [clave, nombre] of Object.entries(etiquetas)) {
      // Si la consulta de ese módulo falló, no se sabe si registraron o no.
      // Acusar a la tienda por una falla de lectura es peor que no decir nada.
      if (erroresActividad[clave]) {
        sinRegistrar.push({ modulo: nombre, dias: null, sinDatos: true });
        continue;
      }
      const dias = diasDesde(mod[clave] ?? null);
      sinRegistrar.push({ modulo: nombre, dias });
      if (dias === null) {
        alertas.push({ tienda, tipo: "sin_registrar", gravedad: "media", mensaje: `Nunca registró nada en ${nombre}.` });
      } else if (dias >= 7) {
        alertas.push({ tienda, tipo: "sin_registrar", gravedad: "alta", mensaje: `Lleva ${dias} días sin registrar en ${nombre}.` });
      }
    }

    // Stock bajo mínimo.
    const stockDisponible = stock.length > 0;
    const bajoMinimo = stock.filter((it) => it.tienda === tienda && it.estado === "bajo_minimo");
    const faltante = (it: ItemStockMinimo) => {
      const bruto = Math.max(0, it.stockMinimoSugerido - it.stockActual);
      return (it.unidad || "un") === "un" ? Math.ceil(bruto) : Number(bruto.toFixed(1));
    };
    const unidadesFaltantes = bajoMinimo.reduce((s, it) => s + faltante(it), 0);
    if (bajoMinimo.length >= 20) {
      alertas.push({ tienda, tipo: "stock", gravedad: "alta", mensaje: `${bajoMinimo.length} productos bajo el mínimo, faltan ${Math.round(unidadesFaltantes)} unidades para reponer.` });
    }

    // Asistencia.
    const personasTienda = atrasos.personas.filter((p) => p.tienda === tienda);
    const sinJustificar = personasTienda.reduce((s, p) => s + p.ausenciasSinJustificar, 0);
    const minutosAtraso = personasTienda.reduce((s, p) => s + p.minutosAtraso, 0);
    if (sinJustificar > 0) {
      alertas.push({ tienda, tipo: "asistencia", gravedad: "alta", mensaje: `${sinJustificar} día(s) de ausencia sin justificar en la semana.` });
    }
    if (minutosAtraso >= 60) {
      alertas.push({ tienda, tipo: "asistencia", gravedad: "media", mensaje: `${Math.floor(minutosAtraso / 60)}h ${minutosAtraso % 60}m de atraso acumulado entre el equipo.` });
    }

    const topSabores = Object.entries(act.sabores)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([sabor, kg]) => ({ sabor, kg: Number(kg.toFixed(1)) }));

    return {
      tienda,
      produccion: {
        kg: Number(act.kg.toFixed(1)),
        kgSemanaPrevia: Number(prev.kg.toFixed(1)),
        variacionPct: variacion === null ? null : Number((variacion * 100).toFixed(0)),
        diasConProduccion: act.dias.size,
        topSabores,
      },
      stock: {
        // null, no 0: sin datos no es lo mismo que "no falta nada".
        bajoMinimo: stockDisponible ? bajoMinimo.length : null,
        unidadesQueFaltan: stockDisponible ? Math.round(unidadesFaltantes) : null,
        masUrgentes: bajoMinimo
          .map((it) => ({ producto: it.producto, falta: faltante(it) }))
          .sort((a, b) => b.falta - a.falta).slice(0, 5),
      },
      equipo: {
        horasTrabajadas: (horas.porTienda as Record<string, { personas: number; horasTotales: string }>)[tienda]?.horasTotales ?? null,
        personas: (horas.porTienda as Record<string, { personas: number; horasTotales: string }>)[tienda]?.personas ?? null,
        atrasoAcumulado: minutosAtraso > 0 ? `${Math.floor(minutosAtraso / 60)}h ${String(minutosAtraso % 60).padStart(2, "0")}m` : "sin atrasos",
        ausenciasSinJustificar: sinJustificar,
      },
      registros: sinRegistrar,
    };
  });

  const totalKg = tiendas.reduce((s, t) => s + t.produccion.kg, 0);
  const totalPrevio = tiendas.reduce((s, t) => s + t.produccion.kgSemanaPrevia, 0);

  return {
    semana,
    semanaPrevia: previa,
    generadoEn: new Date().toISOString(),
    resumen: {
      totalKg: Number(totalKg.toFixed(1)),
      totalKgSemanaPrevia: Number(totalPrevio.toFixed(1)),
      variacionPct: totalPrevio > 0 ? Number((((totalKg - totalPrevio) / totalPrevio) * 100).toFixed(0)) : null,
      alertasAltas: alertas.filter((a) => a.gravedad === "alta").length,
      alertasMedias: alertas.filter((a) => a.gravedad === "media").length,
    },
    alertas: alertas.sort((a, b) => (a.gravedad === b.gravedad ? 0 : a.gravedad === "alta" ? -1 : 1)),
    tiendas,
    // Si una fuente falló hay que decirlo: un informe sin alertas porque no se
    // pudo leer no es lo mismo que una semana sin problemas.
    fuentesQueFallaron: fallas,
  };
}
