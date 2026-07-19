// ─── Code.gs — Apps Script Web App para Inventario Food (Larrs) ─────────────
// Vive dentro del Sheet compartido "Mermas Larrs" (pestaña "Inventario"),
// junto con Mermas, Vitrina, Recepciones y Overrides — todo en un solo
// archivo. Producción sigue en su propio Sheet aparte (no se toca).
//
// Si es la primera vez que despliegas esto: Extensiones → Apps Script desde
// cualquier Sheet → pegar este archivo → Implementar → Nueva implementación
// → Aplicación web → Ejecutar como: tu cuenta → Acceso: Cualquier usuario.
// Cada cambio futuro: Administrar implementaciones → editar → Nueva versión
// (la URL /exec no cambia).

const TOKEN = 'larrs-inventario-food-2026';
const HUB_SPREADSHEET_ID = '1L952Ivf2eBZh9vQYmAOkJaZszBQUy2Uvmtub3RWifOw'; // Mermas Larrs
const SHEET_NAME = 'Inventario';
const HEADERS = ['id', 'fecha', 'tienda', 'categoria', 'producto', 'cantidad',
                  'unidad', 'observaciones', 'reportado_por', 'reportado_por_id', 'creado_en'];

function ensureSheet_() {
  const ss = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  // Columna "fecha" (B) como texto plano: sin esto, Sheets convierte
  // "2026-07-14" a un valor Date y se lee de vuelta con hora incluida.
  sheet.getRange('B2:B').setNumberFormat('@');
  return sheet;
}

function fechaStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return v;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e.parameter.token !== TOKEN) {
    return jsonOut_({ ok: false, error: 'Token inválido' });
  }
  const action = e.parameter.action || 'list';
  if (action === 'list') return doList_(e);
  return jsonOut_({ ok: false, error: 'Acción no soportada: ' + action });
}

function doList_(e) {
  const sheet = ensureSheet_();
  const rows = sheet.getDataRange().getValues().slice(1);
  const tiendaFiltro = e.parameter.tienda || null;

  let items = rows.map(function (r) {
    const obj = {};
    HEADERS.forEach(function (h, i) { obj[h] = h === 'fecha' ? fechaStr_(r[i]) : r[i]; });
    return obj;
  });

  if (tiendaFiltro) {
    items = items.filter(function (it) { return it.tienda === tiendaFiltro; });
  }

  items.sort(function (a, b) {
    const da = new Date(a.creado_en || a.fecha).getTime();
    const db = new Date(b.creado_en || b.fecha).getTime();
    return db - da;
  });

  const limit = Number(e.parameter.limit) || 5000;
  items = items.slice(0, limit);

  return jsonOut_({ ok: true, items: items });
}

// Inserta un conteo por cada producto de "items" (un conteo = una planilla
// de una categoría completa, enviada de una sola vez).
function doPost(e) {
  if (e.parameter.token !== TOKEN) {
    return jsonOut_({ ok: false, error: 'Token inválido' });
  }

  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Body inválido' });
  }

  const action = e.parameter.action || 'create';
  if (action === 'update') return doUpdate_(body);
  if (action === 'delete') return doDelete_(body);
  return doCreate_(body);
}

function doCreate_(body) {
  const required = ['fecha', 'tienda', 'categoria', 'reportado_por', 'reportado_por_id'];
  for (let i = 0; i < required.length; i++) {
    const f = required[i];
    if (!body[f]) return jsonOut_({ ok: false, error: 'Falta campo: ' + f });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return jsonOut_({ ok: false, error: 'items debe ser un array con al menos un producto' });
  }

  const creadoEn = new Date().toISOString();
  const ids = [];
  let rows;
  try {
    // La unidad viene por producto (ej. café en grano = "un", café por kilo
    // = "kg"), no una sola para toda la planilla.
    rows = body.items.map(function (item) {
      if (!item.producto || item.cantidad === undefined || item.cantidad === null) {
        throw new Error('Cada item requiere producto y cantidad');
      }
      const id = Utilities.getUuid();
      ids.push(id);
      return HEADERS.map(function (h) {
        if (h === 'id') return id;
        if (h === 'creado_en') return creadoEn;
        if (h === 'producto') return item.producto;
        if (h === 'cantidad') return item.cantidad;
        if (h === 'unidad') return item.unidad || 'un';
        return body[h] != null ? body[h] : '';
      });
    });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }

  const sheet = ensureSheet_();
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, HEADERS.length).setValues(rows);

  return jsonOut_({ ok: true, count: rows.length, ids: ids, creado_en: creadoEn });
}

function findRowById_(sheet, id) {
  const ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function doUpdate_(body) {
  if (!body.id) return jsonOut_({ ok: false, error: 'Falta campo: id' });
  const required = ['fecha', 'tienda', 'categoria', 'producto', 'cantidad', 'unidad'];
  for (let i = 0; i < required.length; i++) {
    const f = required[i];
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      return jsonOut_({ ok: false, error: 'Falta campo: ' + f });
    }
  }

  const sheet = ensureSheet_();
  const rowNum = findRowById_(sheet, body.id);
  if (rowNum < 0) return jsonOut_({ ok: false, error: 'No se encontró el registro (id inválido)' });

  const actual = sheet.getRange(rowNum, 1, 1, HEADERS.length).getValues()[0];
  const fila = HEADERS.map(function (h, i) {
    if (h === 'id' || h === 'creado_en' || h === 'reportado_por' || h === 'reportado_por_id') return actual[i];
    return body[h] != null ? body[h] : '';
  });

  sheet.getRange(rowNum, 1, 1, HEADERS.length).setValues([fila]);
  return jsonOut_({ ok: true, id: body.id });
}

function doDelete_(body) {
  if (!body.id) return jsonOut_({ ok: false, error: 'Falta campo: id' });

  const sheet = ensureSheet_();
  const rowNum = findRowById_(sheet, body.id);
  if (rowNum < 0) return jsonOut_({ ok: false, error: 'No se encontró el registro (id inválido)' });

  sheet.deleteRow(rowNum);
  return jsonOut_({ ok: true, id: body.id });
}
