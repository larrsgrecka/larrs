// Gramos de helado que representa una unidad vendida — para poder medir
// "kilos vendidos" en el Análisis de ventas, además de unidades y $. No todo
// lo que vende la familia HELADERIA es helado puro con un peso claro (bochas
// sueltas, copas armadas, tortas, o líneas que son en realidad el sabor
// elegido dentro de un pedido, no una venta física aparte) — por eso solo se
// cuentan los formatos con peso real y sin ambigüedad: los dos formatos
// principales (simple/doble, la enorme mayoría del volumen vendido) definidos
// a mano acá, más cualquier producto cuyo propio nombre ya declara el peso
// (750gr, 1kg, etc.). El resto queda excluido del cálculo en vez de adivinar.

const GRAMAJE_POR_CODIGO: Record<string, number> = {
  H001: 160, // HELADO LÄRRS 2S (SIMPLE)
  H002: 240, // HELADO LÄRRS 3S (DOBLE)
};

const RE_KG = /(\d+(?:[.,]\d+)?)\s*kg\.?\b/i;
const RE_GR = /(\d+(?:[.,]\d+)?)\s*gr(?:s|amos)?\.?\b/i;
const RE_KILO_PALABRA = /\bkilo\b/i;

function parsePesoDesdeNombre(nombre: string): number | null {
  const mKg = nombre.match(RE_KG);
  if (mKg) return parseFloat(mKg[1].replace(",", ".")) * 1000;
  const mGr = nombre.match(RE_GR);
  if (mGr) return parseFloat(mGr[1].replace(",", "."));
  if (RE_KILO_PALABRA.test(nombre)) return 1000;
  return null;
}

// Gramos por unidad vendida, o null si no hay un peso confiable para este producto.
export function gramosPorUnidad(codigo: string, nombre: string): number | null {
  if (codigo in GRAMAJE_POR_CODIGO) return GRAMAJE_POR_CODIGO[codigo];
  return parsePesoDesdeNombre(nombre);
}
