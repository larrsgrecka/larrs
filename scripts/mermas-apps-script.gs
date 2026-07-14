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
