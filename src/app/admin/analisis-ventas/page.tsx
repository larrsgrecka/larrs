"use client";

import { useState, useRef } from "react";

type Periodo = { anio: number; mes: number } | null;
type Resultado = { filasArticulo: number; filasGrupo: number; desde: Periodo; hasta: Periodo };

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function fmtPeriodo(p: Periodo) {
  if (!p) return "—";
  return `${MESES[p.mes]} ${p.anio}`;
}

export default function AnalisisVentasAdminPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [result, setResult] = useState<Resultado | null>(null);
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

    const res = await fetch("/api/upload-ventas-tienda", { method: "POST", body: fd });
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
            <p className="text-sm font-bold text-white">Importar ventas por tienda</p>
          </div>
          <a href="/admin" className="text-xs text-blue-300 hover:underline">← Admin</a>
        </div>
      </div>

      <div className="mx-auto w-full max-w-lg px-4 py-8 space-y-5">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-sm font-bold text-slate-700 mb-1">Excel de ventas por tienda (SAP)</h2>
          <p className="text-xs text-gray-400 mb-5">
            Sube el .xlsx con el detalle transaccional (Nombre de almacén, Fecha, Artículo, Nombre de grupo, Cantidad, Neto). Se agrega automáticamente por tienda, artículo/grupo y mes — re-subir un mes actualiza los valores.
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
              <p className="text-xs text-gray-300 mt-1">Solo archivos .xlsx — puede tardar unos minutos si es un archivo grande</p>
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
              {status === "loading" ? "Procesando... (puede tardar)" : "Importar datos"}
            </button>
          </form>

          {status === "ok" && result && (
            <div className="mt-4 rounded-xl bg-green-50 border border-green-200 p-4 text-sm text-green-700 space-y-1">
              <p className="font-bold">✓ Importación completa</p>
              <p>{result.filasArticulo.toLocaleString()} filas por artículo · {result.filasGrupo.toLocaleString()} filas por grupo</p>
              <p>Rango: {fmtPeriodo(result.desde)} → {fmtPeriodo(result.hasta)}</p>
            </div>
          )}

          {status === "error" && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-600">
              {errorMsg}
              {errorMsg.toLowerCase().includes("fetch") && (
                <p className="mt-1 text-xs">
                  Si el archivo es muy grande y falla desde el navegador, puedes subirlo desde la terminal con:
                  <br />
                  <code>curl -F &quot;file=@archivo.xlsx&quot; https://tu-dominio/api/upload-ventas-tienda</code>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-700 space-y-1">
          <p className="font-bold">¿Cuándo subir?</p>
          <p>Cada vez que tengas un extracto nuevo de ventas por tienda. Los meses ya cargados se actualizan (no se duplican).</p>
        </div>
      </div>
    </div>
  );
}
