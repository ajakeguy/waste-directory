#!/usr/bin/env python3
"""
pipelines/nyc-bic-import/index.py

Imports NYC Business Integrity Commission (BIC) licensed trade waste
haulers from the NYC Open Data API.

Only records with application_type = "License" are imported.

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

API_URL     = "https://data.cityofnewyork.us/resource/867j-5pgi.json"
PAGE_SIZE   = 1000
PAGE_CAP    = 20       # hard stop at 20,000 records (active BIC list has ~250)
DATA_SOURCE = "nyc_bic_license_2026"
BATCH_SIZE  = 50

# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(name: str, city: str) -> str:
    """Generate a URL-friendly slug from name and city."""
    combined = f"{name} {city}"
    combined = combined.lower()
    combined = re.sub(r"[^a-z0-9]+", "-", combined)
    return combined.strip("-")


def normalize_name(name: str) -> str:
    """Normalize company name for dedup matching."""
    name = name.lower()
    name = re.sub(r"[^a-z0-9 ]", "", name)
    return re.sub(r"\s+", " ", name).strip()


def clean_phone(raw: str | None) -> str | None:
    """Normalize phone to NNN-NNN-NNNN. Returns None for empty/invalid."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"{digits[0:3]}-{digits[3:6]}-{digits[6:10]}"
    if len(digits) == 11 and digits[0] == "1":
        return f"{digits[1:4]}-{digits[4:7]}-{digits[7:11]}"
    trimmed = raw.strip()
    return trimmed if trimmed else None


def iso_date(raw: str | None) -> str | None:
    """
    Return the date portion of an ISO datetime string (YYYY-MM-DD).
    The NYC Open Data API returns dates as 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS.000'.
    """
    if not raw:
        return None
    return raw[:10]  # slice to YYYY-MM-DD


