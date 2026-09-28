// Alertas al momento, para quien supervisa las tres tiendas.
//
// El informe semanal ya detecta casi todo esto, pero se lee una vez por semana:
// sirve para entender qué pasó, no para enterarse de que hoy falta un sabor en
// la vitrina. Acá se calculan las mismas señales sobre la semana en curso y se
// les suman las de las revisiones de vitrina.
//
// El cálculo es caro —cruza producción, stock, asistencia y cumplimiento, y en
// frío pasa del medio minuto— así que no se hace cuando alguien abre la app: lo
// deja listo el calentador cada quince minutos y las pantallas leen eso, con la
// antigüedad a la vista. Un panel que tarda 40 segundos en abrir no lo mira
// nadie.

import { generarInformeSemanal, type Alerta } from "@/utils/informe-semanal";
import { ultimasRevisiones } from "@/utils/revision-vitrina";
import { guardarCopia, leerCopia, antiguedadEnPalabras } from "@/utils/cache-persistente";

const CLAVE = "alertas-actuales";

// Una vitrina sin revisar en una semana no es una alerta por sí sola, pero sí
// cuando nadie la miró nunca o pasaron varios días: es lo que hace que el resto
// de las alertas de vitrina existan.
const DIAS_SIN_REVISAR = 7;

export type AlertasActuales = {
  calculadoEn: string;
  alertas: Alerta[];
  altas: number;
  medias: number;
  /** Fuentes que no se pudieron leer: sus alertas pueden estar faltando. */
  fuentesQueFallaron: string[];
};

export async function calcularAlertas(hoy = new Date()): Promise<AlertasActuales> {
  const [informe, revisiones] = await Promise.all([
    generarInformeSemanal(hoy, "en-curso"),
    ultimasRevisiones().catch(() => ({ revisiones: [], sinRevisarNunca: [] })),
  ]);

  const alertas: Alerta[] = [...informe.alertas];

  const nombreTipo = (t: string) => (t === "helados" ? "la vitrina de helados" : "la vitrina de pastelería");

  for (const r of revisiones.revisiones) {
    if (r.faltantes > 0) {
      alertas.push({
        tienda: r.tienda,
        tipo: "vitrina",
        gravedad: "alta",
        mensaje: `${r.faltantes} producto(s) faltando en ${nombreTipo(r.tipo)}, según la revisión de ${r.hace}.`,
      });
    }
    if (r.sinNombre > 0) {
      alertas.push({
        tienda: r.tienda,
        tipo: "vitrina",
        gravedad: "media",
        mensaje: `${r.sinNombre} cubeta(s) sin cartel o sin nombre claro en ${nombreTipo(r.tipo)}: el cliente no sabe qué está comprando.`,
      });
    }
    const dias = Math.round((Date.now() - new Date(r.revisadoEn).getTime()) / 86400000);
    if (dias >= DIAS_SIN_REVISAR) {
      alertas.push({
        tienda: r.tienda,
        tipo: "vitrina",
        gravedad: "media",
        mensaje: `Hace ${dias} días que nadie revisa ${nombreTipo(r.tipo)} con una foto.`,
      });
    }
  }

  for (const s of revisiones.sinRevisarNunca) {
    alertas.push({
      tienda: s.tienda,
      tipo: "vitrina",
      gravedad: "media",
      mensaje: `Nunca revisó ${nombreTipo(s.tipo)} con una foto.`,
    });
  }

  const ordenadas = alertas.sort((a, b) =>
    a.gravedad === b.gravedad ? a.tienda.localeCompare(b.tienda) : a.gravedad === "alta" ? -1 : 1
  );

  return {
    calculadoEn: new Date().toISOString(),
    alertas: ordenadas,
    altas: ordenadas.filter((a) => a.gravedad === "alta").length,
    medias: ordenadas.filter((a) => a.gravedad === "media").length,
    // Se arrastra tal cual: si la asistencia no se pudo leer, no hay alertas de
    // asistencia, y decir "todo en orden" ahí sería mentir.
    fuentesQueFallaron: informe.fuentesQueFallaron,
  };
}

/** Recalcula y deja el resultado listo para que las pantallas lo lean al instante. */
export async function refrescarAlertas(hoy = new Date()): Promise<AlertasActuales> {
  const alertas = await calcularAlertas(hoy);
  await guardarCopia(CLAVE, alertas);
  return alertas;
}

export async function alertasGuardadas() {
  const copia = await leerCopia<AlertasActuales>(CLAVE);
  if (!copia) return null;
  return { ...copia.datos, hace: antiguedadEnPalabras(copia.edadMs), edadMs: copia.edadMs };
}
