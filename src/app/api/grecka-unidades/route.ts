import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { unidadesCorregidas, corregirUnidad, borrarCorreccion, marcarSoloProduccion } from "@/utils/grecka-unidades";

async function soloAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Solo un admin corrige unidades" }, { status: 403 }) };
  }
  return { user, profile };
}

export async function GET() {
  const auth = await soloAdmin();
  if (auth.error) return auth.error;
  return NextResponse.json({ ok: true, unidades: await unidadesCorregidas() });
}

export async function POST(request: NextRequest) {
  const auth = await soloAdmin();
  if (auth.error) return auth.error;

  const body = await request.json();
  const sku = String(body.sku || "").trim();
  if (!sku) return NextResponse.json({ error: "Falta el código del producto" }, { status: 400 });

  // Marcar un producto como de la sala de producción es su propia operación: no
  // cambia la unidad, solo saca el producto de los pedidos de tienda.
  if (body.soloProduccion !== undefined) {
    const unidades = await marcarSoloProduccion(
      sku,
      !!body.soloProduccion,
      auth.profile!.name || auth.user!.email || ""
    );
    return NextResponse.json({ ok: true, unidades });
  }

  const unidad = String(body.unidad || "").trim();
  if (!unidad) {
    return NextResponse.json({ error: "Hace falta la unidad" }, { status: 400 });
  }

  const porCaja = Number(body.porCaja) || undefined;
  if (porCaja !== undefined && (porCaja < 1 || porCaja > 1000)) {
    return NextResponse.json({ error: "Las unidades por caja tienen que estar entre 1 y 1000" }, { status: 400 });
  }

  try {
    const unidades = await corregirUnidad(sku, {
      unidad,
      porCaja,
      corregidoPor: auth.profile!.name || auth.user!.email || "",
    });
    return NextResponse.json({ ok: true, unidades });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await soloAdmin();
  if (auth.error) return auth.error;
  const sku = request.nextUrl.searchParams.get("sku");
  if (!sku) return NextResponse.json({ error: "Falta el código" }, { status: 400 });
  return NextResponse.json({ ok: true, unidades: await borrarCorreccion(sku) });
}
