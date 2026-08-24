import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";

// Proxy del Apps Script de producción para el panel /produccion.
//
// El panel llamaba a script.google.com directo desde el navegador, lo que
// traía dos problemas: el token viajaba en el HTML servido al cliente (visible
// a cualquiera que abra el fuente) y la carga dependía de que la red del
// usuario alcanzara a Google — un bloqueador de contenido, un proxy corporativo
// o una caída de DNS daban un "Failed to fetch" sin explicación. Pasando por
// acá el fetch lo hace el servidor, con el token en variables de entorno.
export const maxDuration = 60;

// El CSV de la planilla son ~360 KB y Google lo entrega entre 2 y 19 s según su
// humor (medido). El panel pide dos cosas seguidas —la planilla y las ventas— y
// Apps Script serializa las ejecuciones del mismo script, así que sin caché la
// segunda espera a la primera y cualquier recarga vuelve a pagar todo. Un caché
// corto en memoria hace que las llamadas siguientes salgan al instante; el mismo
// patrón que ya usa produccion-historial.ts.
const CACHE_TTL_MS = 3 * 60 * 1000;
const cache = new Map<string, { texto: string; ts: number }>();

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Mismo criterio que /produccion, que es el único que consume esta ruta.
  const profile = await getProfile();
  if (profile?.role === "operador") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const url = process.env.PRODUCCION_APPS_SCRIPT_URL;
  const token = process.env.PRODUCCION_APPS_SCRIPT_TOKEN;
  if (!url || !token) {
    return NextResponse.json({ error: "Apps Script de producción no configurado" }, { status: 500 });
  }

  // Única acción extra soportada: el panel también pide las ventas, que el
  // mismo Apps Script devuelve como JSON.
  const esVentas = request.nextUrl.searchParams.get("action") === "getSales";

  // Se arma con URL en vez de concatenar: la variable de entorno puede venir
  // con el token ya pegado (así estaba escrita en el panel) o con una barra
  // final, y concatenar "?token=" daría una URL con dos querystrings que Google
  // responde con 404.
  let destino: string;
  try {
    const u = new URL(url.trim());
    // Una barra final ("/exec/") hace que Google responda 404 con una página
    // HTML — verificado —, y es un typo fácil de dejar en una variable de
    // entorno, así que se normaliza acá en vez de depender de cómo esté escrita.
    u.pathname = u.pathname.replace(/\/+$/, "");
    u.searchParams.set("token", token);
    if (esVentas) u.searchParams.set("action", "getSales");
    destino = u.toString();
  } catch {
    return NextResponse.json(
      { error: "La URL del Apps Script de producción está mal formada. Revisa PRODUCCION_APPS_SCRIPT_URL." },
      { status: 500 }
    );
  }

  const claveCache = esVentas ? "ventas" : "csv";
  const guardado = cache.get(claveCache);
  if (guardado && Date.now() - guardado.ts < CACHE_TTL_MS) {
    return respuesta(guardado.texto, esVentas);
  }

  let resp: Response;
  let texto: string;
  try {
    // 25 s y no más: si Google va a tardar más que eso, es mejor decirlo y
    // dejar reintentar que tener al panel girando un minuto entero.
    resp = await fetch(destino, { signal: AbortSignal.timeout(25_000) });
    texto = await resp.text();
  } catch (e) {
    const timeout = (e as Error)?.name === "TimeoutError";
    // Antes de dar error, sirve la copia vencida si hay: un dato de hace unos
    // minutos es infinitamente mejor que una pantalla de error.
    if (guardado) return respuesta(guardado.texto, esVentas);
    return NextResponse.json(
      {
        error: timeout
          ? "Google no respondió en 25 s (la planilla es grande y arranca en frío). Vuelve a intentar en un momento."
          : "No se pudo conectar con la planilla de producción.",
      },
      { status: 504 }
    );
  }

  // Google a veces responde una página de error o de login en vez de los datos:
  // sin este guard el panel recibía HTML y reventaba al parsearlo.
  const pareceHtml = texto.trimStart().startsWith("<");
  if (!resp.ok || pareceHtml) {
    console.error(
      "[produccion/datos] respuesta inesperada:", resp.status,
      "| host:", (() => { try { return new URL(destino).host; } catch { return "?"; } })(),
      "| ruta:", (() => { try { return new URL(destino).pathname; } catch { return "?"; } })(),
      "|", texto.slice(0, 200)
    );
    if (guardado) return respuesta(guardado.texto, esVentas);
    return NextResponse.json(
      {
        error:
          resp.status === 404
            // 404 no es una falla pasajera: es que esa implementación del Apps
            // Script no existe. Casi siempre, la variable de entorno del
            // servidor apunta a un deployment viejo del script.
            ? "La planilla de producción respondió 404: la URL del Apps Script no existe. Hay que revisar PRODUCCION_APPS_SCRIPT_URL en el servidor (debe ser la URL /exec de la implementación activa)."
            : `La planilla de producción no respondió con datos (HTTP ${resp.status}). Puede ser una falla temporal de Google: vuelve a intentar en un momento.`,
      },
      { status: 502 }
    );
  }

  cache.set(claveCache, { texto, ts: Date.now() });
  return respuesta(texto, esVentas);
}

function respuesta(texto: string, esVentas: boolean) {
  return new NextResponse(texto, {
    headers: {
      "Content-Type": esVentas ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
