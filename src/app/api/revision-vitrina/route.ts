import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { revisarVitrina, ultimasRevisiones, type TipoVitrina } from "@/utils/revision-vitrina";

// Lee las fotos con el modelo (20-40 s) más las fuentes con las que compara.
export const maxDuration = 60;

const TIPOS: TipoVitrina[] = ["helados", "pasteleria"];

async function quien() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };

  const profile = await getProfile();
  // Lo usa quien está parado frente a la vitrina: jefe de local y operador,
  // además del admin.
  if (!profile || !["admin", "jefe_tienda", "operador"].includes(profile.role)) {
    return { error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }
  return { user, profile };
}

export async function GET(request: NextRequest) {
  const auth = await quien();
  if (auth.error) return auth.error;

  const propia = auth.profile!.role !== "admin" ? auth.profile!.tienda : undefined;
  const tienda = propia || request.nextUrl.searchParams.get("tienda") || undefined;

  try {
    return NextResponse.json({ ok: true, ...(await ultimasRevisiones(tienda)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await quien();
  if (auth.error) return auth.error;

  const body = await request.json();
  const tipo = body.tipo as TipoVitrina;
  if (!TIPOS.includes(tipo)) {
    return NextResponse.json({ error: "tipo debe ser 'helados' o 'pasteleria'" }, { status: 400 });
  }

  // El jefe y el operador revisan su propia tienda; el admin elige cuál.
  const tienda = auth.profile!.role === "admin"
    ? body.tienda
    : auth.profile!.tienda;
  if (!tienda) return NextResponse.json({ error: "Falta la tienda" }, { status: 400 });

  const fotos = (body.fotos ?? []) as { base64: string; mimetype?: string }[];
  if (!fotos.length) return NextResponse.json({ error: "Hace falta al menos una foto" }, { status: 400 });
  // Más de tres fotos no entran en el minuto que da la plataforma.
  if (fotos.length > 3) return NextResponse.json({ error: "Máximo 3 fotos por revisión" }, { status: 400 });

  try {
    const resultado = await revisarVitrina({
      tienda,
      tipo,
      fotos,
      revisadoPor: auth.profile!.name || auth.user!.email || "",
    });
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    console.error("[revision-vitrina] falló:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
