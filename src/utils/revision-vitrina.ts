// Revisión de vitrina por foto: el jefe de local fotografía la vitrina y el
// sistema le dice qué falta, qué sobra y qué está sin identificar.
//
// Nace de una revisión hecha a mano sobre fotos de Trapenses: contra los 24
// slots configurados aparecieron cinco sabores que no estaban en la vitrina,
// cuatro que estaban sin figurar en el sistema y dos cubetas rotuladas solo
// "Novedad", que al cliente no le dicen nada. Eso es lo que automatiza esto.
//
// La comparación la hace el modelo y no un emparejado de texto a propósito: los
// carteles del local están escritos para el cliente y el sistema usa el nombre
// de producción — "Mascarpone Amarena" contra "Mascarpone Vet. Guinda",
// "Limón" contra "Limon 40". Ningún parecido de strings resuelve eso; leer los
// dos nombres y decidir si son lo mismo, sí.

import Anthropic from "@anthropic-ai/sdk";
import { fetchAppsScriptJson, urlAppsScript } from "@/utils/apps-script";
import { getStockMinimos } from "@/utils/stock-minimos";
import { guardarCopia, leerCopia, antiguedadEnPalabras } from "@/utils/cache-persistente";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type TipoVitrina = "helados" | "pasteleria";

export type Foto = { base64: string; mimetype?: string };

export type ResultadoRevision = {
  tienda: string;
  tipo: TipoVitrina;
  revisadoEn: string;
  revisadoPor: string;
  /** Lo que el sistema esperaba encontrar. */
  esperados: number;
  presentes: string[];
  /** "seguro" = no está; "dudoso" = no se pudo confirmar en la foto. */
  faltantes: { esperado: string; certeza: "seguro" | "dudoso"; nota: string }[];
  /** Está en la vitrina pero el sistema no lo tiene. */
  noEsperados: { cartel: string; nota: string }[];
  /** Cubetas o bandejas sin cartel legible: el cliente no sabe qué compra. */
  sinNombre: { descripcion: string }[];
  observaciones: string;
  /** Cuando el modelo se queda sin espacio, el resultado está incompleto. */
  incompleto: boolean;
};

// ─── qué debería haber ───

async function saboresConfigurados(tienda: string): Promise<string[]> {
  const url = process.env.VITRINA_APPS_SCRIPT_URL;
  const token = process.env.VITRINA_APPS_SCRIPT_TOKEN;
  if (!url || !token) throw new Error("Apps Script de vitrina no configurado");

  const data = await fetchAppsScriptJson(urlAppsScript(url, token, { tienda }), { servicio: "Vitrina" });
  if (!data.ok) throw new Error(String(data.error || "No se pudo leer la vitrina"));

  // El Apps Script devuelve el historial completo: vale la fila más reciente de
  // cada slot, que es la configuración vigente.
  const porSlot = new Map<number, { sabor: string; ts: string }>();
  for (const it of (data.items ?? []) as { tienda?: string; slot?: number; sabor?: string; actualizado_en?: string }[]) {
    if (String(it.tienda || "").toLowerCase() !== tienda.toLowerCase()) continue;
    const slot = Number(it.slot);
    if (!slot) continue;
    const ts = String(it.actualizado_en || "");
    const previo = porSlot.get(slot);
    if (!previo || ts > previo.ts) porSlot.set(slot, { sabor: String(it.sabor || ""), ts });
  }

  return [...porSlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v.sabor)
    .filter(Boolean);
}

const CATEGORIAS_DE_VITRINA = /pasteler|paniader|panader|galleter|boller/i;

async function productosDePasteleria(tienda: string): Promise<string[]> {
  // Se compara contra lo que esa tienda efectivamente maneja —los productos con
  // mínimo calculado— y no contra el catálogo entero: media pastelería del
  // catálogo no se vende en todos los locales, y marcarla como faltante sería
  // ruido que tapa lo que importa.
  const items = await getStockMinimos();
  return [...new Set(
    items
      .filter((i) => i.tienda === tienda && CATEGORIAS_DE_VITRINA.test(i.categoria))
      .map((i) => i.producto)
  )].sort();
}

