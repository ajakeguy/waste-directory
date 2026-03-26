#!/usr/bin/env python3
"""
pipelines/nyc-bic-import/index.py

Imports NYC Business Integrity Commission (BIC) licensed trade waste
haulers from the NYC Open Data API.

The API mixes historical and current records. Strategy:
  1. Fetch all pages (PAGE_CAP max)
  2. Group by bic_number, keep the most recent record per BIC number
     (using export_date, falling back to created)
  3. Filter to application_type == 'License' only
  4. Slug-dedup against existing DB, insert new records in batches

Usage:
    python pipelines/nyc-bic-import/index.py

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

Data source:
    https://data.cityofnewyork.us/resource/867j-5pgi.json
"""

import sys
import os
import re
import json
from datetime import datetime

try:
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

API_BASE    = "https://data.cityofnewyork.us/resource/867j-5pgi.json"
PAGE_SIZE   = 1000
PAGE_CAP    = 5         # max 5,000 records fetched total
SAFE_MAX    = 500       # abort if new-record count exceeds this
DATA_SOURCE = "nyc_bic_license_2026"
BATCH_SIZE  = 50

# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(name: str, city: str) -> str:
    combined = f"{name} {city}".lower()
    combined = re.sub(r"[^a-z0-9]+", "-", combined)
    return combined.strip("-")


def clean_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"{digits[0:3]}-{digits[3:6]}-{digits[6:10]}"
    if len(digits) == 11 and digits[0] == "1":
        return f"{digits[1:4]}-{digits[4:7]}-{digits[7:11]}"
    return raw.strip() or None


def iso_date(raw: str | None) -> str | None:
    """Return YYYY-MM-DD from an ISO datetime string, or None."""
    return raw[:10] if raw else None


def s(value) -> str | None:
    """Stripped string or None."""
    if value is None:
        return None
    v = str(value).strip()
    return v if v else None


