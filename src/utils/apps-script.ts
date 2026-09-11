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
  opciones: RequestInit & { servicio?: string; intentos?: number; timeoutMs?: number } = {}
): Promise<RespuestaAppsScript> {
  const { servicio = "Google", intentos = 3, timeoutMs = 45_000, ...init } = opciones;
  let ultimoDetalle = "";

  for (let intento = 1; intento <= intentos; intento++) {
    let resp: Response;
    try {
      resp = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      ultimoDetalle = (e as Error)?.name === "TimeoutError"
        ? `no respondió en ${Math.round(timeoutMs / 1000)} s`
        : "sin conexión";
      if (intento < intentos) { await espera(800 * intento); continue; }
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
      if (intento < intentos) { await espera(800 * intento); continue; }
    }
  }

  return {
    ok: false,
    error: `${servicio} no respondió bien tras ${intentos} intentos (${ultimoDetalle}). ` +
      "Es una falla temporal de Google: espera unos segundos y, antes de repetir, revisa si el registro alcanzó a guardarse.",
  };
}
