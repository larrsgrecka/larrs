// ─── Code.gs — Apps Script Web App para Vitrina (Larrs) ─────────────────────
// Guarda la configuración actual de la vitrina de cada tienda (qué sabor va
// en cada uno de los slots físicos del mostrador). Es un "estado actual"
// que se reemplaza completo cada vez que se guarda (no un historial de
// eventos como Mermas/Inventario) — al cambiar la vitrina cada ~2 semanas,
// se sobrescriben los slots de esa tienda.
//
// Despliegue:
// 1. Crear un Google Sheet nuevo vacío ("Vitrina Larrs").
// 2. Extensiones → Apps Script → pegar este archivo completo.
// 3. Implementar → Nueva implementación → Aplicación web → Ejecutar como: tu
//    cuenta → Acceso: Cualquier usuario.
// 4. Copiar la URL /exec y guardarla junto al TOKEN en .env.local:
//      VITRINA_APPS_SCRIPT_URL=<esa URL>
//      VITRINA_APPS_SCRIPT_TOKEN=larrs-vitrina-2026

const TOKEN = 'larrs-vitrina-2026';
const SHEET_NAME = 'Vitrina';
const HEADERS = ['tienda', 'slot', 'sabor', 'actualizado_en', 'actualizado_por'];

function ensureSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  const sheet = ensureSheet_();
  const rows = sheet.getDataRange().getValues().slice(1);
  const tiendaFiltro = e.parameter.tienda || null;

  let items = rows.map(function (r) {
    const obj = {};
    HEADERS.forEach(function (h, i) { obj[h] = r[i]; });
    return obj;
  }).filter(function (it) { return it.tienda && it.sabor; });

  if (tiendaFiltro) items = items.filter(function (it) { return it.tienda === tiendaFiltro; });
  items.sort(function (a, b) { return Number(a.slot) - Number(b.slot); });

  return jsonOut_({ ok: true, items: items });
}

// Reemplaza TODOS los slots de una tienda por los que llegan en el body.
function doPost(e) {
  if (e.parameter.token !== TOKEN) return jsonOut_({ ok: false, error: 'Token inválido' });

  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut_({ ok: false, error: 'Body inválido' }); }

  if (!body.tienda) return jsonOut_({ ok: false, error: 'Falta campo: tienda' });
  if (!Array.isArray(body.slots)) return jsonOut_({ ok: false, error: 'slots debe ser un array' });

  const sheet = ensureSheet_();
  const data = sheet.getDataRange().getValues();
  const actualizadoEn = new Date().toISOString();

  // Quitar filas viejas de esta tienda (de abajo hacia arriba para no
  // desordenar los índices al borrar).
  for (let r = data.length - 1; r >= 1; r--) {
    if (data[r][0] === body.tienda) sheet.deleteRow(r + 1);
  }

  const nuevas = body.slots
    .filter(function (s) { return s.sabor; })
    .map(function (s) {
      return [body.tienda, s.slot, s.sabor, actualizadoEn, body.actualizado_por || ''];
    });

  if (nuevas.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, nuevas.length, HEADERS.length).setValues(nuevas);
  }

  return jsonOut_({ ok: true, count: nuevas.length });
}
