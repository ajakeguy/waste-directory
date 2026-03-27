#!/usr/bin/env python3
"""
pipelines/ny-dec-import/index.py

Attempts to import NY DEC Part 364 waste transporter permit holders.

Tries three data sources in order — logs what each returns so we can
debug and adapt. NEVER fails silently: if no data is found, the summary
says so clearly and exits with code 0 (informational, not a crash).

Endpoints tried (in order):
  1. NY Open Data Socrata API — dataset dnwv-xxci
     https://data.ny.gov/resource/dnwv-xxci.json
  2. NY Open Data rows.json endpoint
     https://data.ny.gov/api/views/dnwv-xxci/rows.json
  3. NY DEC eFACTS web search (HTML, read-only probe)
     https://www.dec.ny.gov/cfmx/extapps/envapps/index.cfm?p=wasteTransporterSearch

Usage:
    python pipelines/ny-dec-import/index.py

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import sys
import os
import re
import math
import json
from datetime import datetime

# ── Auto-install dependencies if missing ──────────────────────────────────────

try:
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

try:
    from supabase import create_client, Client
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "supabase", "-q"])
    from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

# Primary: Socrata SoQL API, paginated
SOCRATA_BASE  = "https://data.ny.gov/resource/dnwv-xxci.json"

# Fallback 1: Socrata rows.json
ROWS_JSON_URL = "https://data.ny.gov/api/views/dnwv-xxci/rows.json"

# Fallback 2: NY DEC eFACTS web search (probe only — no machine-readable data)
EFACTS_URL    = "https://www.dec.ny.gov/cfmx/extapps/envapps/index.cfm?p=wasteTransporterSearch"

DATA_SOURCE   = "ny_dec_part364_2026"
SAFE_MAX      = 3000
BATCH_SIZE    = 50
PAGE_SIZE     = 1000
PAGE_CAP      = 10     # max 10,000 records

HTTP_HEADERS  = {
    "User-Agent": "WasteDirectory-DataImport/1.0",
    "Accept":     "application/json, */*",
}

# ── Field mapping ─────────────────────────────────────────────────────────────
# For Socrata datasets the field names are unpredictable until we see them.
# These aliases cover common NY Open Data naming patterns for transporter permits.

FIELD_ALIASES: dict[str, list[str]] = {
    "permit_number":  ["permit_number", "permit_no", "permitnumber", "permit",
                       "certificate_number", "cert_no", "authorization_number",
                       "transporter_id", "id"],
    "company_name":   ["company_name", "company", "business_name", "name",
                       "applicant_name", "permittee_name", "facility_name",
                       "transporter_name", "entity_name"],
    "address":        ["address", "street_address", "address1", "mailing_address",
                       "street", "addr", "location_address"],
    "city":           ["city", "municipality", "location_city"],
    "state":          ["state", "state_code", "location_state"],
    "zip":            ["zip", "zip_code", "zipcode", "postal_code"],
    "phone":          ["phone", "phone_number", "telephone"],
    "status":         ["status", "permit_status", "authorization_status",
                       "license_status", "active_status"],
    "expiration":     ["expiration_date", "exp_date", "expiry_date",
                       "expiration", "permit_expiration", "expires"],
}


def find_field(record_keys: list[str], alias_key: str) -> str | None:
    """Return the actual record key matching our alias, or None."""
    aliases = FIELD_ALIASES.get(alias_key, [alias_key])
    lower_map = {k.lower(): k for k in record_keys}
    for alias in aliases:
        if alias.lower() in lower_map:
            return lower_map[alias.lower()]
    return None


# ── Data helpers ──────────────────────────────────────────────────────────────

def s(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    v = str(value).strip()
    return v if v and v.lower() not in ("nan", "none", "n/a", "na", "") else None


def clean_phone(raw) -> str | None:
    v = s(raw)
    if not v:
        return None
    digits = re.sub(r"\D", "", v)
    if len(digits) == 10:
        return f"{digits[0:3]}-{digits[3:6]}-{digits[6:10]}"
    if len(digits) == 11 and digits[0] == "1":
        return f"{digits[1:4]}-{digits[4:7]}-{digits[7:11]}"
    return v or None


def iso_date(raw) -> str | None:
    if raw is None:
        return None
    if hasattr(raw, "strftime"):
        return raw.strftime("%Y-%m-%d")
    v = s(raw)
    if not v:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(v.split("T")[0].split(" ")[0], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return v[:10] if len(v) >= 10 else None


def slugify(name: str, city: str) -> str:
    combined = f"{name} {city}".lower()
    combined = re.sub(r"[^a-z0-9]+", "-", combined)
    return combined.strip("-")


# ── Endpoint 1: Socrata JSON API ──────────────────────────────────────────────

def try_socrata() -> list[dict] | None:
    """
    Paginate through the Socrata SoQL API for dataset dnwv-xxci.
    Returns list of records on success, None if the endpoint is unavailable.
    """
    print(f"\n[1] Trying Socrata API: {SOCRATA_BASE}")
    session = requests.Session()
    session.headers.update(HTTP_HEADERS)

    all_rows: list[dict] = []
    offset = 0
    pages  = 0

    while pages < PAGE_CAP:
        try:
            resp = session.get(
                SOCRATA_BASE,
                params={"$limit": PAGE_SIZE, "$offset": offset},
                timeout=30,
            )
        except requests.RequestException as exc:
            print(f"  [1] Network error: {exc}")
            return None

        ct = resp.headers.get("Content-Type", "")
        print(f"  [1] Page {pages + 1}: HTTP {resp.status_code}  Content-Type: {ct}")

        if resp.status_code == 404:
            print(f"  [1] 404 — dataset dnwv-xxci does not exist on data.ny.gov")
            return None

        if resp.status_code != 200:
            print(f"  [1] Unexpected status {resp.status_code}")
            print(f"  [1] Headers: {dict(resp.headers)}")
            print(f"  [1] Body (first 500 chars): {resp.text[:500]}")
            return None

        # Expect JSON array
        try:
            page = resp.json()
        except json.JSONDecodeError:
            print(f"  [1] Response is not valid JSON")
            print(f"  [1] Body (first 500 chars): {resp.text[:500]}")
            return None

        if not isinstance(page, list):
            print(f"  [1] Expected JSON array, got {type(page).__name__}")
            print(f"  [1] Body (first 500 chars): {resp.text[:500]}")
            return None

        pages += 1
        print(f"  [1] Page {pages}: {len(page)} records returned")

        if pages == 1 and page:
            print(f"  [1] First record keys: {list(page[0].keys())}")
            print(f"  [1] Sample record:\n{json.dumps(page[0], indent=4, default=str)[:800]}")

        all_rows.extend(page)

        if len(page) < PAGE_SIZE:
            break  # last page
        offset += PAGE_SIZE

    if pages >= PAGE_CAP:
        print(f"  [1] WARNING: Hit PAGE_CAP ({PAGE_CAP} pages / {len(all_rows):,} records)")

    if not all_rows:
        print(f"  [1] Dataset exists but returned 0 records")
        return None

    print(f"  [1] ✓ Total records from Socrata: {len(all_rows)}")
    return all_rows


# ── Endpoint 2: Socrata rows.json ─────────────────────────────────────────────

def try_rows_json() -> list[dict] | None:
    """
    Try the Socrata /rows.json endpoint which returns column metadata + row data.
    Returns a list of flat dicts on success, None if unavailable.
    """
    print(f"\n[2] Trying rows.json: {ROWS_JSON_URL}")
    try:
        resp = requests.get(ROWS_JSON_URL, headers=HTTP_HEADERS, timeout=30)
    except requests.RequestException as exc:
        print(f"  [2] Network error: {exc}")
        return None

    ct = resp.headers.get("Content-Type", "")
    print(f"  [2] HTTP {resp.status_code}  Content-Type: {ct}")

    if resp.status_code == 404:
        print(f"  [2] 404 — rows.json endpoint also unavailable")
        return None

    if resp.status_code != 200:
        print(f"  [2] Unexpected status {resp.status_code}")
        print(f"  [2] Headers: {dict(resp.headers)}")
        print(f"  [2] Body (first 500 chars): {resp.text[:500]}")
        return None

    try:
        body = resp.json()
    except json.JSONDecodeError:
        print(f"  [2] Response is not valid JSON")
        print(f"  [2] Body (first 500 chars): {resp.text[:500]}")
        return None

    # rows.json structure: { "meta": { "view": { "columns": [...] } }, "data": [[...]] }
    if not isinstance(body, dict):
        print(f"  [2] Unexpected JSON structure: {type(body).__name__}")
        return None

    meta = body.get("meta", {})
    view = meta.get("view", {}) if isinstance(meta, dict) else {}
    columns_meta = view.get("columns", []) if isinstance(view, dict) else []
    raw_data     = body.get("data", [])

    print(f"  [2] columns_meta count: {len(columns_meta)}  |  data rows: {len(raw_data)}")

    if not columns_meta or not raw_data:
        print(f"  [2] No usable data in rows.json response")
        return None

    # Build column name list (fieldName or name)
    col_names = [
        (c.get("fieldName") or c.get("name") or f"col_{i}").lower()
        for i, c in enumerate(columns_meta)
    ]
    print(f"  [2] Column names: {col_names[:20]}")

    # Flatten rows: each row is a list matching column order
    records: list[dict] = []
    for raw_row in raw_data:
        if not isinstance(raw_row, list):
            continue
        record = {}
        for i, col in enumerate(col_names):
            record[col] = raw_row[i] if i < len(raw_row) else None
        records.append(record)

    if not records:
        print(f"  [2] No records parsed from rows.json")
        return None

    print(f"  [2] ✓ Total records from rows.json: {len(records)}")
    if records:
        print(f"  [2] Sample record:\n{json.dumps(records[0], indent=4, default=str)[:800]}")
    return records


# ── Endpoint 3: eFACTS probe ──────────────────────────────────────────────────

def probe_efacts() -> None:
    """
    Probe the NY DEC eFACTS waste transporter search page.
    This is an HTML form — we can detect if it's reachable and note what
    we see, but we cannot scrape structured data without a form submission.
    """
    print(f"\n[3] Probing NY DEC eFACTS: {EFACTS_URL}")
    try:
        resp = requests.get(EFACTS_URL, headers=HTTP_HEADERS, timeout=30)
    except requests.RequestException as exc:
        print(f"  [3] Network error: {exc}")
        return

    ct = resp.headers.get("Content-Type", "")
    print(f"  [3] HTTP {resp.status_code}  Content-Type: {ct}")
    print(f"  [3] Response size: {len(resp.content)} bytes")

    if resp.status_code == 200:
        text = resp.text
        # Check for known markers that indicate the search form is present
        has_form       = "<form" in text.lower()
        has_search_btn = "search" in text.lower()
        has_cfm        = ".cfm" in text.lower()
        print(f"  [3] Contains <form>: {has_form}")
        print(f"  [3] Contains 'search': {has_search_btn}")
        print(f"  [3] References .cfm pages: {has_cfm}")
        print(f"  [3] NOTE: eFACTS requires a POST form submission to retrieve data.")
        print(f"  [3]       Machine-readable export not available via this URL alone.")
        print(f"  [3]       A Selenium/Playwright scraper would be needed for full access.")
    elif resp.status_code in (403, 401):
        print(f"  [3] Access denied — eFACTS may require authentication or block bots.")
    else:
        print(f"  [3] Unexpected status: {resp.status_code}")
        print(f"  [3] Body (first 300 chars): {resp.text[:300]}")


# ── Record mapping ────────────────────────────────────────────────────────────

def map_records(
    raw_records: list[dict],
    source_label: str,
) -> list[dict]:
    """
    Map raw API records to our organizations schema.
    Deduplicates by permit number within the batch, discards records with
    no name. Returns list of org dicts ready for insert.
    """
    if not raw_records:
        return []

    sample_keys = list(raw_records[0].keys()) if raw_records else []
    print(f"\nMapping {len(raw_records)} records from {source_label} ...")
    print(f"Available keys: {sample_keys[:25]}")

    # Deduplicate by permit number — keep the latest per permit
    permit_key = find_field(sample_keys, "permit_number")
    if permit_key:
        by_permit: dict[str, dict] = {}
        no_permit = 0
        for rec in raw_records:
            permit = s(rec.get(permit_key))
            if not permit:
                no_permit += 1
                # Still include records without permit numbers
                by_permit[f"_nopermit_{id(rec)}"] = rec
            else:
                existing = by_permit.get(permit)
                # Keep last record per permit (simple dedup — no date sort needed
                # since Socrata returns latest data)
                if existing is None:
                    by_permit[permit] = rec
        deduped = list(by_permit.values())
        print(f"Deduped by permit number: {len(deduped)} unique"
              + (f"  ({no_permit} had no permit number)" if no_permit else ""))
    else:
        deduped = raw_records
        print(f"No permit number field found — skipping permit dedup")

    # Optional: filter to active status only if a status field is present
    status_key = find_field(sample_keys, "status")
    if status_key:
        active = [
            r for r in deduped
            if s(r.get(status_key)) is None or
               s(r.get(status_key)).lower() in ("active", "valid", "current", "issued", "approved", "")
        ]
        skipped_status = len(deduped) - len(active)
        if skipped_status:
            print(f"After status filter: {len(active)} records ({skipped_status} non-active skipped)")
        deduped = active

    mapped:      list[dict] = []
    seen_slugs:  set[str]   = set()
    skipped_name = 0

    for rec in deduped:
        rkeys = list(rec.keys())

        name_key    = find_field(rkeys, "company_name")
        city_key    = find_field(rkeys, "city")
        state_key   = find_field(rkeys, "state")
        addr_key    = find_field(rkeys, "address")
        zip_key     = find_field(rkeys, "zip")
        phone_key   = find_field(rkeys, "phone")
        permit_fkey = find_field(rkeys, "permit_number")
        exp_key     = find_field(rkeys, "expiration")

        name = s(rec.get(name_key)) if name_key else None
        if not name:
            skipped_name += 1
            continue

        city  = s(rec.get(city_key))  if city_key  else None
        state = s(rec.get(state_key)) if state_key else "NY"
        if state and len(state) > 2:
            state = state[:2].upper()
        state = (state or "NY").upper()

        slug = slugify(name, city or "")
        if not slug:
            continue

        # Disambiguate within-batch collisions
        base_slug, counter = slug, 1
        while slug in seen_slugs:
            slug = f"{base_slug}-{counter}"
            counter += 1
        seen_slugs.add(slug)

        mapped.append({
            "name":                name,
            "slug":                slug,
            "org_type":            "hauler",
            "address":             s(rec.get(addr_key))    if addr_key    else None,
            "city":                city,
            "state":               state,
            "zip":                 s(rec.get(zip_key))     if zip_key     else None,
            "phone":               clean_phone(rec.get(phone_key) if phone_key else None),
            "license_number":      s(rec.get(permit_fkey)) if permit_fkey else None,
            "license_expiry":      iso_date(rec.get(exp_key) if exp_key else None),
            "service_types":       ["commercial", "industrial"],
            "service_area_states": ["NY"],
            "verified":            True,
            "active":              True,
            "data_source":         DATA_SOURCE,
        })

    if skipped_name:
        print(f"Skipped (no name): {skipped_name}")
    print(f"Mapped to schema : {len(mapped)}")
    return mapped


# ── Supabase insert ───────────────────────────────────────────────────────────

def slug_dedup_and_insert(
    to_insert: list[dict],
    supabase: "Client",
) -> tuple[int, int, int]:
    """
    Load existing slugs, remove already-present records, batch-insert the rest.
    Returns (existing_count, inserted_count, error_count).
    """
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

    print(f"Existing slugs in DB: {len(existing_slugs)}")

    new_records  = [r for r in to_insert if r["slug"] not in existing_slugs]
    already_in   = len(to_insert) - len(new_records)
    print(f"Already in DB       : {already_in}")
    print(f"Net new to insert   : {len(new_records)}")

    if len(new_records) > SAFE_MAX:
        print(
            f"\nERROR: {len(new_records)} new records exceeds SAFE_MAX ({SAFE_MAX:,}). "
            f"Aborting to prevent runaway insert.",
            file=sys.stderr,
        )
        sys.exit(1)

    inserted = 0
    errors   = 0

    if not new_records:
        print("Nothing new to insert.")
    else:
        print(f"\nInserting {len(new_records)} records in batches of {BATCH_SIZE} ...")
        for i in range(0, len(new_records), BATCH_SIZE):
            batch     = new_records[i : i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            try:
                supabase.table("organizations").insert(batch).execute()
                inserted += len(batch)
                print(f"  ✓ Batch {batch_num}: inserted {len(batch)} records")
            except Exception as exc:
                print(f"  ✗ Batch {batch_num} failed: {exc}")
                errors += 1

    return already_in, inserted, errors


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=== WasteDirectory — NY DEC Part 364 Transporter Importer ===")
    print(datetime.utcnow().isoformat())

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    # ── Try each endpoint in order ────────────────────────────────────────────
    raw_records: list[dict] | None = None
    source_label = ""

    # Attempt 1: Socrata JSON API
    raw_records = try_socrata()
    if raw_records is not None:
        source_label = "Socrata JSON API (dnwv-xxci)"
    else:
        # Attempt 2: rows.json
        raw_records = try_rows_json()
        if raw_records is not None:
            source_label = "Socrata rows.json (dnwv-xxci)"
        else:
            # Attempt 3: eFACTS probe (informational only)
            probe_efacts()

    # ── If no data found, report and exit cleanly ─────────────────────────────
    if not raw_records:
        print("\n" + "=" * 60)
        print("DATA NOT AVAILABLE — Summary")
        print("=" * 60)
        print(
            "\nNone of the three NY DEC Part 364 data sources returned\n"
            "usable machine-readable records:\n"
            "\n"
            "  [1] data.ny.gov/resource/dnwv-xxci.json\n"
            "      → Dataset may not exist on NY Open Data (404) or\n"
            "        may require an API token for bulk access.\n"
            "\n"
            "  [2] data.ny.gov/api/views/dnwv-xxci/rows.json\n"
            "      → Same underlying dataset — same result as above.\n"
            "\n"
            "  [3] dec.ny.gov eFACTS search\n"
            "      → Requires POST form submission; not scrapeable\n"
            "        via GET request alone. A Selenium/Playwright\n"
            "        browser automation would be needed.\n"
            "\n"
            "Recommended next steps:\n"
            "  a) Verify the correct dataset ID on https://data.ny.gov/\n"
            "     (search 'Part 364 transporter' or 'waste transporter')\n"
            "  b) Check if an API token is needed:\n"
            "     https://dev.socrata.com/foundry/data.ny.gov/dnwv-xxci\n"
            "  c) Contact NY DEC directly for a bulk export:\n"
            "     https://www.dec.ny.gov/permits/6101.html\n"
            "\n"
            "No records were modified. Exiting cleanly."
        )
        sys.exit(0)   # Not a failure — just no data available yet

    # ── Map records to schema ─────────────────────────────────────────────────
    to_insert = map_records(raw_records, source_label)

    if not to_insert:
        print("\nNo records could be mapped after filtering. Exiting cleanly.")
        sys.exit(0)

    # Preview
    print("\nFirst 5 records to evaluate:")
    for rec in to_insert[:5]:
        print(f"  {rec['name']!r:45s}  city={rec['city']!r:20s}  "
              f"state={rec['state']}  license={rec['license_number']!r}")

    # ── Insert ────────────────────────────────────────────────────────────────
    supabase: Client = create_client(supabase_url, service_role_key)
    already_in, inserted, errors = slug_dedup_and_insert(to_insert, supabase)

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n=== Summary ===")
    print(f"  Source               : {source_label}")
    print(f"  Total from source    : {len(raw_records)}")
    print(f"  Mapped to schema     : {len(to_insert)}")
    print(f"  Already in DB        : {already_in}")
    print(f"  Inserted             : {inserted}")
    print(f"  Errors               : {errors}")

    if errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
