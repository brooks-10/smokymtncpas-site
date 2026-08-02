/* Smoky Mountain CPAs. Chat assistant widget.
 *
 * Vanilla JS, no framework, no build step, no dependencies. Loaded on every
 * page with <script src="/assets/chat.js" defer></script> just after site.js.
 *
 * ===========================================================================
 * DEPLOY STEP: paste the Cloudflare Worker URL below.
 * ===========================================================================
 * Until WORKER_URL is a non-empty string this file does nothing at all: no
 * bubble, no stylesheet request, no DOM. A live site with an unconfigured
 * widget looks exactly like a site with no widget. That is deliberate.
 *
 * Get the URL from `wrangler deploy` in the smcpas-chat-worker repo. It looks
 * like https://smcpas-chat.<subdomain>.workers.dev
 */
var WORKER_URL = "https://smcpas-chat.brooks-e6f.workers.dev";
/* ========================================================================= */

(function () {
  "use strict";

  if (!WORKER_URL) return; // not configured yet, stay invisible
  if (window.__smcChatLoaded) return; // never mount twice
  window.__smcChatLoaded = true;

  /* ---- configuration ---- */

  var PHONE_DISPLAY = "(865) 312-1203";
  var PHONE_HREF = "tel:+18653121203";
  var CALENDLY = "https://calendly.com/smokymountaincpas/30-min-discovery-call";
  var STRIPE = "https://buy.stripe.com/9B6dRa4P57nRdZL32u00000";

  var GREETING =
    "Ask anything about how we work, what it costs, or whether we're a fit. " +
    "For anything about your own books, a CPA is better than I am, and the call is free.";

  var ERROR_TEXT =
    "I'm having trouble right now. Call " +
    PHONE_DISPLAY +
    " or book a call and a CPA will pick up.";

  var MAX_CHARS = 1200; // keep in step with MAX_MESSAGE_CHARS on the Worker
  var MAX_STORED = 24; // keep in step with MAX_MESSAGES on the Worker
  var CTA_AFTER_EXCHANGES = 3;
  var STORAGE_KEY = "smc-chat-v1";

  /* ---- small helpers ---- */

  function track(name, params) {
    if (typeof window.gtag === "function") {
      try {
        window.gtag("event", name, params || {});
      } catch (e) {
        /* analytics must never break the widget */
      }
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Render a reply as HTML: escape everything first, then turn bare URLs and
     the firm's phone number into links. Nothing the model returns is ever
     inserted unescaped. */
  function renderText(text) {
    var html = escapeHtml(text);

    html = html.replace(/https?:\/\/[^\s<>"')\]]+/g, function (url) {
      var trailing = "";
      while (/[.,;:!?]$/.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }
      var external = url.indexOf("smokymtncpas.com") === -1;
      return (
        '<a href="' +
        url +
        '"' +
        (external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        url.replace(/^https?:\/\//, "") +
        "</a>" +
        trailing
      );
    });

    html = html.replace(
      /\(865\)\s?312-1203/g,
      '<a href="' + PHONE_HREF + '">' + PHONE_DISPLAY + "</a>",
    );

    return html.replace(/\n/g, "<br>");
  }

  /* ---- conversation state ---- */

  var messages = []; // [{ role: "user" | "assistant", content: string }]
  var busy = false;
  var ctaShown = false;
  var lastFocused = null;

  function load() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (Array.isArray(saved.messages)) messages = saved.messages.slice(-MAX_STORED);
      ctaShown = !!saved.ctaShown;
    } catch (e) {
      messages = [];
    }
  }

  function save() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ messages: messages.slice(-MAX_STORED), ctaShown: ctaShown }),
      );
    } catch (e) {
      /* private browsing, storage full: the conversation just will not persist */
    }
  }

  /* ---- stylesheet, loaded only now that we know we are mounting ---- */

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/chat.css";
  document.head.appendChild(link);

  /* ---- DOM ---- */

  var root = el("div", "smc-chat");
  root.setAttribute("data-open", "false");

  var launcher = el("button", "smc-chat-launcher");
  launcher.type = "button";
  launcher.id = "smc-chat-launcher";
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "smc-chat-panel");
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/>' +
    "</svg><span>Ask us a question</span>";

  var panel = el("div", "smc-chat-panel");
  panel.id = "smc-chat-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "smc-chat-title");

  var head = el("div", "smc-chat-head");
  var headText = el("div");
  var title = el("h2", null, "Ask us a question");
  title.id = "smc-chat-title";
  headText.appendChild(title);
  headText.appendChild(el("p", null, "Answers from what we publish. A CPA for everything else."));
  var closeBtn = el("button", "smc-chat-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close chat");
  closeBtn.innerHTML = "&times;";
  head.appendChild(headText);
  head.appendChild(closeBtn);

  var log = el("div", "smc-chat-log");
  log.id = "smc-chat-log";
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-atomic", "false");
  log.setAttribute("aria-label", "Conversation");

  var form = el("form", "smc-chat-form");
  var input = el("textarea");
  input.id = "smc-chat-input";
  input.rows = 1;
  input.maxLength = MAX_CHARS;
  input.placeholder = "Type your question";
  input.setAttribute("aria-label", "Your question");
  var send = el("button", "smc-chat-send");
  send.type = "submit";
  send.setAttribute("aria-label", "Send");
  send.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 12h15M13 6l6 6-6 6"/></svg>';
  form.appendChild(input);
  form.appendChild(send);

  var note = el("p", "smc-chat-note");
  note.innerHTML =
    "General information only, not tax or financial advice. Please don't send account " +
    'numbers or logins here. Prefer a person? <a href="' +
    PHONE_HREF +
    '">' +
    PHONE_DISPLAY +
    "</a>.";

  panel.appendChild(head);
  panel.appendChild(log);
  panel.appendChild(form);
  panel.appendChild(note);
  root.appendChild(launcher);
  root.appendChild(panel);

  /* ---- rendering ---- */

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  function addBubble(role, text) {
    var cls =
      role === "user"
        ? "smc-chat-msg smc-chat-msg-you"
        : role === "error"
          ? "smc-chat-msg smc-chat-msg-err"
          : "smc-chat-msg smc-chat-msg-bot";
    var node = el("div", cls);
    node.innerHTML = renderText(text);
    var who = el(
      "span",
      "smc-chat-sr",
      role === "user" ? "You said: " : role === "error" ? "Problem: " : "Smoky Mountain CPAs said: ",
    );
    node.insertBefore(who, node.firstChild);
    log.appendChild(node);
    scrollDown();
    return node;
  }

  function showTyping() {
    var node = el("div", "smc-chat-msg smc-chat-msg-bot smc-chat-typing");
    node.setAttribute("aria-label", "Typing");
    node.appendChild(el("span"));
    node.appendChild(el("span"));
    node.appendChild(el("span"));
    log.appendChild(node);
    scrollDown();
    return node;
  }

  function ctaLink(label, href, tag) {
    var a = el("a", null, label);
    a.href = href;
    if (href.indexOf("smokymtncpas.com") === -1 && href.indexOf("tel:") !== 0) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    a.addEventListener("click", function () {
      track("chat_cta_clicked", { cta: tag });
      // Mirror the site-wide conversion events so chat traffic lands in the
      // same GA4 funnels as the page CTAs.
      if (tag === "book_call") track("generate_lead", { lead_type: "discovery_call_click" });
      if (tag === "diagnostic")
        track("begin_checkout", { currency: "USD", value: 497, item_name: "Diagnostic Review" });
      if (tag === "phone") track("contact", { contact_type: "phone_click" });
    });
    return a;
  }

  function maybeShowCta() {
    if (ctaShown) return;
    var exchanges = messages.filter(function (m) {
      return m.role === "user";
    }).length;
    if (exchanges < CTA_AFTER_EXCHANGES) return;
    ctaShown = true;
    renderCta();
    save();
  }

  function renderCta() {
    var row = el("div", "smc-chat-cta");
    row.appendChild(ctaLink("Book a free 30-minute call", CALENDLY, "book_call"));
    row.appendChild(ctaLink("Diagnostic Review, $497", STRIPE, "diagnostic"));
    log.appendChild(row);
    scrollDown();
  }

  /* Tappable starter questions — shown until the visitor sends anything. */
  var STARTERS = [
    "How much does monthly bookkeeping cost?",
    "What's included in the $497 Diagnostic Review?",
    "Do you work with businesses like mine?",
    "My books are a mess. Can you clean them up?",
    "Do you file tax returns?",
  ];

  function renderStarters() {
    if (messages.length) return;
    var row = el("div", "smc-chat-starters");
    STARTERS.forEach(function (q) {
      var b = el("button", "smc-chat-starter", q);
      b.type = "button";
      b.addEventListener("click", function () {
        track("chat_starter_clicked", { question: q });
        input.value = q;
        submit();
      });
      row.appendChild(b);
    });
    log.appendChild(row);
    scrollDown();
  }

  function clearStarters() {
    var row = log.querySelector(".smc-chat-starters");
    if (row) row.remove();
  }

  function renderAll() {
    log.innerHTML = "";
    addBubble("assistant", GREETING);
    renderStarters();
    for (var i = 0; i < messages.length; i++) {
      addBubble(messages[i].role === "user" ? "user" : "assistant", messages[i].content);
    }
    if (ctaShown) renderCta();
  }

  /* ---- open and close ---- */

  var FOCUSABLE = 'button, [href], textarea, input, select, [tabindex]:not([tabindex="-1"])';

  function open() {
    if (root.getAttribute("data-open") === "true") return;
    lastFocused = document.activeElement;
    root.setAttribute("data-open", "true");
    launcher.setAttribute("aria-expanded", "true");
    track("chat_opened", { page_path: location.pathname });
    input.focus();
    scrollDown();
  }

  function close() {
    if (root.getAttribute("data-open") !== "true") return;
    root.setAttribute("data-open", "false");
    launcher.setAttribute("aria-expanded", "false");
    if (lastFocused && typeof lastFocused.focus === "function" && document.contains(lastFocused)) {
      lastFocused.focus();
    }
    // If that did not actually move focus (the element was the body, or has since
    // become unfocusable) fall back to the launcher, so focus is never stranded
    // on a hidden panel child.
    if (!document.activeElement || document.activeElement === document.body || panel.contains(document.activeElement)) {
      launcher.focus();
    }
  }

  launcher.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

  document.addEventListener("keydown", function (e) {
    if (root.getAttribute("data-open") !== "true") return;

    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }

    if (e.key !== "Tab") return;

    // Focus trap. The panel is a non-modal dialog, so the rest of the page
    // stays usable with the mouse, but keyboard focus stays inside while open.
    var items = Array.prototype.filter.call(panel.querySelectorAll(FOCUSABLE), function (n) {
      return n.offsetParent !== null && !n.disabled;
    });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];

    if (!panel.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /* ---- composer behaviour ---- */

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  }

  input.addEventListener("input", autoGrow);

  input.addEventListener("keydown", function (e) {
    // Enter sends, Shift+Enter makes a new line. Skip while an IME is composing.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : send.click();
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    submit();
  });

  /* ---- send ---- */

  function setBusy(state) {
    busy = state;
    send.disabled = state;
    input.disabled = state;
  }

  async function submit() {
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

    input.value = "";
    autoGrow();
    clearStarters();
    addBubble("user", text);
    messages.push({ role: "user", content: text });
    save();

    track("chat_message_sent", {
      message_number: messages.filter(function (m) {
        return m.role === "user";
      }).length,
      page_path: location.pathname,
    });

    setBusy(true);
    var typing = showTyping();

    var replyText = null;
    var errorText = null;

    try {
      var res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messages.slice(-MAX_STORED) }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(50000) : undefined,
      });

      var data = null;
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }

      if (data && typeof data.reply === "string" && data.reply.trim()) {
        replyText = data.reply.trim();
      } else if (data && typeof data.error === "string" && data.error.trim()) {
        errorText = data.error.trim();
      } else {
        errorText = ERROR_TEXT;
      }
    } catch (err) {
      errorText = ERROR_TEXT;
    }

    typing.remove();
    setBusy(false);

    if (replyText) {
      addBubble("assistant", replyText);
      messages.push({ role: "assistant", content: replyText });
      save();
      maybeShowCta();
    } else {
      // Do not push errors into `messages`. The model must never see them, and
      // the visitor should be able to retry with a clean history.
      var node = addBubble("error", errorText);
      var row = el("div", "smc-chat-cta");
      row.appendChild(ctaLink("Call " + PHONE_DISPLAY, PHONE_HREF, "phone"));
      row.appendChild(ctaLink("Book a call", CALENDLY, "book_call"));
      node.appendChild(row);
      scrollDown();
    }

    if (root.getAttribute("data-open") === "true") input.focus();
  }

  /* ---- mount ---- */

  load();
  document.body.appendChild(root);
  renderAll();
})();
