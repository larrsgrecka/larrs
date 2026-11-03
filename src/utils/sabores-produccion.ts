// Lee el CSV real de producción (mismo Apps Script que ya usa /produccion)
// y extrae solo los nombres de sabores terminados (columnas con "#;" en el
// header) — Bases ("$;") y PreRecetas/insumos ("[;") quedan fuera, igual
// que en produccion.html.
import { getOverrides } from "@/utils/catalogo-overrides";

function parseCsvFirstLine(text: string): string[] {
  const rows: string[][] = [];
  let inQ = false, cur = "", fields: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      fields.push(cur); cur = "";
    } else if (ch === "\n" && !inQ) {
      fields.push(cur); cur = "";
      rows.push(fields);
      fields = [];
      break; // solo necesitamos la primera fila (headers)
    } else {
      cur += ch;
    }
  }
  if (rows.length === 0 && (cur || fields.length)) {
    fields.push(cur);
    rows.push(fields);
  }
  return rows[0] || [];
}

function nombreSabor(header: string): string {
  const cutBracket = header.includes("[") ? header.indexOf("[") : header.length;
  const cutHash = header.includes("#") ? header.indexOf("#") : header.length;
  return header.slice(0, Math.min(cutBracket, cutHash)).trim();
}

// La planilla usa columnas separadoras ("---", "----") para agrupar visualmente
// los sabores, y traen "#;" igual que los de verdad. Sin esto aparecen como
// sabores en Vitrina, Pesaje y el catalogo: nombres que nadie puede pesar ni
// reconocer.
function esSeparador(nombre: string): boolean {
  return !/[a-z0-9]/i.test(nombre);
}

let cache: { sabores: string[]; ts: number } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;
// Normalmente hay ~166 sabores — si el fetch trae bastante menos, no fue el
// CSV real (Apps Script caído, página de error, redirect, etc.), fue una
// falla disfrazada de éxito. No hay que cachear eso ni devolverlo como si
// fuera la lista completa (rompería Vitrina/Pesaje/Inventario Food a la vez).
const MIN_SABORES_ESPERADOS = 50;

async function getSaboresBase(forzarRelectura = false): Promise<string[]> {
  if (!forzarRelectura && cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.sabores;

  const url = process.env.PRODUCCION_APPS_SCRIPT_URL;
  const token = process.env.PRODUCCION_APPS_SCRIPT_TOKEN;
  if (!url || !token) throw new Error("Apps Script de producción no configurado");

  const resp = await fetch(`${url}?token=${encodeURIComponent(token)}`);
  const text = await resp.text();
  const headers = parseCsvFirstLine(text);

  const sabores = headers
    .filter((h) => h.includes("#;"))
    .map(nombreSabor)
    .filter((n) => !esSeparador(n))
    .sort((a, b) => a.localeCompare(b));

  if (sabores.length < MIN_SABORES_ESPERADOS) {
    console.error(
      `[sabores-produccion] Fetch sospechoso: solo ${sabores.length} sabores (esperados ${MIN_SABORES_ESPERADOS}+). ` +
      `HTTP ${resp.status}, primeros 200 chars: ${text.slice(0, 200)}`
    );
    if (cache) return cache.sabores; // sirve el cache viejo (aunque esté vencido) antes que una lista vacía
    throw new Error("El CSV de producción no devolvió sabores válidos (falla temporal del Apps Script)");
  }

  cache = { sabores, ts: Date.now() };
  return sabores;
}

// Solo los sabores que EXISTEN como columna en la planilla, sin los overrides
// que un admin haya agregado a mano: son los únicos nombres en los que el Apps
// Script puede escribir un pesaje (busca la columna por nombre exacto).
export async function getSaboresEnPlanilla(forzarRelectura = false): Promise<string[]> {
  return getSaboresBase(forzarRelectura);
}

// Para comparar nombres tipeados a mano: ignora mayúsculas, tildes, espacios y
// puntuación ("Limón Sicilia (S/A)" === "limon sicilia s/a").
export function normalizarSabor(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function distancia(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

// El sabor de la planilla más parecido a uno que no existe, para poder sugerir
// "¿quisiste decir...?" en vez de solo decir que no se encontró. Un typo de una
// o dos letras cae acá; un nombre realmente distinto no.
export function sugerirSabor(nombre: string, enPlanilla: string[]): string | null {
  const objetivo = normalizarSabor(nombre);
  if (!objetivo) return null;
  let mejor: string | null = null;
  let mejorDist = Infinity;
  for (const candidato of enPlanilla) {
    const d = distancia(objetivo, normalizarSabor(candidato));
    if (d < mejorDist) { mejorDist = d; mejor = candidato; }
  }
  const tolerancia = Math.max(2, Math.floor(objetivo.length * 0.2));
  return mejor && mejorDist <= tolerancia ? mejor : null;
}

function resolverContra(enPlanilla: string[], nombres: string[]) {
  const exactos = new Set(enPlanilla);
  const porNorm = new Map(enPlanilla.map((n) => [normalizarSabor(n), n]));

  const canonico: Record<string, string> = {};
  const faltantes: { sabor: string; sugerencia: string | null }[] = [];
  for (const nombre of nombres) {
    const resuelto = exactos.has(nombre) ? nombre : porNorm.get(normalizarSabor(nombre));
    if (resuelto) canonico[nombre] = resuelto;
    else faltantes.push({ sabor: nombre, sugerencia: sugerirSabor(nombre, enPlanilla) });
  }
  return { canonico, faltantes };
}

// Traduce los nombres que llegan del panel (vitrina, overrides, texto viejo) al
// nombre exacto de la columna de la planilla. Lo que no tiene columna no se
// puede guardar: se devuelve aparte para avisarlo, en vez de dejar que el Apps
// Script rechace el pesaje completo por un solo nombre mal escrito.
export async function resolverSaboresEnPlanilla(nombres: string[]): Promise<{
  canonico: Record<string, string>;
  faltantes: { sabor: string; sugerencia: string | null }[];
}> {
  const tsAntes = cache?.ts ?? 0;
  const resultado = resolverContra(await getSaboresEnPlanilla(), nombres);
  if (!resultado.faltantes.length) return resultado;

  // Acabar de crear la columna en la planilla y que el panel diga "no existe"
  // durante media hora es peor que releer: el cache de 30 min era justo lo que
  // pasaba con "Chocolate suizo". Antes de negar un sabor se relee la planilla
  // una vez — solo si lo anterior salio del cache, para no pagar dos veces los
  // ~7s del CSV.
  if (cache?.ts !== tsAntes) return resultado;
  console.log(
    `[sabores-produccion] "${resultado.faltantes.map((f) => f.sabor).join('", "')}" no estaba en el cache; releyendo la planilla`
  );
  return resolverContra(await getSaboresEnPlanilla(true), nombres);
}

// Los admins pueden agregar/excluir sabores puntuales sin tocar código vía
// /catalogo (ver catalogo-overrides.ts). El CSV de producción es lento de
// leer (~7s, planilla grande) — se corre en paralelo con los overrides en
// vez de encadenarlos, para no sumar tiempo extra a un fetch ya lento.
export async function getSaboresProduccion(): Promise<string[]> {
  const [base, { incluir, excluirNombres }] = await Promise.all([
    getSaboresBase(),
    getOverrides("sabores"),
  ]);

  const conExclusiones = base.filter((s) => !excluirNombres.has(s));
  for (const ov of incluir) {
    if (!conExclusiones.includes(ov.nombre)) conExclusiones.push(ov.nombre);
  }
  return conExclusiones.sort((a, b) => a.localeCompare(b));
}
