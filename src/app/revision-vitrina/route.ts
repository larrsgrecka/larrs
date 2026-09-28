import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const profile = await getProfile();
  if (!profile || !["admin", "jefe_tienda", "operador"].includes(profile.role)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  let html = readFileSync(join(process.cwd(), "src", "panels", "revision-vitrina.html"), "utf8");
  html = html.replace("<body>", `<body>\n<script src="/larrs-nav.js" defer></script>`);

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