export async function loQueDeberiaHaber(tienda: string, tipo: TipoVitrina): Promise<string[]> {
  return tipo === "helados" ? saboresConfigurados(tienda) : productosDePasteleria(tienda);
}

// ─── la revisión ───

const TOOL = "comparar_vitrina";

export async function revisarVitrina(opciones: {
  tienda: string;
  tipo: TipoVitrina;
  fotos: Foto[];
  revisadoPor: string;
}): Promise<ResultadoRevision> {
  const { tienda, tipo, fotos, revisadoPor } = opciones;
  if (!fotos.length) throw new Error("Hace falta al menos una foto");

  const esperados = await loQueDeberiaHaber(tienda, tipo);
  if (!esperados.length) {
    throw new Error(
      tipo === "helados"
        ? `No hay vitrina configurada para ${tienda}: hay que cargarla en el módulo Vitrina antes de revisarla.`
        : `No hay productos de pastelería con mínimo calculado para ${tienda}.`
    );
  }

  const queEs = tipo === "helados"
    ? "una vitrina de helados artesanales, donde cada cubeta tiene un cartel negro con el nombre del sabor"
    : "una vitrina de pastelería y panadería, donde cada bandeja tiene un cartelito con el nombre del producto y el precio";

  const instrucciones = `Estas fotos son de ${queEs} de la heladería Lärrs, local ${tienda}.

Esta es la lista de lo que el sistema dice que DEBERÍA estar en esa vitrina:

${esperados.map((e, i) => `${i + 1}. ${e}`).join("\n")}

Compará las fotos contra esa lista y devolvé el resultado con la herramienta.

Reglas:
- Los carteles del local están escritos para el cliente y la lista usa el nombre interno de producción, así que muchas veces NO coinciden palabra por palabra. Son el mismo producto si se refieren a lo mismo: "Limón" y "Limon 40", "Vainilla Francesa" y "Vainilla French", "Mascarpone Amarena" y "Mascarpone Vet. Guinda", "Cookies and cream" y "Cookies & Cream (Fior Di Panna)". Usá criterio, no comparación literal.
- En "presentes" van los nombres de la lista que sí se ven.
- En "faltantes" va cada elemento de la lista que no se ve. La certeza importa y hay que usar las dos etiquetas: "seguro" cuando el producto no aparece y las fotos muestran la zona donde tendría que estar; "dudoso" solo cuando haya un motivo concreto —la vitrina quedó cortada por el borde, el cartel está tapado, ilegible o de espaldas, hay reflejo encima—. No marques todo como dudoso por precaución: si las fotos cubren la vitrina y el producto no está, es "seguro", y decirlo es justamente para lo que sirve esta revisión. Un "seguro" equivocado manda a alguien a buscar algo que está; un "dudoso" de más hace que la revisión no sirva para nada.
- Las notas, cortas: quince palabras como máximo.
- En "noEsperados" va lo que se ve en la vitrina y no está en la lista, con el texto del cartel.
- En "sinNombre" va cada cubeta o bandeja con producto pero sin cartel legible, o rotulada de forma que no identifica el producto (por ejemplo "Novedad"). Describila para que alguien la ubique: color, posición, qué parece.
- No inventes: si una zona de la vitrina no se ve, decilo en observaciones.`;

  const contenido: Anthropic.ContentBlockParam[] = [
    ...fotos.map((f) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: (f.mimetype || "image/jpeg") as "image/jpeg", data: f.base64 },
    })),
    { type: "text" as const, text: instrucciones },
  ];

  // Streaming por el tope alto de salida: una vitrina de 24 cubetas más la
  // pastelería genera listas largas, y fue exactamente un max_tokens corto lo
  // que rompió la lectura de guías en Recepción.
  const resp = await anthropic.messages.stream({
    model: "claude-opus-5",
    max_tokens: 16000,
    tools: [{
      name: TOOL,
      description: "Resultado de comparar la vitrina fotografiada contra lo que el sistema espera",
      input_schema: {
        type: "object",
        properties: {
          presentes: {
            type: "array",
            description: "Nombres de la lista del sistema que sí se ven en la vitrina",
            items: { type: "string" },
          },
          faltantes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                esperado: { type: "string" },
                certeza: {
                  type: "string",
                  enum: ["seguro", "dudoso"],
                  description: "seguro: la vitrina se ve bien y el producto no está. dudoso: la foto no permite confirmarlo (zona cortada, cartel ilegible, reflejo)",
                },
                nota: { type: "string", description: "Máximo 15 palabras" },
              },
              required: ["esperado", "certeza", "nota"],
            },
          },
          noEsperados: {
            type: "array",
            items: {
              type: "object",
              properties: {
                cartel: { type: "string" },
                nota: { type: "string", description: "Dónde está y qué parece ser" },
              },
              required: ["cartel", "nota"],
            },
          },
          sinNombre: {
            type: "array",
            items: {
              type: "object",
              properties: { descripcion: { type: "string" } },
              required: ["descripcion"],
            },
          },
          observaciones: { type: "string", description: "Lo que no se alcanza a ver, o cualquier cosa rara" },
        },
        required: ["presentes", "faltantes", "noEsperados", "sinNombre", "observaciones"],
      },
    }],
    tool_choice: { type: "tool", name: TOOL },
    messages: [{ role: "user", content: contenido }],
  }).finalMessage();

  const bloque = resp.content.find((b) => b.type === "tool_use" && b.name === TOOL);
  if (!bloque || bloque.type !== "tool_use") {
    throw new Error(
      resp.stop_reason === "max_tokens"
        ? "La vitrina tiene demasiados productos y la lectura se cortó."
        : "No se pudo interpretar la foto de la vitrina."
    );
  }

  const datos = bloque.input as Omit<ResultadoRevision, "tienda" | "tipo" | "revisadoEn" | "revisadoPor" | "esperados" | "incompleto">;

  const resultado: ResultadoRevision = {
    tienda,
    tipo,
    revisadoEn: new Date().toISOString(),
    revisadoPor,
    esperados: esperados.length,
    presentes: datos.presentes ?? [],
    faltantes: datos.faltantes ?? [],
    noEsperados: datos.noEsperados ?? [],
    sinNombre: datos.sinNombre ?? [],
    observaciones: datos.observaciones ?? "",
    incompleto: resp.stop_reason === "max_tokens",
  };

  // Queda guardada la última revisión de cada tienda y tipo, para poder saber
  // hace cuánto que nadie mira la vitrina de un local.
  await guardarCopia(`revision-vitrina:${tienda}:${tipo}`, resultado);

  console.log(
    `[revision-vitrina] ${tienda}/${tipo} por ${revisadoPor}:`,
    `${resultado.presentes.length}/${esperados.length} presentes,`,
    `${resultado.faltantes.length} faltantes, ${resultado.noEsperados.length} no esperados,`,
    `${resultado.sinNombre.length} sin nombre`
  );

  return resultado;
}

