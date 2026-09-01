import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // /api/mcp queda fuera: se autentica con su propio token Bearer, no con la
    // sesión de Supabase. Si pasara por acá, una petición sin cookie terminaría
    // redirigida a /login y el cliente MCP recibiría HTML en vez de JSON-RPC.
    "/((?!api/mcp|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
