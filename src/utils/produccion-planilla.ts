// Un solo lector de la planilla de producción, con espejo en Supabase.
//
// Antes, cuatro módulos distintos —sabores, historial de pesajes, recetas
// consumidas y el panel /produccion— bajaban por su cuenta el MISMO CSV de
// ~450 KB con un fetch pelado: sin reintentos, sin presupuesto de tiempo y sin
// respaldo. Cuatro oportunidades distintas de fallar con el mismo dato, y
// cuatro cachés en memoria que se pierden en cada deploy y no comparten las
// instancias entre sí (fue justo lo que hizo que el catálogo dijera que
// "Chocolate suizo" no existía cuando sí existía).
//
// La regla acá es que Google deje de estar en el camino de quien abre un panel:
//   1. memoria de la instancia (3 min), para no repetir dentro de una ráfaga
//   2. el espejo de Supabase, si es reciente — Google ni se toca
//   3. Google, y lo que vuelve se guarda como nuevo espejo
//   4. si Google falla, el espejo de cualquier edad antes que una pantalla de
//      error, pero diciendo de cuándo es: un dato viejo nunca se presenta como
//      actual.
// Quien mantiene fresco el espejo es el calentador (/api/cron/calentar), que
// corre cada 15 minutos: los ~7 s de Google los paga el cron, no la persona.

import { fetchAppsScriptTexto, urlAppsScript } from "@/utils/apps-script";
import { guardarCopia, leerCopia } from "@/utils/cache-persistente";

export type Documento = "csv" | "ventas";

export type LecturaPlanilla = {
  texto: string;
  /** Antigüedad del dato. 0 si se acaba de leer de Google. */
  edadMs: number;
  /** true cuando el texto salió del espejo y no de una lectura fresca. */
  desdeEspejo: boolean;
  /** Qué falló, cuando hubo que caer al espejo porque Google no respondió. */
  errorDeGoogle?: string;
};

const MEMORIA_MS = 3 * 60 * 1000;
// El calentador pasa cada 15 min: 20 deja pasar una ronda perdida sin que nadie
// espere a Google. Si el calentador se cae del todo, al cruzar este umbral la
// primera persona que entre refresca el espejo para todos.
const ESPEJO_FRESCO_MS = 20 * 60 * 1000;
// Con Google caído y el espejo vencido, sin esto cada panel que alguien abre se
// queda esperando los 50 s del presupuesto. Tras una falla se sirve el espejo
// viejo sin preguntarle a Google de nuevo hasta que pase este rato.
const ESPERA_TRAS_FALLA_MS = 60 * 1000;
// Google entrega este CSV entre 2 y 19 s según su humor (medido). 25 s dan
// margen para un reintento sin comerse el minuto que la plataforma le da a la
// función: quien además tiene que ESCRIBIR después —el pesaje— pasa un
// presupuesto más chico todavía, porque los dos tienen que caber juntos.
const PRESUPUESTO_MS = 25_000;

// Normalmente hay 166 columnas de sabor. Si el texto trae bastante menos, no es
// el CSV: es una página de error, un login o un redirect — una falla disfrazada
// de éxito, que no hay que guardar como espejo ni devolver como si fuera la
// planilla.
const MIN_COLUMNAS_SABOR = 50;

