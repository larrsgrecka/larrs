import { NextResponse, type NextRequest } from "next/server";
import { generarInformeSemanal } from "@/utils/informe-semanal";

// Lo dispara Vercel los lunes a las 8:00 de Chile (11:00 UTC). No envía nada:
// genera el informe para que quede caliente en caché y, sobre todo, para que
// cualquier falla de las fuentes aparezca en los logs del lunes temprano y no
// cuando alguien abre el panel.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Vercel manda el CRON_SECRET como Bearer; sin eso, cualquiera podría
  // disparar un cálculo caro desde afuera.
  //
  // Falta la variable y token equivocado son dos problemas distintos y se
  // arreglan distinto, así que no comparten respuesta: con 401 para ambos no
  // hay forma de saber, desde afuera, si la variable llegó al deploy.
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    return NextResponse.json(
      { error: "Falta CRON_SECRET en el entorno de este deploy. Hay que crearla en Vercel y volver a desplegar: las variables se leen al desplegar." },
      { status: 503 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "Token del cron incorrecto" }, { status: 401 });
  }

  try {
    const informe = await generarInformeSemanal();
    console.log(
      `[cron/informe-semanal] semana ${informe.semana.etiqueta}: ${informe.resumen.totalKg} kg, ` +
      `${informe.resumen.alertasAltas} alertas altas, ${informe.resumen.alertasMedias} medias` +
      (informe.fuentesQueFallaron.length ? ` | fuentes con falla: ${informe.fuentesQueFallaron.join(" ; ")}` : "")
    );
    return NextResponse.json({
      ok: true,
      semana: informe.semana,
      resumen: informe.resumen,
      alertas: informe.alertas,
      fuentesQueFallaron: informe.fuentesQueFallaron,
    });
  } catch (e) {
    console.error("[cron/informe-semanal] falló:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