def str_or_none(value) -> str | None:
    """Return stripped string or None for empty/null values."""
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def float_or_none(value) -> float | None:
    """Return float or None."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ── API fetch ─────────────────────────────────────────────────────────────────

def fetch_all_records() -> list[dict]:
    """
    Paginate through the NYC Open Data BIC endpoint and return all rows.

    Filters server-side to application_type='License' AND expiration_date
    >= today, so only currently active licenses are returned (~250 records).

    Stop conditions (whichever comes first):
      1. Page returns fewer than PAGE_SIZE records  → last page
      2. Page returns empty                         → past the end
      3. PAGE_CAP pages fetched                     → safety hard stop

    API field names (verified from live data):
        bic_number, account_name, address, city, state, postcode,
        phone, email, application_type, expiration_date,
        latitude, longitude
    """
    today = date.today().isoformat()  # e.g. "2026-03-26"
    where = f"application_type='License' AND expiration_date>='{today}'"

    all_rows: list[dict] = []
    offset = 0
    pages_fetched = 0
    session = requests.Session()
    session.headers.update({"User-Agent": "WasteDirectory-DataImport/1.0"})

    while True:
        resp = session.get(
            API_URL,
            params={"$limit": PAGE_SIZE, "$offset": offset, "$where": where},
            timeout=15,
        )
        resp.raise_for_status()
        page = resp.json()
        pages_fetched += 1

        print(f"  Page at offset {offset}: {len(page)} records")

        if not page:
            break

        # Print a sample of the first record so field names are visible in logs
        if offset == 0:
            print("  Sample record:", json.dumps(page[0], indent=2))

        all_rows.extend(page)

        if len(page) < PAGE_SIZE:
            break  # last page — fewer records than the limit means no more pages

        offset += PAGE_SIZE

        if pages_fetched >= PAGE_CAP:
            print(f"  WARNING: hit page cap ({PAGE_CAP} pages / {len(all_rows):,} records), stopping")
            break

    return all_rows


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=== WasteDirectory — NYC BIC License Importer ===")
    print(datetime.utcnow().isoformat())

    # Supabase credentials
    supabase_url      = os.environ.get("SUPABASE_URL")
    service_role_key  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print(
            "Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        sys.exit(1)

    # ── 1. Fetch from NYC Open Data API ───────────────────────────────────────
    print(f"\nFetching data from NYC Open Data API ...")
    print(f"  {API_URL}")
    try:
        all_records = fetch_all_records()
    except Exception as exc:
        print(f"Failed to fetch from API: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"  Total records fetched: {len(all_records)}")

    # ── 2. Safety-filter to License type only ────────────────────────────────
    # The API $where already filters server-side; this is a belt-and-suspenders
    # check in case the API returns unexpected records.
    license_records = [
        r for r in all_records
        if str(r.get("application_type", "")).strip().lower() == "license"
    ]
    skipped_type = len(all_records) - len(license_records)
    if skipped_type:
        print(f"  Non-License records filtered out: {skipped_type}")
    print(f"  Active License records: {len(license_records)}")

    if not license_records:
        print("\nNo License-type records found.")
        return

    # ── 3. Connect to Supabase ────────────────────────────────────────────────
    supabase: Client = create_client(supabase_url, service_role_key)

    # ── 4. Load existing orgs for name-match dedup ────────────────────────────
    print("\nLoading existing organizations for dedup ...")
    existing_name_map: dict[str, dict] = {}
    existing_slug_set: set[str]        = set()
    db_page_size = 1000
    db_offset    = 0

    while True:
        result = (
            supabase.table("organizations")
            .select("id, name, slug, service_area_states")
            .range(db_offset, db_offset + db_page_size - 1)
            .execute()
        )
        for org in result.data:
            key = normalize_name(org["name"] or "")
            if key:
                existing_name_map[key] = org
            if org.get("slug"):
                existing_slug_set.add(org["slug"])
        if len(result.data) < db_page_size:
            break
        db_offset += db_page_size

    print(f"  Loaded {len(existing_name_map)} existing organizations")

    # ── 5. Classify records ───────────────────────────────────────────────────
    to_update:       list[tuple[dict, dict]] = []  # (existing_org, api_record)
    already_existed: list[dict]              = []
    to_insert:       list[dict]              = []
    seen_slugs:      set[str]               = set()
    skipped_no_name  = 0

    for rec in license_records:
        account_name = str_or_none(rec.get("account_name")) or ""
        if not account_name:
            skipped_no_name += 1
            continue

        name_key = normalize_name(account_name)
        existing = existing_name_map.get(name_key)

        if existing:
            current_states = existing.get("service_area_states") or []
            if "NY" not in current_states:
                to_update.append((existing, rec))
            else:
                already_existed.append(existing)
            continue

        # New record — generate a unique slug
        city = str_or_none(rec.get("city")) or ""
        base_slug = slugify(account_name, city)
        if not base_slug:
            skipped_no_name += 1
            continue

        slug = base_slug
        counter = 1
        while slug in existing_slug_set or slug in seen_slugs:
            slug = f"{base_slug}-{counter}"
            counter += 1
        seen_slugs.add(slug)

        state = str_or_none(rec.get("state")) or "NY"

        to_insert.append({
            "name":                account_name,
            "slug":                slug,
            "org_type":            "hauler",
            "phone":               clean_phone(str_or_none(rec.get("phone"))),
            "email":               str_or_none(rec.get("email")),
            "address":             str_or_none(rec.get("address")),
            "city":                city or None,
            "state":               state,
            "zip":                 str_or_none(rec.get("postcode")),
            "hq_state":            state,
            "lat":                 float_or_none(rec.get("latitude")),
            "lng":                 float_or_none(rec.get("longitude")),
            "license_number":      str_or_none(rec.get("bic_number")),
            "license_expiry":      iso_date(str_or_none(rec.get("expiration_date"))),
            "service_types":       ["commercial"],
            "service_area_states": ["NY"],
            "verified":            True,
            "active":              True,
            "data_source":         DATA_SOURCE,
        })

    print(f"  Name-matched (NY update needed): {len(to_update)}")
    print(f"  Name-matched (already complete): {len(already_existed)}")
    print(f"  New records to insert:           {len(to_insert)}")
    if skipped_no_name:
        print(f"  Skipped (no name):               {skipped_no_name}")

    # ── 6. Update service_area_states for name-matched orgs ───────────────────
    update_errors = 0
    for existing, rec in to_update:
        current_states = existing.get("service_area_states") or []
        try:
            supabase.table("organizations").update({
                "service_area_states": list(current_states) + ["NY"],
                "license_number":      str_or_none(rec.get("bic_number")),
                "license_expiry":      iso_date(str_or_none(rec.get("expiration_date"))),
            }).eq("id", existing["id"]).execute()
            print(f"  ✓ Updated {existing['slug']} — added NY to service_area_states")
        except Exception as exc:
            print(f"  ✗ Update failed for {existing['slug']}: {exc}")
            update_errors += 1

    # ── 7. Insert new records in batches ──────────────────────────────────────
    # Dedup is fully resolved in Python above (existing_slug_set + seen_slugs).
    # to_insert contains only records whose name AND slug are not in the DB.
    # No Supabase slug query needed — avoids URL-too-long errors at scale.
    insert_errors  = 0
    newly_inserted = 0

    print(f"  Inserting {len(to_insert)} new records in batches of {BATCH_SIZE} ...")

    for i in range(0, len(to_insert), BATCH_SIZE):
        batch     = to_insert[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            supabase.table("organizations").insert(batch).execute()
            newly_inserted += len(batch)
            print(f"  ✓ Batch {batch_num}: inserted {len(batch)} records")
        except Exception as exc:
            print(f"  ✗ Batch {batch_num} failed: {exc}")
            insert_errors += 1

    # ── 8. Summary ────────────────────────────────────────────────────────────
    total_errors = update_errors + insert_errors
    print("\n=== Summary ===")
    print(f"  Total fetched    : {len(all_records)}")
    print(f"  License type     : {len(license_records)}")
    print(f"  Name-matched     : {len(to_update) + len(already_existed)}")
    print(f"  Already existed  : {len(already_existed)}")
    print(f"  Newly inserted   : {newly_inserted}")
    print(f"  Errors           : {total_errors}")

    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
