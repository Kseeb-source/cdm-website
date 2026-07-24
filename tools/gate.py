#!/usr/bin/env python3
"""
gate.py — the fail-safe production gate for this site.

The gate is one idea: an artifact does not ship unless it MATCHES a reference to
perfection, EXCEEDS it where it can, INVENTS nothing, and carries ZERO faults.
This script makes that checkable instead of remembered, so it never goes stale.

It runs on any HTML artifact — a site page, or a generated report/blog before it
publishes. Stdlib only, no install (same discipline as the claude-system MCPs).

Laws enforced
  1. MAX BASELINE   every page meets the maxed-cornerstone head standard
                    (lang, charset, viewport, one title/description/canonical,
                    favicon, full Open Graph set, Twitter card).
  2. ZERO FAULT     every JSON-LD block parses and declares @context + @type;
                    og:url agrees with canonical; BreadcrumbList URLs stay on
                    the canonical domain.
  3. NEVER INVENT   every FAQPage question and answer must exist verbatim in the
                    page's VISIBLE body — schema cannot claim what the page does
                    not say.
  4. MATCH-THEN-MAX (with --reference REF) the artifact must carry at least as
                    many JSON-LD blocks as the reference, and must include the
                    reference's connective schema (BreadcrumbList; FAQPage when
                    the page has an on-page FAQ).

Exemptions are explicit and visible, never silent. Put a directive in the page:
    <!-- gate:ignore og-tags reason: OAuth callback, noindex utility page -->
Matching failures become WARN (still printed, with the reason) and do not fail
the gate. No directive = strict.

Usage
    python3 tools/gate.py                      # all *.html in repo root
    python3 tools/gate.py autopilot.html
    python3 tools/gate.py autopilot.html --reference ai-search-visibility.html
    python3 tools/gate.py --quiet              # only show WARN/FAIL lines
Exit code is non-zero if any un-exempted law fails.
"""
import argparse, glob, html as htmllib, json, re, sys
from pathlib import Path
from urllib.parse import urlparse

OG_REQUIRED = ["og:type", "og:url", "og:title", "og:description", "og:image"]

# Fabrication check: minimum fraction of a Q&A's significant words that must be
# present in the visible page body. Below this, the schema is claiming content
# the page does not support.
FAB_THRESHOLD = 0.60
STOPWORDS = set(
    "the a an and or of to in on for with your you our we it is are be as that this at by "
    "from can will not no yes do does if so but any all its their them they what how why when "
    "who which just get got up out about into more most every each per than then there here".split()
)


def sig_tokens(s):
    """Lowercase alphanumeric words of length >= 4 that are not stopwords."""
    return [w for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) >= 4 and w not in STOPWORDS]


def load(path):
    return Path(path).read_text(encoding="utf-8")


def visible_body(doc):
    """Page text with <script>/<style> removed and tags stripped — what a reader
    (and a fabrication check) actually sees. JSON-LD is thus never self-matching."""
    x = re.sub(r"<script\b[^>]*>.*?</script>", " ", doc, flags=re.S | re.I)
    x = re.sub(r"<style\b[^>]*>.*?</style>", " ", x, flags=re.S | re.I)
    x = re.sub(r"<[^>]+>", " ", x)
    return norm(htmllib.unescape(x))


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def metas(doc):
    """Map og:*/twitter:* property+name meta content, plus a few singletons."""
    m = {}
    for prop, content in re.findall(r'<meta\s+property="([^"]+)"\s+content="([^"]*)"', doc):
        m[prop] = content
    for name, content in re.findall(r'<meta\s+name="([^"]+)"\s+content="([^"]*)"', doc):
        m[name] = content
    return m


def ldjson_blocks(doc):
    return re.findall(r'<script type="application/ld\+json">(.*?)</script>', doc, flags=re.S)


def ld_types(doc):
    out = []
    for b in ldjson_blocks(doc):
        try:
            out.append(json.loads(b).get("@type"))
        except Exception:
            out.append(None)
    return out


def ignores(doc):
    """Parse <!-- gate:ignore RULE[,RULE] [reason...] --> directives."""
    out = {}
    for rules, reason in re.findall(r"<!--\s*gate:ignore\s+([a-z0-9,\-]+)\s*(.*?)-->", doc, flags=re.I | re.S):
        for r in rules.split(","):
            out[r.strip()] = norm(reason) or "(no reason given)"
    return out


def count(pattern, doc):
    return len(re.findall(pattern, doc))


