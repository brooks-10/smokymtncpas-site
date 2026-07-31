/* Smoky Mountain CPAs — pricing calculator (v-DRAFT)
   Built 2026-07-30 from Karen's pricing-model session. Level figures are
   DRAFT and expected to be tuned after Tuesday's follow-up. Sales Tax
   bolt-on ($200/mo) is Brooks's confirmed real minimum, not a placeholder —
   still kept in this same tunable block. Payroll bolt-on remains a
   reasonable placeholder pending Karen's number. Every price lives in the
   single PRICING block below — that's WHY it's here: to change a price,
   cadence label, or blurb, edit ONLY the block below. Nothing else in this
   file, or in index.html, needs to change — card text and the live total
   both read from here. Vanilla JS, no build step, no framework, no backend.

   v4 note: the total now counts up (~400ms) on every change instead of
   snapping instantly, per the art-direction pass. The count-up is purely
   cosmetic — it's skipped entirely under prefers-reduced-motion, in which
   case the total just sets immediately, same as before.
*/

(function () {
  "use strict";

  /* ============================================================== */
  /* TUNABLE CONSTANTS — the only block Brooks should ever need to edit */
  /* ============================================================== */
  var PRICING = {
    levels: [
      {
        id: "foundations",
        name: "Foundations",
        price: 800,
        cadence: "Quarterly strategy meetings",
        blurb: "Clean books every month, plus a quarterly sit-down on your numbers and your Profit First allocations.",
        popular: false
      },
      {
        id: "growth",
        name: "Growth",
        price: 1000,
        cadence: "Monthly strategy meetings",
        blurb: "Everything in Foundations, with a monthly meeting so allocations and decisions never drift for long.",
        popular: true
      },
      {
        id: "partner",
        name: "Partner",
        price: 1500,
        cadence: "Bi-weekly meetings + priority access",
        blurb: "Our closest level of involvement — bi-weekly meetings and priority access to your CPA team.",
        popular: false
      }
    ],
    addons: [
      { id: "payroll", name: "Payroll", price: 200, blurb: "We run payroll so it's never a scramble." },
      { id: "salestax", name: "Sales Tax", price: 200, blurb: "Multi-state sales tax tracked and filed on schedule." }
    ],
    defaultLevel: "foundations",
    calendlyUrl: "https://calendly.com/smokymountaincpas"
  };
  /* ============================================================== */
  /* End tunable block                                                */
  /* ============================================================== */

  function formatMoney(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function init() {
    var root = document.getElementById("pricing-calculator");
    if (!root) return; // calculator markup not on this page

    var levelInputs = Array.prototype.slice.call(root.querySelectorAll('input[name="calc-level"]'));
    var addonInputs = Array.prototype.slice.call(root.querySelectorAll('.calc-addon input[type="checkbox"]'));
    var totalEl = root.querySelector("#calc-total");
    var ctaEl = root.querySelector("#calc-cta");

    var prefersReducedMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var currentDisplayed = null; // tracks the last rendered total, for count-up start point
    var countUpRaf = null;

    function setTotalText(n) {
      if (totalEl) totalEl.innerHTML = formatMoney(n) + "<span>/mo</span>";
    }

    function animateTotalTo(target) {
      if (!totalEl) return;
      // Skip the animation outright when there's nothing to animate FROM yet,
      // when the visitor prefers reduced motion, or when the document isn't
      // visible — requestAnimationFrame callbacks are throttled/suspended for
      // hidden documents by design, which would otherwise leave the total
      // stuck showing a stale, incorrect number indefinitely.
      if (currentDisplayed === null || prefersReducedMotion || document.hidden) {
        setTotalText(target);
        currentDisplayed = target;
        return;
      }
      var start = currentDisplayed;
      var startTime = null;
      var duration = 400; // ~400ms tick, per the art-direction spec
      if (countUpRaf) window.cancelAnimationFrame(countUpRaf);
      // Hard safety net: whatever happens with rAF, the total must read
      // correctly no later than duration + a small buffer after a change.
      var fallbackTimer = window.setTimeout(function () {
        setTotalText(target);
        currentDisplayed = target;
      }, duration + 120);
      function tick(ts) {
        if (startTime === null) startTime = ts;
        var elapsed = ts - startTime;
        var progress = Math.min(elapsed / duration, 1);
        // ease-out cubic — quick start, gentle settle
        var eased = 1 - Math.pow(1 - progress, 3);
        var value = start + (target - start) * eased;
        setTotalText(value);
        if (progress < 1) {
          countUpRaf = window.requestAnimationFrame(tick);
        } else {
          window.clearTimeout(fallbackTimer);
          setTotalText(target);
          currentDisplayed = target;
          countUpRaf = null;
        }
      }
      countUpRaf = window.requestAnimationFrame(tick);
    }

    // Populate level card text from PRICING so numbers live in exactly one place.
    root.querySelectorAll(".calc-level").forEach(function (card) {
      var levelId = card.getAttribute("data-level");
      var level = PRICING.levels.filter(function (l) { return l.id === levelId; })[0];
      if (!level) return;
      card.setAttribute("data-popular", level.popular ? "true" : "false");
      var nameEl = card.querySelector(".calc-level-name");
      var priceEl = card.querySelector(".calc-level-price");
      var cadenceEl = card.querySelector(".calc-level-cadence");
      var blurbEl = card.querySelector(".calc-level-blurb");
      if (nameEl) nameEl.textContent = level.name;
      if (priceEl) priceEl.innerHTML = formatMoney(level.price) + '<span>/mo</span>';
      if (cadenceEl) cadenceEl.textContent = level.cadence;
      if (blurbEl) blurbEl.textContent = level.blurb;
      var input = card.querySelector('input[name="calc-level"]');
      if (input) input.value = level.id;
    });

    // Populate addon text/prices from PRICING.
    root.querySelectorAll(".calc-addon").forEach(function (row) {
      var addonId = row.getAttribute("data-addon");
      var addon = PRICING.addons.filter(function (a) { return a.id === addonId; })[0];
      if (!addon) return;
      var labelEl = row.querySelector(".calc-addon-label");
      var priceEl = row.querySelector(".calc-addon-price");
      if (priceEl) priceEl.textContent = "(+" + formatMoney(addon.price) + "/mo)";
      if (labelEl) labelEl.setAttribute("title", addon.blurb);
      var input = row.querySelector('input[type="checkbox"]');
      if (input) input.value = addon.id;
    });

    // Default level selection (in case markup doesn't pre-check one).
    if (!levelInputs.some(function (i) { return i.checked; })) {
      var def = levelInputs.filter(function (i) { return i.value === PRICING.defaultLevel; })[0];
      if (def) def.checked = true;
    }

    function selectedLevel() {
      var checked = levelInputs.filter(function (i) { return i.checked; })[0];
      if (!checked) return PRICING.levels[0];
      return PRICING.levels.filter(function (l) { return l.id === checked.value; })[0] || PRICING.levels[0];
    }

    function selectedAddonsTotal() {
      return addonInputs
        .filter(function (i) { return i.checked; })
        .map(function (i) { return PRICING.addons.filter(function (a) { return a.id === i.value; })[0]; })
        .filter(Boolean)
        .reduce(function (sum, a) { return sum + a.price; }, 0);
    }

    function recompute() {
      var level = selectedLevel();
      var addonsTotal = selectedAddonsTotal();
      var total = level.price + addonsTotal;

      animateTotalTo(total);

      root.querySelectorAll(".calc-level").forEach(function (card) {
        var input = card.querySelector('input[name="calc-level"]');
        card.classList.toggle("is-selected", !!(input && input.checked));
      });

      if (ctaEl) {
        ctaEl.setAttribute(
          "aria-label",
          "Book a fit call — currently configured at " + formatMoney(total) + " per month, " + level.name + " level"
        );
      }
    }

    levelInputs.forEach(function (input) {
      input.addEventListener("change", recompute);
    });
    addonInputs.forEach(function (input) {
      input.addEventListener("change", recompute);
    });

    if (ctaEl) {
      ctaEl.setAttribute("href", PRICING.calendlyUrl);
    }

    recompute();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
