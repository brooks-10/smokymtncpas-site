# GO-LIVE — smokymtncpas.com static rebuild

This repo (`/Users/botfleet/Firm/smokymtncpas-site/`) is a content-identical,
hand-rolled static rebuild of the live WordPress site, built and verified
locally. **Nothing here is pushed anywhere and nothing on the live site or
DNS has been touched.** WordPress hosting is still what's actually serving
smokymtncpas.com right now. This runbook is what Brooks runs, in order, to
actually go live — it is intentionally NOT something the fleet runs on its
own, because steps ①–③ need `gh auth login` (a human logging into GitHub as
themselves) and step ④ touches DNS.

Two Brooks buttons in this whole process: **① authorize GitHub once**, and
**④ flip DNS when ready.** Everything else is mechanical.

---

## ① Authorize GitHub on the M4 (one-time)

The M4 appliance has no `gh` auth yet. From the M4 (`ssh botfleet@bots-mac-mini.local` or directly at the machine):

```bash
gh auth login
```

Follow the prompts (browser-based device login is easiest). This only needs
to happen once, ever, on this machine.

## ② Create the GitHub repo and push

```bash
cd /Users/botfleet/Firm/smokymtncpas-site
gh repo create smokymtncpas-site --private --source=. --remote=origin
git push -u origin main
```

Start **private**. Nothing here is sensitive, but there's no reason to make
it public before it's actually live — flip it to public in step ③ if you
want Pages served from a public repo (GitHub Pages works from private repos
too, on paid plans; on a free personal account Pages requires the repo be
public, or you use a GitHub Pro/org plan — check which applies before
deciding).

## ③ Enable GitHub Pages

Repo → **Settings → Pages** → under "Build and deployment", set **Source:
Deploy from a branch** → Branch: `main`, folder: `/ (root)` → Save.

GitHub will build and serve at `https://<org-or-user>.github.io/smokymtncpas-site/`
first — that's expected and fine, it's not the final URL. The `CNAME` file
already committed in this repo (containing `smokymtncpas.com`) is what tells
GitHub Pages to serve the custom domain once DNS points at it (step ④).

Also under Pages settings, once the custom domain is added: check **"Enforce
HTTPS"** (may take a few minutes to become available after the domain
verifies — see step ⑤).

## ④ DNS — point smokymtncpas.com at GitHub Pages

**Do this only when Brooks is ready for the cutover.** Until this step, the
old WordPress site keeps serving smokymtncpas.com exactly as it does today —
nothing before this step is visible to the public.

Two options. Pick one.

### Option A — Plain CNAME / A-records straight at GitHub (simpler, fewer moving parts)

At whatever DNS host currently manages smokymtncpas.com:

- For the apex domain (`smokymtncpas.com`), add **A records** pointing at GitHub Pages' IPs:
  ```
  185.199.108.153
  185.199.109.153
  185.199.110.153
  185.199.111.153
  ```
- For `www.smokymtncpas.com` (if used), add a **CNAME record** pointing to `<org-or-user>.github.io.` (trailing dot).
- In the repo's Pages settings, set the **custom domain** field to `smokymtncpas.com` (this rewrites/confirms the `CNAME` file in the repo).

### Option B — Cloudflare in front (recommended if you want caching, extra security headers, or plan to add anything dynamic later)

- Move the domain's nameservers to Cloudflare (or, if already on Cloudflare, just add the records there).
- Add the same 4 A records as Option A for the apex, proxied (orange cloud) through Cloudflare.
- Add a CNAME for `www` → `<org-or-user>.github.io`, proxied.
- In Cloudflare SSL/TLS settings, use **Full** (not Flexible) once GitHub Pages HTTPS is confirmed working, to avoid redirect loops.
- Cloudflare gets you a WAF, DDoS protection, and page rules for free — worth it for basically no extra cost if the domain's already there or moving is easy. Downside: one more system in the chain to reason about when something breaks.

## ⑤ Verify HTTPS + redirects

- Give DNS 10 minutes to a few hours to propagate (`dig smokymtncpas.com` from the M4 to check).
- Confirm `https://smokymtncpas.com/` loads the new static site (not WordPress).
- Confirm `http://` redirects to `https://` (GitHub Pages does this automatically once "Enforce HTTPS" is checked in step ③).
- Click through every one of the 16 pages listed in the wrap report — confirm each resolves at its expected path with no 404s.
- Check `https://smokymtncpas.com/sitemap.xml` and `/robots.txt` both serve correctly.

## ⑥ Only then — retire WordPress hosting

Once ⑤ is fully confirmed (give it a day of quiet monitoring, not just one
check), cancel/downgrade the WordPress hosting plan. Not before. Keeping it
paused-but-not-cancelled for a week costs little and buys a same-day fallback
if something in ①–⑤ needs a redo.

---

## Rollback

If anything goes wrong after DNS is flipped (step ④), rollback is **just DNS,
and it's fast**: revert the A/CNAME records back to whatever the WordPress
host's values were before this runbook started (write those old values down
BEFORE touching anything in step ④ — they're not recorded here because they
belong to the current WordPress host, not this repo). WordPress hosting
stays live and untouched through step ⑤, so as long as it isn't cancelled
yet, reverting DNS restores the old site within normal DNS TTL (usually
minutes to an hour). This is why step ⑥ says wait.

---

## What this repo does NOT do

- No forms are wired to a real backend yet — see `TODO-FORMS.md`.
- No redesign — this is content-identical to the WordPress site as of
  2026-07-30. Visual/UX improvements are intentionally deferred (Karen's
  gap-analysis work, a separate future project).
- Two things already broken on the *live* WordPress site (`STRIPE_LINK_HERE`
  / `CALENDLY_LINK_HERE` placeholder links, several dead `href="#"` CTAs on
  the homepage) were carried over verbatim rather than fixed, per the
  content-identical scope fence. See `TODO-FORMS.md` for the exact locations
  and a proposed low-risk fix Brooks can approve separately.
