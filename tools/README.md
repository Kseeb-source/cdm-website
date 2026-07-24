# The Gate

`gate.py` is the fail-safe production gate for this site. It exists so the standard
that got our pages to 100 lives in **code that runs**, not in memory that goes stale.

## The idea

An artifact does not ship unless it:

1. **Matches** a reference to perfection (the maxed-cornerstone standard), and
2. **Exceeds** it where it can, while
3. **Inventing nothing** (schema can't claim what the page doesn't say), with
4. **Zero faults**.

The gate makes each of those *checkable*. Run it on any HTML artifact — a site
page, or a **generated report/blog before it publishes**.

## The laws it enforces

| Law | Rules |
|---|---|
| **Max baseline** | `html-lang`, `charset`, `viewport`, exactly one `title` / `meta-description` / absolute `canonical`, `favicon`, full Open Graph set (`og:type/url/title/description/image`), `twitter-card` |
| **Zero fault** | `jsonld-valid` (every block parses, has `@context`+`@type`), `og-canonical-match`, `breadcrumb-domain` (breadcrumb URLs stay on the canonical host) |
| **Never invent** | `faq-no-fabrication` — every FAQ Q&A must be grounded in the visible page body (significant-word coverage ≥ 60%; catches invented Q&As, tolerates rewording) |
| **Match-then-max** | with `--reference`: `parity-block-count` (≥ reference's JSON-LD count), `parity-breadcrumb`, `parity-faqpage` (when the page has an on-page FAQ) |

## Usage

```bash
python3 tools/gate.py                                            # all root *.html
python3 tools/gate.py autopilot.html                            # one file
python3 tools/gate.py autopilot.html --reference ai-search-visibility.html
python3 tools/gate.py --quiet                                   # only WARN/FAIL
```

Exit code is non-zero if any un-exempted law fails — so it drops straight into a
pre-publish step or CI.

## Exemptions are explicit, never silent

A utility page (e.g. an OAuth callback, a `noindex` preview) can opt out of a
rule — but only visibly, in the page itself:

```html
<!-- gate:ignore og-tags,twitter-card reason: noindex OAuth callback, not shared socially -->
```

Matching failures become `WARN` (still printed, with the reason) and don't fail
the gate. No directive = strict. Nothing is ever waived quietly.

## Reference page

`ai-search-visibility.html` is the current maxed cornerstone (3 JSON-LD blocks:
primary entity + `FAQPage` + `BreadcrumbList`). Use it as `--reference` for
content/landing pages.

## The lock (so it can't be skipped)

The gate runs in two places. Both check only the pages a change actually
touches, so existing debt never blocks unrelated work.

**1. Local pre-commit hook** — blocks a bad page before it's even committed.
Activate once per clone:

```bash
git config core.hooksPath .githooks
```

Then any commit touching an HTML file runs the gate first. If it fails: fix the
page, add a `<!-- gate:ignore RULE reason -->`, or (emergency only)
`git commit --no-verify`.

**2. CI check** (`.github/workflows/gate.yml`) — the real lock. Runs on every
push and PR on GitHub, where `--no-verify` can't reach it. To make it *block
merges*, protect `main` in **Settings → Branches** and require the **gate**
status check.

Verified: committing a page missing lang/OG/canonical is rejected by the hook,
and nothing lands.
