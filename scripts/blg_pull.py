#!/usr/bin/env python3
"""Pull new BabyLoveGrowth articles into the Learning Center as draft pages.

No GoHighLevel. BabyLoveGrowth API -> learning-center/<slug>/index.html ->
one pull request per batch. Nothing goes live until a human edits the pages
and Brooks merges the pull request.

Usage
  BLG_API_KEY=... python3 scripts/blg_pull.py            # live pull, writes files
  python3 scripts/blg_pull.py --dry-run                  # fixture, writes nothing
  python3 scripts/blg_pull.py --dry-run --preview-dir /tmp/blg   # fixture, render to a scratch dir

The page template (head, nav, footer, Google tag, business JSON-LD) is copied
at run time from an existing Learning Center article, so new pages always
match the live site. Standard library only.
"""

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API_BASE = "https://api.babylovegrowth.ai/api/integrations/v1"
SITE = "https://smokymtncpas.com"
GA_ID = "G-2G7BW0Y1GE"
BUSINESS_ID = SITE + "/#business"
CALENDLY_URL = "https://calendly.com/smokymountaincpas/30-min-discovery-call"
DEFAULT_TEMPLATE = "learning-center/set-aside-cash-for-taxes/index.html"
DEFAULT_FIXTURE = "scripts/fixtures/blg_articles.json"
PAGE_SIZE = 50
RETRIES = 4
USER_AGENT = "Mozilla/5.0 (compatible; smcpas-blg-pull/1.0)"
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
BLG_HOST_RE = re.compile(r"babylovegrowth\.ai", re.I)


class PipelineError(Exception):
    pass


# ---------- source: API or fixture ----------

class ApiSource:
    def __init__(self, key):
        self._key = key

    def _get(self, path, params=None):
        url = API_BASE + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={
            "X-API-Key": self._key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        })
        for attempt in range(RETRIES + 1):
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < RETRIES:
                    # rate limited: wait (Retry-After if given) and try again
                    wait = e.headers.get("Retry-After") if e.headers else None
                    time.sleep(int(wait) if wait and wait.isdigit() else 10 * (attempt + 1))
                    continue
                raise PipelineError("BabyLoveGrowth API returned HTTP %s for %s" % (e.code, path))
            except urllib.error.URLError as e:
                raise PipelineError("BabyLoveGrowth API unreachable: %s" % e.reason)

    def list_articles(self):
        out, offset = [], 0
        while True:
            page = self._get("/articles", {"limit": PAGE_SIZE, "offset": offset})
            items = page if isinstance(page, list) else (page.get("data") or page.get("articles") or [])
            out.extend(items)
            if len(items) < PAGE_SIZE:
                return out
            offset += PAGE_SIZE

    def get_article(self, article_id):
        data = self._get("/articles/%s" % urllib.parse.quote(str(article_id)))
        return data.get("data", data) if isinstance(data, dict) else data


