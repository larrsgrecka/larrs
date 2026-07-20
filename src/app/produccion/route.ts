import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
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
  const inject = `<script>window._LARRS_TIENDA=${JSON.stringify(tienda)};</script>
<script src="/larrs-nav.js" defer></script>
<style>.larrs-ventas-sec{display:none!important}</style>`;

  let html = readFileSync(
    join(process.cwd(), "src", "panels", "produccion.html"),
    "utf8"
  );
  html = html.replace("<body>", `<body>\n${inject}`);
  html = html.replace("<title>Producción Larrs</title>", "<title>Producción · Larrs</title>");

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