def f(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def sort_key(rec: dict) -> str:
    """
    Return a sortable string for recency comparison.
    Prefers export_date, falls back to created, falls back to empty string.
    Both fields are ISO datetime strings (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS),
    so lexicographic sort is correct.
    """
    return s(rec.get("export_date")) or s(rec.get("created")) or ""


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_all() -> list[dict]:
    """
    Fetch all pages from the NYC Open Data BIC endpoint.
    No server-side filter — we handle dedup/filtering in Python.
    Stops when a page returns fewer than PAGE_SIZE records or PAGE_CAP is hit.
    """
    session = requests.Session()
    session.headers.update({"User-Agent": "WasteDirectory-DataImport/1.0"})

    all_rows: list[dict] = []
    offset = 0
    pages  = 0

    print(f"  Endpoint: {API_BASE}")

    while pages < PAGE_CAP:
        resp = session.get(
            API_BASE,
            params={"$limit": PAGE_SIZE, "$offset": offset},
            timeout=15,
        )
        resp.raise_for_status()
        page = resp.json()
        pages += 1

        print(f"  Page {pages} (offset {offset}): {len(page)} records")

        if not page:
            break

        if pages == 1:
            print(f"  Sample record:\n{json.dumps(page[0], indent=4)}")

        all_rows.extend(page)

        if len(page) < PAGE_SIZE:
            break  # last page

        offset += PAGE_SIZE

    if pages >= PAGE_CAP:
        print(f"  WARNING: hit PAGE_CAP ({PAGE_CAP} pages / {len(all_rows):,} records)")

    return all_rows


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=== WasteDirectory — NYC BIC License Importer ===")
    print(datetime.utcnow().isoformat())

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    # ── 1. Fetch all records from API ─────────────────────────────────────────
    print("\nFetching from NYC Open Data API ...")
    try:
        raw_records = fetch_all()
    except Exception as exc:
        print(f"ERROR fetching from API: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"\nTotal fetched from API : {len(raw_records)}")

    # ── 2. Deduplicate by BIC number — keep most recent record per BIC ────────
    # Group all rows by bic_number, then keep the one with the latest
    # export_date (or created as fallback). This collapses historical
    # duplicates to one current record per company.
    by_bic: dict[str, dict] = {}
    no_bic = 0
    for rec in raw_records:
        bic = s(rec.get("bic_number"))
        if not bic:
            no_bic += 1
            continue
        existing = by_bic.get(bic)
        if existing is None or sort_key(rec) > sort_key(existing):
            by_bic[bic] = rec

    print(f"Unique BIC numbers     : {len(by_bic)}"
          + (f"  ({no_bic} records had no BIC number)" if no_bic else ""))

    # ── 3. Filter to License type only ────────────────────────────────────────
    license_records = [
        rec for rec in by_bic.values()
        if str(rec.get("application_type") or "").strip() == "License"
    ]
    skipped_type = len(by_bic) - len(license_records)
    print(f"After License filter   : {len(license_records)}"
          + (f"  ({skipped_type} non-License skipped)" if skipped_type else ""))

    if not license_records:
        print("No License records found after BIC dedup — check API response above.")
        return

    # ── 4. Connect to Supabase ────────────────────────────────────────────────
    supabase: Client = create_client(supabase_url, service_role_key)

    # ── 5. Load ALL existing slugs into a Python set ──────────────────────────
    print("\nLoading existing slugs from DB ...")
    existing_slugs: set[str] = set()
    db_offset = 0
    while True:
        result = (
            supabase.table("organizations")
            .select("slug")
            .range(db_offset, db_offset + 999)
            .execute()
        )
        for row in result.data:
            if row.get("slug"):
                existing_slugs.add(row["slug"])
        if len(result.data) < 1000:
            break
        db_offset += 1000

    print(f"Existing slugs loaded  : {len(existing_slugs)}")

    # ── 6. Build insert list — slug dedup entirely in Python ─────────────────
    to_insert:  list[dict] = []
    seen_slugs: set[str]   = set()
    skipped_slug = 0

    for rec in license_records:
        name = s(rec.get("account_name")) or ""
        if not name:
            continue

        city = s(rec.get("city")) or ""
        slug = slugify(name, city)
        if not slug:
            continue

        if slug in existing_slugs or slug in seen_slugs:
            skipped_slug += 1
            continue
        seen_slugs.add(slug)

        state = s(rec.get("state")) or "NY"

        to_insert.append({
            "name":                name,
            "slug":                slug,
            "org_type":            "hauler",
            "phone":               clean_phone(s(rec.get("phone"))),
            "email":               s(rec.get("email")),
            "address":             s(rec.get("address")),
            "city":                city or None,
            "state":               state,
            "zip":                 s(rec.get("postcode")),
            "hq_state":            state,
            "lat":                 f(rec.get("latitude")),
            "lng":                 f(rec.get("longitude")),
            "license_number":      s(rec.get("bic_number")),
            "license_expiry":      iso_date(s(rec.get("expiration_date"))),
            "service_types":       ["commercial"],
            "service_area_states": ["NY"],
            "verified":            True,
            "active":              True,
            "data_source":         DATA_SOURCE,
        })

    print(f"After slug dedup       : {len(to_insert)} new records"
          + (f"  ({skipped_slug} already in DB)" if skipped_slug else ""))

    # ── 7. Preview first 5 records ────────────────────────────────────────────
    if to_insert:
        print("\nFirst 5 records to insert:")
        for rec in to_insert[:5]:
            print(f"  {rec['name']!r:45s}  city={rec['city']!r:20s}  slug={rec['slug']!r}")

    # ── 8. Safety check ───────────────────────────────────────────────────────
    if len(to_insert) > SAFE_MAX:
        print(
            f"\nWARNING: {len(to_insert)} new records seems too high for BIC active "
            f"licenses (~250 expected). Aborting. Check the API filter.",
            file=sys.stderr,
        )
        sys.exit(1)

    # ── 9. Insert in batches ──────────────────────────────────────────────────
    inserted = 0
    errors   = 0

    if not to_insert:
        print("\nNothing new to insert — all records already exist.")
    else:
        print(f"\nInserting {len(to_insert)} records in batches of {BATCH_SIZE} ...")
        for i in range(0, len(to_insert), BATCH_SIZE):
            batch     = to_insert[i : i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            try:
                supabase.table("organizations").insert(batch).execute()
                inserted += len(batch)
                print(f"  ✓ Batch {batch_num}: {len(batch)} records")
            except Exception as exc:
                print(f"  ✗ Batch {batch_num} failed: {exc}")
                errors += 1

    # ── 10. Summary ───────────────────────────────────────────────────────────
    print("\n=== Summary ===")
    print(f"  Total from API       : {len(raw_records)}")
    print(f"  Unique BIC numbers   : {len(by_bic)}")
    print(f"  License type         : {len(license_records)}")
    print(f"  Already in DB        : {skipped_slug}")
    print(f"  Inserted             : {inserted}")
    print(f"  Errors               : {errors}")

    if errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
