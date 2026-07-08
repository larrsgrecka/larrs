export const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function nombreMes(mes: number): string {
  const n = MESES_ES[mes - 1] ?? "";
  return n.charAt(0).toUpperCase() + n.slice(1);
}
