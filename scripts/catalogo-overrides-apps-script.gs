// ─── Code.gs — Apps Script Web App para Overrides de Catálogo (Larrs) ──────
// Permite a los admins agregar o excluir artículos de dos catálogos:
// "food" (Inventario Food / Recepción) y "sabores" (Pesaje de Producción /
// Vitrina) — sin tener que tocar código. Es una capa de overrides sobre el
// catálogo real (derivado de ventas o del CSV de producción): "excluir"
// oculta un ítem que sí existe en el catálogo real; "incluir" agrega uno
// que no está ahí (ej. un insumo nuevo).
//
// Vive dentro del Sheet compartido "Mermas Larrs" (pestaña "Overrides"),
// junto con Mermas, Inventario, Vitrina y Recepciones. Producción sigue en
// su propio Sheet aparte (no se toca).
//
// IMPORTANTE: antes de desplegar este cambio, copia manualmente las filas
// existentes de la planilla vieja "Catálogo Overrides Larrs" (pestaña
// Overrides) a la nueva pestaña "Overrides" en "Mermas Larrs" — si no, esos
// overrides ya creados (agregar/excluir) quedan huérfanos y dejan de
// aplicarse hasta que los vuelvas a crear a mano.
//
// Despliegue: Implementar → Administrar implementaciones → editar (lápiz)
// → Nueva versión → Implementar. La URL /exec no cambia.

const TOKEN = 'larrs-catalogo-2026';
const HUB_SPREADSHEET_ID = '1L952Ivf2eBZh9vQYmAOkJaZszBQUy2Uvmtub3RWifOw'; // Mermas Larrs
const SHEET_NAME = 'Overrides';
const HEADERS = ['id', 'catalogo', 'tipo', 'categoria', 'nombre', 'unidad',
                  'creado_en', 'creado_por'];

function ensureSheet_() {
  const ss = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e.parameter.token !== TOKEN) return jsonOut_({ ok: false, error: 'Token inválido' });
  const action = e.parameter.action || 'list';
  if (action === 'list') return doList_(e);
  return jsonOut_({ ok: false, error: 'Acción no soportada: ' + action });
}

function doList_(e) {
  const sheet = ensureSheet_();
  const rows = sheet.getDataRange().getValues().slice(1);
  const catalogoFiltro = e.parameter.catalogo || null;

  let items = rows.map(function (r) {
    const obj = {};
    HEADERS.forEach(function (h, i) { obj[h] = r[i]; });
    return obj;
  });
  if (catalogoFiltro) items = items.filter(function (it) { return it.catalogo === catalogoFiltro; });
  items.sort(function (a, b) { return new Date(b.creado_en) - new Date(a.creado_en); });

  return jsonOut_({ ok: true, items: items });
}

function doPost(e) {
  if (e.parameter.token !== TOKEN) return jsonOut_({ ok: false, error: 'Token inválido' });

  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut_({ ok: false, error: 'Body inválido' }); }

  const action = e.parameter.action || 'create';
  if (action === 'delete') return doDelete_(body);
  return doCreate_(body);
}

function doCreate_(body) {
  if (body.catalogo !== 'food' && body.catalogo !== 'sabores') {
    return jsonOut_({ ok: false, error: 'catalogo debe ser "food" o "sabores"' });
  }
  if (body.tipo !== 'incluir' && body.tipo !== 'excluir') {
    return jsonOut_({ ok: false, error: 'tipo debe ser "incluir" o "excluir"' });
  }
  if (!body.nombre) return jsonOut_({ ok: false, error: 'Falta campo: nombre' });
  if (body.catalogo === 'food' && !body.categoria) {
    return jsonOut_({ ok: false, error: 'categoria es requerida para el catálogo food' });
  }

  const sheet = ensureSheet_();
  const id = Utilities.getUuid();
  const creadoEn = new Date().toISOString();

  const row = HEADERS.map(function (h) {
    if (h === 'id') return id;
    if (h === 'creado_en') return creadoEn;
    return body[h] != null ? body[h] : '';
  });
  sheet.appendRow(row);

  return jsonOut_({ ok: true, id: id });
}

function doDelete_(body) {
  if (!body.id) return jsonOut_({ ok: false, error: 'Falta campo: id' });

  const sheet = ensureSheet_();
  const ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === body.id) {
      sheet.deleteRow(i + 2);
      return jsonOut_({ ok: true, id: body.id });
    }
  }
  return jsonOut_({ ok: false, error: 'No se encontró el override (id inválido)' });
}