class FixtureSource:
    """Fixture file: a JSON list of full article objects (API field names)."""

    def __init__(self, path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        self._articles = data if isinstance(data, list) else data.get("articles", [])

    def list_articles(self):
        return [{k: v for k, v in a.items() if k not in ("content_html", "content_markdown")}
                for a in self._articles]

    def get_article(self, article_id):
        for a in self._articles:
            if str(a.get("id")) == str(article_id):
                return a
        raise PipelineError("fixture has no article id %s" % article_id)


# ---------- template from an existing page ----------

class Template:
    def __init__(self, page):
        m_head = re.search(r"(?is)^(.*?<head>)(.*?)(</head>\s*<body>.*?<main>)", page)
        m_foot = re.search(r"(?is)(</main>.*)$", page)
        if not (m_head and m_foot):
            raise PipelineError("template page is missing head, main or footer")
        self.prefix, self.head, self.header = m_head.group(1), m_head.group(2), m_head.group(3)
        self.footer = m_foot.group(1)
        if GA_ID not in self.head:
            raise PipelineError("template page has no Google tag %s" % GA_ID)
        blocks = re.findall(r'(?is)<script type="application/ld\+json">.*?</script>', self.head)
        self.business_ld = next((b for b in blocks if BUSINESS_ID in b and '"AccountingService"' in b), None)
        if not self.business_ld:
            raise PipelineError("template page has no business JSON-LD with @id %s" % BUSINESS_ID)
        # Keep the head minus page specific JSON-LD; the business block is re-added in place.
        head = self.head
        for b in blocks:
            head = head.replace(b, "@@BUSINESS_LD@@" if b is self.business_ld else "", 1)
        self.head = head
        cal = re.search(r'href="(https://calendly\.com/[^"]+)"', page)
        self.booking_url = cal.group(1) if cal else CALENDLY_URL

    def head_for(self, a):
        h = self.head
        esc = lambda s: html.escape(s, quote=True)
        title = esc(a["title"]) + " | Smoky Mountain CPAs"
        h = re.sub(r"(?is)<title>.*?</title>", "<title>%s</title>" % title, h, 1)
        subs = [
            (r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % esc(a["description"])),
            (r'<link rel="canonical" href="[^"]*">', '<link rel="canonical" href="%s">' % a["url"]),
            (r'<meta property="og:type" content="[^"]*">', '<meta property="og:type" content="article">'),
            (r'<meta property="og:title" content="[^"]*">', '<meta property="og:title" content="%s">' % title),
            (r'<meta property="og:description" content="[^"]*">', '<meta property="og:description" content="%s">' % esc(a["description"])),
            (r'<meta property="og:url" content="[^"]*">', '<meta property="og:url" content="%s">' % a["url"]),
        ]
        for pat, rep in subs:
            h = re.sub(pat, lambda _m, r=rep: r, h, 1)
        ld = [self.business_ld, ld_script(article_ld(a))]
        if a.get("faq_ld"):
            ld.append(ld_script(a["faq_ld"]))
        ld.append(ld_script(breadcrumb_ld(a)))
        h = h.replace("@@BUSINESS_LD@@", "\n".join(ld), 1)
        return h


def ld_script(obj):
    body = json.dumps(obj, ensure_ascii=False).replace("</", "<\\/")
    return '<script type="application/ld+json">%s</script>' % body


def article_ld(a):
    return {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": a["title"],
        "description": a["description"],
        "image": SITE + "/assets/images/og-v4.png",
        "author": {"@id": BUSINESS_ID},
        "publisher": {"@id": BUSINESS_ID},
        "datePublished": a["date"],
        "dateModified": a["date"],
        "inLanguage": a.get("lang") or "en",
        "keywords": ", ".join(a.get("keywords") or []),
        "mainEntityOfPage": a["url"],
    }


def breadcrumb_ld(a):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": "Learning Center", "item": SITE + "/learning-center/"},
        {"@type": "ListItem", "position": 3, "name": a["title"], "item": a["url"]},
    ]}


# ---------- content ----------

def clean_content(raw):
    """Strip unsafe or off brand markup from BabyLoveGrowth HTML."""
    s = raw or ""
    s = re.sub(r"(?is)<(script|style|iframe|form|noscript)\b.*?</\1\s*>", "", s)
    s = re.sub(r"(?is)<(script|iframe|link|meta)\b[^>]*/?>", "", s)
    s = re.sub(r"(?is)<h1\b[^>]*>.*?</h1>", "", s)  # the template supplies the H1
    s = re.sub(r'(?i)\s+on[a-z]+\s*=\s*("[^"]*"|\'[^\']*\')', "", s)
    # Drop "Made with BabyLoveGrowth" style credit blocks, then unwrap any other BLG links.
    s = re.sub(r"(?is)<(p|div|span)\b[^>]*>(?:(?!</\1>).)*?made with\s*<a[^>]*babylovegrowth[^>]*>.*?</a>.*?</\1>", "", s)
    s = re.sub(r'(?is)<a\b[^>]*href="[^"]*babylovegrowth\.ai[^"]*"[^>]*>(.*?)</a>', r"\1", s)
    return s.strip()


def review_flags(content):
    text = re.sub(r"<[^>]+>", " ", content)
    flags = []
    dashes = len(re.findall("[–—]", text)) + len(re.findall(r"&[mn]dash;", content))
    if dashes:
        flags.append("%d em or en dash(es): house style bans them" % dashes)
    if "$497" in text or re.search(r"\bDiagnostic\b", text):
        flags.append("mentions the retired $497 Diagnostic")
    if re.search(r"(?i)(^|\s)[—-]\s*Brooks\b|written by brooks|by brooks mclean", text):
        flags.append("byline claims Brooks wrote it")
    if BLG_HOST_RE.search(content):
        flags.append("still references babylovegrowth.ai (image or link)")
    if re.search(r"(?i)gohighlevel|leadconnector|blog\.smokymtncpas\.com", content):
        flags.append("links to the GoHighLevel blog")
    return flags


