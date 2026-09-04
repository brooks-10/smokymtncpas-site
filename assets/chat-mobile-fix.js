/* Smoky Mountain CPAs. Brand styling + mobile clamp for the GoHighLevel chat widget.
 *
 * The GHL <chat-widget> element (loader.js, data-widget-id
 * 6a97fa6c783fa3779413ac30) renders entirely inside a shadow DOM, so page CSS
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


  /* ---- Brand skin -------------------------------------------------------
   * GHL ships the launcher in its default blue (#188BF6) and its builder has
   * no colour control. Injecting a <style> into the shadow root does NOT work,
   * and neither does adoptedStyleSheets: GHL's own rules win the cascade even
   * against a tripled-class !important selector. Verified 2026-09-04. Inline
   * style with priority "important" is the only thing that takes, which is why
   * this paints properties on the element rather than writing a rule.
   *
   * Because it is inline, GHL wipes it on re-render, so paintBrand() is called
   * from the same MutationObserver that drives the mobile clamp.
   *
   * Pine, not maple, on purpose: maple is the primary CTA colour on every
   * "book a call" button and booking is the goal. A loud orange chat bubble
   * would outrank the thing it should defer to.
   *
   * The opened chat panel is rendered by GHL and its header stays blue. That
   * one has to be changed in the GHL widget builder.
   * ------------------------------------------------------------------- */
  var PINE = "#2E5E4A";

  function paintBrand(sr) {
    var bubble = sr.querySelector(".lc_text-widget--bubble");
    if (bubble && bubble.style.getPropertyValue("background") !== PINE) {
      bubble.style.setProperty("background", PINE, "important");
      bubble.style.setProperty(
        "box-shadow", "0 6px 20px rgba(31,42,36,.35)", "important");
    }
    var prompt = sr.querySelector(".lc_text-widget_prompt--msg-bubble");
    if (prompt) {
      prompt.style.setProperty("background", "#FAF6EE", "important");
      prompt.style.setProperty("color", "#1F2A24", "important");
      prompt.style.setProperty("font-family",
        '"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        "important");
      prompt.style.setProperty("border", "1px solid rgba(31,42,36,.12)", "important");
    }
  }

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
    paintBrand(sr);
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

    paintBrand(host.shadowRoot);
    clamp();
    var observer = new MutationObserver(function () {
      paintBrand(host.shadowRoot);
      clamp();
    });
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
