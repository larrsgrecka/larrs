// Datos de personas desde BUK (remuneraciones): dotación, costo laboral,
// ausencias y vacaciones. Complementa a GeoVictoria, que cubre el marcaje
// diario: acá está lo contractual y lo que cuesta.
//
// Todo verificado contra la API real, porque varias cosas no se deducen:
//
// - La instancia "martina" tiene tres empresas (Cristiano Ferrero SPA, que son
//   las heladerías Lärrs; Grecka; Martina). Sumarlas daría un costo laboral de
//   $152 millones cuando las heladerías son $33 millones, así que todo se
//   filtra a Cristiano Ferrero.
// - Los parámetros que parecen filtros y no lo son: `start_date`/`end_date` en
//   absences y `process` en accounting se ignoran en silencio y devuelven el
//   histórico completo desde 2022 como si fuera el período pedido. Los que sí
//   filtran son `from`/`to` y `process_id`. En vacations no filtra ninguno, así
//   que ahí el rango se aplica en memoria.
// - accounting es lento de verdad: 25-40 s por consulta. Por eso va por
//   process_id (una por local, en paralelo) y con caché por proceso.

const BASE = "https://martina.buk.cl/api/v1/chile";

// Las heladerías Lärrs facturan como Cristiano Ferrero SPA; Grecka y Martina
// son del mismo grupo pero otro negocio.
const EMPRESA_LARRS = 1;

type Pagina<T> = { pagination: { total_pages: number; count: number }; data: T[] };

