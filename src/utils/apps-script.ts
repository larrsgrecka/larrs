// Cliente común para los Apps Scripts de Google (mermas, recepción, vitrina,
// inventario, producción, catálogo).
//
// Dos problemas se repitieron en todos ellos y cada ruta los resolvía —o no—
// por su cuenta:
//
// 1. Google responde 404 con una página HTML de forma intermitente cuando la
//    petición viene de un datacenter: en el mismo minuto unas llamadas pasan y
//    otras no, con el deployment intacto. Quien hacía JSON.parse de eso se caía
//    con "Unexpected token '<'" y devolvía un 500 que en el teléfono aparece
//    como "The string did not match the expected pattern".
// 2. Si la URL de la variable de entorno trae una barra final o el token ya
//    pegado, concatenar "?token=" produce un 404 permanente.

export function urlAppsScript(
  base: string,
  token: string,
  params: Record<string, string> = {}
): string {
  const u = new URL(base.trim());
  u.pathname = u.pathname.replace(/\/+$/, "");
  u.searchParams.set("token", token);
  for (const [clave, valor] of Object.entries(params)) u.searchParams.set(clave, valor);
  return u.toString();
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RespuestaAppsScript = { ok: boolean; error?: string; [clave: string]: unknown };

export async function fetchAppsScriptJson(
  url: string,
  opciones: RequestInit & {
    servicio?: string;
    intentos?: number;
    timeoutMs?: number;
    /** Tiempo total para todos los intentos. Tiene que caber dentro del
     *  maxDuration de la ruta que llama, con margen para responder. */
    presupuestoMs?: number;
  } = {}
): Promise<RespuestaAppsScript> {
  // 4 intentos con espera exponencial (1 s, 2 s, 4 s): las ráfagas de 404 de
  // Google duran varios segundos, y con esperas de 0,8 y 1,6 s los tres intentos
  // caían dentro de la misma ventana de fallo — visto en el informe semanal.
  //
  // Pero los reintentos tienen que caber en el tiempo que la plataforma le da a
  // la función. 4 × 45 s más las esperas son hasta 187 segundos dentro de una
  // función que Vercel corta a los 60: cuando Google se pone lento —medido:
  // tres funciones muertas seguidas el 28 de octubre— ninguno de los mensajes
  // de error de acá alcanza a devolverse, porque la función ya murió. El
  // navegador recibe la página de error de la plataforma, que no es JSON, y el
  // panel muestra "The string did not match the expected pattern": un error
  // que no dice nada y que además deja sin saber si el registro se guardó.
  //
  // Con presupuesto, el último intento se corta a tiempo y la ruta alcanza a
  // responder su propio error, que sí explica qué pasó y qué hacer.
  const {
    servicio = "Google",
    intentos = 4,
    timeoutMs = 45_000,
    presupuestoMs = 50_000,
    ...init
  } = opciones;

  const inicio = Date.now();
  const restante = () => presupuestoMs - (Date.now() - inicio);
  // Menos de esto no alcanza ni para el viaje de ida: mejor devolver el error
  // que gastar el margen que queda para responder.
  const MINIMO_POR_INTENTO = 4_000;

  let ultimoDetalle = "";
  let intentosHechos = 0;

  for (let intento = 1; intento <= intentos; intento++) {
    const disponible = restante();
    if (disponible < MINIMO_POR_INTENTO) {
      if (!ultimoDetalle) ultimoDetalle = `sin respuesta en ${Math.round(presupuestoMs / 1000)} s`;
      break;
    }
    intentosHechos = intento;

    let resp: Response;
    try {
      resp = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(Math.min(timeoutMs, disponible)),
      });
    } catch (e) {
      ultimoDetalle = (e as Error)?.name === "TimeoutError"
        ? `no respondió en ${Math.round(Math.min(timeoutMs, disponible) / 1000)} s`
        : "sin conexión";
      if (intento < intentos && restante() > MINIMO_POR_INTENTO) {
        await espera(Math.min(1000 * 2 ** (intento - 1), Math.max(0, restante() - MINIMO_POR_INTENTO)));
        continue;
      }
      return { ok: false, error: `No se pudo conectar con ${servicio} (${ultimoDetalle}). Intenta de nuevo en unos segundos.` };
    }

    const texto = await resp.text();
    try {
      return JSON.parse(texto) as RespuestaAppsScript;
    } catch {
      // Respuesta HTML: llega antes de que el script se ejecute, así que
      // reintentar no repite una escritura ya hecha.
      ultimoDetalle = `HTTP ${resp.status}`;
      console.error(`[apps-script:${servicio}] respuesta no-JSON (intento ${intento}/${intentos}):`, resp.status, texto.slice(0, 200));
      if (intento < intentos && restante() > MINIMO_POR_INTENTO) {
        await espera(Math.min(1000 * 2 ** (intento - 1), Math.max(0, restante() - MINIMO_POR_INTENTO)));
        continue;
      }
    }
  }

  return {
    ok: false,
    error: `${servicio} no respondió bien tras ${intentosHechos} intento${intentosHechos === 1 ? "" : "s"} (${ultimoDetalle}). ` +
      "Es una falla temporal de Google: espera unos segundos y, antes de repetir, revisa si el registro alcanzó a guardarse.",
  };
}
