#!/usr/bin/env python3
"""
pipelines/nyc-bic-import/index.py

Imports NYC Business Integrity Commission (BIC) licensed trade waste
haulers from the NYC Open Data API.

Only currently active License records are imported (application_type =
'License' AND expiration_date >= today). Dedup is slug-based only.

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
from datetime import datetime, date

try:
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

# Single quotes URL-encoded as %27 for the Socrata $where filter
API_BASE    = "https://data.cityofnewyork.us/resource/867j-5pgi.json"
PAGE_SIZE   = 1000
PAGE_CAP    = 5         # max 5,000 records — active BIC list is ~250
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


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_all() -> list[dict]:
    """
    Fetch all records from the NYC Open Data BIC endpoint.

    Tries server-side filtering first (application_type='License' with
    URL-encoded single quotes). Falls back to fetching all records and
    filtering in Python — handles APIs that ignore $where parameters.

    Stops when a page has fewer than PAGE_SIZE records or PAGE_CAP is hit.
    """
    session = requests.Session()
    session.headers.update({"User-Agent": "WasteDirectory-DataImport/1.0"})

    all_rows: list[dict] = []
    offset = 0
    pages = 0

    # Build URL with URL-encoded $where so single quotes survive
    # application_type='License' → application_type%3D%27License%27
    filter_url = (
        f"{API_BASE}"
        f"?$limit={PAGE_SIZE}"
        f"&$where=application_type%3D%27License%27"
    )

    print(f"  Filter URL: {filter_url}&$offset=0")

    while pages < PAGE_CAP:
        url = f"{filter_url}&$offset={offset}"
        resp = session.get(url, timeout=15)
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
        print(f"  WARNING: hit PAGE_CAP ({PAGE_CAP}), stopped early")

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

    # ── 1. Fetch from API ─────────────────────────────────────────────────────
    print(f"\nFetching from NYC Open Data API ...")
    try:
        raw_records = fetch_all()
    except Exception as exc:
        print(f"ERROR fetching from API: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"\nTotal records from API : {len(raw_records)}")

    # ── 2. Filter in Python (belt-and-suspenders) ─────────────────────────────
    today = date.today().isoformat()  # e.g. "2026-03-26"
    active = []
    for r in raw_records:
        app_type = str(r.get("application_type") or "").strip()
        exp_date = iso_date(s(r.get("expiration_date"))) or ""
        if app_type == "License" and exp_date >= today:
            active.append(r)

    print(f"After Python filter    : {len(active)}  "
          f"(active License, expiry >= {today})")

    if not active:
        print("No active License records found — check API response above.")
        return

    # ── 3. Connect to Supabase ────────────────────────────────────────────────
    supabase: Client = create_client(supabase_url, service_role_key)

    # ── 4. Load ALL existing slugs into a Python set (slug-only dedup) ────────
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

    # ── 5. Build insert list — skip any slug already in DB ────────────────────
    to_insert: list[dict] = []
    seen_slugs: set[str]  = set()

    for rec in active:
        name = s(rec.get("account_name")) or ""
        if not name:
            continue

        city      = s(rec.get("city")) or ""
        slug      = slugify(name, city)
        if not slug:
            continue

        # Deduplicate: skip if slug already in DB or seen in this run
        if slug in existing_slugs or slug in seen_slugs:
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

    print(f"After slug dedup       : {len(to_insert)} new records to insert")

    # ── 6. Preview first 5 records ────────────────────────────────────────────
    if to_insert:
        print("\nFirst 5 records to insert:")
        for rec in to_insert[:5]:
            print(f"  {rec['name']!r:45s}  city={rec['city']!r:20s}  slug={rec['slug']!r}")

    # ── 7. Safety check ───────────────────────────────────────────────────────
    if len(to_insert) > SAFE_MAX:
        print(
            f"\nWARNING: {len(to_insert)} new records seems too high for BIC active "
            f"licenses (~250 expected). Aborting. Check the API filter.",
            file=sys.stderr,
        )
        sys.exit(1)

    if not to_insert:
        print("\nNothing new to insert — all records already exist.")
    else:
        # ── 8. Insert in batches ──────────────────────────────────────────────
        print(f"\nInserting {len(to_insert)} records in batches of {BATCH_SIZE} ...")
        inserted = 0
        errors   = 0

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

    # ── 9. Summary ────────────────────────────────────────────────────────────
    print("\n=== Summary ===")
    print(f"  Total from API       : {len(raw_records)}")
    print(f"  Active licenses      : {len(active)}")
    print(f"  Already in DB        : {len(active) - len(to_insert)}")
    print(f"  Inserted             : {inserted if to_insert else 0}")
    print(f"  Errors               : {errors if to_insert else 0}")

    if to_insert and errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
