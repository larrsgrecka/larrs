import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile, isAdmin } from "@/utils/auth";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const profile = await getProfile();
  const tienda =
    (profile?.role === "jefe_tienda" || profile?.role === "operador") && profile.tienda
      ? profile.tienda
      : null;
  const esOperador = profile?.role === "operador";

  const inject = `<script>window._LARRS_TIENDA=${JSON.stringify(tienda)};window._LARRS_IS_ADMIN=${isAdmin(profile)};window._LARRS_IS_OPERADOR=${esOperador};window._LARRS_NOMBRE_PERFIL=${JSON.stringify(profile?.name || "")};</script>
<script src="/larrs-nav.js" defer></script>`;

  let html = readFileSync(
    join(process.cwd(), "src", "panels", "produccion-pesaje.html"),
    "utf8"
  );
  html = html.replace("<body>", `<body>\n${inject}`);

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