async function bukGet<T = unknown>(
  path: string,
  opciones: { timeoutMs?: number; intentos?: number } = {}
): Promise<Pagina<T>> {
  const token = process.env.BUK_AUTH_TOKEN;
  if (!token) throw new Error("Falta BUK_AUTH_TOKEN");

  const { timeoutMs = 60_000, intentos = 3 } = opciones;
  let ultimoError = "";

  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const resp = await fetch(`${BASE}/${path}`, {
        headers: { auth_token: token, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const texto = await resp.text();

      if (!resp.ok) {
        // Sin token válido la API responde 401 con el string "no_authorize",
        // que es JSON válido: si solo mirásemos data llegaríamos a "0
        // empleados" en vez de a un error de credenciales.
        ultimoError = `BUK respondió HTTP ${resp.status}: ${texto.slice(0, 120)}`;
        if (resp.status === 401 || resp.status === 403) {
          // Un 401 acá tiene dos causas que se arreglan distinto: el token mal
          // copiado en el entorno, o la lista blanca de IPs de BUK, que no deja
          // entrar a Vercel porque no tiene IP fija. La huella del token —largo
          // y extremos, nunca el valor— distingue una de la otra sin tener que
          // ir a mirar la variable.
          const huella = `${token.length} caracteres, ${token.slice(0, 2)}…${token.slice(-2)}`;
          ultimoError +=
            ` — el token configurado tiene ${huella}. Si coincide con el de BUK, entonces la API está ` +
            `rechazando la IP: hay que revisar la lista blanca de IPs de la API key (Vercel no tiene IP fija).`;
          break;  // reintentar no ayuda
        }
      } else {
        const datos = JSON.parse(texto);
        if (datos && Array.isArray(datos.errors)) {
          throw new Error(`BUK rechazó la consulta: ${datos.errors.join("; ")}`);
        }
        if (!datos || !Array.isArray(datos.data)) {
          throw new Error(`BUK devolvió una respuesta sin datos para ${path}`);
        }
        return datos as Pagina<T>;
      }
    } catch (e) {
      ultimoError = (e as Error).message;
      if (ultimoError.includes("rechazó la consulta")) throw e;
    }
    if (intento < intentos) await new Promise((r) => setTimeout(r, 1500 * intento));
  }
  throw new Error(ultimoError || `No se pudo leer ${path} de BUK`);
}

async function bukTodo<T = unknown>(path: string, pageSize = 100): Promise<T[]> {
  const sep = path.includes("?") ? "&" : "?";
  const filas: T[] = [];
  let pagina = 1;
  let total = 1;
  while (pagina <= total) {
    const p = await bukGet<T>(`${path}${sep}page_size=${pageSize}&page=${pagina}`);
    total = p.pagination.total_pages;
    filas.push(...p.data);
    pagina++;
    if (pagina > 30) break;  // tope de seguridad: nada acá tiene 3.000 filas
  }
  return filas;
}

// ─── tipos de lo que devuelve BUK (solo los campos que usamos) ───

type Area = {
  id: number; name: string; cost_center?: string;
  parent_area?: { id: number; name: string } | null;
};

type Job = {
  company_id?: number; area_id?: number; cost_center?: string;
  contract_type?: string; weekly_hours?: number; start_date?: string;
  base_wage?: number;
};

type Empleado = {
  id: number; rut: string; full_name: string; status: string;
  active_since?: string; active_until?: string; termination_reason?: string;
  current_job?: Job;
};

type Ausencia = {
  id: number; employee_id: number; type: string; status: string;
  start_date: string; end_date: string; licence_type?: string;
};

type Vacacion = {
  id: number; employee_id: number; working_days: number; calendar_days: number;
  start_date: string; end_date: string; status: string; type?: string;
};

type Proceso = { id: number; name: string; process_type: string; status: string; payment_date?: string };

type ItemContable = {
  description: string; amount: number; entry_type: string;
  cost_center?: string; employee_rut?: string;
};

// ─── cachés en memoria ───
// Las áreas y el maestro cambian poco; la contabilidad de un mes cerrado no
// cambia nunca, y como cada consulta cuesta ~30 s es la que más importa.

const TTL_AREAS = 30 * 60 * 1000;
const TTL_MAESTRO = 30 * 60 * 1000;
const TTL_CONTABILIDAD = 12 * 60 * 60 * 1000;

let cacheAreas: { datos: Area[]; ts: number } | null = null;
let cacheMaestro: { datos: Empleado[]; ts: number } | null = null;
const cacheContabilidad = new Map<number, { items: ItemContable[]; ts: number }>();

async function getAreas(): Promise<Area[]> {
  if (cacheAreas && Date.now() - cacheAreas.ts < TTL_AREAS) return cacheAreas.datos;
  const datos = await bukTodo<Area>("areas");
  cacheAreas = { datos, ts: Date.now() };
  return datos;
}

async function getMaestro(): Promise<Empleado[]> {
  if (cacheMaestro && Date.now() - cacheMaestro.ts < TTL_MAESTRO) return cacheMaestro.datos;
  // Incluye a quienes ya no trabajan: aparecen en la nómina del mes en que se
  // fueron y sirven para contar salidas.
  const datos = await bukTodo<Empleado>("employees");
  cacheMaestro = { datos, ts: Date.now() };
  return datos;
}

const esDeLarrs = (e: Empleado) => e.current_job?.company_id === EMPRESA_LARRS;

// El resto del sistema (vitrina, producción, GeoVictoria) usa el nombre pelado
// de la tienda; en BUK el área es "Local Costanera" y cuelga de un área padre.
function localDeArea(area?: Area): string {
  const nombre = area?.parent_area?.name || area?.name || "";
  return nombre.replace(/^Local\s+/i, "").trim() || "Sin área";
}

async function mapaLocales() {
  const areas = await getAreas();
  const porId = new Map(areas.map((a) => [a.id, a]));
  const porCentroDeCosto = new Map<string, string>();
  for (const a of areas) {
    if (a.cost_center) porCentroDeCosto.set(a.cost_center, localDeArea(a));
  }
  return {
    porAreaId: (id?: number) => localDeArea(id ? porId.get(id) : undefined),
    porCentroDeCosto: (cc?: string) => (cc && porCentroDeCosto.get(cc)) || cc || "Sin centro de costo",
  };
}

const antiguedadEnAnios = (desde?: string) =>
  desde ? Math.round(((Date.now() - new Date(desde).getTime()) / (365.25 * 24 * 3600 * 1000)) * 10) / 10 : null;

// ─── dotación ───

export async function dotacionPorLocal() {
  const [maestro, locales] = await Promise.all([getMaestro(), mapaLocales()]);
  const activos = maestro.filter((e) => esDeLarrs(e) && e.status === "activo");

  const porLocal = new Map<string, {
    local: string; personas: number; contratos: Record<string, number>;
    horasSemanalesTotales: number; antiguedadPromedioAnios: number | null;
    nombres: { nombre: string; contrato?: string; horasSemanales?: number; desde?: string; antiguedadAnios: number | null }[];
  }>();

  for (const e of activos) {
    const local = locales.porAreaId(e.current_job?.area_id);
    if (!porLocal.has(local)) {
      porLocal.set(local, { local, personas: 0, contratos: {}, horasSemanalesTotales: 0, antiguedadPromedioAnios: null, nombres: [] });
    }
    const g = porLocal.get(local)!;
    g.personas++;
    const contrato = e.current_job?.contract_type || "sin contrato registrado";
    g.contratos[contrato] = (g.contratos[contrato] || 0) + 1;
    g.horasSemanalesTotales += e.current_job?.weekly_hours || 0;
    g.nombres.push({
      nombre: e.full_name,
      contrato: e.current_job?.contract_type,
      horasSemanales: e.current_job?.weekly_hours,
      desde: e.active_since,
      antiguedadAnios: antiguedadEnAnios(e.active_since),
    });
  }

  for (const g of porLocal.values()) {
    const conAnt = g.nombres.map((n) => n.antiguedadAnios).filter((a): a is number => a !== null);
    g.antiguedadPromedioAnios = conAnt.length
      ? Math.round((conAnt.reduce((s, a) => s + a, 0) / conAnt.length) * 10) / 10
      : null;
  }

  return {
    empresa: "Cristiano Ferrero SPA (heladerías Lärrs)",
    totalActivos: activos.length,
    locales: [...porLocal.values()].sort((a, b) => b.personas - a.personas),
    nota: "Solo personal de Cristiano Ferrero SPA. La instancia de BUK también tiene Grecka y Martina, que son otro negocio y quedan fuera a propósito. No incluye sueldos individuales: para eso está el costo laboral por local.",
  };
}

// ─── movimientos de personal ───

export async function movimientosDePersonal(desde: string, hasta: string) {
  const [maestro, locales] = await Promise.all([getMaestro(), mapaLocales()]);
  const deLarrs = maestro.filter(esDeLarrs);
  const dentro = (f?: string) => !!f && f >= desde && f <= hasta;

  const entradas = deLarrs.filter((e) => dentro(e.active_since)).map((e) => ({
    nombre: e.full_name, local: locales.porAreaId(e.current_job?.area_id), fecha: e.active_since,
  }));
  const salidas = deLarrs.filter((e) => dentro(e.active_until)).map((e) => ({
    nombre: e.full_name, local: locales.porAreaId(e.current_job?.area_id), fecha: e.active_until,
    motivo: e.termination_reason || "sin motivo registrado",
  }));

  return { periodo: { desde, hasta }, entradas, salidas, resumen: `${entradas.length} ingresos y ${salidas.length} salidas` };
}

// ─── ausencias y licencias ───

export async function ausenciasYLicencias(desde: string, hasta: string) {
  // from/to filtra por solapamiento: trae también la licencia que empezó antes
  // y sigue vigente, que es lo que uno quiere saber.
  const [filas, maestro, locales] = await Promise.all([
    bukTodo<Ausencia>(`absences?from=${desde}&to=${hasta}`),
    getMaestro(),
    mapaLocales(),
  ]);

  const porId = new Map(maestro.map((e) => [e.id, e]));
  const detalle = filas
    .map((a) => {
      const e = porId.get(a.employee_id);
      return { a, e };
    })
    .filter(({ e }) => e && esDeLarrs(e))
    .map(({ a, e }) => ({
      persona: e!.full_name,
      local: locales.porAreaId(e!.current_job?.area_id),
      tipo: a.type === "licence" ? "licencia médica" : a.type === "paid_leave" ? "permiso con goce" : "ausencia",
      motivo: a.licence_type || "",
      desde: a.start_date,
      hasta: a.end_date,
      dias: Math.round((new Date(a.end_date).getTime() - new Date(a.start_date).getTime()) / 86400000) + 1,
    }));

  const porLocal: Record<string, { eventos: number; dias: number }> = {};
  for (const d of detalle) {
    porLocal[d.local] = porLocal[d.local] || { eventos: 0, dias: 0 };
    porLocal[d.local].eventos++;
    porLocal[d.local].dias += d.dias;
  }

  return {
    periodo: { desde, hasta },
    total: detalle.length,
    porLocal,
    detalle: detalle.sort((a, b) => a.desde.localeCompare(b.desde)),
    nota: "Incluye eventos que empezaron antes del período pero siguen vigentes dentro de él. Solo personal de Cristiano Ferrero SPA.",
  };
}

// ─── vacaciones ───

export async function vacaciones(desde: string, hasta: string) {
  // Acá from/to no filtra (verificado: devuelve desde 2021), así que se trae
  // todo y se corta en memoria. Son ~700 filas, no es caro.
  const [filas, maestro, locales] = await Promise.all([
    bukTodo<Vacacion>("vacations"),
    getMaestro(),
    mapaLocales(),
  ]);

  const porId = new Map(maestro.map((e) => [e.id, e]));
  const seSolapa = (v: Vacacion) => v.start_date <= hasta && v.end_date >= desde;

  const detalle = filas
    .filter(seSolapa)
    .map((v) => ({ v, e: porId.get(v.employee_id) }))
    .filter(({ e }) => e && esDeLarrs(e))
    .map(({ v, e }) => ({
      persona: e!.full_name,
      local: locales.porAreaId(e!.current_job?.area_id),
      desde: v.start_date,
      hasta: v.end_date,
      diasHabiles: v.working_days,
      diasCorridos: v.calendar_days,
      tipo: v.type || "",
      estado: v.status,
    }));

  const porLocal: Record<string, number> = {};
  for (const d of detalle) porLocal[d.local] = (porLocal[d.local] || 0) + d.diasHabiles;

  return {
    periodo: { desde, hasta },
    total: detalle.length,
    diasHabilesPorLocal: porLocal,
    detalle: detalle.sort((a, b) => a.desde.localeCompare(b.desde)),
  };
}

// ─── costo laboral ───

async function itemsDelProceso(procesoId: number, mes: number, anio: number): Promise<ItemContable[]> {
  const enCache = cacheContabilidad.get(procesoId);
  if (enCache && Date.now() - enCache.ts < TTL_CONTABILIDAD) return enCache.items;

  // Una consulta por proceso tarda 25-40 s; sin process_id son 4 páginas y más
  // de dos minutos. El timeout es alto a propósito: cortar antes solo
  // significaría no tener el dato.
  const pagina = await bukGet<{ items?: ItemContable[] }>(
    `accounting?month=${mes}&year=${anio}&process_id=${procesoId}`,
    { timeoutMs: 55_000, intentos: 1 }
  );
  const items = pagina.data.flatMap((r) => r.items || []);
  cacheContabilidad.set(procesoId, { items, ts: Date.now() });
  return items;
}

export async function costoLaboralPorLocal(mes: number, anio: number) {
  const procesos = await bukTodo<Proceso>(
    `process?date=${anio}-${String(mes).padStart(2, "0")}-01`
  );

  // Los procesos no traen la empresa, solo el nombre ("Lärrs - Costanera"), así
  // que se preseleccionan por nombre y después se verifica por RUT contra el
  // maestro: si algún ítem no es de Cristiano Ferrero se informa aparte en vez
  // de sumarse sin que nadie lo note.
  const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const deLarrs = procesos.filter((p) => sinTildes(p.name).includes("larrs"));
  const usados = deLarrs.length ? deLarrs : procesos;

  const [maestro, locales] = await Promise.all([getMaestro(), mapaLocales()]);
  const rutsLarrs = new Set(maestro.filter(esDeLarrs).map((e) => e.rut));

  const resultados = await Promise.allSettled(
    usados.map(async (p) => ({ proceso: p, items: await itemsDelProceso(p.id, mes, anio) }))
  );

  const porLocal = new Map<string, { local: string; costo: number; personas: Set<string>; conceptos: Record<string, number> }>();
  const procesosSinDatos: string[] = [];
  let montoDeOtraEmpresa = 0;

  resultados.forEach((r, i) => {
    if (r.status === "rejected") {
      procesosSinDatos.push(`${usados[i].name}: ${(r.reason as Error).message}`);
      return;
    }
    for (const it of r.value.items) {
      if (it.entry_type !== "debit") continue;  // el débito es el gasto; el haber es su contrapartida
      if (it.employee_rut && !rutsLarrs.has(it.employee_rut)) {
        montoDeOtraEmpresa += it.amount;
        continue;
      }
      const local = locales.porCentroDeCosto(it.cost_center);
      if (!porLocal.has(local)) porLocal.set(local, { local, costo: 0, personas: new Set(), conceptos: {} });
      const g = porLocal.get(local)!;
      g.costo += it.amount;
      if (it.employee_rut) g.personas.add(it.employee_rut);
      g.conceptos[it.description] = (g.conceptos[it.description] || 0) + it.amount;
    }
  });

  const locales_ = [...porLocal.values()]
    .map((g) => ({
      local: g.local,
      costo: Math.round(g.costo),
      personas: g.personas.size,
      costoPorPersona: g.personas.size ? Math.round(g.costo / g.personas.size) : null,
      principalesConceptos: Object.entries(g.conceptos)
        .sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([concepto, monto]) => ({ concepto, monto: Math.round(monto) })),
    }))
    .sort((a, b) => b.costo - a.costo);

  return {
    periodo: `${String(mes).padStart(2, "0")}/${anio}`,
    empresa: "Cristiano Ferrero SPA (heladerías Lärrs)",
    costoTotal: locales_.reduce((s, l) => s + l.costo, 0),
    locales: locales_,
    procesos: usados.map((p) => ({ nombre: p.name, estado: p.status, pago: p.payment_date })),
    procesosSinDatos,
    montoDeOtraEmpresaExcluido: Math.round(montoDeOtraEmpresa),
    nota:
      "Costo empresa del mes (débitos de la centralización contable: sueldos, gratificación, aportes patronales), no el líquido pagado. " +
      (procesosSinDatos.length
        ? "ATENCIÓN: faltan locales en este total, ver procesosSinDatos — el total está incompleto."
        : "Todos los locales del mes están incluidos."),
  };
}
