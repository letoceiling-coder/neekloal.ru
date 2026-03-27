/**
 * AI Chat Widget — load after setting:
 *   window.AI_WIDGET_API = "https://api.example.com";
 *   window.AI_WIDGET_KEY = "sk-...";
 *   window.AI_WIDGET_ASSISTANT_ID = "uuid";
 */
(function () {
  "use strict";

  var API = window.AI_WIDGET_API || "";
  var KEY = window.AI_WIDGET_KEY || "";
  var ASSISTANT_ID = window.AI_WIDGET_ASSISTANT_ID || "";

  var root = document.createElement("div");
  root.id = "ai-widget-root";
  document.body.appendChild(root);

  var style = document.createElement("style");
  style.textContent =
    "#ai-widget-root *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}" +
    "#ai-widget-toggle{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border:none;border-radius:50%;" +
    "background:#2563eb;color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 14px rgba(37,99,235,.45);z-index:99998}" +
    "#ai-widget-toggle:hover{background:#1d4ed8}" +
    "#ai-widget-panel{position:fixed;bottom:96px;right:24px;width:min(100vw - 32px,380px);height:min(70vh,520px);" +
    "background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden;z-index:99999}" +
    "#ai-widget-panel.ai-open{display:flex}" +
    "#ai-widget-head{padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:600;font-size:15px;color:#0f172a}" +
    "#ai-widget-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;background:#fff}" +
    ".ai-msg{max-width:92%;padding:10px 12px;border-radius:10px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}" +
    ".ai-msg-user{align-self:flex-end;background:#dbeafe;color:#0f172a}" +
    ".ai-msg-bot{align-self:flex-start;background:#f1f5f9;color:#0f172a}" +
    ".ai-msg-err{align-self:center;background:#fee2e2;color:#991b1b;font-size:13px}" +
    "#ai-widget-input-row{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#f8fafc}" +
    "#ai-widget-input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font-size:14px;outline:none}" +
    "#ai-widget-input:focus{border-color:#2563eb}" +
    "#ai-widget-send{border:none;border-radius:8px;padding:10px 16px;background:#2563eb;color:#fff;font-size:14px;cursor:pointer}" +
    "#ai-widget-send:disabled{opacity:.55;cursor:not-allowed}" +
    "#ai-widget-send:hover:not(:disabled){background:#1d4ed8}";
  document.head.appendChild(style);

  var panel = document.createElement("div");
  panel.id = "ai-widget-panel";
  panel.innerHTML =
    '<div id="ai-widget-head">Chat</div>' +
    '<div id="ai-widget-messages"></div>' +
    '<div id="ai-widget-input-row">' +
    '<input id="ai-widget-input" type="text" placeholder="Message…" autocomplete="off" />' +
    '<button id="ai-widget-send" type="button">Send</button>' +
    '</div>';

  var btn = document.createElement("button");
  btn.id = "ai-widget-toggle";
  btn.type = "button";
  btn.setAttribute("aria-label", "Open chat");
  btn.textContent = "💬";

  root.appendChild(btn);
  root.appendChild(panel);

  var messagesEl = document.getElementById("ai-widget-messages");
  var inputEl = document.getElementById("ai-widget-input");
  var sendBtn = document.getElementById("ai-widget-send");

  var open = false;
  btn.addEventListener("click", function () {
    open = !open;
    panel.classList.toggle("ai-open", open);
    btn.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    if (open) inputEl.focus();
  });

  function addLine(text, cls) {
    var d = document.createElement("div");
    d.className = "ai-msg " + cls;
    d.textContent = text;
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function send() {
    var text = (inputEl.value || "").trim();
    if (!text) return;

    if (!API || !KEY || !ASSISTANT_ID) {
      addLine("Configure AI_WIDGET_API, AI_WIDGET_KEY, AI_WIDGET_ASSISTANT_ID", "ai-msg-err");
      return;
    }

    inputEl.value = "";
    addLine(text, "ai-msg-user");
    sendBtn.disabled = true;

    var url = API.replace(/\/$/, "") + "/chat";
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + KEY,
      },
      body: JSON.stringify({
        message: text,
        assistantId: ASSISTANT_ID,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (r) {
        if (r.ok && r.data && r.data.reply != null) {
          addLine(String(r.data.reply), "ai-msg-bot");
        } else {
          var err =
            (r.data && (r.data.error || r.data.message)) ||
            "Request failed (" + r.status + ")";
          addLine(err, "ai-msg-err");
        }
      })
      .catch(function () {
        addLine("Network error", "ai-msg-err");
      })
      .finally(function () {
        sendBtn.disabled = false;
        inputEl.focus();
      });
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
})();
