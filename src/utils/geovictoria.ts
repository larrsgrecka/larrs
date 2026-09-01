// Asistencia desde GeoVictoria, para poder preguntarla desde Claude junto al
// resto de los datos de Larrs.
//
// La API pide el token con Login y lo devuelve dentro de un JSON ({"token": …}),
// no como texto plano; después va como Bearer. Los identificadores que acepta
// AttendanceBook son los RUT (campo Identifier), en un string separado por
// comas — no la lista de Ids internos, que responde "Bad user's identifiers
// format". Todo verificado contra la API real.

const BASE = "https://customerapi.geovictoria.com/api/v1";

// La API corta en 3 llamadas por segundo, así que las llamadas se espacian.
const ESPERA_ENTRE_LLAMADAS_MS = 400;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// El grupo de GeoVictoria trae el prefijo "Local"; el resto del sistema usa el
// nombre pelado de la tienda.
function tiendaDesdeGrupo(grupo?: string): string {
  const g = (grupo || "").replace(/^Local\s+/i, "").trim();
  return g || "Sin grupo";
}

type Usuario = {
  Id: string; Identifier: string; Enabled: string; Name: string; LastName: string;
  ContractDate?: string; GroupDescription?: string;
};

export type DiaAsistencia = {
  Date: string;
  Punches?: { Type?: string; Date?: string; ShiftPunchType?: string; Origin?: string }[];
  Shifts?: { ShiftDisplay?: string; StartTime?: string; ExitTime?: string }[];
  Delay?: string; EarlyLeave?: string; WorkedHours?: string;
  Absent?: string | boolean; Holiday?: string | boolean; Worked?: string | boolean;
  // Verificado contra la API: AccomplishedExtraTime y AssignedExtraTime llegan
  // como objeto vacío; la hora extra utilizable es TotalAuthorizedOvertime.
  TotalAuthorizedOvertime?: string;
  TimeOffs?: { TimeOffTypeDescription?: string; Description?: string }[];
};

type UsuarioAsistencia = Usuario & {
  PlannedInterval?: DiaAsistencia[];
  TotalWorkedHours?: string; WorkedDays?: string; Absences?: string;
  AbsenceDaysWithoutJustification?: string; AbsenceDaysLicense?: string;
  Vacation?: string; WorkedSundays?: string; WorkedHolidays?: string;
};

let tokenCache: { token: string; ts: number } | null = null;
const TOKEN_TTL_MS = 20 * 60 * 1000;

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.ts < TOKEN_TTL_MS) return tokenCache.token;

  const user = process.env.GEOVICTORIA_API_KEY;
  const pass = process.env.GEOVICTORIA_API_SECRET;
  if (!user || !pass) throw new Error("Faltan GEOVICTORIA_API_KEY / GEOVICTORIA_API_SECRET");

  const resp = await fetch(`${BASE}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ User: user, Password: pass }),
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await resp.text();
  if (!resp.ok) {
    // Credenciales recién creadas tardan en propagarse: el mensaje de la API lo
    // dice y conviene repetirlo tal cual en vez de traducirlo a "error 401".
    throw new Error(`GeoVictoria rechazó las credenciales (${resp.status}): ${texto.slice(0, 120)}`);
  }
  let token: string;
  try {
    token = JSON.parse(texto).token;
  } catch {
    throw new Error("GeoVictoria devolvió una respuesta de login inesperada");
  }
  if (!token) throw new Error("GeoVictoria no devolvió token");
  tokenCache = { token, ts: Date.now() };
  return token;
}

async function llamar<T>(endpoint: string, body: unknown): Promise<T> {
  const token = await getToken();
  const resp = await fetch(`${BASE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`GeoVictoria ${endpoint} respondió ${resp.status}: ${texto.slice(0, 150)}`);
  return JSON.parse(texto) as T;
}

let usuariosCache: { usuarios: Usuario[]; ts: number } | null = null;
const USUARIOS_TTL_MS = 15 * 60 * 1000;

async function getUsuarios(): Promise<Usuario[]> {
  if (usuariosCache && Date.now() - usuariosCache.ts < USUARIOS_TTL_MS) return usuariosCache.usuarios;
  const usuarios = await llamar<Usuario[]>("User/List", {});
  usuariosCache = { usuarios, ts: Date.now() };
  return usuarios;
}

