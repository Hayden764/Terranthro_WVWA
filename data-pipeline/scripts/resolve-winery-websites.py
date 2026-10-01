#!/usr/bin/env python3
"""
resolve-winery-websites.py  (vineyard-scrape Phase 0)
=====================================================
Step zero of the vineyard web-scrape pipeline.

Each winery in the WVWA list (src/data/wineries.json) only carries a
willamettewines.com *directory listing* URL, not the winery's own website.
Those listing pages are Simpleview-CRM widgets that embed a JSON blob with the
real homepage under "weburl" (anchored to the listing's recid), plus city/zip
and a listing-level email. This script:

  1. Fetches each winery's WVWA listing page (cached to disk; polite delay).
  2. Extracts the real website (weburl), city, zip, state, and email.
  3. Carries over the data we already own from wineries.json
     (description, phone, lat/long, image).
  4. Writes data/scrape/websites.csv and flags every winery we could NOT
     resolve a site for (-> manual follow-up bucket).

Nothing here calls an LLM and nothing is destructive. Raw HTML is cached so
Phase 1 (crawl) can reuse it and we never re-hit a server unnecessarily.

Usage:
  python3 resolve-winery-websites.py                 # full run (all wineries)
  python3 resolve-winery-websites.py --limit 10      # calibration subset
  python3 resolve-winery-websites.py --refresh       # ignore cache, refetch
  python3 resolve-winery-websites.py --delay 1.5     # seconds between fetches
"""

import argparse
import csv
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

# ── Paths ───────────────────────────────────────────────────────────────────
REPO       = Path(__file__).parents[2]
WINERIES   = REPO / "src" / "data" / "wineries.json"
OUT_DIR    = REPO / "data-pipeline" / "data" / "scrape"
CACHE_DIR  = OUT_DIR / "raw_listings"
OUT_CSV    = OUT_DIR / "websites.csv"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Hosts that are never a winery's own site (CDNs, socials, the directory itself).
NON_SITE_HOSTS = (
    "willamettewines.com", "simpleviewinc.com", "facebook.com", "instagram.com",
    "twitter.com", "x.com", "linkedin.com", "pinterest.com", "youtube.com",
)


# ── Extraction ──────────────────────────────────────────────────────────────
def resolve_website(html: str, recid) -> tuple[str, int]:
    """Return (weburl, match_position) for this listing, anchored to its recid.

    The recid anchor ties the URL to *this* winery's record rather than to a
    related listing or event elsewhere on the page. Try both key orders.
    """
    rid = re.escape(str(recid))
    for pat in (
        r'"recid":%s\b[^{}]{0,400}?"weburl":"([^"]*)"' % rid,
        r'"weburl":"([^"]*)"[^{}]{0,400}?"recid":%s\b' % rid,
    ):
        m = re.search(pat, html)
        if m and m.group(1).strip():
            return m.group(1).strip(), m.start()
    # Fallback: any non-directory weburl tagged as the Website typename.
    m = re.search(r'"typename":"Website"[^{}]{0,200}?"weburl":"([^"]+)"', html)
    if m:
        return m.group(1).strip(), m.start()
    return "", -1


def field_near(html: str, pos: int, key: str, span: int = 2500) -> str:
    """Grab a JSON string field from the window around the recid match."""
    if pos < 0:
        return ""
    window = html[max(0, pos - span): pos + span]
    m = re.search(r'"%s":"([^"]*)"' % re.escape(key), window)
    return m.group(1).strip() if m else ""


def listing_email(html: str) -> str:
    """Listing-level email sits next to the description blob, not the staff
    contacts (those use 'contactEmail'). Anchor to ',"description"'."""
    m = re.search(r'"email":"([^"@]+@[^"]+)","description"', html)
    return m.group(1).strip() if m else ""