// ─── historial ───

const TIENDAS = ["Costanera", "Dominicos", "Trapenses"];

export async function ultimasRevisiones(tienda?: string) {
  const tiendas = tienda ? [tienda] : TIENDAS;
  const out: {
    tienda: string; tipo: TipoVitrina; hace: string; revisadoEn: string;
    revisadoPor: string; faltantes: number; noEsperados: number; sinNombre: number;
  }[] = [];

  for (const t of tiendas) {
    for (const tipo of ["helados", "pasteleria"] as TipoVitrina[]) {
      const copia = await leerCopia<ResultadoRevision>(`revision-vitrina:${t}:${tipo}`);
      if (!copia) continue;
      out.push({
        tienda: t,
        tipo,
        hace: antiguedadEnPalabras(copia.edadMs),
        revisadoEn: copia.datos.revisadoEn,
        revisadoPor: copia.datos.revisadoPor,
        faltantes: copia.datos.faltantes.length,
        noEsperados: copia.datos.noEsperados.length,
        sinNombre: copia.datos.sinNombre.length,
      });
    }
  }

  const sinRevisar = tiendas.flatMap((t) =>
    (["helados", "pasteleria"] as TipoVitrina[])
      .filter((tipo) => !out.some((r) => r.tienda === t && r.tipo === tipo))
      .map((tipo) => ({ tienda: t, tipo }))
  );

  return { revisiones: out, sinRevisarNunca: sinRevisar };
}
