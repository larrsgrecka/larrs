import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // /api/mcp y /api/cron quedan fuera: se autentican con su propio token
    // (Bearer del conector y CRON_SECRET respectivamente), no con la sesión de
    // Supabase. Si pasaran por acá, una petición sin cookie terminaría
    // redirigida a /login: el cliente MCP recibiría HTML en vez de JSON-RPC, y
    // el cron de Vercel se quedaría en el redirect sin ejecutar nunca la tarea.
    "/((?!api/mcp|api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
