window._ordExtra = window._ordExtra || [];
window._lm = window._lm || { msgs: [] };

// Monkey-patch render() so extras persist after every re-render
(function patchRender() {
  if (typeof render !== 'function') { setTimeout(patchRender, 100); return; }
  var orig = render;
  window.render = render = function () {
    orig.apply(this, arguments);
    var ex = window._ordExtra || [];
    if (!ex.length) return;
    // Append extras to window._ord so Excel/copy include them
    window._ord = (window._ord || []).concat(ex);
    // Visual: append rows to the existing table
    var tbl = document.getElementById('tbl');
    if (!tbl) return;
    var old = document.getElementById('_lchat_extras');
    if (old) old.remove();
    var d = document.createElement('div');
    d.id = '_lchat_extras';
    var rows = ex.map(function (x) {
      return '<tr class="newrow"><td class="sku">' + x.sku + '</td>' +
        '<td>' + x.desc + ' <span class="nuevo">🤖 IA</span></td>' +
        '<td class="r"><span class="qty">' + x.sem + '</span></td>' +
        '<td class="um">' + x.um + '</td></tr>';
    }).join('');
    var table = tbl.querySelector('table');
    if (table) {
      var tbody = table.querySelector('tbody');
      if (tbody) tbody.insertAdjacentHTML('beforeend', '<tr class="grp-row"><td colspan="5">Agregado por IA · ' + ex.length + '</td></tr>' + rows);
    } else {
      d.innerHTML = '<table><tbody>' + rows + '</tbody></table>';
      tbl.appendChild(d);
    }
  };
})();

window.larrsAgregarProducto = function (sku, desc, cant, um, grupo, btnEl) {
  var ex = window._ordExtra;
  if (ex.find(function (x) { return x.sku === sku; })) {
    if (btnEl) { btnEl.textContent = 'Ya existe'; btnEl.disabled = true; }
    return;
  }
  ex.push({ sku: sku, desc: desc, sem: parseFloat(cant) || 1, um: um, grupo: grupo || 'Accesorios' });
  if (typeof render === 'function') render();
  if (btnEl) {
    btnEl.textContent = 'Agregado ✓';
    btnEl.disabled = true;
    btnEl.style.background = '#86efac';
    btnEl.style.color = '#14532d';
  }
};

window.larrsParseAI = function (text) {
  var result = text.replace(/\[AGREGAR:([^\]]+)\]/g, function (_, inner) {
    var p = inner.split('|');
    if (p.length < 4) return '[' + inner + ']';
    var sku = p[0].trim();
    var desc = p[1].trim();
    var cant = p[2].trim();
    var um = p[3].trim();
    var grp = (p[4] || 'Accesorios').trim();
    var safeSku = sku.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var safeDesc = desc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var safeCant = cant.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var safeUm = um.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var safeGrp = grp.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return '<button class="lcm-action-btn" onclick="larrsAgregarProducto(\'' +
      safeSku + '\',\'' + safeDesc + '\',\'' + safeCant + '\',\'' + safeUm + '\',\'' + safeGrp + '\',this)">' +
      '+ Agregar ' + desc + ' (' + cant + ' ' + um + ')</button>';
  });
  result = result.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  result = result.replace(/\n/g, '<br>');
  return result;
};

window.larrsSubmitChat = async function (e) {
  e.preventDefault();
  var inp = document.getElementById('larrs-chat-input');
  var text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  inp.disabled = true;
  document.getElementById('larrs-chat-send').disabled = true;
  var ms = document.getElementById('larrs-chat-msgs');
  window._lm.msgs.push({ role: 'user', content: text });
  var ud = document.createElement('div');
  ud.className = 'lcm-user';
  ud.textContent = text;
  ms.appendChild(ud);
  ms.scrollTop = ms.scrollHeight;
  var ad = document.createElement('div');
  ad.className = 'lcm-ai typing';
  ad.textContent = '...';
  ms.appendChild(ad);
  ms.scrollTop = ms.scrollHeight;
  var loc = document.getElementById('loc');
  var tienda = loc ? loc.value : (window._LARRS_TIENDA || '');
  try {
    var res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: window._lm.msgs,
        pedidoActual: (window._ord || []).slice(0, 120),
        tienda: tienda
      })
    });
    if (!res.ok) throw new Error('Error ' + res.status);
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var full = '';
    ad.className = 'lcm-ai';
    ad.textContent = '';
    while (true) {
      var r = await reader.read();
      if (r.done) break;
      full += decoder.decode(r.value, { stream: true });
      ad.textContent = full.replace(/\[AGREGAR:[^\]]*\]/g, '[sugerencia]');
      ms.scrollTop = ms.scrollHeight;
    }
    ad.innerHTML = window.larrsParseAI(full);
    window._lm.msgs.push({ role: 'assistant', content: full });
  } catch (err) {
    ad.className = 'lcm-ai';
    ad.textContent = 'Error al conectar. Intenta de nuevo.';
  }
  inp.disabled = false;
  document.getElementById('larrs-chat-send').disabled = false;
  inp.focus();
};

// Auto-alerts on load
function runAutoAlerts() {
  var ord = window._ord || [];
  if (!ord.length) { setTimeout(runAutoAlerts, 800); return; }
  var loc = document.getElementById('loc');
  var tienda = loc ? loc.value : (window._LARRS_TIENDA || 'Costanera');
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Analiza el pedido.' }],
      pedidoActual: ord.slice(0, 120),
      tienda: tienda,
      mode: 'alertas'
    })
  }).then(function (res) {
    if (!res.ok) return null;
    return res.text();
  }).then(function (text) {
    if (!text || text.trim().length < 20) return;
    var btn = document.getElementById('larrs-chat-btn');
    if (btn) btn.classList.add('has-alerts');
    var ms = document.getElementById('larrs-chat-msgs');
    if (!ms) return;
    var d = document.createElement('div');
    d.className = 'lcm-ai';
    d.innerHTML = 'Analisis del pedido:<br><br>' + window.larrsParseAI(text);
    var first = ms.firstChild;
    if (first && first.nextSibling) ms.insertBefore(d, first.nextSibling);
    else ms.appendChild(d);
    window._lm.msgs.push({ role: 'assistant', content: text });
  }).catch(function () {});
}
setTimeout(runAutoAlerts, 1500);
