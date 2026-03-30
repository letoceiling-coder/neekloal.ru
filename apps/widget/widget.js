/**
 * Embed AI chat widget — with SSE streaming, typing animation, retry.
 *
 * Simple embed (recommended):
 *   <script src="https://site-al.ru/widget.js" data-key="sk-..."></script>
 *
 * Advanced config (optional):
 *   window.AI_WIDGET_CONFIG = {
 *     apiKey:      "sk-...",    // alternative to data-key
 *     assistantId: "uuid",      // optional if baked into API key
 *     title:       "Support",   // optional
 *     greeting:    "...",       // optional
 *   };
 *
 * Legacy: AI_WIDGET_API, AI_WIDGET_KEY, AI_WIDGET_ASSISTANT_ID still work.
 *
 * Endpoints used:
 *   POST /widget/conversation  — create conversation (once)
 *   POST /chat/stream          — SSE streaming response
 *   GET  /widget/messages      — poll for server-push messages
 */
(function () {
  "use strict";

  /* ── read data-key / data-assistant-id from the <script> tag ── */
  var _script = null;
  try {
    _script = document.currentScript;
    if (!_script) {
      var _scripts = document.querySelectorAll('script[src*="widget.js"]');
      if (_scripts.length) _script = _scripts[_scripts.length - 1];
    }
  } catch (e) { /* ignore */ }
  var _dataKey = (_script && _script.getAttribute("data-key")) || "";
  var _dataAssistantId = (_script && _script.getAttribute("data-assistant-id")) || "";

  /* ── config ── */
  var DEFAULT_API = "https://site-al.ru/api";
  var cfg = window.AI_WIDGET_CONFIG || {};
  var API = (cfg.apiBaseUrl || cfg.apiUrl || cfg.baseUrl || window.AI_WIDGET_API || DEFAULT_API).replace(/\/$/, "");
  var KEY = _dataKey || cfg.apiKey || window.AI_WIDGET_KEY || "";
  var ASSISTANT_ID = _dataAssistantId || cfg.assistantId || window.AI_WIDGET_ASSISTANT_ID || "";
  var TITLE = cfg.title || "Chat";
  var GREETING =
    cfg.greeting != null && String(cfg.greeting).trim() !== ""
      ? String(cfg.greeting).trim()
      : "Здравствуйте! Напишите ваш вопрос — отвечу быстро.";

  var greetingShownThisSession = false;

  /* ── storage ── */
  function sk(suffix) { return "neeklo_ai_" + suffix + "_" + String(ASSISTANT_ID || "na"); }
  function skSeen()   { return sk("seen") + "_" + String(conversationId || ""); }
  function skWm()     { return sk("wm")   + "_" + String(conversationId || ""); }

  var conversationId = null;
  try {
    var saved = localStorage.getItem(sk("wconv"));
    if (saved) { conversationId = saved; greetingShownThisSession = true; }
  } catch (e) { /* ignore */ }

  /* ── DOM ── */
  var root = document.createElement("div");
  root.id = "ai-widget-root";
  document.body.appendChild(root);

  var style = document.createElement("style");
  style.textContent =
    "#ai-widget-root *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}" +
    "#ai-widget-toggle{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border:none;border-radius:50%;" +
    "background:#2563eb;color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 14px rgba(37,99,235,.45);z-index:99998;transition:background .15s}" +
    "#ai-widget-toggle:hover{background:#1d4ed8}" +
    "#ai-widget-panel{position:fixed;bottom:96px;right:24px;width:min(100vw - 32px,380px);height:min(70vh,520px);" +
    "background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden;z-index:99999}" +
    "#ai-widget-panel.ai-open{display:flex}" +
    "#ai-widget-head{padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:600;font-size:15px;color:#0f172a;display:flex;align-items:center;gap:8px}" +
    "#ai-widget-status{width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0}" +
    "#ai-widget-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;background:#fff;min-height:0}" +
    ".ai-msg{max-width:92%;padding:10px 12px;border-radius:10px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}" +
    ".ai-msg-user{align-self:flex-end;background:#dbeafe;color:#0f172a;border-bottom-right-radius:3px}" +
    ".ai-msg-bot{align-self:flex-start;background:#f1f5f9;color:#0f172a;border-bottom-left-radius:3px}" +
    ".ai-msg-err{align-self:center;background:#fee2e2;color:#991b1b;font-size:13px;text-align:center;border-radius:8px}" +
    ".ai-msg-loader{align-self:flex-start;background:#e2e8f0;color:#475569;font-size:13px;font-style:italic;border-radius:10px;border-bottom-left-radius:3px}" +
    "#ai-widget-input-row{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#f8fafc;align-items:center}" +
    "#ai-widget-input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font-size:14px;outline:none;resize:none;max-height:100px;overflow-y:auto}" +
    "#ai-widget-input:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}" +
    "#ai-widget-send{border:none;border-radius:8px;padding:10px 16px;background:#2563eb;color:#fff;font-size:14px;cursor:pointer;min-width:72px;transition:background .15s}" +
    "#ai-widget-send:disabled{opacity:.5;cursor:not-allowed}" +
    "#ai-widget-send:hover:not(:disabled){background:#1d4ed8}" +
    ".ai-cursor{display:inline-block;width:2px;height:1em;background:#475569;vertical-align:text-bottom;animation:ai-blink .7s step-end infinite;margin-left:1px}" +
    "@keyframes ai-blink{0%,100%{opacity:1}50%{opacity:0}}" +
    ".ai-widget-spin{display:inline-block;width:12px;height:12px;border:2px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;animation:aiw-rot .7s linear infinite;vertical-align:middle;margin-right:6px}" +
    "@keyframes aiw-rot{to{transform:rotate(360deg)}}";
  document.head.appendChild(style);

  var panel = document.createElement("div");
  panel.id = "ai-widget-panel";
  panel.innerHTML =
    '<div id="ai-widget-head"><span id="ai-widget-status"></span><span id="ai-widget-title"></span></div>' +
    '<div id="ai-widget-messages"></div>' +
    '<div id="ai-widget-input-row">' +
    '<input id="ai-widget-input" type="text" placeholder="Напишите сообщение…" autocomplete="off" />' +
    '<button id="ai-widget-send" type="button">Отправить</button>' +
    "</div>";

  var btn = document.createElement("button");
  btn.id = "ai-widget-toggle";
  btn.type = "button";
  btn.setAttribute("aria-label", "Открыть чат");
  btn.textContent = "💬";

  root.appendChild(btn);
  root.appendChild(panel);

  document.getElementById("ai-widget-title").textContent = TITLE;
  var messagesEl = document.getElementById("ai-widget-messages");
  var inputEl    = document.getElementById("ai-widget-input");
  var sendBtn    = document.getElementById("ai-widget-send");

  /* ── helpers ── */
  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function addLine(text, cls) {
    var d = document.createElement("div");
    d.className = "ai-msg " + cls;
    d.textContent = text;
    messagesEl.appendChild(d);
    scrollToBottom();
    return d;
  }

  function removeNode(n) { if (n && n.parentNode) n.parentNode.removeChild(n); }

  function apiUrl(path) { return API + path; }

  /* ── seen-ids / watermark (for poll) ── */
  var seenIds = new Set();

  function loadSeenIds() {
    seenIds.clear();
    if (!conversationId) return;
    try {
      var raw = localStorage.getItem(skSeen());
      if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) arr.forEach(function(id){ seenIds.add(String(id)); }); }
    } catch (e) { /* */ }
  }

  function saveSeenIds() {
    if (!conversationId) return;
    try { localStorage.setItem(skSeen(), JSON.stringify(Array.from(seenIds).slice(-250))); } catch (e) { /* */ }
  }

  function rememberSync(sync) {
    if (!sync) return;
    if (sync.userMessageId)      seenIds.add(String(sync.userMessageId));
    if (sync.assistantMessageId) seenIds.add(String(sync.assistantMessageId));
    if (sync.lastCreatedAt) {
      try { localStorage.setItem(skWm(), String(sync.lastCreatedAt)); } catch (e) { /* */ }
    }
    saveSeenIds();
  }

  /* ── conversation init ── */
  function ensureConversation(firstUserText) {
    if (conversationId) return Promise.resolve(conversationId);
    if (!API || !KEY) return Promise.reject(new Error("config"));
    var msg = firstUserText != null ? String(firstUserText).trim() : "";
    return fetch(apiUrl("/widget/conversation"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": KEY,
        "X-Widget-Client": "1",
      },
      body: JSON.stringify({
        assistantId: ASSISTANT_ID || undefined,
        firstMessage: msg ? msg.slice(0, 8000) : null,
        userAgent: typeof navigator !== "undefined" ? String(navigator.userAgent || "").slice(0, 4000) : null,
        referer: typeof document !== "undefined" ? String(document.referrer || "").slice(0, 4000) : null,
      }),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || "conversation_failed");
        if (!data.conversationId) throw new Error("no_conversation_id");
        conversationId = data.conversationId;
        try { localStorage.setItem(sk("wconv"), conversationId); } catch (e) { /* */ }
        return conversationId;
      });
    });
  }

  /* ── SSE streaming fetch ── */
  function sendChatStream(userText, convId, onToken, onDone, onError) {
    var body = JSON.stringify({
      message: userText,
      assistantId: ASSISTANT_ID || undefined,
      conversationId: convId,
    });

    fetch(apiUrl("/chat/stream"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": KEY,
        "X-Widget-Client": "1",
      },
      body: body,
    }).then(function (res) {
      if (!res.ok || !res.body) {
        return res.json().catch(function () { return { error: "HTTP " + res.status }; }).then(function (d) {
          onError(new Error((d && d.error) || "HTTP " + res.status));
        });
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) { onDone(); return; }
          buf += decoder.decode(result.value, { stream: true });
          var parts = buf.split("\n\n");
          buf = parts.pop();
          parts.forEach(function (block) {
            var eventLine = "", dataLine = "";
            block.split("\n").forEach(function (line) {
              if (line.startsWith("event:")) eventLine = line.slice(6).trim();
              if (line.startsWith("data:"))  dataLine  = line.slice(5).trim();
            });
            if (!dataLine) return;
            try {
              var obj = JSON.parse(dataLine);
              if (eventLine === "token" && obj.token != null) {
                onToken(String(obj.token));
              } else if (eventLine === "done") {
                // done event — reader.done will follow
              } else if (eventLine === "error") {
                onError(new Error(obj.error || "stream error"));
              }
            } catch (e) { /* ignore */ }
          });
          return pump();
        });
      }

      return pump();
    }).catch(function (err) { onError(err); });
  }

  /* ── main send function ── */
  var isSending = false;

  function send(retryCount) {
    if (isSending) return;
    var text = (inputEl.value || "").trim();
    if (!text) return;

    if (!KEY) {
      addLine("Укажите data-key в теге script или AI_WIDGET_CONFIG.apiKey", "ai-msg-err");
      return;
    }

    retryCount = retryCount || 0;
    isSending = true;
    inputEl.value = "";
    addLine(text, "ai-msg-user");
    sendBtn.disabled = true;

    // Typing indicator
    var loader = document.createElement("div");
    loader.className = "ai-msg ai-msg-loader";
    loader.innerHTML = '<span class="ai-widget-spin"></span>Печатает…';
    messagesEl.appendChild(loader);
    scrollToBottom();

    // Bot bubble that fills token by token
    var botBubble = null;
    var cursor = null;

    ensureConversation(text)
      .then(function (convId) {
        return new Promise(function (resolve, reject) {
          sendChatStream(
            text,
            convId,
            function onToken(token) {
              removeNode(loader);
              loader = null;
              if (!botBubble) {
                botBubble = document.createElement("div");
                botBubble.className = "ai-msg ai-msg-bot";
                cursor = document.createElement("span");
                cursor.className = "ai-cursor";
                messagesEl.appendChild(botBubble);
                botBubble.appendChild(cursor);
              }
              // Insert token before cursor
              botBubble.insertBefore(document.createTextNode(token), cursor);
              scrollToBottom();
            },
            function onDone() {
              removeNode(cursor);
              cursor = null;
              resolve();
            },
            function onError(err) {
              reject(err);
            }
          );
        });
      })
      .then(function () {
        if (loader) removeNode(loader);
      })
      .catch(function (err) {
        if (loader) removeNode(loader);
        if (cursor && botBubble) removeNode(cursor);

        if (retryCount === 0) {
          // Show brief retry message then retry once automatically
          var retryNote = addLine("Ошибка соединения. Повтор…", "ai-msg-err");
          isSending = false;
          inputEl.value = text; // restore text
          setTimeout(function () {
            removeNode(retryNote);
            // Remove the user bubble we already added
            var userBubbles = messagesEl.querySelectorAll(".ai-msg-user");
            if (userBubbles.length) {
              var last = userBubbles[userBubbles.length - 1];
              if (last.textContent === text) removeNode(last);
            }
            send(1); // retry once
          }, 1500);
          return;
        }

        // Second failure — show permanent error
        var errMsg = err && err.message
          ? String(err.message)
          : "Ошибка соединения";
        addLine("Ошибка: " + errMsg, "ai-msg-err");
      })
      .finally(function () {
        if (isSending) {
          isSending = false;
          sendBtn.disabled = false;
          inputEl.focus();
          scrollToBottom();
        }
      });
  }

  /* ── poll for server-push messages ── */
  var pollTimer = null;

  function pollServerMessages() {
    if (!API || !KEY || !conversationId) return;
    var after = "1970-01-01T00:00:00.000Z";
    try { var wm = localStorage.getItem(skWm()); if (wm) after = wm; } catch (e) { /* */ }
    var url =
      apiUrl("/widget/messages") +
      "?conversationId=" + encodeURIComponent(conversationId) +
      "&after=" + encodeURIComponent(after);
    fetch(url, {
      method: "GET",
      headers: { "X-Api-Key": KEY, "X-Widget-Client": "1" },
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
      .then(function (r) {
        if (!r.ok || !r.data || !Array.isArray(r.data.messages)) return;
        var maxT = after;
        r.data.messages.forEach(function (m) {
          var id = String(m.id);
          if (seenIds.has(id)) return;
          seenIds.add(id);
          var role = m.role === "user" ? "ai-msg-user" : "ai-msg-bot";
          if (m.role === "assistant" || m.role === "user") addLine(String(m.content || ""), role);
          var t = m.createdAt ? String(m.createdAt) : "";
          if (t && t > maxT) maxT = t;
        });
        saveSeenIds();
        if (maxT !== after) {
          try { localStorage.setItem(skWm(), maxT); } catch (e) { /* */ }
        }
      })
      .catch(function () { /* ignore */ });
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(pollServerMessages, 25000);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ── toggle ── */
  var open = false;
  btn.addEventListener("click", function () {
    open = !open;
    panel.classList.toggle("ai-open", open);
    btn.setAttribute("aria-label", open ? "Закрыть чат" : "Открыть чат");
    btn.textContent = open ? "✕" : "💬";
    if (open) {
      if (!conversationId && !greetingShownThisSession && messagesEl.childElementCount === 0) {
        greetingShownThisSession = true;
        addLine(GREETING, "ai-msg-bot");
      }
      if (conversationId) {
        loadSeenIds();
        pollServerMessages();
        startPoll();
      }
      inputEl.focus();
      scrollToBottom();
    } else {
      stopPoll();
    }
  });

  sendBtn.addEventListener("click", function () { send(0); });
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(0); }
  });
})();
