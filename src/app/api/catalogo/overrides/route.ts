import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { resolverSaboresEnPlanilla } from "@/utils/sabores-produccion";

// Validar un sabor implica leer el CSV de producción, que puede tardar.
export const maxDuration = 30;

function appsScriptConfig() {
  const url = process.env.CATALOGO_APPS_SCRIPT_URL;
  const token = process.env.CATALOGO_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Solo un admin puede gestionar el catálogo" }, { status: 403 }) };
  }
  return { user, profile };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de catálogo no configurado" }, { status: 500 });
  }

  const catalogo = request.nextUrl.searchParams.get("catalogo");
  if (catalogo !== "food" && catalogo !== "sabores") {
    return NextResponse.json({ error: "catalogo debe ser 'food' o 'sabores'" }, { status: 400 });
  }

  const url = new URL(config.url);
  url.searchParams.set("token", config.token);
  url.searchParams.set("action", "list");
  url.searchParams.set("catalogo", catalogo);

  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!data.ok) {
    return NextResponse.json({ error: data.error || "Error en Apps Script" }, { status: 502 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de catálogo no configurado" }, { status: 500 });
  }

  const body = await request.json();
  if (body.catalogo !== "food" && body.catalogo !== "sabores") {
    return NextResponse.json({ error: "catalogo debe ser 'food' o 'sabores'" }, { status: 400 });
  }
  if (body.tipo !== "incluir" && body.tipo !== "excluir") {
    return NextResponse.json({ error: "tipo debe ser 'incluir' o 'excluir'" }, { status: 400 });
  }
  if (!body.nombre) {
    return NextResponse.json({ error: "nombre es requerido" }, { status: 400 });
  }

  // Un sabor solo se puede pesar si existe como columna en la planilla de
  // producción: el Apps Script busca la columna por nombre exacto. Incluir uno
  // que no existe lo hace aparecer en Vitrina y Pesaje pero imposible de
  // guardar, y de paso hacía fallar el pesaje completo (caso real: "Banana
  // split vet. Striacciatella", con el nombre mal escrito).
  if (body.catalogo === "sabores" && body.tipo === "incluir") {
    const { canonico, faltantes } = await resolverSaboresEnPlanilla([String(body.nombre)]);
    if (faltantes.length) {
      const f = faltantes[0];
      const pista = f.sugerencia ? ` ¿Quisiste decir "${f.sugerencia}"?` : "";
      return NextResponse.json(
        { error: `"${f.sabor}" no existe como columna en la planilla de producción, así que no se podría pesar.${pista}` },
        { status: 400 }
      );
    }
    // Guarda el nombre tal como está en la planilla, no como lo tipearon.
    body.nombre = canonico[String(body.nombre)];
  }
  if (body.catalogo === "food" && body.tipo === "incluir" && !body.categoria) {
    return NextResponse.json({ error: "categoria es requerida para agregar un producto food" }, { status: 400 });
  }

  const payload = {
    catalogo: body.catalogo,
    tipo: body.tipo,
    categoria: body.categoria || "",
    nombre: body.nombre,
    unidad: body.unidad || "un",
    creado_por: auth.profile!.name || auth.user!.email || "",
  };

  const resp = await fetch(`${config.url}?token=${encodeURIComponent(config.token)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!data.ok) {
    return NextResponse.json({ error: data.error || "Error en Apps Script" }, { status: 502 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de catálogo no configurado" }, { status: 500 });
  }

  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ error: "id es requerido" }, { status: 400 });
  }

  const resp = await fetch(`${config.url}?token=${encodeURIComponent(config.token)}&action=delete`, {
    method: "POST",
    body: JSON.stringify({ id: body.id }),
  });
  const data = await resp.json();
  if (!data.ok) {
    return NextResponse.json({ error: data.error || "Error en Apps Script" }, { status: 502 });
  }

  return NextResponse.json(data);
}
