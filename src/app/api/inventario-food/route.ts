import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";

type Item = { producto: string; cantidad: number; unidad?: string };

function appsScriptConfig() {
  const url = process.env.INVENTARIO_FOOD_APPS_SCRIPT_URL;
  const token = process.env.INVENTARIO_FOOD_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "jefe_tienda" && profile?.role !== "admin" && profile?.role !== "operador") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de inventario food no configurado" }, { status: 500 });
  }

  const body = await request.json();
  const tienda =
    (profile.role === "jefe_tienda" || profile.role === "operador") && profile.tienda
      ? profile.tienda
      : body.tienda;

  if (!tienda) {
    return NextResponse.json({ error: "tienda es requerida" }, { status: 400 });
  }
  if (!body.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) {
    return NextResponse.json({ error: "fecha inválida" }, { status: 400 });
  }
  if (!body.categoria) {
    return NextResponse.json({ error: "categoria es requerida" }, { status: 400 });
  }
  const items = (body.items ?? []) as Item[];
  const validItems = items.filter((it) => it.producto && it.cantidad !== null && !Number.isNaN(Number(it.cantidad)));
  if (validItems.length === 0) {
    return NextResponse.json({ error: "Debes contar al menos un producto" }, { status: 400 });
  }
  const conDecimalIndebido = validItems.find(
    (it) => (it.unidad || "un") === "un" && !Number.isInteger(Number(it.cantidad))
  );
  if (conDecimalIndebido) {
    return NextResponse.json(
      { error: `"${conDecimalIndebido.producto}" se cuenta en unidades enteras` },
      { status: 400 }
    );
  }

  const nombreOperador = typeof body.nombre_operador === "string" ? body.nombre_operador.trim() : "";
  if (profile.role === "operador" && !nombreOperador) {
    return NextResponse.json({ error: "nombre_operador es requerido para la cuenta compartida de tienda" }, { status: 400 });
  }

  const payload = {
    fecha: body.fecha,
    tienda,
    categoria: body.categoria,
    observaciones: body.observaciones || "",
    reportado_por: nombreOperador || profile.name || user.email || "",
    reportado_por_id: user.id,
    items: validItems.map((it) => ({
      producto: it.producto,
      cantidad: Number(it.cantidad),
      unidad: it.unidad || "un",
    })),
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

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin puede editar conteos" }, { status: 403 });
  }

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de inventario food no configurado" }, { status: 500 });
  }

  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ error: "id es requerido" }, { status: 400 });
  }
  if (!body.tienda || !body.categoria || !body.producto) {
    return NextResponse.json({ error: "tienda, categoria y producto son requeridos" }, { status: 400 });
  }
  if (!body.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) {
    return NextResponse.json({ error: "fecha inválida" }, { status: 400 });
  }
  if (body.cantidad === undefined || body.cantidad === null || Number.isNaN(Number(body.cantidad))) {
    return NextResponse.json({ error: "cantidad inválida" }, { status: 400 });
  }
  const unidad = body.unidad || "un";
  if (unidad === "un" && !Number.isInteger(Number(body.cantidad))) {
    return NextResponse.json({ error: "La cantidad debe ser un número entero cuando la unidad es 'un'" }, { status: 400 });
  }

  const payload = {
    id: body.id,
    fecha: body.fecha,
    tienda: body.tienda,
    categoria: body.categoria,
    producto: body.producto,
    cantidad: Number(body.cantidad),
    unidad,
    observaciones: body.observaciones || "",
  };

  const resp = await fetch(`${config.url}?token=${encodeURIComponent(config.token)}&action=update`, {
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin puede eliminar conteos" }, { status: 403 });
  }

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de inventario food no configurado" }, { status: 500 });
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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de inventario food no configurado" }, { status: 500 });
  }

  const profile = await getProfile();
  const sp = request.nextUrl.searchParams;
  const tienda =
    (profile?.role === "jefe_tienda" || profile?.role === "operador") && profile.tienda
      ? profile.tienda
      : sp.get("tienda");

  const url = new URL(config.url);
  url.searchParams.set("token", config.token);
  url.searchParams.set("action", "list");
  if (tienda && tienda !== "Todas") url.searchParams.set("tienda", tienda);

  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!data.ok) {
    return NextResponse.json({ error: data.error || "Error en Apps Script" }, { status: 502 });
  }

  // Nos quedamos con el conteo más reciente por tienda+categoria+producto
  // (mismo criterio que /api/pedidos-historial: la fila más nueva primero).
  const porClave: Record<string, unknown> = {};
  for (const it of (data.items ?? []) as Record<string, unknown>[]) {
    const clave = `${it.tienda}||${it.categoria}||${it.producto}`;
    if (!(clave in porClave)) porClave[clave] = it;
  }

  return NextResponse.json({ ok: true, items: Object.values(porClave) });
}
