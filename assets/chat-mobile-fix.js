/* Smoky Mountain CPAs. Mobile clamp for the GoHighLevel chat widget.
 *
 * The GHL <chat-widget> element (loader.js, data-widget-id
 * 6a84b5ce7eb38cd3accabcd6) renders entirely inside a shadow DOM, so page CSS
 * cannot reach it. On narrow viewports its auto-prompt greeting bubble (and
 * the opened chat panel, which shares the same container under an --active
 * class) can render wider than the screen and clip off the right edge. GHL's
 * own builder has no control for this. This script watches the shadow DOM
 * and forces the bubble to stay on screen, without touching the launcher
 * button or anything above the mobile breakpoint.
 */
(function () {
  "use strict";

  var MOBILE_BREAKPOINT = 767;
  var EDGE_MARGIN = 12; // px kept clear on each side of the viewport
  var POLL_MS = 400;
  var ORIG_RIGHT_ATTR = "smcOrigRight";

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  // GHL sets "right" as an inline style on these elements itself (e.g.
  // "right: 20px; bottom: 20px;"). We must restore that exact value on
  // desktop, not strip it - removeProperty("right") deletes GHL's own
  // positioning along with ours, since there is no external stylesheet
  // fallback for it.
  function rememberOriginalRight(el) {
    if (el.dataset[ORIG_RIGHT_ATTR] === undefined) {
      el.dataset[ORIG_RIGHT_ATTR] = el.style.getPropertyValue("right") || "";
    }
    return el.dataset[ORIG_RIGHT_ATTR];
  }

  function clampElement(el, available) {
    if (!el) return;
    var origRight = rememberOriginalRight(el);
    if (isMobile()) {
      el.style.setProperty("box-sizing", "border-box", "important");
      el.style.setProperty("max-width", available + "px", "important");
      el.style.setProperty("min-width", "0px", "important");
      el.style.setProperty("right", EDGE_MARGIN + "px", "important");
    } else {
      el.style.removeProperty("max-width");
      el.style.removeProperty("min-width");
      el.style.removeProperty("box-sizing");
      if (origRight) {
        el.style.setProperty("right", origRight);
      } else {
        el.style.removeProperty("right");
      }
    }
  }

  function clamp() {
    var host = document.querySelector("chat-widget");
    if (!host || !host.shadowRoot) return;
    var sr = host.shadowRoot;
    var container = sr.getElementById("lc_text-widget");
    var msgBubble = sr.querySelector(".lc_text-widget_prompt--msg-bubble");
    if (!container && !msgBubble) return;

    var available = window.innerWidth - EDGE_MARGIN * 2;
    clampElement(container, available);
    clampElement(msgBubble, available);
  }

  function watchWidget() {
    var host = document.querySelector("chat-widget");
    if (!host) return false;
    if (host.__smcMobileClampAttached) return true;

    if (!host.shadowRoot) return false;
    host.__smcMobileClampAttached = true;

    clamp();
    var observer = new MutationObserver(clamp);
    observer.observe(host.shadowRoot, {
      attributes: true,
      attributeFilter: ["style", "class"],
      childList: true,
      subtree: true,
    });
    return true;
  }

  var mountPoll = setInterval(function () {
    if (watchWidget()) clearInterval(mountPoll);
  }, POLL_MS);

  window.addEventListener("resize", clamp);
  window.addEventListener("orientationchange", clamp);
})();
