#!/usr/bin/env python3
"""Fixture tests for scripts/blg_pull.py. Run: python3 scripts/test_blg_pull.py"""

import contextlib
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import blg_pull  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "blg_articles.json")
NEW = "tennessee-business-tax-basics"


def tree_digest(root):
    h = hashlib.sha256()
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x != ".git"]
        for name in sorted(files):
            path = os.path.join(d, name)
            h.update(path.encode())
            with open(path, "rb") as f:
                h.update(f.read())
    return h.hexdigest()


def run(argv, env=None):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = blg_pull.run(argv, env=env if env is not None else {})
    return code, out.getvalue(), err.getvalue()


class DryRun(unittest.TestCase):
    def test_dry_run_writes_nothing_and_skips_existing(self):
        before = tree_digest(os.path.join(ROOT, "learning-center")), open(os.path.join(ROOT, "sitemap.xml")).read()
        code, out, _ = run(["--root", ROOT, "--dry-run", "--today", "2026-09-29"])
        after = tree_digest(os.path.join(ROOT, "learning-center")), open(os.path.join(ROOT, "sitemap.xml")).read()
        self.assertEqual(code, 0)
        self.assertEqual(before, after)
        self.assertIn("would write learning-center/%s/index.html" % NEW, out)
        self.assertIn("skipped set-aside-cash-for-taxes", out)
        self.assertIn("1 new, 1 skipped", out)
        self.assertIn("em or en dash", out)

    def test_no_key_no_fixture_refuses_without_network(self):
        code, _, err = run(["--root", ROOT])
        self.assertEqual(code, 2)
        self.assertIn("BLG_API_KEY is not set", err)


class Preview(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.code, cls.out, _ = run(["--root", ROOT, "--dry-run", "--preview-dir", cls.tmp.name, "--today", "2026-09-29"])
        with open(os.path.join(cls.tmp.name, "learning-center", NEW, "index.html"), encoding="utf-8") as f:
            cls.page = f.read()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def ld_blocks(self):
        return [json.loads(b) for b in re.findall(r'(?s)<script type="application/ld\+json">(.*?)</script>', self.page)]

    def test_template_pieces_copied(self):
        self.assertEqual(self.code, 0)
        self.assertIn("gtag('config', 'G-2G7BW0Y1GE')", self.page)
        self.assertIn('<header class="site-header">', self.page)
        self.assertIn('<footer class="site-footer">', self.page)
        self.assertIn('<link rel="canonical" href="https://smokymtncpas.com/learning-center/%s/">' % NEW, self.page)
        self.assertIn("<title>Tennessee Business Tax Basics for Small Shops | Smoky Mountain CPAs</title>", self.page)
        self.assertEqual(self.page.count("<h1>"), 1)

    def test_json_ld(self):
        blocks = self.ld_blocks()
        types = [b.get("@type") or b["@graph"][0]["@type"] for b in blocks]
        self.assertEqual(types, ["AccountingService", "Article", "FAQPage", "BreadcrumbList"])
        self.assertEqual(blocks[0]["@graph"][0]["@id"], "https://smokymtncpas.com/#business")
        art = blocks[1]
        self.assertEqual(art["publisher"]["@id"], "https://smokymtncpas.com/#business")
        self.assertEqual(art["datePublished"], "2026-09-28")
        self.assertEqual(art["mainEntityOfPage"], "https://smokymtncpas.com/learning-center/%s/" % NEW)
        self.assertNotIn("set-aside-cash-for-taxes", json.dumps(blocks))  # template page's own JSON-LD removed

    def test_calendly_cta(self):
        self.assertIn('<a href="https://calendly.com/smokymountaincpas/30-min-discovery-call" class="btn">Book a free call', self.page)

    def test_content_cleaned(self):
        self.assertNotIn("alert(", self.page.split("<article>")[1])
        self.assertNotIn("onclick", self.page)
        self.assertNotIn("babylovegrowth", self.page.lower())
        self.assertIn('src="image-1.png"', self.page)
        self.assertIn("this guide", self.page)

    def test_template_copy_has_no_dashes(self):
        # The fixture itself carries one em dash; everything the pipeline adds must carry none.
        self.assertEqual(self.page.count("—"), 1)
        self.assertNotIn("–", self.page)

    def test_index_and_sitemap(self):
        with open(os.path.join(self.tmp.name, "learning-center", "index.html"), encoding="utf-8") as f:
            idx = f.read()
        with open(os.path.join(self.tmp.name, "sitemap.xml"), encoding="utf-8") as f:
            sm = f.read()
        self.assertEqual(idx.count('href="/learning-center/%s/"' % NEW), 1)
        self.assertLess(idx.index('<section id="articles">'), idx.index('href="/learning-center/%s/"' % NEW))
        self.assertIn("<loc>https://smokymtncpas.com/learning-center/%s/</loc><lastmod>2026-09-29</lastmod>" % NEW, sm)
        self.assertNotIn("Should never be written", idx + sm)
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "learning-center", "set-aside-cash-for-taxes")))

    def test_rerun_is_idempotent(self):
        idx = blg_pull.add_to_index("<section id=\"articles\"><div class=\"lc-grid\">\n</div>", {
            "slug": NEW, "title": "T", "excerpt": "E", "content": "x"})
        self.assertEqual(blg_pull.add_to_index(idx, {"slug": NEW, "title": "T", "excerpt": "E", "content": "x"}), idx)


class Excerpt(unittest.TestCase):
    def test_excerpt_skips_title_and_image_alt(self):
        raw = "Real Estate Books\n\n! Title card alt text\n\nFirst real sentence."
        a = blg_pull.normalise({"slug": "x-y", "title": "Real Estate Books", "excerpt": raw}, "2026-09-30")
        self.assertEqual(a["excerpt"], "First real sentence.")

    def test_plain_excerpt_unchanged(self):
        a = blg_pull.normalise({"slug": "x-y", "title": "T", "excerpt": " Plain. "}, "2026-09-30")
        self.assertEqual(a["excerpt"], "Plain.")


class KeyHandling(unittest.TestCase):
    def test_key_never_printed(self):
        secret = "blg_test_SECRET_123"
        code, out, err = run(["--root", ROOT, "--dry-run"], env={"BLG_API_KEY": secret})
        self.assertEqual(code, 0)
        self.assertNotIn(secret, out + err)


if __name__ == "__main__":
    unittest.main(verbosity=2)
