import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { getCatalogoFood } from "@/utils/catalogo-food";

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type ItemDetectado = {
  texto_detectado: string;
  categoria: string;
  producto: string;
  cantidad: number;
  unidad: string;
};

const TOOL_NAME = "extraer_productos";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const profile = await getProfile();
  if (profile?.role !== "jefe_tienda" && profile?.role !== "admin") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const body = await request.json();
  const { foto_base64: fotoBase64, foto_mimetype: fotoMimetype } = body;
  if (!fotoBase64) {
    return NextResponse.json({ error: "foto_base64 es requerido" }, { status: 400 });
  }

  let categorias;
  try {
    categorias = await getCatalogoFood();
  } catch (e) {
    return NextResponse.json({ error: "No se pudo cargar el catálogo: " + (e as Error).message }, { status: 500 });
  }

  const catalogoTexto = categorias
    .map((c) => `${c.value}: ${c.productos.map((p) => p.nombre).join(", ")}`)
    .join("\n");

  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      tools: [
        {
          name: TOOL_NAME,
          description: "Lista de productos detectados en la foto de la guía de despacho",
          input_schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    texto_detectado: {
                      type: "string",
                      description: "Texto tal como aparece en la guía (nombre del producto y cantidad)",
                    },
                    categoria: {
                      type: "string",
                      description: "Valor EXACTO de la categoría del catálogo si hay un match confiable, o string vacío si no",
                    },
                    producto: {
                      type: "string",
                      description: "Nombre EXACTO del producto del catálogo si hay un match confiable, o string vacío si no",
                    },
                    cantidad: { type: "number", description: "Cantidad recibida de ese producto" },
                    unidad: { type: "string", description: "Unidad tal como aparece en la guía (un, kg, caja, etc.)" },
                  },
                  required: ["texto_detectado", "categoria", "producto", "cantidad", "unidad"],
                },
              },
            },
            required: ["items"],
          },
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: fotoMimetype || "image/jpeg",
                data: fotoBase64,
              },
            },
            {
              type: "text",
              text: `Esta es una foto de una guía de despacho de productos que llegaron a una heladería. Extrae CADA línea de producto con su cantidad recibida, incluso si la foto está borrosa, inclinada o con mala luz — haz tu mejor esfuerzo, nunca devuelvas la lista vacía si se alcanza a distinguir aunque sea una tabla o listado de productos.

Para cada línea detectada, intenta hacer match contra este catálogo real de productos (formato "CATEGORIA: producto1, producto2, ..."):

${catalogoTexto}

Reglas:
- Si el producto de la guía corresponde con confianza a uno del catálogo (aunque el nombre no sea idéntico letra por letra), usa el valor EXACTO de "categoria" y "producto" tal como aparecen arriba.
- Si NO hay un match confiable (producto no está en el catálogo, no estás seguro, o es un insumo/materia prima que no aparece en este catálogo), deja "categoria" y "producto" como string vacío "" — igual incluye "texto_detectado" y "cantidad" para que una persona lo revise a mano. Es preferible incluir una línea sin match confiable a omitirla.
- No inventes productos que no aparecen en la foto.
- Si la cantidad aparece como un check/marca (✓) en vez de un número, usa 1 como cantidad.
- Si el número de cantidad es difícil de leer, usa tu mejor estimación — es mejor una estimación aproximada que omitir la línea.
- Ignora columnas de precio, código interno o total — solo interesa el nombre del producto y la cantidad recibida.`,
            },
          ],
        },
      ],
    });

    const toolUse = resp.content.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json({ error: "No se pudo interpretar la foto" }, { status: 502 });
    }

    const items = ((toolUse.input as { items?: ItemDetectado[] }).items ?? []).filter(
      (it) => it.texto_detectado && Number(it.cantidad) > 0
    );

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ error: "Error al leer la foto: " + (e as Error).message }, { status: 500 });
  }
}
