import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  // El jefe de local también entra: es quien arma el pedido de su tienda.
  const profile = await getProfile();
  if (profile?.role !== "admin" && profile?.role !== "jefe_tienda") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  let html = readFileSync(join(process.cwd(), "src", "panels", "pedido-sugerido.html"), "utf8");
  html = html.replace("<body>", `<body>\n<script src="/larrs-nav.js" defer></script>`);

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // El HTML cambia en cada release: sin esto el navegador sirve el viejo.
      "Cache-Control": "no-store",
    },
  });
}
