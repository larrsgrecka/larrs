import { NextResponse, type NextRequest } from "next/server";
import { getActividadTiendas } from "@/utils/actividad-tiendas";
import { leerStockActual } from "@/utils/inventario-food-stock";

// Mantiene despiertos los Apps Script de Google.
//
// Medido: un script dormido no responde lento, responde 404 — y tarda entre 25
// y 48 s en hacerlo. En una tanda de 8 llamadas seguidas, las tres primeras
// fallaron y de la cuarta en adelante todas respondieron en 2-3 s, con dos
// implementaciones distintas del mismo proyecto. Por eso cambiar la URL no
// arregló nada y achicar la respuesta tampoco: la falla ocurre antes de que el
// script se ejecute.
//
// Esta ruta los toca cada tanto para que nunca estén fríos cuando alguien abre
// un panel, y de paso deja fresca la copia de respaldo, porque las lecturas que
// hace son las mismas que la guardan.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    return NextResponse.json({ error: "Falta CRON_SECRET en el entorno de este deploy." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "Token del cron incorrecto" }, { status: 401 });
  }

  const inicio = Date.now();
  const resultado: Record<string, unknown> = {};

  // Las cuatro fuentes del panel de actividad: ahora cuestan 98 bytes cada una,
  // así que tocarlas seguido es barato.
  try {
    const { errores, respaldos } = await getActividadTiendas();
    resultado.actividad = {
      fuentesConError: Object.keys(errores),
      fuentesDesdeRespaldo: Object.keys(respaldos),
    };
  } catch (e) {
    resultado.actividad = { error: (e as Error).message };
  }

  // El stock completo es la lectura cara (1,7 MB), así que se pide solo cuando
  // se lo pide explícitamente: el workflow lo hace una vez por hora, no en cada
  // pasada.
  if (request.nextUrl.searchParams.get("stock") === "1") {
    try {
      const { porClave, respaldo } = await leerStockActual();
      resultado.stock = { productos: Object.keys(porClave).length, desdeRespaldo: respaldo ?? false };
    } catch (e) {
      resultado.stock = { error: (e as Error).message };
    }
  }

  const segundos = Math.round((Date.now() - inicio) / 100) / 10;
  console.log(`[cron/calentar] ${segundos}s`, JSON.stringify(resultado));
  return NextResponse.json({ ok: true, segundos, ...resultado });
}
