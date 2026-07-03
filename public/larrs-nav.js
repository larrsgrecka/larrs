document.addEventListener('DOMContentLoaded', function () {
  var hdr = document.querySelector('.header');
  if (!hdr) return;
  var a = document.createElement('a');
  a.href = '/';
  a.textContent = '← Inicio';
  a.style.cssText = 'color:#94a3b8;font-size:13px;font-weight:600;text-decoration:none;' +
    'padding:7px 14px;border:1px solid #334155;border-radius:8px;white-space:nowrap;flex-shrink:0;';
  a.onmouseover = function () { this.style.color = '#fff'; this.style.borderColor = '#94a3b8'; };
  a.onmouseout = function () { this.style.color = '#94a3b8'; this.style.borderColor = '#334155'; };
  hdr.insertBefore(a, hdr.firstChild);
});
