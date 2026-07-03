import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getProfile, isAdmin } from "@/utils/auth";
import { logout } from "@/app/login/actions";
import { createUser, updateUser } from "./actions";
import { DeleteButton } from "./DeleteButton";

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  const okMsg = params.ok ? `✓ ${decodeURIComponent(params.ok)} actualizado correctamente` : null;
  const errMsg = params.err ? decodeURIComponent(params.err) : null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  if (!isAdmin(profile)) redirect("/");

  // Listar usuarios
  const admin = createAdminClient();
  const { data: { users } } = await admin.auth.admin.listUsers();
  const { data: profiles } = await supabase.from("profiles").select("id, name, role, tienda");
  const profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));

  const userList = users.map((u) => ({
    id: u.id,
    email: u.email ?? "",
    name: profileMap[u.id]?.name ?? u.email ?? "",
    role: profileMap[u.id]?.role ?? "viewer",
    tienda: profileMap[u.id]?.tienda ?? "",
  }));

  // Registro de auditoría (últimas 50 entradas)
  const { data: auditRows } = await supabase
    .from("audit_log")
    .select("id, actor_email, action, target_email, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <div
        className="px-6 pt-10 pb-6"
        style={{ background: "linear-gradient(135deg, #111418, #1e293b)" }}
      >
        <div className="mx-auto max-w-2xl flex items-center justify-between">
          <div>
            <img
              src="https://heladerialarrs.cl/cdn/shop/t/2/assets/logo-footer.png?v=41616879924709803011609269083"
              alt="Larrs"
              className="h-9 w-auto mb-2"
            />
            <p className="text-sm font-bold text-white">Administración de usuarios</p>
          </div>
          <div className="text-right">
            <a href="/" className="text-xs text-blue-300 hover:underline block mb-1">← Inicio</a>
            <form action={logout}>
              <button className="text-xs text-gray-400 hover:underline">Salir</button>
            </form>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 py-6 space-y-6">
        {okMsg && <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm font-medium text-green-700">{okMsg}</div>}
        {errMsg && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-700">⚠ {errMsg}</div>}

        {/* Crear usuario */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Nuevo usuario</h2>
          <form action={createUser} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Correo</label>
                <input name="email" type="email" required className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-slate-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Nombre</label>
                <input name="name" type="text" required className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-slate-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Contraseña</label>
                <input name="password" type="text" required className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-slate-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Rol</label>
                <select name="role" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-slate-400">
                  <option value="viewer">Viewer</option>
                  <option value="jefe_tienda">Jefe de tienda</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Tienda (si es jefe)</label>
                <input name="tienda" type="text" placeholder="ej: Costanera" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-slate-400" />
              </div>
            </div>
            <button type="submit" className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700">
              Crear usuario
            </button>
          </form>
        </div>

        {/* Lista de usuarios */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">Usuarios ({userList.length})</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {userList.map((u) => (
              <details key={u.id} className="group">
                <summary className="flex items-center gap-3 px-5 py-3 cursor-pointer list-none hover:bg-gray-50">
                  <div className="flex-1">
                    <span className="font-medium text-sm text-gray-800">{u.name}</span>
                    <span className="ml-2 text-xs text-gray-400">{u.email}</span>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    u.role === "admin" ? "bg-amber-100 text-amber-700" :
                    u.role === "jefe_tienda" ? "bg-blue-100 text-blue-700" :
                    "bg-gray-100 text-gray-500"
                  }`}>
                    {u.role === "jefe_tienda" ? `Jefe · ${u.tienda || "—"}` : u.role}
                  </span>
                  <span className="text-gray-300 text-sm group-open:rotate-180 transition-transform">▾</span>
                </summary>

                {/* Editar */}
                <div className="px-5 pb-4 pt-1 bg-gray-50 space-y-3">
                  <form action={updateUser} className="space-y-2">
                    <input type="hidden" name="id" value={u.id} />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-400 block mb-0.5">Nombre</label>
                        <input name="name" defaultValue={u.name} className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-0.5">Nueva contraseña</label>
                        <input name="password" type="text" placeholder="(dejar vacío = no cambia)" className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-0.5">Rol</label>
                        <select name="role" defaultValue={u.role} className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm">
                          <option value="viewer">Viewer</option>
                          <option value="jefe_tienda">Jefe de tienda</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-0.5">Tienda</label>
                        <input name="tienda" defaultValue={u.tienda} placeholder="ej: Costanera" className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
                      </div>
                    </div>
                    <button type="submit" className="rounded-lg bg-slate-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
                      Guardar cambios
                    </button>
                  </form>
                  {u.id !== user.id && (
                    <DeleteButton id={u.id} name={u.name} />
                  )}
                </div>
              </details>
            ))}
          </div>
        {/* Importar datos */}
        <a
          href="/admin/datos"
          className="flex items-center gap-4 bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-4 hover:bg-gray-50 transition-colors"
        >
          <span className="text-2xl">📊</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-700">Importar datos Grecka</p>
            <p className="text-xs text-gray-400">Subir Excel de ventas para actualizar el historial</p>
          </div>
          <span className="text-gray-300">›</span>
        </a>

        {/* Registro de auditoría */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
              Registro de actividad
            </h2>
          </div>
          {!auditRows || auditRows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">Sin registros aún.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {auditRows.map((row) => {
                const labels: Record<string, string> = {
                  login: "Inició sesión",
                  logout: "Cerró sesión",
                  create_user: "Creó usuario",
                  update_user: "Editó usuario",
                  delete_user: "Eliminó usuario",
                };
                const colors: Record<string, string> = {
                  login: "text-green-600",
                  logout: "text-gray-400",
                  create_user: "text-blue-600",
                  update_user: "text-amber-600",
                  delete_user: "text-red-500",
                };
                const d = new Date(row.created_at);
                const fecha = d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "2-digit" });
                const hora = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={row.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="text-xs text-gray-300 w-24 shrink-0">{fecha} {hora}</span>
                    <span className="text-xs font-medium text-gray-700 flex-1 truncate">
                      {row.actor_email}
                    </span>
                    <span className={`text-xs font-semibold ${colors[row.action] ?? "text-gray-500"}`}>
                      {labels[row.action] ?? row.action}
                    </span>
                    {row.target_email && (
                      <span className="text-xs text-gray-400 truncate max-w-[140px]">→ {row.target_email}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        </div>
      </div>
    </div>
  );
}
