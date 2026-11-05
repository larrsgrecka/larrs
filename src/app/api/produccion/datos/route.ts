import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { leerPlanilla } from "@/utils/produccion-planilla";

// Proxy del Apps Script de producción para el panel /produccion.
//
// El panel llamaba a script.google.com directo desde el navegador, lo que
// traía dos problemas: el token viajaba en el HTML servido al cliente (visible
// a cualquiera que abra el fuente) y la carga dependía de que la red del
// usuario alcanzara a Google — un bloqueador de contenido, un proxy corporativo
// o una caída de DNS daban un "Failed to fetch" sin explicación. Pasando por
// acá el fetch lo hace el servidor, con el token en variables de entorno.
//
// Los reintentos, el caché y el respaldo ya no viven acá: son los mismos que
// usan el historial de pesajes, los sabores y las recetas consumidas, que leen
// esta misma planilla (ver produccion-planilla.ts). Antes cada uno tenía su
// propia versión, y la de acá era la única con copia vencida de emergencia.
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

  // Única acción extra soportada: el panel también pide las ventas, que el
  // mismo Apps Script devuelve como JSON.
  const esVentas = request.nextUrl.searchParams.get("action") === "getSales";

  try {
    const lectura = await leerPlanilla(esVentas ? "ventas" : "csv");
    if (lectura.errorDeGoogle) {
      console.warn(
        `[produccion/datos] sirviendo copia de hace ${Math.round(lectura.edadMs / 60000)} min:`,
        lectura.errorDeGoogle
      );
    }
    return respuesta(lectura.texto, esVentas, lectura);
  } catch (e) {
    const mensaje = (e as Error).message;
    if (/no configurado/i.test(mensaje)) {
      return NextResponse.json({ error: mensaje }, { status: 500 });
    }
    // Sin datos y sin copia: recién acá se muestra un error.
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }
}

// La antigüedad viaja en cabeceras porque el cuerpo es el CSV crudo que el
// panel parsea: no hay dónde meterla adentro sin cambiarle el formato. El
// panel la usa para avisar cuando lo que muestra no es de ahora.
function respuesta(
  texto: string,
  esVentas: boolean,
  lectura: { edadMs: number; desdeEspejo: boolean; errorDeGoogle?: string }
) {
  return new NextResponse(texto, {
    headers: {
      "Content-Type": esVentas ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Datos-Edad-Ms": String(Math.round(lectura.edadMs)),
      "X-Datos-Desde-Espejo": lectura.desdeEspejo ? "1" : "0",
      ...(lectura.errorDeGoogle ? { "X-Datos-Google-Fallo": "1" } : {}),
    },
  });
}
