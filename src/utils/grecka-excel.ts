// Lectura de los reportes de compras que exporta Grecka.
//
// Vive fuera de la ruta para poder probarlo contra archivos reales: el formato
// cambia solo (una columna "#" de numeración al principio bastó para que el
// importador descartara 726 filas creyendo que no eran de Larrs).
//
// Grecka exporta dos reportes distintos y los dos describen las mismas compras:
//
//   - FACTURAS (el viejo): una línea por línea de factura. Trae grupo, unidad y
//     marca, numera por N° de documento y fecha el día en que se facturó.
//     Incluye las notas de crédito, que vienen con cantidad negativa.
//   - PEDIDOS (el que Gustavo puede sacar solo): numera por N° de pedido y
//     fecha el día en que se pidió —uno o dos días antes de la factura—. No
//     trae grupo, unidad, marca ni notas de crédito, y además muestra pedidos
//     todavía no facturados, marcados "Abierto".
//
// El mismo pedido tiene números distintos en cada reporte (el pedido 91259 se
// facturó como documento 58355), así que no hay forma de cruzarlos por número:
// quien importa el reporte de pedidos manda sobre el período que cubre.

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
  // El reporte de facturas trae 21/10/2026 y el de pedidos 21-10-26: los dos
  // son día-mes-año, cambia el separador y el largo del año.
  const s = String(raw).trim();
  const partes = s.includes("/") ? s.split("/") : s.includes("-") ? s.split("-") : null;
  if (!partes || partes.length !== 3) return null;
  const [d, m, yRaw] = partes;
  if (!d || !m || !yRaw) return null;
  const y = yRaw.length <= 2 ? `20${yRaw.padStart(2, "0")}` : yRaw;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Los números vienen de dos formas: el .xlsx los entrega ya como número y el
// .csv escrito a la chilena, "26.505,00", donde el punto separa los miles y la
// coma los decimales. Leer eso con parseFloat da 26 —y un precio de $26 en vez
// de $26.505 no se nota en pantalla, se nota en la proyección.
export function numero(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  // La coma solo aparece en el formato chileno; sin ella el texto ya es un
  // número común y corriente.
  const limpio = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = parseFloat(limpio);
  return Number.isFinite(n) ? n : 0;
}

// Cada columna se busca por su encabezado, aceptando las variantes con las que
// sale del sistema de Grecka ("E_Cliente") y las escritas a mano ("Cliente").
const ALIAS: Record<string, string[]> = {
  ndoc: ["b_ndoc", "ndoc", "n doc", "numero documento", "nro documento", "pedido", "n pedido"],
  cliente: ["e_cliente", "cliente", "nombre cliente", "nombre del cliente", "nombre de cliente/proveedor"],
  fecha: ["g_fecha", "fecha", "fecha doc", "i_fechadoc"],
  sku: ["n_sku", "sku", "codigo", "cod articulo", "articulo", "numero de articulo", "n articulo"],
  descripcion: ["o_descripcion", "descripcion", "desc articulo", "desc.articulo"],
  cantidad: ["t_cantidad", "cantidad"],
  precio: ["v_precio", "precio", "precio unitario", "precio unit"],
  neto: ["w_neto", "neto", "total neto", "total linea"],
  destino: ["af_destino", "destino", "nombre destino", "tienda"],
};

// Lo que trae un reporte y el otro no. Nada de esto puede ser obligatorio: el
// reporte de pedidos no tiene grupo, unidad ni marca, y el de facturas no tiene
// estado. Exigirlos dejaría afuera a uno de los dos.
const ALIAS_OPCIONALES: Record<string, string[]> = {
  marca: ["r_marca", "marca", "nombre marca"],
  grupo: ["s_grupo", "grupo", "nombre de grupo"],
  unidad: ["u_unidad", "unidad"],
  estado: ["estado", "z_estado"],
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

  for (const [clave, alias] of Object.entries(ALIAS_OPCIONALES)) {
    const esperados = alias.map(normalizar);
    const i = normalizados.findIndex((h) => esperados.includes(h));
    if (i !== -1) indices[clave] = i;
  }

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


/** Qué reporte es, según las columnas que trajo. */
export type Formato = "facturas" | "pedidos";

export function formatoDe(indices: Record<string, number>): Formato {
  // El grupo es lo que distingue a los dos: el reporte de facturas lo trae
  // siempre y el de pedidos no lo trae nunca.
  return indices.grupo === undefined ? "pedidos" : "facturas";
}

// Lector de CSV propio en vez de pasarle el texto a la librería de Excel: el
// reporte de pedidos viene separado por punto y coma, con BOM, con saltos CRLF
// y con descripciones que llevan comillas adentro —ABRAZADERAS DE 1/2"— que
// escapadas quedan como "". Cualquiera de esas cuatro cosas, leída de más o de
// menos, corre una columna y arruina la fila entera sin avisar.
export function leerCSV(texto: string): unknown[][] {
  const limpio = texto.replace(/^\uFEFF/, "");
  // El separador se deduce de la primera línea: Grecka exporta con ";" pero un
  // archivo guardado de nuevo desde Excel en otro equipo puede salir con ",".
  const primera = limpio.split(/\r?\n/)[0] ?? "";
  const sep = (primera.match(/;/g)?.length ?? 0) >= (primera.match(/,/g)?.length ?? 0) ? ";" : ",";

  const filas: unknown[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') { campo += '"'; i++; }  // comilla escapada
        else entreComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { entreComillas = true; continue; }
    if (c === sep) { fila.push(campo); campo = ""; continue; }
    if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; continue; }
    if (c === "\r") continue;
    campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }

  // Las filas vacías del final no son datos y harían contar de más.
  return filas.filter((f) => f.some((c) => String(c).trim() !== ""));
}
