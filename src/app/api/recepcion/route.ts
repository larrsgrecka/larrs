import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";

type Item = { categoria: string; producto: string; cantidad: number; unidad?: string };

const PROVEEDORES_VALIDOS = ["Centro de Producción", "Grecka", "Otro"];

function appsScriptConfig() {
  const url = process.env.RECEPCION_APPS_SCRIPT_URL;
  const token = process.env.RECEPCION_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

function inventarioFoodConfig() {
  const url = process.env.INVENTARIO_FOOD_APPS_SCRIPT_URL;
  const token = process.env.INVENTARIO_FOOD_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

// Suma cada producto recibido al último conteo de Inventario Food para esa
// tienda+categoria+producto, generando un nuevo conteo (no modifica ni borra
// los conteos anteriores — mismo criterio de "historial completo").
async function sumarAlStock(
  tienda: string,
  items: Item[],
  reportadoPor: string,
  reportadoPorId: string
): Promise<{ ok: boolean; error?: string }> {
  const config = inventarioFoodConfig();
  if (!config) return { ok: false, error: "Apps Script de inventario food no configurado" };

  const porCategoria = new Map<string, Item[]>();
  for (const it of items) {
    if (!porCategoria.has(it.categoria)) porCategoria.set(it.categoria, []);
    porCategoria.get(it.categoria)!.push(it);
  }

  for (const [categoria, itemsCategoria] of porCategoria) {
    const listUrl = new URL(config.url);
    listUrl.searchParams.set("token", config.token);
    listUrl.searchParams.set("action", "list");
    listUrl.searchParams.set("tienda", tienda);
    const listResp = await fetch(listUrl.toString());
    const listData = await listResp.json();
    if (!listData.ok) return { ok: false, error: listData.error || "Error al leer stock actual" };

    const stockActual: Record<string, number> = {};
    for (const row of (listData.items ?? []) as { categoria: string; producto: string; cantidad: number }[]) {
      const clave = `${row.categoria}||${row.producto}`;
      if (!(clave in stockActual)) stockActual[clave] = Number(row.cantidad) || 0;
    }

    const nuevosItems = itemsCategoria.map((it) => {
      const clave = `${categoria}||${it.producto}`;
      const actual = stockActual[clave] || 0;
      return { producto: it.producto, cantidad: actual + Number(it.cantidad), unidad: it.unidad || "un" };
    });

    const fecha = new Date().toISOString().slice(0, 10);
    const resp = await fetch(`${config.url}?token=${encodeURIComponent(config.token)}`, {
      method: "POST",
      body: JSON.stringify({
        fecha,
        tienda,
        categoria,
        observaciones: "Auto-generado por recepción de productos",
        reportado_por: reportadoPor,
        reportado_por_id: reportadoPorId,
        items: nuevosItems,
      }),
    });
    const data = await resp.json();
    if (!data.ok) return { ok: false, error: data.error || "Error al actualizar stock" };
  }

  return { ok: true };
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
    return NextResponse.json({ error: "Apps Script de recepción no configurado" }, { status: 500 });
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
  if (!PROVEEDORES_VALIDOS.includes(body.proveedor)) {
    return NextResponse.json({ error: "proveedor inválido" }, { status: 400 });
  }
  const items = (body.items ?? []) as Item[];
  const validItems = items.filter((it) => it.categoria && it.producto && Number(it.cantidad) > 0);
  if (validItems.length === 0) {
    return NextResponse.json({ error: "Debes registrar al menos un producto recibido" }, { status: 400 });
  }

  const nombreOperador = typeof body.nombre_operador === "string" ? body.nombre_operador.trim() : "";
  if (profile.role === "operador" && !nombreOperador) {
    return NextResponse.json({ error: "nombre_operador es requerido para la cuenta compartida de tienda" }, { status: 400 });
  }
  const reportadoPor = nombreOperador || profile.name || user.email || "";
  const reportadoPorId = user.id;

  const payload = {
    fecha: body.fecha,
    tienda,
    proveedor: body.proveedor,
    observaciones: body.observaciones || "",
    reportado_por: reportadoPor,
    reportado_por_id: reportadoPorId,
    items: validItems.map((it) => ({
      categoria: it.categoria,
      producto: it.producto,
      cantidad: Number(it.cantidad),
      unidad: it.unidad || "un",
    })),
    foto_base64: body.foto_base64 || undefined,
    foto_mimetype: body.foto_mimetype || undefined,
  };

  const resp = await fetch(`${config.url}?token=${encodeURIComponent(config.token)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!data.ok) {
    return NextResponse.json({ error: data.error || "Error en Apps Script de recepción" }, { status: 502 });
  }

  const stockResult = await sumarAlStock(tienda, payload.items, reportadoPor, reportadoPorId);
  if (!stockResult.ok) {
    return NextResponse.json({
      ok: true,
      ...data,
      stockWarning: `Recepción guardada, pero no se pudo actualizar el stock automáticamente: ${stockResult.error}`,
    });
  }

  return NextResponse.json(data);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const config = appsScriptConfig();
  if (!config) {
    return NextResponse.json({ error: "Apps Script de recepción no configurado" }, { status: 500 });
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

  return NextResponse.json(data);
}
