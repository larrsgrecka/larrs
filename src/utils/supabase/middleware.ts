import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !request.nextUrl.pathname.startsWith("/login")) {
    // A una llamada de la API se le responde en JSON y no con la página de
    // login. Redirigirla devuelve el HTML del login con estado 200, y el panel
    // que hace resp.json() se cae con "The string did not match the expected
    // pattern": un error que no dice nada y que, en una pantalla de guardado,
    // deja sin saber si el registro quedó o no. Con 401 el panel puede decir
    // "se cerró la sesión, vuelve a entrar", que es lo que de verdad pasó.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Se cerró la sesión. Vuelve a entrar y repite la operación." },
        { status: 401 }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
