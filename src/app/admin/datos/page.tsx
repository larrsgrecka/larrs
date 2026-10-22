"use client";

import { useState, useRef } from "react";

export default function DatosPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [result, setResult] = useState<{
    total: number;
    leidas: number;
    formato: "facturas" | "pedidos";
    periodo: { desde: string; hasta: string };
    porTienda: Record<string, number>;
    avisos?: {
      pedidosAbiertos: number; sinFecha: number; repetidasEnElArchivo: number;
      skusSinGrupo: string[]; destinosIgnorados: string[];
      reemplazadas?: number; conservadas?: number; copiasRepetidas?: number;
    };
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  // El nombre del archivo vive en el estado y no se lee del input al dibujar:
  // leer la ref durante el render no vuelve a dibujar, así que el recuadro
  // seguía diciendo "haz clic para seleccionar" con el archivo ya elegido.
  const [nombreArchivo, setNombreArchivo] = useState("");
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
            Sube el reporte que exporta Grecka, en .xlsx o .csv. Sirven los dos:
            el de facturas (trae grupo y marca) y el de pedidos (el que puedes
            sacar tú). El de pedidos manda sobre el período que cubre: lo que
            vuelve a traer reemplaza lo que había, y lo que no trae se conserva.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-slate-400 transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              <div className="text-3xl mb-2">📊</div>
              <p className="text-sm text-gray-500">
                {nombreArchivo || "Haz clic para seleccionar el archivo"}
              </p>
              <p className="text-xs text-gray-300 mt-1">Archivos .xlsx o .csv</p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(e) => {
                  setStatus("idle");
                  setNombreArchivo(e.target.files?.[0]?.name ?? "");
                }}
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
              <p className="text-sm font-bold text-green-700">
                ✓ {result.total.toLocaleString()} registros importados
              </p>
              <p className="text-xs text-green-600 mb-3">
                Reporte de {result.formato === "pedidos" ? "pedidos" : "facturas"} ·{" "}
                {result.periodo.desde} a {result.periodo.hasta} · {result.leidas.toLocaleString()} líneas leídas
              </p>
              <div className="space-y-1">
                {Object.entries(result.porTienda).map(([tienda, count]) => (
                  <div key={tienda} className="flex justify-between text-xs text-green-600">
                    <span>{tienda}</span>
                    <span className="font-semibold">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>

              {/* Lo que el archivo no pudo contar se dice acá. Una importación
                  que calla lo que dejó afuera es la que después aparece como un
                  número raro en la proyección, sin nada que lo explique. */}
              {result.avisos && (
                <ul className="mt-3 space-y-1 border-t border-green-200 pt-3 text-xs text-green-700">
                  {result.avisos.reemplazadas ? (
                    <li>
                      Reemplazó {result.avisos.reemplazadas.toLocaleString()} líneas que ya
                      estaban del mismo período
                      {result.avisos.conservadas
                        ? `, y conservó ${result.avisos.conservadas.toLocaleString()} que este reporte no trae (notas de crédito, repuestos).`
                        : "."}
                    </li>
                  ) : null}
                  {result.avisos.copiasRepetidas ? (
                    <li>
                      Eliminó {result.avisos.copiasRepetidas.toLocaleString()} copias que
                      habían quedado repetidas de una carga anterior.
                    </li>
                  ) : null}
                  {result.avisos.pedidosAbiertos > 0 && (
                    <li>
                      Dejó fuera {result.avisos.pedidosAbiertos} línea
                      {result.avisos.pedidosAbiertos === 1 ? "" : "s"} de pedidos todavía no
                      facturados (&quot;Abierto&quot;).
                    </li>
                  )}
                  {result.avisos.sinFecha > 0 && (
                    <li>{result.avisos.sinFecha} líneas sin fecha legible quedaron fuera.</li>
                  )}
                  {result.avisos.skusSinGrupo.length > 0 && (
                    <li>
                      {result.avisos.skusSinGrupo.length} producto
                      {result.avisos.skusSinGrupo.length === 1 ? "" : "s"} sin grupo conocido
                      (nunca se compraron antes): {result.avisos.skusSinGrupo.slice(0, 8).join(", ")}
                      {result.avisos.skusSinGrupo.length > 8 ? "…" : ""}. No entran en la
                      proyección hasta que se clasifiquen.
                    </li>
                  )}
                  {result.avisos.destinosIgnorados.length > 0 && (
                    <li>Destinos que no son tienda de Larrs: {result.avisos.destinosIgnorados.join(", ")}.</li>
                  )}
                </ul>
              )}
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
          <p>Cada vez que tengas el reporte actualizado. Puedes subir el mismo archivo varias veces sin duplicar nada, y conviene pedirlo desde el 1 de enero para que una sola carga arregle todo el año.</p>
        </div>
      </div>
    </div>
  );
}
