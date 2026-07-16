// ─── Code.gs — Apps Script Web App para Mermas (Larrs) ──────────────────────
// 1. Crear un Google Sheet nuevo y vacío (ej: "Mermas Larrs").
// 2. Extensiones → Apps Script → pegar este archivo completo, reemplazando
//    cualquier contenido de Code.gs.
// 3. (Opcional) Cambiar el valor de TOKEN por uno propio.
// 4. Implementar → Nueva implementación → tipo "Aplicación web".
//    Ejecutar como: tu cuenta. Quién tiene acceso: Cualquier usuario.
// 5. Autorizar permisos la primera vez que lo pida.
// 6. Copiar la URL que termina en /exec y ponerla junto con el TOKEN en
//    .env.local del proyecto:
//      MERMAS_APPS_SCRIPT_URL=<esa URL>
//      MERMAS_APPS_SCRIPT_TOKEN=<el TOKEN de abajo>
// 7. Cada vez que edites este script, hay que ir a
//    Implementar → Administrar implementaciones → Editar → Nueva versión
//    para que los cambios se reflejen en la URL /exec ya existente.

const TOKEN = 'larrs-mermas-2026';
const SHEET_NAME = 'Mermas';
const HEADERS = ['id', 'fecha', 'tienda', 'producto', 'categoria_producto', 'cantidad',
                  'unidad', 'motivo', 'motivo_detalle', 'observaciones',
                  'reportado_por', 'reportado_por_id', 'creado_en'];

function ensureSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

  const limit = Number(e.parameter.limit) || 300;
  items = items.slice(0, limit);

  return jsonOut_({ ok: true, items: items });
}

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
  const required = ['fecha', 'tienda', 'producto', 'cantidad', 'unidad', 'motivo',
                     'reportado_por', 'reportado_por_id'];
  for (let i = 0; i < required.length; i++) {
    const f = required[i];
    if (!body[f]) return jsonOut_({ ok: false, error: 'Falta campo: ' + f });
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

  return jsonOut_({ ok: true, id: id, creado_en: creadoEn });
}

// Encuentra la fila (1-indexed, incluye encabezado) de un id dado en la
// columna "id". Devuelve -1 si no existe.
function findRowById_(sheet, id) {
  const ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function doUpdate_(body) {
  if (!body.id) return jsonOut_({ ok: false, error: 'Falta campo: id' });
  const required = ['fecha', 'tienda', 'producto', 'cantidad', 'unidad', 'motivo'];
  for (let i = 0; i < required.length; i++) {
    const f = required[i];
    if (!body[f]) return jsonOut_({ ok: false, error: 'Falta campo: ' + f });
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