def fetch_images(content, slug_dir, dry):
    """Copy BabyLoveGrowth hosted images next to the page so the site does not hotlink them."""
    urls = sorted(set(re.findall(r'<img\b[^>]*\bsrc="(https?://[^"]*babylovegrowth\.ai[^"]+)"', content)))
    for i, url in enumerate(urls, 1):
        ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
        name = "image-%d%s" % (i, ext if ext in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif") else ".png")
        if not dry:
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as r, open(os.path.join(slug_dir, name), "wb") as f:
                    f.write(r.read())
            except (urllib.error.URLError, OSError) as e:
                print("  warn: image not copied (%s): %s" % (e, url), file=sys.stderr)
                continue
        content = content.replace(url, name)
    return content


def read_minutes(content):
    words = len(re.sub(r"<[^>]+>", " ", content).split())
    return max(1, round(words / 225))


def normalise(art, today):
    slug = (art.get("slug") or "").strip().strip("/").lower()
    if not SLUG_RE.match(slug):
        raise PipelineError("article %s has an unusable slug %r" % (art.get("id"), art.get("slug")))
    title = html.unescape((art.get("title") or "").strip())
    if not title:
        raise PipelineError("article %s has no title" % art.get("id"))
    desc = (art.get("meta_description") or art.get("excerpt") or "").strip()
    created = str(art.get("created_at") or "")[:10]
    faq = art.get("faqJsonLd") if isinstance(art.get("faqJsonLd"), dict) else None
    if faq and faq.get("@type") != "FAQPage":
        faq = None
    return {
        "id": art.get("id"), "slug": slug, "title": title, "description": desc,
        "excerpt": (art.get("excerpt") or desc).strip(),
        "keywords": [k for k in (art.get("keywords") or []) if isinstance(k, str)],
        "lang": art.get("languageCode"),
        "date": created if re.match(r"\d{4}-\d{2}-\d{2}$", created) else today,
        "url": "%s/learning-center/%s/" % (SITE, slug),
        "faq_ld": faq, "content": art.get("content_html") or "",
    }


def render_page(tpl, a):
    cta = (
        '<div class="card center" style="margin:28px 0;">\n'
        "<h3>Want a CPA to look at your numbers?</h3>\n"
        "<p>Book a free 30 minute call. We will walk through your books and tell you what we see.</p>\n"
        '<p><a href="%s" class="btn">Book a free call &rarr;</a></p>\n'
        "</div>" % html.escape(tpl.booking_url, quote=True)
    )
    body = (
        "\n<section>\n<article>\n"
        "<!-- Draft pulled from the BLG API, article id %s. Edit before merge. -->\n"
        '<p class="breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/learning-center/">Learning Center</a></p>\n'
        "<h1>%s</h1>\n\n%s\n\n%s\n"
        "</article>\n</section>\n\n"
    ) % (a["id"], html.escape(a["title"]), a["content"], cta)
    return tpl.prefix + tpl.head_for(a) + tpl.header + body + tpl.footer


def index_card(a):
    return (
        '      <a class="lc-card" href="/learning-center/%s/">\n'
        '        <div class="lc-cover" style="background:#2E5E4A">\n'
        '          <svg class="lc-ico" viewBox="0 0 84 84" aria-hidden="true"><use href="#ic-doc"/></svg>\n'
        '          <svg class="lc-ridge" viewBox="0 0 1440 160" preserveAspectRatio="none" aria-hidden="true"><use href="#lc-ridge"/></svg>\n'
        "        </div>\n"
        '        <div class="lc-card-body">\n'
        '          <p class="lc-tag">Guide</p>\n'
        "          <h3>%s</h3>\n"
        '          <p class="lc-excerpt">%s</p>\n'
        '          <div class="lc-card-foot"><span class="lc-read">Read now &rarr;</span><span class="lc-min">%d min read</span></div>\n'
        "        </div>\n"
        "      </a>\n"
    ) % (a["slug"], html.escape(a["title"]), html.escape(a["excerpt"]), read_minutes(a["content"]))


def add_to_index(index_html, a):
    href = 'href="/learning-center/%s/"' % a["slug"]
    if href in index_html:
        return index_html
    m = re.search(r'(?s)<section id="articles">.*?<div class="lc-grid">\n', index_html)
    if not m:
        raise PipelineError("learning-center/index.html has no articles grid")
    return index_html[:m.end()] + index_card(a) + index_html[m.end():]


def add_to_sitemap(xml, a, today):
    if "<loc>%s</loc>" % a["url"] in xml:
        return xml
    line = "  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n" % (a["url"], today)
    if "</urlset>" not in xml:
        raise PipelineError("sitemap.xml has no closing urlset")
    return xml.replace("</urlset>", line + "</urlset>", 1)


# ---------- run ----------

def run(argv=None, env=None):
    env = os.environ if env is None else env
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   help="site repo root (default: this repo)")
    p.add_argument("--dry-run", action="store_true", help="read the fixture, write nothing to the repo")
    p.add_argument("--fixture", help="fixture JSON (default for --dry-run: %s)" % DEFAULT_FIXTURE)
    p.add_argument("--preview-dir", help="with --dry-run: render pages into this scratch folder")
    p.add_argument("--template", default=DEFAULT_TEMPLATE, help="existing article to copy head, nav and footer from")
    p.add_argument("--max", type=int, default=10, help="most new articles per batch (default 10)")
    p.add_argument("--today", help=argparse.SUPPRESS)
    args = p.parse_args(argv)
    today = args.today or dt.date.today().isoformat()
    root = os.path.abspath(args.root)

    fixture = args.fixture or (os.path.join(root, DEFAULT_FIXTURE) if args.dry_run else None)
    if fixture:
        source = FixtureSource(fixture)
    else:
        key = (env.get("BLG_API_KEY") or "").strip()
        if not key:
            print("BLG_API_KEY is not set. Load it from 1Password (vault Agents, item "
                  "'BabyLoveGrowth API', field API) or use --dry-run.", file=sys.stderr)
            return 2
        source = ApiSource(key)

    with open(os.path.join(root, args.template), encoding="utf-8") as f:
        tpl = Template(f.read())
    index_path = os.path.join(root, "learning-center", "index.html")
    sitemap_path = os.path.join(root, "sitemap.xml")
    with open(index_path, encoding="utf-8") as f:
        index_html = f.read()
    with open(sitemap_path, encoding="utf-8") as f:
        sitemap = f.read()

    write = not args.dry_run
    out_root = root if write else (os.path.abspath(args.preview_dir) if args.preview_dir else None)
    mode = "LIVE" if write else "DRY RUN"
    print("%s: source=%s, booking link=%s" % (mode, "fixture" if fixture else "API", tpl.booking_url))

    added, skipped = [], []
    for summary in source.list_articles():
        slug = (summary.get("slug") or "").strip().strip("/").lower()
        if slug and os.path.exists(os.path.join(root, "learning-center", slug)):
            skipped.append(slug)
            continue
        if len(added) >= args.max:
            break
        a = normalise(source.get_article(summary.get("id")), today)
        if any(x["slug"] == a["slug"] for x in added):
            skipped.append(a["slug"])
            continue
        page_dir = os.path.join(out_root, "learning-center", a["slug"]) if out_root else None
        if page_dir:
            os.makedirs(page_dir, exist_ok=True)
        a["content"] = clean_content(a["content"])
        a["content"] = fetch_images(a["content"], page_dir, dry=not write)
        a["flags"] = review_flags(a["content"])
        if not a["description"]:
            a["flags"].append("no meta description")
        page = render_page(tpl, a)
        if page_dir:
            with open(os.path.join(page_dir, "index.html"), "w", encoding="utf-8") as f:
                f.write(page)
        index_html = add_to_index(index_html, a)
        sitemap = add_to_sitemap(sitemap, a, today)
        added.append(a)

    if added and out_root:
        idx_out = os.path.join(out_root, "learning-center", "index.html")
        os.makedirs(os.path.dirname(idx_out), exist_ok=True)
        with open(idx_out, "w", encoding="utf-8") as f:
            f.write(index_html)
        with open(os.path.join(out_root, "sitemap.xml"), "w", encoding="utf-8") as f:
            f.write(sitemap)

    verb = "wrote" if write else "would write"
    for a in added:
        print("  %s learning-center/%s/index.html  (%s)" % (verb, a["slug"], a["title"]))
        for fl in a["flags"]:
            print("      review: %s" % fl)
    for s in skipped:
        print("  skipped %s (already in learning-center/)" % s)
    print("%d new, %d skipped.%s" % (len(added), len(skipped),
          "" if write else " Nothing written to the repo."))
    return 0


def main():
    try:
        sys.exit(run())
    except PipelineError as e:
        print("error: %s" % e, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
