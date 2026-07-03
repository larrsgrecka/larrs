import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getProfile } from "@/utils/auth";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  const { messages, pedidoActual, tienda, semana, mode } = await request.json();

  const admin = createAdminClient();
  const tiendaFiltro = profile?.role === "jefe_tienda" ? profile.tienda : tienda;

  const { data: historial } = await admin
    .from("ventas_grecka")
    .select("fecha, sku, descripcion, grupo, cantidad, unidad, precio_unitario, neto, tienda")
    .eq("tienda", tiendaFiltro || "Costanera")
    .in("grupo", ["Insumos", "Accesorios"])
    .gte("fecha", new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
    .order("fecha", { ascending: false })
    .limit(400);

  // Agrupar historial por producto
  const porProducto: Record<string, {
    compras: number; totalKg: number; ultimaFecha: string; precios: number[]; unidad: string; grupo: string;
  }> = {};
  for (const row of historial || []) {
    const key = `${row.sku}|${row.descripcion}`;
    if (!porProducto[key]) porProducto[key] = { compras: 0, totalKg: 0, ultimaFecha: row.fecha, precios: [], unidad: row.unidad, grupo: row.grupo };
    porProducto[key].compras++;
    porProducto[key].totalKg += row.cantidad;
    porProducto[key].precios.push(row.precio_unitario);
    if (row.fecha > porProducto[key].ultimaFecha) porProducto[key].ultimaFecha = row.fecha;
  }

  // Productos en el pedido actual
  const skusEnPedido = new Set(
    Array.isArray(pedidoActual) ? pedidoActual.map((p: { sku: string }) => p.sku) : []
  );

  // Productos del historial que NO están en el pedido (con al menos 2 compras)
  const productosFaltantes = Object.entries(porProducto)
    .filter(([key]) => !skusEnPedido.has(key.split("|")[0]))
    .filter(([, v]) => v.compras >= 2)
    .sort((a, b) => b[1].compras - a[1].compras)
    .slice(0, 25)
    .map(([key, v]) => {
      const [sku, desc] = key.split("|");
      const avgQty = v.totalKg / v.compras;
      return { sku, desc, compras: v.compras, avgQty: Math.round(avgQty * 10) / 10, unidad: v.unidad, grupo: v.grupo, ultimaFecha: v.ultimaFecha };
    });

  const historialResumen = Object.entries(porProducto)
    .sort((a, b) => b[1].compras - a[1].compras)
    .slice(0, 80)
    .map(([key, v]) => {
      const [sku, desc] = key.split("|");
      const avgPrecio = v.precios.reduce((s, p) => s + p, 0) / v.precios.length;
      const avgQty = v.totalKg / v.compras;
      return `• ${desc} (${sku}): ${v.compras}x en 12m, prom ${avgQty.toFixed(1)} ${v.unidad}/compra, última ${v.ultimaFecha}, ~$${Math.round(avgPrecio).toLocaleString("es-CL")}`;
    })
    .join("\n");

  const pedidoResumen = Array.isArray(pedidoActual) && pedidoActual.length
    ? pedidoActual.map((p: { sku: string; desc: string; cantidad: number; sem: number; unidad: string; um: string; grupo: string }) =>
        `• ${p.desc} (${p.sku}): ${p.sem ?? p.cantidad ?? 1} ${p.um ?? p.unidad} — ${p.grupo}`
      ).join("\n")
    : "No hay pedido cargado aún.";

  const faltantesResumen = productosFaltantes.length
    ? productosFaltantes.map(p =>
        `• ${p.desc} (${p.sku}): ${p.compras} compras, prom ${p.avgQty} ${p.unidad}/vez, última ${p.ultimaFecha} → [AGREGAR:${p.sku}|${p.desc}|${p.avgQty}|${p.unidad}|${p.grupo}]`
      ).join("\n")
    : "Todos los productos frecuentes están en el pedido.";

  const formatoAgregarInstruccion = `
CAPACIDAD PRINCIPAL — AGREGAR PRODUCTOS AL PEDIDO:
Puedes agregar productos directamente al pedido usando este formato (genera un botón interactivo en la pantalla):
[AGREGAR:CODIGO|Descripcion del articulo|cantidad|unidad|grupo]
Ejemplo: [AGREGAR:AB-123|Cono Napolitano 120mm|25|KG|Accesorios]

REGLAS IMPORTANTES:
- Cuando el usuario diga "agregar", "añadir", "incluir", "procesa esto", "agrega X", o similar: DEBES responder con [AGREGAR:...] para cada producto. ESA ES TU ACCIÓN.
- Nunca digas que "no puedes agregar" o que "no puedes procesar". Sí puedes — a través del botón [AGREGAR:...].
- Si el usuario pide agregar todos los faltantes o "procesar el pedido", genera [AGREGAR:...] para los más importantes (máx 10).
- El campo grupo debe ser "Insumos" o "Accesorios".
- Usa la cantidad promedio histórica como cantidad sugerida.`;

  let systemPrompt: string;

  if (mode === "alertas") {
    systemPrompt = `Eres el asistente de pedidos de Heladería Larrs (${tiendaFiltro || "todas las tiendas"}).

PEDIDO ACTUAL (${semana || "semana actual"}):
${pedidoResumen}

PRODUCTOS DEL HISTORIAL QUE NO ESTÁN EN EL PEDIDO (los más frecuentes primero):
${faltantesResumen}

TAREA: Analiza brevemente el pedido y genera alertas útiles:
1. De los productos faltantes, destaca los 3-5 más importantes con sus botones [AGREGAR:...]
2. Si hay algo inusual o que merezca atención, mencíonalo

${formatoAgregarInstruccion}

Sé conciso y directo. Máximo 200 palabras. Responde en español.`;
  } else {
    systemPrompt = `Eres el asistente de pedidos de Heladería Larrs, una heladería artesanal chilena con tiendas en Costanera, Dominicos y Trapenses.

CONTEXTO:
- Tienda: ${tiendaFiltro || "todas"}
- Semana: ${semana || "actual"}

PEDIDO SUGERIDO ACTUAL:
${pedidoResumen}

HISTORIAL DE COMPRAS (últimos 12 meses):
${historialResumen || "Sin historial disponible."}

PRODUCTOS FRECUENTES QUE NO ESTÁN EN EL PEDIDO:
${faltantesResumen}

${formatoAgregarInstruccion}

INSTRUCCIONES GENERALES:
- Responde en español, de forma concisa y práctica
- Usa datos reales del historial cuando respondes preguntas de cantidades
- Los precios son en CLP (pesos chilenos)
- Sé directo — el equipo usa esto en tiempo real`;
  }

  const stream = await anthropic.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: mode === "alertas" ? 600 : 1024,
    system: systemPrompt,
    messages: messages.map((m: { role: string; content: string }) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          controller.enqueue(encoder.encode(chunk.delta.text));
        }
      }
      controller.close();
    },
  });

  return new NextResponse(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