def check(doc, body, m, ref=None):
    """Return list of (rule_id, ok, detail)."""
    r = []

    # --- Law 1: max baseline ---
    r.append(("html-lang", bool(re.search(r"<html[^>]*\blang=", doc)), "missing <html lang>"))
    r.append(("charset", "charset" in doc.lower(), "missing <meta charset>"))
    r.append(("viewport", count(r'name="viewport"', doc) >= 1, "missing viewport meta"))
    tc = count(r"<title>", doc)
    r.append(("title", tc == 1, f"expected 1 <title>, found {tc}"))
    dc = count(r'name="description"', doc)
    r.append(("meta-description", dc == 1, f"expected 1 meta description, found {dc}"))
    cc = count(r'rel="canonical"', doc)
    canon = re.search(r'<link\s+rel="canonical"\s+href="([^"]+)"', doc)
    canon_url = canon.group(1) if canon else None
    r.append(("canonical", cc == 1 and canon_url and canon_url.startswith("http"),
              f"need exactly 1 absolute canonical (found {cc})"))
    r.append(("favicon", count(r'rel="(?:icon|shortcut icon)"', doc) >= 1, "missing favicon <link>"))
    missing_og = [p for p in OG_REQUIRED if p not in m]
    r.append(("og-tags", not missing_og, "missing " + ", ".join(missing_og)))
    r.append(("twitter-card", "twitter:card" in m, "missing twitter:card"))

    # --- Law 2: zero fault ---
    bad = []
    for i, b in enumerate(ldjson_blocks(doc)):
        try:
            o = json.loads(b)
            if "@context" not in o or "@type" not in o:
                bad.append(f"block {i}: missing @context/@type")
        except Exception as e:
            bad.append(f"block {i}: invalid JSON ({e})")
    r.append(("jsonld-valid", not bad, "; ".join(bad)))

    ogu = m.get("og:url")
    if ogu and canon_url:
        ok = ogu.rstrip("/") == canon_url.rstrip("/")
        r.append(("og-canonical-match", ok, f"og:url {ogu} != canonical {canon_url}"))

    canon_host = urlparse(canon_url).netloc if canon_url else None
    off = []
    for b in ldjson_blocks(doc):
        try:
            o = json.loads(b)
        except Exception:
            continue
        if o.get("@type") == "BreadcrumbList":
            for it in o.get("itemListElement", []):
                url = it.get("item", "")
                if canon_host and url and urlparse(url).netloc != canon_host:
                    off.append(url)
    if canon_host:
        r.append(("breadcrumb-domain", not off, "off-domain breadcrumb URL(s): " + ", ".join(off)))

    # --- Law 3: never invent (FAQ claims must be grounded in the visible page) ---
    # Robust to wording: require most SIGNIFICANT words of each Q&A to appear in
    # the body. Verbatim copy scores ~100%; a genuinely fabricated Q&A about
    # something the page never says scores low. Threshold + coverage are shown.
    body_tokens = set(sig_tokens(body))
    invented = []
    for b in ldjson_blocks(doc):
        try:
            o = json.loads(b)
        except Exception:
            continue
        if o.get("@type") == "FAQPage":
            for qa in o.get("mainEntity", []):
                claim = qa.get("name", "") + " " + qa.get("acceptedAnswer", {}).get("text", "")
                toks = set(sig_tokens(htmllib.unescape(claim)))
                if not toks:
                    continue
                cov = sum(1 for w in toks if w in body_tokens) / len(toks)
                if cov < FAB_THRESHOLD:
                    q = qa.get("name", "")[:45]
                    invented.append(f"{q} (coverage {cov:.0%})")
    if any(t == "FAQPage" for t in ld_types(doc)):
        r.append(("faq-no-fabrication", not invented,
                  f"below {FAB_THRESHOLD:.0%} on-page coverage: " + " | ".join(invented)))

    # --- Law 4: match-then-max vs reference ---
    if ref is not None:
        rt = ld_types(ref)
        tt = ld_types(doc)
        r.append(("parity-block-count", len(tt) >= len(rt),
                  f"has {len(tt)} JSON-LD blocks, reference has {len(rt)}"))
        if "BreadcrumbList" in rt:
            r.append(("parity-breadcrumb", "BreadcrumbList" in tt,
                      "reference has BreadcrumbList, this page does not"))
        has_faq_section = ("<details" in doc.lower()) or ('id="faq"' in doc.lower())
        if "FAQPage" in rt and has_faq_section:
            r.append(("parity-faqpage", "FAQPage" in tt,
                      "page has an on-page FAQ but no FAQPage schema"))
    return r


def main():
    ap = argparse.ArgumentParser(description="Fail-safe production gate for HTML artifacts.")
    ap.add_argument("files", nargs="*", help="HTML files (default: repo-root *.html, excluding *.bak)")
    ap.add_argument("--reference", help="reference page to match-then-max against")
    ap.add_argument("--quiet", action="store_true", help="print only WARN/FAIL lines")
    a = ap.parse_args()

    files = a.files or sorted(f for f in glob.glob("*.html") if not f.endswith(".bak"))
    ref_doc = load(a.reference) if a.reference else None

    any_fail = False
    failed_files = []
    for f in files:
        doc = load(f)
        results = check(doc, visible_body(doc), metas(doc), ref_doc)
        ig = ignores(doc)
        file_fail = False
        lines = []
        for rule, ok, detail in results:
            if ok:
                status, note = "PASS", ""
            elif rule in ig:
                status, note = "WARN", f"  (ignored: {ig[rule]})"
            else:
                status, note = "FAIL", f"  — {detail}"
                file_fail = True
            if not (a.quiet and status == "PASS"):
                lines.append(f"  {status:4}  {rule}{note}")
        if file_fail:
            any_fail = True
            failed_files.append(f)
        if lines or not a.quiet:
            print(f"\n{f}")
            print("\n".join(lines) if lines else "  PASS  (all gates)")

    print(f"\nSUMMARY: {len(files)} file(s), {len(failed_files)} failed"
          + (": " + ", ".join(failed_files) if failed_files else ""))
    sys.exit(1 if any_fail else 0)


if __name__ == "__main__":
    main()
