// Lee el CSV real de producción (mismo Apps Script que ya usa /produccion)
// y extrae solo los nombres de sabores terminados (columnas con "#;" en el
// header) — Bases ("$;") y PreRecetas/insumos ("[;") quedan fuera, igual
// que en produccion.html.
import { getOverrides } from "@/utils/catalogo-overrides";
import { leerPlanilla, type LecturaPlanilla } from "@/utils/produccion-planilla";

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

// La lectura del CSV, los reintentos y el espejo viven en produccion-planilla:
// acá solo se interpretan los encabezados. Antes este módulo tenía su propio
// fetch y su propio caché de 30 minutos en memoria, y ese caché —que se pierde
// en cada deploy y no lo comparten las instancias— fue lo que hizo que el
// catálogo rechazara "Chocolate suizo" media hora después de crear la columna.
async function leerSabores(
  forzarRelectura = false,
  presupuestoMs?: number
): Promise<{ sabores: string[]; lectura: LecturaPlanilla }> {
  const lectura = await leerPlanilla("csv", { forzar: forzarRelectura, presupuestoMs });
  const sabores = parseCsvFirstLine(lectura.texto)
    .filter((h) => h.includes("#;"))
    .map(nombreSabor)
    .filter((n) => !esSeparador(n))
    .sort((a, b) => a.localeCompare(b));
  return { sabores, lectura };
}

// Solo los sabores que EXISTEN como columna en la planilla, sin los overrides
// que un admin haya agregado a mano: son los únicos nombres en los que el Apps
// Script puede escribir un pesaje (busca la columna por nombre exacto).
export async function getSaboresEnPlanilla(forzarRelectura = false): Promise<string[]> {
  return (await leerSabores(forzarRelectura)).sabores;
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
export async function resolverSaboresEnPlanilla(
  nombres: string[],
  // Presupuesto para TODA la resolución, relectura incluida. Quien llama
  // después tiene que escribir (el pesaje) y los dos tiempos tienen que caber
  // en el minuto de la función.
  opciones: { presupuestoMs?: number } = {}
): Promise<{
  canonico: Record<string, string>;
  faltantes: { sabor: string; sugerencia: string | null }[];
}> {
  const inicio = Date.now();
  const { presupuestoMs } = opciones;
  const restante = () => (presupuestoMs ?? Infinity) - (Date.now() - inicio);

  const { sabores, lectura } = await leerSabores(false, presupuestoMs);
  const resultado = resolverContra(sabores, nombres);
  if (!resultado.faltantes.length) return resultado;

  // Acabar de crear la columna y que el panel diga "no existe" es peor que
  // releer: pasó con "Chocolate suizo". Si lo que miramos no venía recién de
  // Google, el sabor puede ser más nuevo que la copia — así que se relee una
  // vez antes de negarlo. Si ya era una lectura fresca, no existe y punto.
  if (lectura.edadMs === 0) return resultado;
  // Y si no queda tiempo para releer, se devuelve lo que hay: equivocarse
  // diciendo "no existe" es malo, pero matar la función es peor — ahí el
  // usuario no recibe ningún mensaje.
  const MINIMO_PARA_RELEER = 6_000;
  if (restante() < MINIMO_PARA_RELEER) return resultado;

  console.log(
    `[sabores-produccion] "${resultado.faltantes.map((f) => f.sabor).join('", "')}" no está en la copia de hace ${Math.round(lectura.edadMs / 1000)}s; releyendo la planilla`
  );
  const relectura = await leerSabores(true, Math.max(MINIMO_PARA_RELEER, restante()));
  return resolverContra(relectura.sabores, nombres);
}

// Los admins pueden agregar/excluir sabores puntuales sin tocar código vía
// /catalogo (ver catalogo-overrides.ts). El CSV de producción es lento de
// leer (~7s, planilla grande) — se corre en paralelo con los overrides en
// vez de encadenarlos, para no sumar tiempo extra a un fetch ya lento.
export async function getSaboresProduccion(): Promise<string[]> {
  const [base, { incluir, excluirNombres }] = await Promise.all([
    getSaboresEnPlanilla(),
    getOverrides("sabores"),
  ]);

  const conExclusiones = base.filter((s) => !excluirNombres.has(s));
  for (const ov of incluir) {
    if (!conExclusiones.includes(ov.nombre)) conExclusiones.push(ov.nombre);
  }
  return conExclusiones.sort((a, b) => a.localeCompare(b));
}
