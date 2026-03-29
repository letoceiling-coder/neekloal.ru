/**
 * Embed AI chat widget — MVP.
 *
 * Config (recommended):
 *   window.AI_WIDGET_CONFIG = {
 *     apiBaseUrl: "https://your-api.example.com",
 *     apiKey: "sk-...",
 *     assistantId: "uuid-assistant",
 *     title: "Support",   // optional
 *     greeting: "..."     // optional, авто-приветствие при первом открытии пустого чата
 *   };
 *
 * Legacy globals still work: AI_WIDGET_API, AI_WIDGET_KEY, AI_WIDGET_ASSISTANT_ID
 *
 * Embed:
 *   <script src="https://cdn-or-static/widget.js"></script>
 *
 * API: POST /widget/conversation (once) + POST /chat + GET /widget/messages (poll, follow-up)
 */
(function () {
  "use strict";

  var cfg = window.AI_WIDGET_CONFIG || {};
  var API =
    cfg.apiBaseUrl ||
    cfg.apiUrl ||
    cfg.baseUrl ||
    window.AI_WIDGET_API ||
    "";
  var KEY = cfg.apiKey || window.AI_WIDGET_KEY || "";
  var ASSISTANT_ID = cfg.assistantId || window.AI_WIDGET_ASSISTANT_ID || "";
  var TITLE = cfg.title || "Chat";
  var GREETING =
    cfg.greeting != null && String(cfg.greeting).trim() !== ""
      ? String(cfg.greeting).trim()
      : "Здравствуйте! Расскажу о решении и условиях, помогу быстро оформить заявку. Напишите, что вам нужно — или сразу оставьте телефон: перезвоним в ближайшее время и уточним детали.";
  var greetingShownThisSession = false;

  var storageKey = function () {
    return "neeklo_ai_wconv_" + String(ASSISTANT_ID || "na");
  };

  var conversationId = null;
  try {
    var saved = localStorage.getItem(storageKey());
    if (saved) {
      conversationId = saved;
      greetingShownThisSession = true;
    }
  } catch (e) {
    /* ignore */
  }

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
    "#ai-widget-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;background:#fff;min-height:0}" +
    ".ai-msg{max-width:92%;padding:10px 12px;border-radius:10px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}" +
    ".ai-msg-user{align-self:flex-end;background:#dbeafe;color:#0f172a}" +
    ".ai-msg-bot{align-self:flex-start;background:#f1f5f9;color:#0f172a}" +
    ".ai-msg-err{align-self:center;background:#fee2e2;color:#991b1b;font-size:13px;text-align:center}" +
    ".ai-msg-loader{align-self:flex-start;background:#e2e8f0;color:#475569;font-size:13px;font-style:italic}" +
    "#ai-widget-input-row{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#f8fafc;align-items:center}" +
    "#ai-widget-input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font-size:14px;outline:none}" +
    "#ai-widget-input:focus{border-color:#2563eb}" +
    "#ai-widget-send{border:none;border-radius:8px;padding:10px 16px;background:#2563eb;color:#fff;font-size:14px;cursor:pointer;min-width:72px}" +
    "#ai-widget-send:disabled{opacity:.55;cursor:not-allowed}" +
    "#ai-widget-send:hover:not(:disabled){background:#1d4ed8}" +
    ".ai-widget-spin{display:inline-block;width:14px;height:14px;border:2px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;animation:aiw-rot .7s linear infinite;vertical-align:middle;margin-right:6px}" +
    "@keyframes aiw-rot{to{transform:rotate(360deg)}}";
  document.head.appendChild(style);

  var panel = document.createElement("div");
  panel.id = "ai-widget-panel";
  panel.innerHTML =
    '<div id="ai-widget-head"></div>' +
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

  var headEl = document.getElementById("ai-widget-head");
  headEl.textContent = TITLE;

  var messagesEl = document.getElementById("ai-widget-messages");
  var inputEl = document.getElementById("ai-widget-input");
  var sendBtn = document.getElementById("ai-widget-send");

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addLine(text, cls) {
    var d = document.createElement("div");
    d.className = "ai-msg " + cls;
    d.textContent = text;
    messagesEl.appendChild(d);
    scrollToBottom();
    return d;
  }

  function removeLoader(node) {
    if (node && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }

  var pollTimer = null;
  var seenIds = new Set();

  function storageKeySeen() {
    return "neeklo_ai_seen_" + String(ASSISTANT_ID || "na") + "_" + String(conversationId || "");
  }

  function storageKeyWm() {
    return "neeklo_ai_wm_" + String(ASSISTANT_ID || "na") + "_" + String(conversationId || "");
  }

  function loadSeenIds() {
    seenIds.clear();
    if (!conversationId) {
      return;
    }
    try {
      var raw = localStorage.getItem(storageKeySeen());
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.forEach(function (id) {
            seenIds.add(String(id));
          });
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  function saveSeenIds() {
    if (!conversationId) {
      return;
    }
    try {
      localStorage.setItem(storageKeySeen(), JSON.stringify(Array.from(seenIds).slice(-250)));
    } catch (e) {
      /* ignore */
    }
  }

  function rememberSync(sync) {
    if (!sync) {
      return;
    }
    if (sync.userMessageId) {
      seenIds.add(String(sync.userMessageId));
    }
    if (sync.assistantMessageId) {
      seenIds.add(String(sync.assistantMessageId));
    }
    if (sync.lastCreatedAt) {
      try {
        localStorage.setItem(storageKeyWm(), String(sync.lastCreatedAt));
      } catch (e) {
        /* ignore */
      }
    }
    saveSeenIds();
  }

  function pollServerMessages() {
    if (!API || !KEY || !conversationId) {
      return;
    }
    var after = "1970-01-01T00:00:00.000Z";
    try {
      var wm = localStorage.getItem(storageKeyWm());
      if (wm) {
        after = wm;
      }
    } catch (e) {
      /* ignore */
    }
    var url =
      apiUrl("/widget/messages") +
      "?conversationId=" +
      encodeURIComponent(conversationId) +
      "&after=" +
      encodeURIComponent(after);
    fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": KEY,
        "X-Widget-Client": "1",
      },
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (r) {
        if (!r.ok || !r.data || !Array.isArray(r.data.messages)) {
          return;
        }
        var maxT = after;
        r.data.messages.forEach(function (m) {
          var id = String(m.id);
          if (seenIds.has(id)) {
            return;
          }
          seenIds.add(id);
          var role = m.role === "user" ? "ai-msg-user" : "ai-msg-bot";
          if (m.role === "assistant" || m.role === "user") {
            addLine(String(m.content || ""), role);
          }
          var t = m.createdAt ? String(m.createdAt) : "";
          if (t && t > maxT) {
            maxT = t;
          }
        });
        saveSeenIds();
        if (maxT !== after) {
          try {
            localStorage.setItem(storageKeyWm(), maxT);
          } catch (e) {
            /* ignore */
          }
        }
      })
      .catch(function () {
        /* ignore */
      });
  }

  function startPoll() {
    if (pollTimer) {
      return;
    }
    pollTimer = setInterval(pollServerMessages, 25000);
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  var open = false;
  btn.addEventListener("click", function () {
    open = !open;
    panel.classList.toggle("ai-open", open);
    btn.setAttribute("aria-label", open ? "Закрыть чат" : "Открыть чат");
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

  function apiUrl(path) {
    return API.replace(/\/$/, "") + path;
  }

  function ensureConversation(firstUserText) {
    if (conversationId) {
      return Promise.resolve(conversationId);
    }
    if (!API || !KEY || !ASSISTANT_ID) {
      return Promise.reject(new Error("config"));
    }
    var msg = firstUserText != null ? String(firstUserText).trim() : "";
    return fetch(apiUrl("/widget/conversation"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": KEY,
        "X-Widget-Client": "1",
      },
      body: JSON.stringify({
        assistantId: ASSISTANT_ID,
        firstMessage: msg ? msg.slice(0, 8000) : null,
        userAgent: typeof navigator !== "undefined" ? String(navigator.userAgent || "").slice(0, 4000) : null,
        referer: typeof document !== "undefined" ? String(document.referrer || "").slice(0, 4000) : null,
      }),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          throw new Error((data && data.error) || "conversation_failed");
        }
        if (!data.conversationId) {
          throw new Error("no_conversation_id");
        }
        conversationId = data.conversationId;
        try {
          localStorage.setItem(storageKey(), conversationId);
        } catch (e) {
          /* ignore */
        }
        return conversationId;
      });
    });
  }

  function sendChat(userText, convId) {
    return fetch(apiUrl("/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": KEY,
        "X-Widget-Client": "1",
      },
      body: JSON.stringify({
        message: userText,
        assistantId: ASSISTANT_ID,
        conversationId: convId,
      }),
    }).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function send() {
    var text = (inputEl.value || "").trim();
    if (!text) {
      return;
    }

    if (!API || !KEY || !ASSISTANT_ID) {
      addLine("Задайте AI_WIDGET_CONFIG: apiBaseUrl, apiKey, assistantId", "ai-msg-err");
      return;
    }

    inputEl.value = "";
    addLine(text, "ai-msg-user");
    sendBtn.disabled = true;

    var loader = document.createElement("div");
    loader.className = "ai-msg ai-msg-loader";
    loader.innerHTML = '<span class="ai-widget-spin"></span>Ответ…';
    messagesEl.appendChild(loader);
    scrollToBottom();

    ensureConversation(text)
      .then(function (convId) {
        return sendChat(text, convId);
      })
      .then(function (r) {
        removeLoader(loader);
        if (r.ok && r.data && r.data.reply != null) {
          if (r.data.sync) {
            rememberSync(r.data.sync);
          }
          addLine(String(r.data.reply), "ai-msg-bot");
          if (r.data.warning) {
            addLine("Лимит: " + String(r.data.warning), "ai-msg-err");
          }
        } else {
          var err =
            (r.data && (r.data.error || r.data.message)) ||
            "Ошибка (" + r.status + ")";
          addLine(err, "ai-msg-err");
        }
        scrollToBottom();
      })
      .catch(function (err) {
        removeLoader(loader);
        if (err && err.message === "config") {
          addLine("Нет конфигурации виджета", "ai-msg-err");
        } else {
          addLine(err && err.message ? String(err.message) : "Сеть недоступна", "ai-msg-err");
        }
        scrollToBottom();
      })
      .finally(function () {
        sendBtn.disabled = false;
        inputEl.focus();
        scrollToBottom();
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
