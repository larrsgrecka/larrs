import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { logout } from "./login/actions";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const admin = profile?.role === "admin";

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <div
        className="px-6 pt-12 pb-20 text-center"
        style={{ background: "linear-gradient(135deg, #111418, #1e293b)" }}
      >
        <img
          src="https://heladerialarrs.cl/cdn/shop/t/2/assets/logo-footer.png?v=41616879924709803011609269083"
          alt="Heladería Larrs"
          className="mx-auto mb-5 h-12 w-auto"
        />
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Paneles Larrs
        </h1>
        <p className="mt-1 text-sm text-white/60">
          Producción · Pedidos · Gestión
        </p>
      </div>

      {/* Cards */}
      <div className="-mt-8 mx-auto w-full max-w-sm flex-1 px-4">
        <div className="flex flex-col gap-3">
          <Link
            href="/produccion"
            className="block overflow-hidden rounded-2xl shadow-lg transition-transform active:scale-[0.98]"
          >
            <div className="flex items-center gap-4 bg-white p-5">
              <span className="text-3xl">🍦</span>
              <div className="flex-1">
                <p className="text-lg font-bold text-slate-800">Producción</p>
                <p className="text-sm text-gray-500">
                  Kg producidos, merma, sabores y costos
                </p>
              </div>
              <span className="text-xl text-gray-400">›</span>
            </div>
          </Link>

          <Link
            href="/ventas"
            className="block overflow-hidden rounded-2xl shadow-lg transition-transform active:scale-[0.98]"
          >
            <div className="flex items-center gap-4 bg-white p-5">
              <span className="text-3xl">📈</span>
              <div className="flex-1">
                <p className="text-lg font-bold text-slate-800">Ventas</p>
                <p className="text-sm text-gray-500">
                  Ventas diarias, presupuesto y cumplimiento
                </p>
              </div>
              <span className="text-xl text-gray-400">›</span>
            </div>
          </Link>

          <Link
            href="/analisis-ventas"
            className="block overflow-hidden rounded-2xl shadow-lg transition-transform active:scale-[0.98]"
          >
            <div className="flex items-center gap-4 bg-white p-5">
              <span className="text-3xl">📊</span>
              <div className="flex-1">
                <p className="text-lg font-bold text-slate-800">Análisis de ventas</p>
                <p className="text-sm text-gray-500">
                  Comparativo mensual y anual por tienda
                </p>
              </div>
              <span className="text-xl text-gray-400">›</span>
            </div>
          </Link>

          <Link
            href="/pedidos"
            className="block overflow-hidden rounded-2xl shadow-md transition-transform active:scale-[0.98]"
          >
            <div className="flex items-center gap-4 bg-slate-700 p-5">
              <span className="text-3xl">📦</span>
              <div className="flex-1 text-white">
                <p className="text-lg font-bold">Pedidos sugeridos</p>
                <p className="text-sm text-white/70">
                  Pedido semanal a Grecka por tienda · copiar para SAP
                </p>
              </div>
              <span className="text-xl text-white/40">›</span>
            </div>
          </Link>

          <Link
            href="/mermas"
            className="block overflow-hidden rounded-2xl shadow-lg transition-transform active:scale-[0.98]"
          >
            <div className="flex items-center gap-4 bg-white p-5">
              <span className="text-3xl">⚠️</span>
              <div className="flex-1">
                <p className="text-lg font-bold text-slate-800">Mermas</p>
                <p className="text-sm text-gray-500">
                  Registro de mermas puntuales por tienda
                </p>
              </div>
              <span className="text-xl text-gray-400">›</span>
            </div>
          </Link>

          {admin && (
            <Link
              href="/admin"
              className="block overflow-hidden rounded-2xl shadow-sm transition-transform active:scale-[0.98]"
            >
              <div className="flex items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <span className="text-3xl">👥</span>
                <div className="flex-1 text-gray-700">
                  <p className="font-bold">Administrar usuarios</p>
                  <p className="text-sm text-gray-400">
                    Crear, editar y eliminar accesos
                  </p>
                </div>
                <span className="text-xl text-gray-300">›</span>
              </div>
            </Link>
          )}
        </div>

        <div className="mt-8 pb-8 text-center">
          <p className="mb-3 text-xs text-gray-400">
            {profile?.name || user.email}
          </p>
          <a href="/cuenta" className="text-xs text-gray-400 hover:text-gray-600 hover:underline block mb-2">
            Cambiar contraseña
          </a>
          <form action={logout}>
            <button className="text-sm text-gray-400 hover:text-gray-600 hover:underline">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
