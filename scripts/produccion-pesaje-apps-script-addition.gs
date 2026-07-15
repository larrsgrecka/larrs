// ─── ADICIÓN al Apps Script de Producción (NO reemplazar el archivo) ───────
// Este bloque se AGREGA al final del Code.gs que ya existe (el que tiene
// doGet, getProductionCSV_, getSalesJSON_, etc. — SPREADSHEET_ID, COMPS_ID
// y SECRET_TOKEN ya están definidos ahí arriba, no los repitas).
//
// Qué hace: agrega un doPost que escribe una fila nueva directo en la misma
// hoja que ya lee getProductionCSV_() (SpreadsheetApp.openById(SPREADSHEET_ID)
// .getSheets()[0]) — el mismo efecto que si alguien llenara el Google Form,
// para que /produccion siga funcionando exactamente igual sin cambios.
//
// Pasos:
// 1. Abre el Apps Script de Producción (el que responde en
//    .../AKfycbzO2QtBbjXbzbVF0xIPzAn5Uh5P6amNiDE4sCgSolkG0wdynTfQKjxD99tzJ5thB9Zh/exec).
// 2. Al final del archivo Code.gs (después de todo lo que ya hay), pega
//    este bloque completo.
// 3. Guarda (Ctrl+S).
// 4. Implementar → Administrar implementaciones → editar (lápiz) →
//    Nueva versión → Implementar. La URL /exec no cambia.
// 5. No hace falta ninguna variable de entorno nueva en el repo: la URL y
//    el token son los mismos que ya usa /produccion
//    (PRODUCCION_APPS_SCRIPT_URL / PRODUCCION_APPS_SCRIPT_TOKEN en .env.local,
//    con el mismo valor que el APPS_SCRIPT_URL ya hardcodeado en produccion.html).

function doPost(e) {
  if (!e || !e.parameter || e.parameter.token !== SECRET_TOKEN) {
    return jsonOutPesaje_({ ok: false, error: 'No autorizado' });
  }

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutPesaje_({ ok: false, error: 'Body inválido' });
  }

  var required = ['fecha', 'tienda', 'reportado_por_email', 'reportado_por_nombre'];
  for (var i = 0; i < required.length; i++) {
    if (!body[required[i]]) return jsonOutPesaje_({ ok: false, error: 'Falta campo: ' + required[i] });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return jsonOutPesaje_({ ok: false, error: 'items debe ser un array con al menos un sabor' });
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheets()[0];
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // Índice de cada columna de sabor por su nombre limpio (mismo criterio de
  // corte que usa produccion.html: hasta el primer '[' o '#' del header).
  var colBySabor = {};
  var colObservaciones = -1;
  for (var c = 0; c < headers.length; c++) {
    var hdr = String(headers[c]);
    if (hdr.indexOf('#;') !== -1) {
      var cutBracket = hdr.indexOf('[');
      var cutHash = hdr.indexOf('#');
      var cut = Math.min(cutBracket === -1 ? hdr.length : cutBracket, cutHash === -1 ? hdr.length : cutHash);
      colBySabor[hdr.slice(0, cut).trim()] = c;
    }
    if (hdr.toLowerCase().indexOf('observaci') !== -1) colObservaciones = c;
  }

  var notFound = [];
  body.items.forEach(function (item) {
    if (!(item.sabor in colBySabor)) notFound.push(item.sabor);
  });
  if (notFound.length > 0) {
    return jsonOutPesaje_({ ok: false, error: 'Sabores no encontrados en la planilla: ' + notFound.join(', ') });
  }

  var row = new Array(lastCol).fill('');
  var partesFecha = String(body.fecha).split('-').map(Number);
  var fechaDate = new Date(partesFecha[0], partesFecha[1] - 1, partesFecha[2]);

  row[0] = new Date();               // Marca temporal
  row[1] = body.reportado_por_email; // Dirección de correo electrónico
  row[2] = body.tienda;              // Tienda
  row[3] = fechaDate;                // Fecha de recuento
  row[4] = body.reportado_por_nombre;// Nombre
  row[5] = 'Fabricación';            // Tipo de Recuento
  if (colObservaciones >= 0 && body.observaciones) row[colObservaciones] = body.observaciones;

  body.items.forEach(function (item) {
    row[colBySabor[item.sabor]] = item.cantidad;
  });

  sheet.appendRow(row);

  return jsonOutPesaje_({ ok: true, count: body.items.length });
}

function jsonOutPesaje_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
