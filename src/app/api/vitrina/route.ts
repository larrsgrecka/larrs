import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";

type Slot = { slot: number; sabor: string };

function appsScriptConfig() {
  const url = process.env.VITRINA_APPS_SCRIPT_URL;
  const token = process.env.VITRINA_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de vitrina no configurado" }, { status: 500 });
  }

  const profile = await getProfile();
  const sp = request.nextUrl.searchParams;
  const tienda =
    profile?.role === "jefe_tienda" && profile.tienda ? profile.tienda : sp.get("tienda");

  const url = new URL(config.url);
  url.searchParams.set("token", config.token);
  if (tienda) url.searchParams.set("tienda", tienda);

  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!data.ok) {
    return NextResponse.json({ error: data.error || "Error en Apps Script" }, { status: 502 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo un admin puede editar la vitrina" }, { status: 403 });
  }

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de vitrina no configurado" }, { status: 500 });
  }

  const body = await request.json();
  if (!body.tienda) {
    return NextResponse.json({ error: "tienda es requerida" }, { status: 400 });
  }
  const slots = (body.slots ?? []) as Slot[];
  if (!Array.isArray(slots)) {
    return NextResponse.json({ error: "slots debe ser un array" }, { status: 400 });
  }

  const payload = {
    tienda: body.tienda,
    slots: slots
      .filter((s) => s.sabor)
      .map((s) => ({ slot: Number(s.slot), sabor: s.sabor })),
    actualizado_por: profile.name || user.email || "",
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
