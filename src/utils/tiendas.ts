export const TIENDAS_VENTAS = ["Costanera", "Dominicos", "Trapenses"] as const;
export type TiendaVentas = (typeof TIENDAS_VENTAS)[number];

// Tienda cerrada en abril 2025 — se conserva su histórico pero no aparece
// en el selector normal del panel ni en el agregado "Todas".
export const TIENDA_CERRADA = "Vitacura";

export function esTiendaActiva(tienda: string): tienda is TiendaVentas {
  return (TIENDAS_VENTAS as readonly string[]).includes(tienda);
}
