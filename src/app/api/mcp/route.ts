import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import {
  stockYFaltantes, produccionPorSemana, topSabores, ultimosPesajes,
  cumplimientoPorTienda, ultimosConteosDeInventario, ventasPorProducto,
} from "@/utils/mcp-datos";

// Servidor MCP: expone los datos de Larrs como herramientas para Claude, así se
// pueden preguntar desde el celular ("¿qué le falta reponer a Dominicos?") sin
// abrir un panel. Devuelve las mismas cuentas que los paneles —no las planillas
// crudas— porque el valor está en el cálculo, no en la hoja.
//
// Cada herramienta lee Apps Scripts de Google y Supabase, que en frío tardan
// decenas de segundos.
export const maxDuration = 60;

const TIENDAS = ["Costanera", "Dominicos", "Trapenses"] as const;
const tienda = z.enum(TIENDAS).optional().describe("Tienda; si se omite, todas");

const responder = (datos: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(datos, null, 1) }],
});

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "stock_y_que_reponer",
      {
        title: "Stock y qué reponer",
        description:
          "Qué productos están bajo el mínimo sugerido y cuántas unidades faltan para llegar a ese mínimo, " +
          "por tienda. El mínimo sale de la venta histórica real, no de un umbral cargado a mano. " +
          "Sirve para armar un pedido o revisar qué falta.",
        inputSchema: z.object({
          tienda,
          soloBajoMinimo: z.boolean().optional().describe("Por defecto true; false devuelve todo el catálogo"),
        }),
      },
      async ({ tienda, soloBajoMinimo }) => responder(await stockYFaltantes({ tienda, soloBajoMinimo }))
    );

    server.registerTool(
      "produccion_por_semana",
      {
        title: "Producción por semana",
        description:
          "Kg de helado producidos por semana y por tienda, de la más reciente hacia atrás. " +
          "Los kg se imputan a la fecha de recuento que declara quien carga, que puede ser de días antes.",
        inputSchema: z.object({
          tienda,
          semanas: z.number().int().min(1).max(20).optional().describe("Cuántas semanas hacia atrás (default 4)"),
        }),
      },
      async ({ tienda, semanas }) => responder(await produccionPorSemana({ tienda, semanas }))
    );

    server.registerTool(
      "top_sabores",
      {
        title: "Sabores más producidos",
        description: "Ranking de sabores por kg producidos, con su porcentaje del total.",
        inputSchema: z.object({
          tienda,
          desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha desde, formato aaaa-mm-dd"),
          limite: z.number().int().min(1).max(50).optional(),
        }),
      },
      async ({ tienda, desde, limite }) => responder(await topSabores({ tienda, desde, limite }))
    );

    server.registerTool(
      "ultimos_pesajes",
      {
        title: "Últimos pesajes cargados",
        description:
          "Pesajes recientes con la fecha de la producción, cuándo se cargaron, quién los cargó y los kg por sabor. " +
          "Sirve para revisar si una carga entró y con qué fecha quedó imputada.",
        inputSchema: z.object({ tienda, limite: z.number().int().min(1).max(50).optional() }),
      },
      async ({ tienda, limite }) => responder(await ultimosPesajes({ tienda, limite }))
    );

    server.registerTool(
      "cumplimiento_por_tienda",
      {
        title: "Quién está al día",
        description:
          "Última fecha de registro de cada tienda en cada módulo (mermas, inventario food, pesaje, recepción) " +
          "y cuántos días lleva sin registrar. Si una fuente falla, se informa aparte: un dato faltante no es lo " +
          "mismo que una tienda que no registró.",
        inputSchema: z.object({}),
      },
      async () => responder(await cumplimientoPorTienda())
    );

    server.registerTool(
      "ultimos_conteos_inventario",
      {
        title: "Últimos conteos de Inventario Food",
        description:
          "El último conteo por producto y ubicación (barra/bodega), con su fecha. Es una foto del último " +
          "conteo manual, no un saldo corrido con entradas y salidas.",
        inputSchema: z.object({ tienda }),
      },
      async ({ tienda }) => responder(await ultimosConteosDeInventario({ tienda }))
    );

    server.registerTool(
      "ventas_por_producto",
      {
        title: "Ventas por producto",
        description:
          "Unidades vendidas por producto, con precio promedio y venta estimada. Se puede filtrar por tienda y " +
          "por mes (aaaa-mm); devuelve además los meses disponibles.",
        inputSchema: z.object({
          tienda,
          mes: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("Mes, formato aaaa-mm"),
          limite: z.number().int().min(1).max(100).optional(),
        }),
      },
      async ({ tienda, mes, limite }) => responder(await ventasPorProducto({ tienda, mes, limite }))
    );
  },
  { serverInfo: { name: "larrs", version: "1.0.0" } }
);

// Comparación en tiempo constante: un compare normal filtra el token carácter a
// carácter según cuánto tarda en fallar.
function tokenValido(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Este endpoint queda expuesto a internet con todos los datos del negocio, así
// que sin token no se responde nada (required: true).
const protegido = withMcpAuth(
  handler,
  async (req, bearer) => {
    const esperado = process.env.MCP_TOKEN;
    if (!esperado) {
      console.error("[mcp] falta MCP_TOKEN: el servidor MCP queda cerrado");
      return undefined;
    }
    // El header Authorization es la vía correcta. El ?token= es un respaldo para
    // clientes que solo permiten pegar una URL: funciona igual, pero el secreto
    // queda escrito en los logs de acceso, así que conviene el header cuando el
    // cliente lo permita.
    const recibido = bearer || new URL(req.url).searchParams.get("token") || "";
    if (!recibido || !tokenValido(recibido, esperado)) return undefined;
    return { token: recibido, clientId: "larrs-claude", scopes: ["larrs:leer"] };
  },
  { required: true }
);

// withMcpAuth responde 401 si no viene el header Authorization, sin llegar a
// verificar nada, así que el token de la URL se traslada al header antes de
// delegarle. El body se copia explícitamente: reusar el Request original con
// otros headers no es fiable una vez que hay stream de entrada.
async function conAuth(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tokenEnUrl = url.searchParams.get("token");

  if (!request.headers.get("authorization") && tokenEnUrl) {
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${tokenEnUrl}`);
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();
    return protegido(new Request(url, { method: request.method, headers, body }));
  }

  return protegido(request);
}

export { conAuth as GET, conAuth as POST, conAuth as DELETE };
