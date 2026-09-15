// Última copia buena de cada lectura externa, guardada en Supabase.
//
// Los Apps Script de Google fallan seguido y de forma intermitente: medido hoy,
// 3 de 6 llamadas seguidas al de Inventario Food respondieron 404 —y cada 404
// tarda 30 s en llegar, así que reintentar dentro de la misma request no
// alcanza—. Hasta ahora esas fallas llegaban al usuario como "Sin datos" o como
// un error en pantalla, aunque el dato de hace diez minutos estuviera perfecto.
//
// El caché en memoria que ya tienen algunas rutas no cubre esto: vive en la
// instancia serverless que atendió la llamada, así que se pierde en cada deploy
// y no lo comparten las demás instancias. Esta copia es común a todas y
// sobrevive a los deploys.
//
// La regla de siempre: una lectura fallida nunca puede pasar por un dato
// legítimo. Por eso la copia viaja con su antigüedad, para que el panel pueda
// decir "esto es de hace 10 minutos" en vez de presentarlo como actual.

import { createAdminClient } from "@/utils/supabase/admin";

const TABLA = "cache_lecturas";

export type Copia<T> = { datos: T; edadMs: number };

export async function leerCopia<T>(clave: string): Promise<Copia<T> | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from(TABLA)
      .select("datos, actualizado_en")
      .eq("clave", clave)
      .maybeSingle();
    if (error || !data) return null;
    return {
      datos: data.datos as T,
      edadMs: Date.now() - new Date(data.actualizado_en).getTime(),
    };
  } catch {
    // Que falle el respaldo no puede romper a quien lo consulta: es una red de
    // seguridad, no una dependencia.
    return null;
  }
}

export async function guardarCopia(clave: string, datos: unknown): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase
      .from(TABLA)
      .upsert({ clave, datos, actualizado_en: new Date().toISOString() }, { onConflict: "clave" });
  } catch (e) {
    console.error(`[cache-persistente] no se pudo guardar "${clave}":`, e);
  }
}

export type ResultadoConRespaldo<T> = {
  datos: T;
  /** true cuando la lectura falló y esto viene de la copia guardada. */
  desdeRespaldo: boolean;
  /** Antigüedad de la copia, solo cuando desdeRespaldo es true. */
  edadMs?: number;
  /** Qué falló, para poder mostrarlo junto al dato viejo. */
  error?: string;
};

export async function conRespaldo<T>(
  clave: string,
  leer: () => Promise<T>,
  opciones: { esGuardable?: (datos: T) => boolean } = {}
): Promise<ResultadoConRespaldo<T>> {
  // Por defecto no se guarda cualquier cosa: un resultado vacío suele ser una
  // falla disfrazada, y pisar la copia buena con eso sería peor que no tener
  // copia — el respaldo quedaría inservible justo cuando hace falta.
  const { esGuardable = (d: T) => d !== null && d !== undefined && (!Array.isArray(d) || d.length > 0) } = opciones;

  try {
    const datos = await leer();
    if (esGuardable(datos)) await guardarCopia(clave, datos);
    return { datos, desdeRespaldo: false };
  } catch (e) {
    const copia = await leerCopia<T>(clave);
    if (!copia) throw e;
    return {
      datos: copia.datos,
      desdeRespaldo: true,
      edadMs: copia.edadMs,
      error: (e as Error).message,
    };
  }
}

/** "hace 12 minutos", para explicarle al usuario qué tan viejo es el dato. */
export function antiguedadEnPalabras(edadMs: number): string {
  const min = Math.round(edadMs / 60000);
  if (min < 1) return "hace menos de un minuto";
  if (min < 60) return `hace ${min} ${min === 1 ? "minuto" : "minutos"}`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} ${h === 1 ? "hora" : "horas"}`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}
