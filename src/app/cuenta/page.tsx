import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { changePassword } from "./actions";

export default async function CuentaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const { error, ok } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div
        className="px-6 pt-10 pb-20 text-center"
        style={{ background: "linear-gradient(135deg, #111418, #1e293b)" }}
      >
        <img
          src="https://heladerialarrs.cl/cdn/shop/t/2/assets/logo-footer.png?v=41616879924709803011609269083"
          alt="Larrs"
          className="mx-auto mb-4 h-10 w-auto"
        />
        <p className="text-sm font-bold text-white">Mi cuenta</p>
        <p className="mt-1 text-xs text-white/50">{profile?.name || user.email}</p>
      </div>

      <div className="-mt-10 mx-auto w-full max-w-sm px-4">
        <div className="rounded-3xl bg-white shadow-lg px-6 py-7">
          <h2 className="text-base font-bold text-slate-800 mb-5">Cambiar contraseña</h2>

          {ok && (
            <div className="mb-4 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 font-medium">
              Contraseña actualizada correctamente.
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <form action={changePassword} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Contraseña actual
              </label>
              <input
                name="current"
                type="password"
                required
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Nueva contraseña
              </label>
              <input
                name="new"
                type="password"
                required
                minLength={6}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Confirmar nueva contraseña
              </label>
              <input
                name="confirm"
                type="password"
                required
                minLength={6}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:border-slate-400"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-slate-800 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 transition-colors"
            >
              Actualizar contraseña
            </button>
          </form>

          <div className="mt-5 text-center">
            <a href="/" className="text-xs text-gray-400 hover:underline">← Volver al inicio</a>
          </div>
        </div>
      </div>
    </div>
  );
}
