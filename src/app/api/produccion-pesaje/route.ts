import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { resolverSaboresEnPlanilla } from "@/utils/sabores-produccion";

// El POST resuelve los nombres contra el CSV de producción antes de escribir
// (puede tardar varios segundos si el Apps Script arranca en frío).
export const maxDuration = 60;

type Item = { sabor: string; cantidad: number };

function appsScriptConfig() {
  const url = process.env.PRODUCCION_APPS_SCRIPT_URL;
  const token = process.env.PRODUCCION_APPS_SCRIPT_TOKEN;
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
    return NextResponse.json({ error: "Apps Script de producción no configurado" }, { status: 500 });
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

  // Una corrección (solo admin) permite cantidades negativas, para ajustar
  // un pesaje anterior sin tocar ni borrar la fila original.
  const esCorreccion = body.esCorreccion === true && profile.role === "admin";
  const items = (body.items ?? []) as Item[];
  const validItems = esCorreccion
    ? items.filter((it) => it.sabor && Number(it.cantidad) !== 0 && !Number.isNaN(Number(it.cantidad)))
    : items.filter((it) => it.sabor && Number(it.cantidad) > 0);
  if (validItems.length === 0) {
    return NextResponse.json({ error: "Debes pesar al menos un sabor" }, { status: 400 });
  }

  const observaciones = esCorreccion
    ? `[Corrección] ${body.observaciones || ""}`.trim()
    : body.observaciones || "";

  const nombreOperador = typeof body.nombre_operador === "string" ? body.nombre_operador.trim() : "";
  if (profile.role === "operador" && !nombreOperador) {
    return NextResponse.json({ error: "nombre_operador es requerido para la cuenta compartida de tienda" }, { status: 400 });
  }

  // El Apps Script escribe buscando la columna del sabor por nombre exacto y,
  // si un solo nombre no existe, rechaza el pesaje entero. Los nombres pueden
  // venir de la vitrina o de un sabor agregado a mano en /catalogo que no tiene
  // columna en la planilla, así que acá se traducen: los que difieren solo en
  // mayúsculas/tildes se corrigen solos y los que no existen se dejan fuera con
  // aviso, para no perder el resto del pesaje.
  const { canonico, faltantes } = await resolverSaboresEnPlanilla(
    validItems.map((it) => it.sabor)
  );
  const itemsEnviables = validItems
    .filter((it) => canonico[it.sabor])
    .map((it) => ({ sabor: canonico[it.sabor], cantidad: Number(it.cantidad) }));

  if (itemsEnviables.length === 0) {
    const detalle = faltantes
      .map((f) => (f.sugerencia ? `"${f.sabor}" (¿es "${f.sugerencia}"?)` : `"${f.sabor}"`))
      .join(", ");
    return NextResponse.json(
      { error: `Ningún sabor del pesaje existe en la planilla de producción: ${detalle}. Hay que corregir el nombre en Catálogo.` },
      { status: 400 }
    );
  }

  const payload = {
    fecha: body.fecha,
    tienda,
    observaciones,
    reportado_por_email: user.email || "",
    reportado_por_nombre: nombreOperador || profile.name || user.email || "",
    items: itemsEnviables,
  };

  const resp = await fetch(`${config.url}?token=${encodeURIComponent(config.token)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!data.ok) {
    return NextResponse.json({ error: data.error || "Error en Apps Script" }, { status: 502 });
  }

  return NextResponse.json({ ...data, omitidos: faltantes });
}
