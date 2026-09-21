// Lectura del Excel de facturación que exporta Grecka.
//
// Vive fuera de la ruta para poder probarlo contra archivos reales: el formato
// cambia solo (una columna "#" de numeración al principio bastó para que el
// importador descartara 726 filas creyendo que no eran de Larrs).

// Grecka nombra el mismo destino de varias maneras según el export: la tienda
// de Dominicos aparece como "CAMINO EL ALBA" (la calle) o como "LOS DOMINICOS"
// (la comuna), y la producción como "CAMINO DEL CERRO" o "HUECHURABA", que son
// la misma dirección. Se aceptan todas, porque el archivo cambia solo y perder
// un nombre significa perder las compras de esa tienda sin que se note.
export const TIENDA_MAP: Record<string, string> = {
  "ANDRES BELLO": "Costanera",
  "BELLO 2447": "Costanera",
  "COSTANERA CENTER": "Costanera",
  "TRAPENSES": "Trapenses",
  "CAMINO EL ALBA": "Dominicos",
  "EL ALBA": "Dominicos",
  "DOMINICOS": "Dominicos",
  "CAMINO DEL CERRO": "Produccion",
  "HUECHURABA": "Produccion",
};

// Destinos que no son de Larrs o no corresponden a una tienda. Vitacura entra
// acá por decisión de Gustavo: son 19 líneas de junio, casi todas reparación de
// equipos, y no es ninguno de los tres locales.
const EXCLUIR = ["LUIS PASTEUR", "CHAMISERO", "FRANKLIN", "VITACURA"];

export function mapTienda(destino: string): string | null {
  const d = (destino || "").toUpperCase();
  if (EXCLUIR.some((x) => d.includes(x))) return null;
  for (const [key, tienda] of Object.entries(TIENDA_MAP)) {
    if (d.includes(key)) return tienda;
  }
  return null;
}

export function parseDate(raw: unknown): string | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (s.includes("/")) {
    const [d, m, y] = s.split("/");
    if (y && m && d) return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  return null;
}

// Cada columna se busca por su encabezado, aceptando las variantes con las que
// sale del sistema de Grecka ("E_Cliente") y las escritas a mano ("Cliente").
const ALIAS: Record<string, string[]> = {
  ndoc: ["b_ndoc", "ndoc", "n doc", "numero documento", "nro documento"],
  cliente: ["e_cliente", "cliente", "nombre cliente", "nombre del cliente"],
  fecha: ["g_fecha", "fecha", "fecha doc", "i_fechadoc"],
  sku: ["n_sku", "sku", "codigo", "cod articulo", "articulo"],
  descripcion: ["o_descripcion", "descripcion", "desc articulo", "desc.articulo"],
  grupo: ["s_grupo", "grupo", "nombre de grupo"],
  cantidad: ["t_cantidad", "cantidad"],
  unidad: ["u_unidad", "unidad"],
  precio: ["v_precio", "precio", "precio unitario"],
  neto: ["w_neto", "neto", "total neto"],
  destino: ["af_destino", "destino", "nombre destino"],
};

export function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
}

export function ubicarColumnas(encabezado: unknown[]) {
  const normalizados = (encabezado || []).map(normalizar);
  const indices: Record<string, number> = {};
  const faltantes: string[] = [];

  for (const [clave, alias] of Object.entries(ALIAS)) {
    // Los alias se normalizan con la misma regla que los encabezados: escritos
    // como "e_cliente" nunca iban a coincidir con "e cliente", que es en lo
    // que normalizar() convierte "E_Cliente".
    const esperados = alias.map(normalizar);
    // Coincidencia exacta y no por "contiene": "cliente" no puede quedarse con
    // la columna "C_CodCliente", que es el código y no el nombre.
    const i = normalizados.findIndex((h) => esperados.includes(h));
    if (i === -1) faltantes.push(clave);
    else indices[clave] = i;
  }
  return { indices, faltantes };
}