def normalize_site(url: str) -> str:
    """Lowercase host, drop fragments/tracking; keep it as the winery gave it."""
    if not url:
        return ""
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    p = urlparse(url)
    host = (p.netloc or "").lower()
    if not host:
        return ""
    if any(bad in host for bad in NON_SITE_HOSTS):
        return ""  # directory/social slipped through — treat as no site
    path = p.path if p.path not in ("", "/") else "/"
    return f"{p.scheme}://{host}{path if path != '/' else '/'}".rstrip("/") + (
        "/" if path == "/" else ""
    )


# ── Fetch (cached + polite) ─────────────────────────────────────────────────
def fetch_listing(session: requests.Session, url: str, cache: Path,
                  refresh: bool, delay: float) -> tuple[str, bool]:
    """Return (html, was_fetched). Uses on-disk cache unless --refresh."""
    if cache.exists() and not refresh:
        return cache.read_text(encoding="utf-8", errors="replace"), False
    last_err = None
    for attempt in range(3):
        try:
            r = session.get(url, timeout=30)
            r.raise_for_status()
            cache.write_text(r.text, encoding="utf-8")
            time.sleep(delay)  # be a good citizen
            return r.text, True
        except Exception as e:  # noqa: BLE001 - record and back off
            last_err = e
            time.sleep(delay * (attempt + 1))
    raise RuntimeError(f"fetch failed after 3 tries: {last_err}")


# ── Main ────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="only process first N wineries")
    ap.add_argument("--refresh", action="store_true", help="ignore cache, refetch")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between fetches")
    args = ap.parse_args()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    wineries = json.loads(WINERIES.read_text())
    if args.limit:
        wineries = wineries[: args.limit]

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    rows = []
    n_resolved = n_nosite = n_error = 0
    total = len(wineries)
    for i, w in enumerate(wineries, 1):
        recid = w.get("recid")
        name = w.get("title", "")
        listing = (w.get("url") or {}).get("url", "")
        loc = (w.get("loc") or {}).get("coordinates") or [None, None]
        cache = CACHE_DIR / f"{recid}.html"

        website = email = city = zipc = state = ""
        status = "no_website"
        try:
            html, fetched = fetch_listing(session, listing, cache, args.refresh, args.delay)
            raw_web, pos = resolve_website(html, recid)
            website = normalize_site(raw_web)
            email = listing_email(html)
            city = field_near(html, pos, "city")
            zipc = field_near(html, pos, "zip")
            state = field_near(html, pos, "state")
            if website:
                status, n_resolved = "resolved", n_resolved + 1
            else:
                n_nosite += 1
            tag = "·" if not fetched else "↓"
        except Exception as e:  # noqa: BLE001
            status, n_error = "fetch_error", n_error + 1
            website = f""
            tag = "✗"
            print(f"  [{i}/{total}] {tag} {name}: {e}", file=sys.stderr)

        rows.append({
            "recid": recid,
            "winery": name,
            "status": status,
            "website": website,
            "website_source": "wvwa_listing" if website else "",
            "email": email,
            "phone": w.get("phone", ""),
            "city": city,
            "state": state,
            "zip": zipc,
            "latitude": loc[1],
            "longitude": loc[0],
            "image_url": w.get("image_url", ""),
            "description": (w.get("description") or "").strip(),
            "listing_url": listing,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
        if i % 25 == 0 or i == total:
            print(f"  …{i}/{total} processed", file=sys.stderr)

    fields = list(rows[0].keys())
    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        wtr = csv.DictWriter(f, fieldnames=fields)
        wtr.writeheader()
        wtr.writerows(rows)

    # ── Summary ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"Phase 0 complete — {total} wineries")
    print(f"  resolved website : {n_resolved}")
    print(f"  no website found : {n_nosite}")
    print(f"  fetch errors     : {n_error}")
    print(f"  output           : {OUT_CSV.relative_to(REPO)}")
    print(f"  html cache       : {CACHE_DIR.relative_to(REPO)}/")

    flagged = [r for r in rows if r["status"] != "resolved"]
    if flagged:
        print(f"\n  NEEDS ATTENTION ({len(flagged)}) — no site resolved / fetch failed:")
        for r in flagged:
            print(f"    [{r['status']:11s}] {r['winery']}  ({r['listing_url']})")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
