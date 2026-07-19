// ─── Code.gs — Apps Script Web App para Vitrina (Larrs) ─────────────────────
// Guarda el historial de configuraciones de la vitrina de cada tienda (qué
// sabor va en cada slot del mostrador). Cada vez que se guarda, se agregan
// filas NUEVAS (no se borra nada) — así queda un historial completo de cómo
// fue rotando la vitrina en el tiempo. La "configuración actual" es
// simplemente la fila más reciente por tienda+slot (esa reducción la hace
// el backend de Next.js, no este script).
//
// Esta planilla vive dentro del Sheet compartido "Mermas Larrs" (pestaña
// "Vitrina"), junto con Inventario, Recepciones y Overrides — así queda
// todo en un solo archivo. Producción sigue en su propio Sheet aparte (no
// se toca, está atado al Google Form que ya usan a diario).
//
// Despliegue:
// 1. Abrir el Apps Script YA desplegado de Vitrina (o crear uno nuevo si es
//    la primera vez) → pegar este archivo completo, reemplazando todo.
// 2. Guardar → Implementar → Administrar implementaciones → editar (lápiz)
//    → Nueva versión → Implementar. La URL /exec no cambia.

const TOKEN = 'larrs-vitrina-2026';
const HUB_SPREADSHEET_ID = '1L952Ivf2eBZh9vQYmAOkJaZszBQUy2Uvmtub3RWifOw'; // Mermas Larrs
const SHEET_NAME = 'Vitrina';
const HEADERS = ['tienda', 'slot', 'sabor', 'actualizado_en', 'actualizado_por'];

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

// Devuelve TODO el historial (no solo la config actual) — el filtrado a
// "más reciente por slot" lo hace /api/vitrina en Next.js.
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
  items.sort(function (a, b) { return new Date(b.actualizado_en) - new Date(a.actualizado_en); });

  return jsonOut_({ ok: true, items: items });
}

// Agrega una fila nueva por cada slot con sabor (no borra nada existente).
function doPost(e) {
  if (e.parameter.token !== TOKEN) return jsonOut_({ ok: false, error: 'Token inválido' });

  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut_({ ok: false, error: 'Body inválido' }); }

  if (!body.tienda) return jsonOut_({ ok: false, error: 'Falta campo: tienda' });
  if (!Array.isArray(body.slots)) return jsonOut_({ ok: false, error: 'slots debe ser un array' });

  const actualizadoEn = new Date().toISOString();
  const nuevas = body.slots
    .filter(function (s) { return s.sabor; })
    .map(function (s) {
      return [body.tienda, s.slot, s.sabor, actualizadoEn, body.actualizado_por || ''];
    });

  if (nuevas.length > 0) {
    const sheet = ensureSheet_();
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, nuevas.length, HEADERS.length).setValues(nuevas);
  }

  return jsonOut_({ ok: true, count: nuevas.length });
}
