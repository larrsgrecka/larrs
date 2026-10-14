// Las tiendas y qué hace cada una.
//
// Esta lista estaba repetida en dieciséis archivos, así que agregar una tienda
// significaba acordarse de dieciséis lugares. Peor: no todas hacen lo mismo, y
// tratarlas igual genera alertas falsas — un local que no produce helado
// aparecería todas las semanas como "no registró producción".

export type Tienda = {
  nombre: string;
  /** Registra pesaje de producción propio. */
  produce: boolean;
  /** Cuántos sabores entran en su vitrina. */
  slotsVitrina: number;
  /** De dónde recibe el helado, cuando no lo produce. */
  seAbasteceDe?: string;
  /** Le compra insumos a Grecka directamente. */
  compraAGrecka: boolean;
  /** Qué vitrinas tiene, para no pedirle revisiones de una que no existe. */
  vitrinas: ("helados" | "pasteleria")[];
};

export const TIENDAS: Tienda[] = [
  { nombre: "Costanera", produce: true, slotsVitrina: 24, compraAGrecka: true, vitrinas: ["helados", "pasteleria"] },
  { nombre: "Dominicos", produce: true, slotsVitrina: 24, compraAGrecka: true, vitrinas: ["helados", "pasteleria"] },
  { nombre: "Trapenses", produce: true, slotsVitrina: 24, compraAGrecka: true, vitrinas: ["helados", "pasteleria"] },
  // Módulo del Mall Costanera Center: vitrina de 16 sabores, sin producción
  // propia. Se abastece desde la tienda Costanera, así que tampoco le compra a
  // Grecka por su cuenta: sus insumos entran por Costanera.
  {
    nombre: "Módulo Costanera",
    produce: false,
    slotsVitrina: 16,
    seAbasteceDe: "Costanera",
    compraAGrecka: false,
    // Solo vitrina de helados: es un módulo, no tiene vitrina de pastelería.
    // Pedirle una revisión que no corresponde generaría una alerta fija.
    vitrinas: ["helados"],
  },
];

export const NOMBRES_TIENDAS = TIENDAS.map((t) => t.nombre);
export const TIENDAS_QUE_PRODUCEN = TIENDAS.filter((t) => t.produce).map((t) => t.nombre);
export const TIENDAS_QUE_COMPRAN = TIENDAS.filter((t) => t.compraAGrecka).map((t) => t.nombre);

export function tienda(nombre: string): Tienda | undefined {
  return TIENDAS.find((t) => t.nombre.toLowerCase() === (nombre || "").toLowerCase());
}

export function slotsDeVitrina(nombre: string): number {
  return tienda(nombre)?.slotsVitrina ?? 24;
}

export function vitrinasDe(nombre: string): ("helados" | "pasteleria")[] {
  return tienda(nombre)?.vitrinas ?? ["helados", "pasteleria"];
}

export function produce(nombre: string): boolean {
  return tienda(nombre)?.produce ?? false;
}

// Se mantiene el nombre viejo: lo usa el panel de análisis de ventas, donde
// "tiendas con ventas propias" es justo lo que hace falta.
export const TIENDAS_VENTAS = NOMBRES_TIENDAS;
export type TiendaVentas = string;

// Tienda cerrada en abril 2025 — se conserva su histórico pero no aparece
// en el selector normal del panel ni en el agregado "Todas".
export const TIENDA_CERRADA = "Vitacura";

export function esTiendaActiva(nombre: string): boolean {
  return NOMBRES_TIENDAS.includes(nombre);
}
