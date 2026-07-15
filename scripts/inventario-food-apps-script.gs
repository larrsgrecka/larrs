// ─── Code.gs — Apps Script Web App para Inventario Food (Larrs) ─────────────
// 1. Crear un Google Sheet nuevo y vacío (ej: "Inventario Food Larrs").
// 2. Extensiones → Apps Script → pegar este archivo completo, reemplazando
//    cualquier contenido de Code.gs.
// 3. (Opcional) Cambiar el valor de TOKEN por uno propio.
// 4. Implementar → Nueva implementación → tipo "Aplicación web".
//    Ejecutar como: tu cuenta. Quién tiene acceso: Cualquier usuario.
// 5. Autorizar permisos la primera vez que lo pida.
// 6. Copiar la URL que termina en /exec y ponerla junto con el TOKEN en
//    .env.local del proyecto:
//      INVENTARIO_FOOD_APPS_SCRIPT_URL=<esa URL>
//      INVENTARIO_FOOD_APPS_SCRIPT_TOKEN=<el TOKEN de abajo>
// 7. Cada vez que edites este script, hay que ir a
//    Implementar → Administrar implementaciones → Editar → Nueva versión
//    para que los cambios se reflejen en la URL /exec ya existente.

const TOKEN = 'larrs-inventario-food-2026';
const SHEET_NAME = 'Inventario';
const HEADERS = ['id', 'fecha', 'tienda', 'categoria', 'producto', 'cantidad',
                  'unidad', 'observaciones', 'reportado_por', 'reportado_por_id', 'creado_en'];

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