function esCsvDeProduccion(texto: string): boolean {
  const primeraLinea = texto.slice(0, texto.indexOf("\n") + 1 || undefined);
  return (primeraLinea.match(/#;/g) || []).length >= MIN_COLUMNAS_SABOR;
}

function esJsonDeVentas(texto: string): boolean {
  try {
    JSON.parse(texto);
    return true;
  } catch {
    return false;
  }
}

function esValido(doc: Documento, texto: string): boolean {
  return doc === "csv" ? esCsvDeProduccion(texto) : esJsonDeVentas(texto);
}

function destino(doc: Documento): string {
  const url = process.env.PRODUCCION_APPS_SCRIPT_URL;
  const token = process.env.PRODUCCION_APPS_SCRIPT_TOKEN;
  if (!url || !token) throw new Error("Apps Script de producción no configurado");
  return urlAppsScript(url, token, doc === "ventas" ? { action: "getSales" } : {});
}

const clave = (doc: Documento) => `produccion-${doc}`;

type EnMemoria = { texto: string; nacidoEn: number; guardadoEn: number; desdeEspejo: boolean };
const memoria = new Map<Documento, EnMemoria>();
const fallaReciente = new Map<Documento, { cuando: number; error: string }>();

function recordar(doc: Documento, texto: string, nacidoEn: number, desdeEspejo: boolean) {
  memoria.set(doc, { texto, nacidoEn, guardadoEn: Date.now(), desdeEspejo });
}

/** Tras escribir en la planilla, lo guardado en memoria ya no refleja la
 *  realidad: quien acaba de pesar tiene que ver su propio pesaje en el
 *  historial, no la foto de hace tres minutos. */
export function invalidarPlanilla(): void {
  memoria.clear();
}

export async function leerPlanilla(
  doc: Documento,
  opciones: { forzar?: boolean; presupuestoMs?: number } = {}
): Promise<LecturaPlanilla> {
  const { forzar = false, presupuestoMs = PRESUPUESTO_MS } = opciones;
  const ahora = Date.now();

  const enMemoria = memoria.get(doc);
  if (
    !forzar &&
    enMemoria &&
    ahora - enMemoria.guardadoEn < MEMORIA_MS &&
    ahora - enMemoria.nacidoEn < ESPEJO_FRESCO_MS
  ) {
    return {
      texto: enMemoria.texto,
      edadMs: ahora - enMemoria.nacidoEn,
      desdeEspejo: enMemoria.desdeEspejo,
    };
  }

  if (!forzar) {
    const copia = await leerCopia<string>(clave(doc));
    if (copia && copia.edadMs < ESPEJO_FRESCO_MS) {
      recordar(doc, copia.datos, ahora - copia.edadMs, true);
      return { texto: copia.datos, edadMs: copia.edadMs, desdeEspejo: true };
    }
  }

  // Google viene fallando hace menos de un minuto: no tiene sentido que cada
  // panel vuelva a esperar el presupuesto completo para enterarse de lo mismo.
  const falla = fallaReciente.get(doc);
  if (falla && ahora - falla.cuando < ESPERA_TRAS_FALLA_MS) {
    const viejo = await servirEspejoViejo(doc, falla.error);
    if (viejo) return viejo;
  }

  const r = await fetchAppsScriptTexto(destino(doc), {
    servicio: "Planilla de producción",
    esValido: (texto) => esValido(doc, texto),
    presupuestoMs,
  });

  if (r.ok) {
    fallaReciente.delete(doc);
    await guardarCopia(clave(doc), r.valor);
    recordar(doc, r.valor, Date.now(), false);
    return { texto: r.valor, edadMs: 0, desdeEspejo: false };
  }

  fallaReciente.set(doc, { cuando: Date.now(), error: r.error });
  const viejo = await servirEspejoViejo(doc, r.error);
  if (viejo) return viejo;
  throw new Error(r.error);
}

// El espejo sin importar su edad: es el último recurso antes de dar error, y va
// marcado para que arriba se pueda decir de cuándo es.
async function servirEspejoViejo(doc: Documento, error: string): Promise<LecturaPlanilla | null> {
  const enMemoria = memoria.get(doc);
  if (enMemoria) {
    return {
      texto: enMemoria.texto,
      edadMs: Date.now() - enMemoria.nacidoEn,
      desdeEspejo: true,
      errorDeGoogle: error,
    };
  }
  const copia = await leerCopia<string>(clave(doc));
  if (!copia) return null;
  recordar(doc, copia.datos, Date.now() - copia.edadMs, true);
  return { texto: copia.datos, edadMs: copia.edadMs, desdeEspejo: true, errorDeGoogle: error };
}

/** Para el calentador: obliga a leer de Google y deja el espejo al día, que es
 *  lo que hace que nadie más tenga que esperarlo. */
export async function refrescarPlanilla(
  doc: Documento,
  presupuestoMs?: number
): Promise<LecturaPlanilla> {
  return leerPlanilla(doc, { forzar: true, presupuestoMs });
}
