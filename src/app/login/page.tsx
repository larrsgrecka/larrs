import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header oscuro con logo Larrs */}
      <div
        className="px-6 pt-14 pb-24 text-center"
        style={{ background: "linear-gradient(135deg, #111418, #1e293b)" }}
      >
        <img
          src="https://heladerialarrs.cl/cdn/shop/t/2/assets/logo-footer.png?v=41616879924709803011609269083"
          alt="Heladería Larrs"
          className="mx-auto mb-5 h-14 w-auto"
        />
        <h1 className="text-xl font-bold text-white">Paneles Larrs</h1>
        <p className="mt-1 text-sm text-white/60">Solo personal autorizado</p>
      </div>

      {/* Tarjeta blanca flotante */}
      <div className="-mt-10 flex-1 rounded-t-3xl bg-white px-6 pt-8 pb-8 shadow-2xl">
        <div className="mx-auto max-w-sm">
          {error && (
            <p className="mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {decodeURIComponent(error)}
            </p>
          )}
          <form action={login} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Correo
              </label>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 focus:border-slate-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 focus:border-slate-700 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl py-3.5 font-semibold text-white transition-colors"
              style={{ background: "#1e293b" }}
            >
              Ingresar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