const aFecha = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const soloFecha = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const soloHora = (s: string) => `${s.slice(8, 10)}:${s.slice(10, 12)}`;
const esSi = (v: unknown) => v === true || v === "1" || v === 1 || v === "true";

// "01:30" -> 90 minutos, para poder sumar y ordenar. Tolera cualquier tipo:
// algunos campos de la API llegan como objeto vacío en vez de texto.
function aMinutos(valor?: unknown): number {
  const m = String(valor ?? "").match(/^(\d+):(\d+)/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

// TotalWorkedHours no viene en HH:MM sino en horas decimales ("18.0666…"),
// a diferencia del resto de los campos de tiempo.
function horasDecimalesAMinutos(valor?: unknown): number {
  const n = Number(String(valor ?? "").trim());
  return Number.isFinite(n) ? Math.round(n * 60) : 0;
}
const enHoras = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

async function libro(desde: string, hasta: string, tienda?: string) {
  const usuarios = await getUsuarios();
  const habilitados = usuarios.filter((u) => String(u.Enabled) === "1");
  if (habilitados.length === 0) return { usuarios: [] as UsuarioAsistencia[], totalHabilitados: 0 };

  await espera(ESPERA_ENTRE_LLAMADAS_MS);
  const data = await llamar<{ Users: UsuarioAsistencia[] }>("AttendanceBook", {
    StartDate: `${desde}000000`,
    EndDate: `${hasta}235959`,
    UserIds: habilitados.map((u) => u.Identifier).join(","),
  });

  let lista = data.Users ?? [];
  if (tienda) {
    const buscada = tienda.toLowerCase();
    lista = lista.filter((u) => tiendaDesdeGrupo(u.GroupDescription).toLowerCase() === buscada);
  }
  return { usuarios: lista, totalHabilitados: habilitados.length };
}

export async function asistenciaDelDia(opts: { fecha?: string; tienda?: string } = {}) {
  const dia = (opts.fecha || aFecha(new Date())).replace(/-/g, "");
  const { usuarios } = await libro(dia, dia, opts.tienda);

  const personas = usuarios.map((u) => {
    const d = (u.PlannedInterval || [])[0];
    const marcajes = (d?.Punches || []).map((p) => ({
      tipo: p.ShiftPunchType || p.Type || "",
      hora: p.Date ? soloHora(p.Date) : "",
      origen: p.Origin || "",
    }));
    return {
      persona: `${u.Name} ${u.LastName}`.trim(),
      tienda: tiendaDesdeGrupo(u.GroupDescription),
      turno: d?.Shifts?.[0]?.ShiftDisplay || "sin turno asignado",
      marcajes,
      marco: marcajes.length > 0,
      atraso: d?.Delay && d.Delay !== "00:00" ? d.Delay : null,
      salidaAnticipada: d?.EarlyLeave && d.EarlyLeave !== "00:00" ? d.EarlyLeave : null,
      horasTrabajadas: d?.WorkedHours || null,
      ausente: esSi(d?.Absent),
      permiso: d?.TimeOffs?.[0]?.TimeOffTypeDescription || null,
    };
  });

  return {
    fecha: soloFecha(dia),
    personas: personas.sort((a, b) => a.tienda.localeCompare(b.tienda) || a.persona.localeCompare(b.persona)),
    resumen: {
      conTurno: personas.filter((p) => p.turno !== "sin turno asignado").length,
      marcaron: personas.filter((p) => p.marco).length,
      sinMarcar: personas.filter((p) => !p.marco && p.turno !== "sin turno asignado" && !p.ausente).length,
      conAtraso: personas.filter((p) => p.atraso).length,
      conPermiso: personas.filter((p) => p.permiso).length,
    },
    nota: "Un turno sin marcaje puede ser alguien que todavía no llegó, no necesariamente una ausencia.",
  };
}

export async function atrasosYAusencias(opts: { desde: string; hasta: string; tienda?: string }) {
  const desde = opts.desde.replace(/-/g, "");
  const hasta = opts.hasta.replace(/-/g, "");
  const { usuarios } = await libro(desde, hasta, opts.tienda);

  const personas = usuarios.map((u) => {
    const dias = u.PlannedInterval || [];
    const minutosAtraso = dias.reduce((s, d) => s + aMinutos(d.Delay), 0);
    return {
      persona: `${u.Name} ${u.LastName}`.trim(),
      tienda: tiendaDesdeGrupo(u.GroupDescription),
      diasConAtraso: dias.filter((d) => aMinutos(d.Delay) > 0).length,
      atrasoTotal: enHoras(minutosAtraso),
      minutosAtraso,
      salidasAnticipadas: dias.filter((d) => aMinutos(d.EarlyLeave) > 0).length,
      ausenciasSinJustificar: Number(u.AbsenceDaysWithoutJustification || 0),
      diasDeLicencia: Number(u.AbsenceDaysLicense || 0),
      diasDeVacaciones: Number(u.Vacation || 0),
      diasTrabajados: Number(u.WorkedDays || 0),
    };
  }).sort((a, b) => b.minutosAtraso - a.minutosAtraso);

  return {
    periodo: { desde: soloFecha(desde), hasta: soloFecha(hasta) },
    personas,
    resumen: {
      atrasoTotalDelEquipo: enHoras(personas.reduce((s, p) => s + p.minutosAtraso, 0)),
      personasConAlgunAtraso: personas.filter((p) => p.minutosAtraso > 0).length,
      ausenciasSinJustificar: personas.reduce((s, p) => s + p.ausenciasSinJustificar, 0),
    },
  };
}

export async function horasTrabajadas(opts: { desde: string; hasta: string; tienda?: string }) {
  const desde = opts.desde.replace(/-/g, "");
  const hasta = opts.hasta.replace(/-/g, "");
  const { usuarios } = await libro(desde, hasta, opts.tienda);

  const personas = usuarios.map((u) => {
    const dias = u.PlannedInterval || [];
    const minutosExtra = dias.reduce((s, d) => s + aMinutos(d.TotalAuthorizedOvertime), 0);
    const minutosTrabajados = horasDecimalesAMinutos(u.TotalWorkedHours);
    return {
      persona: `${u.Name} ${u.LastName}`.trim(),
      tienda: tiendaDesdeGrupo(u.GroupDescription),
      horasTrabajadas: enHoras(minutosTrabajados),
      minutosTrabajados,
      diasTrabajados: Number(u.WorkedDays || 0),
      horasExtra: enHoras(minutosExtra),
      domingosTrabajados: Number(u.WorkedSundays || 0),
      feriadosTrabajados: Number(u.WorkedHolidays || 0),
    };
  });

  const porTienda: Record<string, { personas: number; minutos: number }> = {};
  for (const p of personas) {
    porTienda[p.tienda] = porTienda[p.tienda] || { personas: 0, minutos: 0 };
    porTienda[p.tienda].personas++;
    porTienda[p.tienda].minutos += p.minutosTrabajados;
  }

  return {
    periodo: { desde: soloFecha(desde), hasta: soloFecha(hasta) },
    personas: personas.sort((a, b) => b.minutosTrabajados - a.minutosTrabajados),
    porTienda: Object.fromEntries(
      Object.entries(porTienda).map(([t, v]) => [t, { personas: v.personas, horasTotales: enHoras(v.minutos) }])
    ),
  };
}

export async function personalPorTienda(opts: { tienda?: string } = {}) {
  // El listado de usuarios no trae el grupo, así que la tienda sale del libro
  // de asistencia de hoy, que sí lo incluye.
  const hoy = aFecha(new Date());
  const { usuarios, totalHabilitados } = await libro(hoy, hoy, opts.tienda);

  const personas = usuarios.map((u) => ({
    persona: `${u.Name} ${u.LastName}`.trim(),
    tienda: tiendaDesdeGrupo(u.GroupDescription),
    desde: u.ContractDate ? soloFecha(u.ContractDate) : null,
  }));

  const porTienda: Record<string, number> = {};
  for (const p of personas) porTienda[p.tienda] = (porTienda[p.tienda] || 0) + 1;

  return {
    personas: personas.sort((a, b) => a.tienda.localeCompare(b.tienda) || a.persona.localeCompare(b.persona)),
    porTienda,
    totalHabilitados,
  };
}
