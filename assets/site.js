/* Smoky Mountain CPAs — site.js (v4)
   Vanilla JS, no framework, no build step, one file. Three small jobs:
     1. Mobile nav toggle (moved here from the old per-page inline script).
     2. Header scroll behavior — adds a shrink+shadow class past a small
        scroll threshold. Pure class toggling; all the actual look lives
        in CSS.
     3. Scroll-reveal — fade+rise content once, staggered within each
        group, via IntersectionObserver. Entirely skipped when the visitor
        has prefers-reduced-motion set, or when IntersectionObserver isn't
        available — content simply renders in its final state, no motion,
        no penalty.
*/
(function () {
  "use strict";

  function initNavToggle() {
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.querySelector(".site-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function initHeaderScroll() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    var threshold = 12;
    function update() {
      header.classList.toggle("is-scrolled", window.scrollY > threshold);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  function initReveal() {
    var prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return; // content stays visible, no motion, per spec
    if (!("IntersectionObserver" in window)) return;

    var items = [];

    // Grouped content — stagger within the group (60ms per item).
    var groups = document.querySelectorAll(".grid, .step-list, .hero-trustline");
    groups.forEach(function (group) {
      var children = group.querySelectorAll(":scope > *");
      children.forEach(function (el, i) {
        el.classList.add("reveal");
        el.style.transitionDelay = Math.min(i * 60, 360) + "ms";
        items.push(el);
      });
    });

    // Standalone editorial moments — no stagger needed, single item.
    document.querySelectorAll(".pull-quote blockquote, .compare-table").forEach(function (el) {
      if (el.classList.contains("reveal")) return;
      el.classList.add("reveal");
      items.push(el);
    });

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );

    items.forEach(function (el) {
      io.observe(el);
    });
  }

  function init() {
    initNavToggle();
    initHeaderScroll();
    initReveal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
