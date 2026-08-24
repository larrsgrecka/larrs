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
  const destino = `${url}?token=${encodeURIComponent(token)}${esVentas ? "&action=getSales" : ""}`;

  let resp: Response;
  let texto: string;
  try {
    resp = await fetch(destino, { signal: AbortSignal.timeout(50_000) });
    texto = await resp.text();
  } catch (e) {
    const timeout = (e as Error)?.name === "TimeoutError";
    return NextResponse.json(
      {
        error: timeout
          ? "Google no respondió en 50 s (la planilla de producción es grande y arranca en frío). Vuelve a intentar."
          : "No se pudo conectar con la planilla de producción.",
      },
      { status: 504 }
    );
  }

  // Google a veces responde una página de error o de login en vez de los datos:
  // sin este guard el panel recibía HTML y reventaba al parsearlo.
  const pareceHtml = texto.trimStart().startsWith("<");
  if (!resp.ok || pareceHtml) {
    console.error("[produccion/datos] respuesta inesperada:", resp.status, texto.slice(0, 200));
    return NextResponse.json(
      { error: `La planilla de producción no respondió con datos (HTTP ${resp.status}). Puede ser una falla temporal de Google: vuelve a intentar en un momento.` },
      { status: 502 }
    );
  }

  return new NextResponse(texto, {
    headers: {
      "Content-Type": esVentas ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
