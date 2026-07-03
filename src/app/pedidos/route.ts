import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { readFileSync } from "fs";
import { join } from "path";

function buildInject(tienda: string | null): string {
  const tiendaJson = JSON.stringify(tienda);
  return `<script>
window._LARRS_TIENDA=${tiendaJson};
window._ordExtra=[];
window._lm={msgs:[]};
window.larrsToggleChat=function(){
  var p=document.getElementById('larrs-chat-panel');
  if(!p)return;
  p.classList.toggle('open');
  if(p.classList.contains('open')){
    var btn=document.getElementById('larrs-chat-btn');
    if(btn)btn.classList.remove('has-alerts');
    var ms=document.getElementById('larrs-chat-msgs');
    if(ms)ms.scrollTop=ms.scrollHeight;
  }
};
</script>
<script src="/larrs-nav.js" defer></script>
<script src="/larrs-chat.js" defer></script>
<style>
#larrs-chat-btn{position:fixed;bottom:24px;right:24px;z-index:9999;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#111418,#1e293b);border:none;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;font-size:22px;transition:transform 0.15s}
#larrs-chat-btn:hover{transform:scale(1.08)}
#larrs-chat-btn.has-alerts::after{content:'';position:absolute;top:4px;right:4px;width:12px;height:12px;border-radius:50%;background:#ef4444;border:2px solid #fff;animation:pulse-dot 1.5s infinite}
@keyframes pulse-dot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.8}}
#larrs-chat-panel{position:fixed;bottom:88px;right:24px;z-index:9998;width:380px;max-height:560px;background:#fff;border-radius:18px;box-shadow:0 8px 32px rgba(0,0,0,0.18);display:none;flex-direction:column;overflow:hidden;border:1px solid #e2e8f0}
#larrs-chat-panel.open{display:flex}
#larrs-chat-header{background:linear-gradient(135deg,#111418,#1e293b);padding:14px 16px;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px}
#larrs-chat-header span{font-size:18px}
#larrs-chat-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:200px}
.lcm-user{align-self:flex-end;background:#1e293b;color:#fff;padding:8px 12px;border-radius:14px 14px 4px 14px;font-size:13px;max-width:85%;line-height:1.45}
.lcm-ai{align-self:flex-start;background:#f1f5f9;color:#1e293b;padding:8px 12px;border-radius:14px 14px 14px 4px;font-size:13px;max-width:90%;line-height:1.55;white-space:pre-wrap}
.lcm-ai.typing{color:#94a3b8}
.lcm-action-btn{display:inline-block;margin-top:6px;background:#16a34a;color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:12px;cursor:pointer;font-weight:600}
.lcm-action-btn:disabled{background:#86efac;cursor:not-allowed}
#larrs-chat-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #f1f5f9}
#larrs-chat-input{flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;font-size:13px;outline:none;font-family:inherit}
#larrs-chat-input:focus{border-color:#94a3b8}
#larrs-chat-send{background:#1e293b;color:#fff;border:none;border-radius:10px;padding:0 14px;cursor:pointer;font-size:18px}
#larrs-chat-send:disabled{opacity:0.4;cursor:not-allowed}
#tbl-extras{margin-top:20px}
#tbl-extras .extras-title{font-size:11px;color:#16a34a;margin-bottom:8px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
</style>`;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const profile = await getProfile();
  const tienda =
    profile?.role === "jefe_tienda" && profile.tienda ? profile.tienda : null;

  let html = readFileSync(
    join(process.cwd(), "src", "panels", "pedidos.html"),
    "utf8"
  );

  const chatHTML = `
<button id="larrs-chat-btn" title="Asistente IA" onclick="larrsToggleChat()">🤖</button>
<div id="larrs-chat-panel">
  <div id="larrs-chat-header"><span>🤖</span> Asistente de pedidos</div>
  <div id="larrs-chat-msgs">
    <div class="lcm-ai">Hola! Puedo ayudarte con el pedido y revisar el historial de compras.</div>
  </div>
  <form id="larrs-chat-form" onsubmit="larrsSubmitChat(event)">
    <textarea id="larrs-chat-input" placeholder="Pregunta sobre el pedido..." rows="1"
      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();larrsSubmitChat(event)}"></textarea>
    <button id="larrs-chat-send" type="submit">&#8593;</button>
  </form>
</div>`;

  html = html.replace("<body>", `<body>\n${buildInject(tienda)}`);
  html = html.replace("</body>", `${chatHTML}\n</body>`);

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
