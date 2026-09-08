import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { dedupePorClaveUbicacion, type StockRow } from "@/utils/inventario-food-stock";

// El Apps Script de Inventario Food maneja 3.400 filas y en frío tarda
// decenas de segundos: con el default de 10 s la plataforma cortaba la
// función y el panel recibía HTML en vez del JSON del conteo.
export const maxDuration = 60;

type Item = { producto: string; cantidad: number; unidad?: string; ubicacion?: string };

// La fila tal como la devuelve el Apps Script: los campos que usa el dedupe más
// el resto (id, observaciones, quién reportó) que el panel necesita mostrar.
type FilaInventario = StockRow & Record<string, unknown>;

function appsScriptConfig() {
  const url = process.env.INVENTARIO_FOOD_APPS_SCRIPT_URL;
  const token = process.env.INVENTARIO_FOOD_APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

// Se arma con URL en vez de concatenar: si la variable de entorno viene con una
// barra final o con el token ya pegado, "?token=" produce una URL que Google
// responde con 404. Ya nos costó un día de diagnóstico en el panel de
// producción; esta ruta seguía concatenando a mano.
function urlAppsScript(base: string, token: string, params: Record<string, string> = {}): string {
  const u = new URL(base.trim());
  u.pathname = u.pathname.replace(/\/+$/, "");
  u.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// Google Apps Script a veces devuelve una respuesta vacía o una página de
// error de Drive en vez del JSON esperado (falla temporal de infraestructura
// de Google, no de esta app) — sin este guard, resp.json() explota con un
// error crudo tipo "Unexpected end of JSON input" que además rompe el propio
// JSON de respuesta de esta ruta, confundiendo al cliente todavía más.
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAppsScriptJson(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  // Google devuelve 404 con una página HTML de forma intermitente: en el mismo
  // minuto unas llamadas pasan y otras no, con el deployment intacto. Reintentar
  // resuelve la enorme mayoría. Un 404 así llega ANTES de ejecutar el script, así
  // que reintentar un POST no duplica el conteo; si en cambio la respuesta fuera
  // un JSON de error del propio script, no se reintenta.
  const intentos = 3;
  let ultimoDetalle = "";

  for (let i = 1; i <= intentos; i++) {
    let resp: Response;
    try {
      resp = await fetch(url, { ...options, signal: AbortSignal.timeout(45_000) });
    } catch (e) {
      ultimoDetalle = (e as Error)?.name === "TimeoutError" ? "no respondió en 45 s" : "sin conexión";
      if (i < intentos) { await espera(800 * i); continue; }
      return { ok: false, error: `No se pudo conectar con el servicio de Inventario Food (${ultimoDetalle}). Intenta de nuevo en unos segundos.` };
    }

    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      ultimoDetalle = `HTTP ${resp.status}`;
      console.error(`[inventario-food] respuesta no-JSON (intento ${i}/${intentos}):`, resp.status, text.slice(0, 200));
      if (i < intentos) { await espera(800 * i); continue; }
    }
  }

  return {
    ok: false,
    error: `El servicio de Inventario Food no respondió bien tras ${intentos} intentos (${ultimoDetalle}). ` +
      "Es una falla temporal de Google: espera unos segundos y, antes de repetir el conteo, revisa en \"Stock actual\" si alcanzó a guardarse.",
  };
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
      ubicacion: it.ubicacion || "",
    })),
  };

  const data = await fetchAppsScriptJson(urlAppsScript(config.url, config.token), {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
    ubicacion: body.ubicacion || "",
    observaciones: body.observaciones || "",
  };

  const data = await fetchAppsScriptJson(urlAppsScript(config.url, config.token, { action: "update" }), {
    method: "POST",
    body: JSON.stringify(payload),
  });
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

  const data = await fetchAppsScriptJson(urlAppsScript(config.url, config.token, { action: "delete" }), {
    method: "POST",
    body: JSON.stringify({ id: body.id }),
  });
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

  // El listado por tienda además baja bastante el peso de la respuesta: el
  // completo ya va en 1,4 MB y ~7 s, y es lo que hacía que la función se
  // pasara de los 60 s.
  const params: Record<string, string> = { action: "list" };
  if (tienda && tienda !== "Todas") params.tienda = tienda;
  const url = urlAppsScript(config.url, config.token, params);

  const data = await fetchAppsScriptJson(url);
  if (!data.ok) {
    return NextResponse.json({ error: data.error || "Error en Apps Script" }, { status: 502 });
  }

  // Mismo criterio de "conteo más reciente por producto y ubicación" que usan
  // los cuadros de valor de stock y stock mínimo, para no desalinearse.
  const filas = (data.items ?? []) as unknown as FilaInventario[];
  const porClave = dedupePorClaveUbicacion(filas);

  // Si la planilla guarda la columna se detecta por la PRESENCIA del campo, no
  // por su valor: mientras el Apps Script no estuvo redesplegado el campo no
  // venía (undefined) y ahora llega vacío ("") hasta que se cargue el primer
  // conteo con ubicación. Mirar el valor creaba un bloqueo circular — el panel
  // esperaba ver ubicaciones para empezar a enviarlas, así que nunca las
  // enviaba y nunca aparecían.
  const ubicacionEnPlanilla = filas.some((it) => it.ubicacion !== undefined);

  return NextResponse.json({
    ok: true,
    items: Object.values(porClave),
    ubicacionEnPlanilla,
  });
}
