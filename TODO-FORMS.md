# TODO — Forms (Brooks decides, not the bot)

## RESOLVED 2026-07-30 (v3 ticket) — CTA links only, not the real Stripe form

The "Recommended fix" below shipped as part of the 2026-07-30 v3 ticket
(mobile + pricing calculator + PF package framing), which explicitly
instructed wiring every `STRIPE_LINK_HERE` / `CALENDLY_LINK_HERE` / dead
`href="#"` CTA to `https://calendly.com/smokymountaincpas`. That includes the
"Buy the Diagnostic — $497" buttons, which previously had no known-good
Stripe link at all — they now route to booking a call instead, as an interim
measure, not a real checkout. **Still open:** an actual Stripe Payment Link
for the $497 Diagnostic (option below), and a real contact/inquiry form.
Original context preserved below for that remaining work.

## What the live site actually had before v3 (PROVEN — checked the raw HTML of every page)

- **No real contact/booking form exists on the live WordPress site.** The only `<form>` elements found anywhere on smokymtncpas.com are the default WordPress **blog-comment forms** (name/email/website/comment) on the 7 blog posts — pure WP cruft, not a business-facing form. They were intentionally **dropped** from the rebuild (nobody was using blog comments; reproducing them would need a comment backend this static site doesn't have).
- The site's actual conversion paths are two **links**, not forms:
  1. **"Buy the Diagnostic Review — $497"** — on the live site this literally points to `href="STRIPE_LINK_HERE"` in three places (homepage hero CTA, homepage final CTA, About page, Our Process page). This is a **broken/unfinished placeholder that is already live on smokymtncpas.com today** — not something the rebuild introduced. Carried over verbatim per the content-identical mandate; flagged here so it doesn't get missed.
  2. **"Book a free 20-minute call"** — mostly resolves to a real Calendly link, `https://calendly.com/smokymountaincpas/30-minute-discovery-call-clone` (used on About, Our Process, Profit First). On the homepage specifically, one instance of this button is also a broken placeholder, `href="CALENDLY_LINK_HERE"`, and several other homepage CTAs (`"See our pricing"` duplicate, `"Watch our 60-second intro"` duplicate, testimonial "Read all 11 reviews", Learning Center teaser "Read now"/"Browse" links) are literally `href="#"` — dead links, live on the site today.

None of this was fixed or redesigned in the rebuild — Gate 1 scope is content-identical, not a fix-it pass. It's called out here so Brooks/Karen can decide.

## Recommended fix (trivial, still content-identical — just wiring already-known-good values)

The working Calendly URL already exists elsewhere on the same site. Swapping `CALENDLY_LINK_HERE` → the real Calendly URL, and the dead `#` CTAs that clearly mean "book a call" → the same Calendly URL, is not new copy — it's using data already present on the site. **Left as-is in this build; do only with Brooks's go-ahead**, since Needle 3 draws the form/payment line as Brooks's call.

`STRIPE_LINK_HERE` has no known-good value anywhere on the live site — genuinely needs a real Stripe Payment Link before it can be filled in.

## Options for a real contact/inquiry form (none wired yet — pick one)

1. **Tally** (tally.so) — free tier, embeds as an iframe or redirects to a hosted form URL. Fastest to stand up, no code.
2. **Formspree** — POST-to-endpoint from a plain HTML `<form>`, keeps the form UI fully on-site/on-brand, sends submissions to email. Needs a Formspree account + endpoint ID.
3. **Financial Cents (FC) client-intake embed** — if FC has a public intake form product, keeps lead capture in the same system that already runs client work. Worth checking before standing up a third-party tool.
4. **Calendly embed (inline, not just a link-out)** — since the real booking path is already Calendly, an embedded scheduling widget on `/our-process/` or a future `/contact/` page may cover most of the need without a separate form service at all.

## Where a placeholder currently sits

No form UI was added speculatively — the rebuild only reproduces what's live (links, some dead). When Brooks picks an option above, the natural spots to wire it in are:
- The `STRIPE_LINK_HERE` and `CALENDLY_LINK_HERE` literal strings (4 occurrences across `/index.html`, `/about/index.html`, `/our-process/index.html` — `grep -rn "STRIPE_LINK_HERE\|CALENDLY_LINK_HERE" .` from the repo root finds all of them).
- The dead `href="#"` CTAs on `/index.html` (same grep approach: `grep -n 'href="#"' index.html`).
