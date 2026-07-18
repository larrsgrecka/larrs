// ─── Code.gs — Apps Script Web App para Recepción de Productos (Larrs) ─────
// Registra la llegada de productos a una tienda (con foto de la guía de
// despacho guardada en Google Drive) — un evento = una entrega, con varios
// productos adentro.
//
// Despliegue:
// 1. Crear un Google Sheet nuevo vacío ("Recepciones Larrs").
// 2. Extensiones → Apps Script → pegar este archivo completo.
// 3. Implementar → Nueva implementación → Aplicación web → Ejecutar como: tu
//    cuenta → Acceso: Cualquier usuario.
// 4. Copiar la URL /exec y guardarla junto al TOKEN en .env.local:
//      RECEPCION_APPS_SCRIPT_URL=<esa URL>
//      RECEPCION_APPS_SCRIPT_TOKEN=larrs-recepcion-2026
// 5. La primera vez que se suba una foto, Apps Script va a pedir autorizar
//    permisos de Google Drive — acéptalos (crea una carpeta "Fotos Guías de
//    Despacho - Larrs" en el Drive de la cuenta que desplegó el script).

const TOKEN = 'larrs-recepcion-2026';
const SHEET_NAME = 'Recepciones';
const DRIVE_FOLDER_NAME = 'Fotos Guías de Despacho - Larrs';
const HEADERS = ['id', 'fecha', 'tienda', 'proveedor', 'items_json', 'foto_url',
                  'reportado_por', 'reportado_por_id', 'observaciones', 'creado_en'];

function ensureSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  sheet.getRange('B2:B').setNumberFormat('@');
  return sheet;
}

function ensureFolder_() {
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DRIVE_FOLDER_NAME);
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
  if (e.parameter.token !== TOKEN) return jsonOut_({ ok: false, error: 'Token inválido' });
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
    let parsedItems = [];
    try { parsedItems = JSON.parse(obj.items_json || '[]'); } catch (err) { parsedItems = []; }
    obj.items = parsedItems;
    return obj;
  });

  if (tiendaFiltro) items = items.filter(function (it) { return it.tienda === tiendaFiltro; });
  items.sort(function (a, b) { return new Date(b.creado_en) - new Date(a.creado_en); });

  const limit = Number(e.parameter.limit) || 300;
  return jsonOut_({ ok: true, items: items.slice(0, limit) });
}

function doPost(e) {
  if (e.parameter.token !== TOKEN) return jsonOut_({ ok: false, error: 'Token inválido' });

  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut_({ ok: false, error: 'Body inválido' }); }

  const required = ['fecha', 'tienda', 'proveedor', 'reportado_por', 'reportado_por_id'];
  for (let i = 0; i < required.length; i++) {
    if (!body[required[i]]) return jsonOut_({ ok: false, error: 'Falta campo: ' + required[i] });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return jsonOut_({ ok: false, error: 'items debe ser un array con al menos un producto' });
  }

  let fotoUrl = '';
  if (body.foto_base64) {
    try {
      const bytes = Utilities.base64Decode(body.foto_base64);
      const mime = body.foto_mimetype || 'image/jpeg';
      const ext = mime.indexOf('png') !== -1 ? 'png' : 'jpg';
      const filename = 'guia-' + body.tienda + '-' + body.fecha + '-' + Utilities.getUuid().slice(0, 8) + '.' + ext;
      const blob = Utilities.newBlob(bytes, mime, filename);
      const file = ensureFolder_().createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      fotoUrl = file.getUrl();
    } catch (err) {
      return jsonOut_({ ok: false, error: 'Error al subir la foto: ' + err.message });
    }
  }

  const sheet = ensureSheet_();
  const id = Utilities.getUuid();
  const creadoEn = new Date().toISOString();

  const row = HEADERS.map(function (h) {
    if (h === 'id') return id;
    if (h === 'creado_en') return creadoEn;
    if (h === 'items_json') return JSON.stringify(body.items);
    if (h === 'foto_url') return fotoUrl;
    return body[h] != null ? body[h] : '';
  });

  sheet.appendRow(row);

  return jsonOut_({ ok: true, id: id, foto_url: fotoUrl, creado_en: creadoEn });
}
