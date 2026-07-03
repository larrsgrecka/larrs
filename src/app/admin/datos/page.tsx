"use client";

import { useState, useRef } from "react";

export default function DatosPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [result, setResult] = useState<{ total: number; porTienda: Record<string, number> } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setStatus("loading");
    setResult(null);
    setErrorMsg("");

    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/upload-ventas", { method: "POST", body: fd });
    const json = await res.json();

    if (!res.ok || json.error) {
      setStatus("error");
      setErrorMsg(json.error || "Error desconocido");
    } else {
      setStatus("ok");
      setResult(json);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div
        className="px-6 pt-10 pb-6"
        style={{ background: "linear-gradient(135deg, #111418, #1e293b)" }}
      >
        <div className="mx-auto max-w-lg flex items-center justify-between">
          <div>
            <img
              src="https://heladerialarrs.cl/cdn/shop/t/2/assets/logo-footer.png?v=41616879924709803011609269083"
              alt="Larrs"
              className="h-9 w-auto mb-2"
            />
            <p className="text-sm font-bold text-white">Importar datos Grecka</p>
          </div>
          <a href="/admin" className="text-xs text-blue-300 hover:underline">← Admin</a>
        </div>
      </div>

      <div className="mx-auto w-full max-w-lg px-4 py-8 space-y-5">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-sm font-bold text-slate-700 mb-1">Archivo de ventas Grecka → Larrs</h2>
          <p className="text-xs text-gray-400 mb-5">
            Sube el Excel exportado desde el sistema de Grecka. Los datos nuevos se agregan automáticamente — los existentes no se duplican.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-slate-400 transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              <div className="text-3xl mb-2">📊</div>
              <p className="text-sm text-gray-500">
                {inputRef.current?.files?.[0]?.name || "Haz clic para seleccionar el archivo .xlsx"}
              </p>
              <p className="text-xs text-gray-300 mt-1">Solo archivos .xlsx</p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={() => setStatus("idle")}
              />
            </div>

            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full rounded-xl bg-slate-800 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50 transition-colors"
            >
              {status === "loading" ? "Procesando..." : "Importar datos"}
            </button>
          </form>

          {status === "ok" && result && (
            <div className="mt-4 rounded-xl bg-green-50 border border-green-200 p-4">
              <p className="text-sm font-bold text-green-700 mb-2">
                ✓ {result.total.toLocaleString()} registros importados
              </p>
              <div className="space-y-1">
                {Object.entries(result.porTienda).map(([tienda, count]) => (
                  <div key={tienda} className="flex justify-between text-xs text-green-600">
                    <span>{tienda}</span>
                    <span className="font-semibold">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-600">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-700 space-y-1">
          <p className="font-bold">¿Cuándo subir?</p>
          <p>Cada vez que Grecka te envíe el reporte actualizado. Los datos se acumulan — puedes subir el mismo archivo varias veces sin duplicar.</p>
        </div>
      </div>
    </div>
  );
}
