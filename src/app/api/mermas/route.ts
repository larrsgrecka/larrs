import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";

const MOTIVOS_VALIDOS = [
  "Vencido / fecha de expiración",
  "Dañado en producción",
  "Roto / derrame (bandeja, envase)",
  "Falla de frío / cadena de frío",
  "Error de despacho o traslado",
  "Prueba / degustación",
  "Otro",
];

function appsScriptConfig() {
  const url = process.env.MERMAS_APPS_SCRIPT_URL;
  const token = process.env.MERMAS_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "jefe_tienda" && profile?.role !== "admin") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de mermas no configurado" }, { status: 500 });
  }

  const body = await request.json();
  const tienda =
    profile.role === "jefe_tienda" && profile.tienda ? profile.tienda : body.tienda;

  if (!tienda) {
    return NextResponse.json({ error: "tienda es requerida" }, { status: 400 });
  }
  if (!body.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) {
    return NextResponse.json({ error: "fecha inválida" }, { status: 400 });
  }
  if (!body.producto || !(Number(body.cantidad) > 0)) {
    return NextResponse.json({ error: "producto y cantidad son requeridos" }, { status: 400 });
  }
  if (!MOTIVOS_VALIDOS.includes(body.motivo)) {
    return NextResponse.json({ error: "motivo inválido" }, { status: 400 });
  }

  const payload = {
    fecha: body.fecha,
    tienda,
    producto: body.producto,
    categoria_producto: body.categoria_producto || "",
    cantidad: Number(body.cantidad),
    unidad: body.unidad || "un",
    motivo: body.motivo,
    motivo_detalle: body.motivo_detalle || "",
    observaciones: body.observaciones || "",
    reportado_por: profile.name || user.email || "",
    reportado_por_id: user.id,
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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de mermas no configurado" }, { status: 500 });
  }

  const profile = await getProfile();
  const sp = request.nextUrl.searchParams;
  const tienda =
    profile?.role === "jefe_tienda" && profile.tienda ? profile.tienda : sp.get("tienda");

  const url = new URL(config.url);
  url.searchParams.set("token", config.token);
  url.searchParams.set("action", "list");
  if (tienda && tienda !== "Todas") url.searchParams.set("tienda", tienda);

  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!data.ok) {
    return NextResponse.json({ error: data.error || "Error en Apps Script" }, { status: 502 });
  }

  return NextResponse.json(data);
}
