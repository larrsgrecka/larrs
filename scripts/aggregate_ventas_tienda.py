#!/usr/bin/env python3
"""
Agrega "Ventas por tienda.xlsx" (transaccional, 735k+ filas) a nivel
tienda+articulo+anio+mes y tienda+grupo+anio+mes, escribiendo dos CSV chicos.

La libreria xlsx de Node no puede leer este archivo (la hoja interna supera
el limite maximo de string de V8), asi que la agregacion se hace en Python
con openpyxl en modo streaming (read_only), que si soporta archivos grandes.

Uso: python3 scripts/aggregate_ventas_tienda.py "Ventas por tienda.xlsx" salida_dir/
"""
import sys
import csv
import re
from datetime import datetime
import openpyxl

COLS = {
    "almacen": "Nombre de almacén",
    "fecha": "Fecha",
    "articulo": "Artículo",
    "descArticulo": "Desc.Artículo",
    "grupo": "Nombre de grupo",
    "cantidad": "Cantidad",
    "neto": "Neto",
}

FECHA_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")


def parse_fecha(raw):
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw.year, raw.month
    m = FECHA_RE.match(str(raw).strip())
    if not m:
        return None
    return int(m.group(3)), int(m.group(2))


def to_number(raw):
    if raw is None or raw == "":
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    try:
        return float(str(raw).replace(",", "."))
    except ValueError:
        return 0.0


def main():
    if len(sys.argv) < 3:
        print("Uso: python3 scripts/aggregate_ventas_tienda.py <archivo.xlsx> <salida_dir>")
        sys.exit(1)

    file_path, out_dir = sys.argv[1], sys.argv[2]

    print("Abriendo archivo (streaming)...")
    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    ws = wb.active

    header = None
    idx = {}
    por_articulo = {}
    por_grupo = {}
    n = 0

    for row in ws.iter_rows(values_only=True):
        if header is None:
            header = [str(h).strip() if h is not None else "" for h in row]
            for key, colname in COLS.items():
                if colname not in header:
                    raise SystemExit(f'No se encontró la columna "{colname}"')
                idx[key] = header.index(colname)
            continue

        n += 1
        tienda = str(row[idx["almacen"]] or "").strip()
        if not tienda:
            continue
        fecha = parse_fecha(row[idx["fecha"]])
        if not fecha:
            continue
        anio, mes = fecha

        cantidad = to_number(row[idx["cantidad"]])
        neto = to_number(row[idx["neto"]])

        codigo = str(row[idx["articulo"]] or "").strip()
        nombre_articulo = str(row[idx["descArticulo"]] or "").strip()
        grupo = str(row[idx["grupo"]] or "").strip()
        if codigo:
            key = (tienda, codigo, anio, mes)
            cur = por_articulo.setdefault(key, {"nombre": nombre_articulo, "grupo": grupo, "cantidad": 0.0, "importe_neto": 0.0})
            cur["cantidad"] += cantidad
            cur["importe_neto"] += neto

        if grupo:
            key = (tienda, grupo, anio, mes)
            cur = por_grupo.setdefault(key, {"cantidad": 0.0, "importe_neto": 0.0})
            cur["cantidad"] += cantidad
            cur["importe_neto"] += neto

        if n % 100000 == 0:
            print(f"  {n} filas procesadas...")

    print(f"Total filas: {n}")
    print(f"Combinaciones únicas -> artículo: {len(por_articulo)}, grupo: {len(por_grupo)}")

    articulo_path = f"{out_dir}/ventas_articulo_agg.csv"
    with open(articulo_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tienda", "codigo", "nombre", "grupo", "anio", "mes", "cantidad", "importe_neto"])
        for (tienda, codigo, anio, mes), v in por_articulo.items():
            w.writerow([tienda, codigo, v["nombre"], v["grupo"], anio, mes, v["cantidad"], v["importe_neto"]])
    print("Escrito:", articulo_path)

    grupo_path = f"{out_dir}/ventas_grupo_agg.csv"
    with open(grupo_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tienda", "grupo", "anio", "mes", "cantidad", "importe_neto"])
        for (tienda, grupo, anio, mes), v in por_grupo.items():
            w.writerow([tienda, grupo, anio, mes, v["cantidad"], v["importe_neto"]])
    print("Escrito:", grupo_path)


if __name__ == "__main__":
    main()
