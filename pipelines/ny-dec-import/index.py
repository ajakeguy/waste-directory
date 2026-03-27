#!/usr/bin/env python3
"""
pipelines/ny-dec-import/index.py

Attempts to locate and import NY DEC Part 364 waste transporter permit holders
from NY Open Data (data.ny.gov).

The original dataset ID (dnwv-xxci) was confirmed to not exist.
This version probes three alternative dataset IDs in order, fetches a
5-record sample from each, and logs:
  - HTTP status code
  - Column names from the response
  - First record (full contents)

If one of the probes returns data that looks like waste transporter records,
the pipeline will proceed to a full fetch + DB insert.

If none are useful, a detailed diagnostic summary is printed and the
script exits cleanly (exit 0) — never fails silently.

Endpoints probed (in order):
  1. https://data.ny.gov/resource/kazv-yi3p.json  (probe — verify this isn't BIC)
  2. https://data.ny.gov/resource/p937-wjvj.json  (candidate: Part 364 transporters)
  3. https://data.ny.gov/resource/w4pn-hx4j.json  (candidate: waste permits)

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

# Datasets to probe — listed with notes so the output is self-documenting
PROBE_DATASETS = [
    {
        "id":    "kazv-yi3p",
        "label": "Candidate 1 (kazv-yi3p) — verify not BIC duplicate",
        "url":   "https://data.ny.gov/resource/kazv-yi3p.json",
    },
    {
        "id":    "p937-wjvj",
        "label": "Candidate 2 (p937-wjvj) — possible Part 364 transporters",
        "url":   "https://data.ny.gov/resource/p937-wjvj.json",
    },
    {
        "id":    "w4pn-hx4j",
        "label": "Candidate 3 (w4pn-hx4j) — possible waste permits",
        "url":   "https://data.ny.gov/resource/w4pn-hx4j.json",
    },
]

# Keywords that suggest a dataset is about waste transporters/permits
USEFUL_KEYWORDS = {
    "permit", "transporter", "waste", "hauler", "license", "carrier",
    "part_364", "part364", "dec", "authorization",
}

DATA_SOURCE = "ny_dec_part364_2026"
SAFE_MAX    = 3000
BATCH_SIZE  = 50
PAGE_SIZE   = 1000
PAGE_CAP    = 10

HTTP_HEADERS = {
    "User-Agent": "WasteDirectory-DataImport/1.0",
    "Accept":     "application/json, */*",
}

# ── Field mapping ─────────────────────────────────────────────────────────────

FIELD_ALIASES: dict[str, list[str]] = {
    "permit_number":  ["permit_number", "permit_no", "permitnumber", "permit",
                       "certificate_number", "cert_no", "authorization_number",
                       "transporter_id", "license_number", "id"],
    "company_name":   ["company_name", "company", "business_name", "name",
                       "applicant_name", "permittee_name", "facility_name",
                       "transporter_name", "entity_name", "owner_name"],
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


def score_usefulness(columns: list[str]) -> tuple[int, list[str]]:
    """
    Score how likely a dataset is to contain waste transporter data.
    Returns (score, matched_keywords).
    Higher score = more likely to be useful.
    """
    all_text = " ".join(c.lower() for c in columns)
    matched = [kw for kw in USEFUL_KEYWORDS if kw in all_text]
    return len(matched), matched


# ── Probe function ────────────────────────────────────────────────────────────

def probe_dataset(dataset: dict) -> dict:
    """
    Fetch up to 5 records from a Socrata dataset endpoint.
    Returns a result dict with keys:
      success (bool), status_code, columns, first_record, usefulness_score,
      matched_keywords, error (str|None)
    """
    url   = dataset["url"]
    label = dataset["label"]
    result = {
        "dataset":           dataset,
        "success":           False,
        "status_code":       None,
        "columns":           [],
        "first_record":      None,
        "record_count":      0,
        "usefulness_score":  0,
        "matched_keywords":  [],
        "error":             None,
    }

    print(f"\n{'─' * 60}")
    print(f"Probing: {label}")
    print(f"URL    : {url}")

    try:
        resp = requests.get(url, params={"$limit": 5}, headers=HTTP_HEADERS, timeout=30)
    except requests.RequestException as exc:
        result["error"] = str(exc)
        print(f"  Network error: {exc}")
        return result

    result["status_code"] = resp.status_code
    ct = resp.headers.get("Content-Type", "")
    print(f"  HTTP {resp.status_code}  Content-Type: {ct}")

    if resp.status_code == 404:
        result["error"] = "404 Not Found — dataset does not exist on data.ny.gov"
        print(f"  → 404: dataset does not exist")
        return result

    if resp.status_code != 200:
        result["error"] = f"HTTP {resp.status_code}"
        print(f"  → Unexpected status. Headers: {dict(resp.headers)}")
        print(f"  → Body (first 400 chars): {resp.text[:400]}")
        return result

    try:
        data = resp.json()
    except json.JSONDecodeError:
        result["error"] = "Response is not valid JSON"
        print(f"  → Not valid JSON. Body (first 400 chars): {resp.text[:400]}")
        return result

    if not isinstance(data, list):
        result["error"] = f"Expected JSON array, got {type(data).__name__}"
        print(f"  → Unexpected structure: {type(data).__name__}")
        print(f"  → Body (first 400 chars): {resp.text[:400]}")
        return result

    result["record_count"] = len(data)
    print(f"  → {len(data)} records returned")

    if not data:
        result["error"] = "Dataset exists but returned 0 records"
        print(f"  → Empty dataset")
        return result

    first = data[0]
    columns = list(first.keys())
    result["success"]      = True
    result["columns"]      = columns
    result["first_record"] = first

    score, matched = score_usefulness(columns)
    result["usefulness_score"] = score
    result["matched_keywords"] = matched

    print(f"\n  Column names ({len(columns)} total):")
    for col in columns:
        print(f"    • {col}")

    print(f"\n  First record:")
    print(json.dumps(first, indent=4, default=str))

    print(f"\n  Usefulness score: {score}/10")
    if matched:
        print(f"  Matched keywords: {matched}")
    else:
        print(f"  No waste-transporter keywords matched — likely not the right dataset")

    return result


# ── Full fetch ────────────────────────────────────────────────────────────────

def fetch_all_records(url: str, label: str) -> list[dict] | None:
    """Paginate through a Socrata endpoint to retrieve all records."""
    print(f"\nFetching all records from: {label}")
    session = requests.Session()
    session.headers.update(HTTP_HEADERS)

    all_rows: list[dict] = []
    offset = 0
    pages  = 0

    while pages < PAGE_CAP:
        try:
            resp = session.get(url, params={"$limit": PAGE_SIZE, "$offset": offset},
                               timeout=30)
        except requests.RequestException as exc:
            print(f"  Network error on page {pages + 1}: {exc}")
            return None

        if resp.status_code != 200:
            print(f"  HTTP {resp.status_code} on page {pages + 1}")
            return None

        try:
            page = resp.json()
        except json.JSONDecodeError:
            print(f"  Non-JSON response on page {pages + 1}")
            return None

        if not isinstance(page, list):
            break

        pages    += 1
        all_rows.extend(page)
        print(f"  Page {pages}: {len(page)} records (total so far: {len(all_rows)})")

        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    if pages >= PAGE_CAP:
        print(f"  WARNING: Hit PAGE_CAP ({PAGE_CAP} pages / {len(all_rows):,} records)")

    print(f"  ✓ Total records fetched: {len(all_rows)}")
    return all_rows if all_rows else None


# ── Record mapping ────────────────────────────────────────────────────────────

def map_records(raw_records: list[dict]) -> list[dict]:
    if not raw_records:
        return []

    sample_keys = list(raw_records[0].keys())
    print(f"\nMapping {len(raw_records)} records ...")

    # Dedup by permit number
    permit_key = find_field(sample_keys, "permit_number")
    if permit_key:
        by_permit: dict[str, dict] = {}
        no_permit = 0
        for rec in raw_records:
            permit = s(rec.get(permit_key))
            if not permit:
                no_permit += 1
                by_permit[f"_nopermit_{id(rec)}"] = rec
            elif permit not in by_permit:
                by_permit[permit] = rec
        deduped = list(by_permit.values())
        print(f"Deduped by permit: {len(deduped)}"
              + (f"  ({no_permit} had no permit number)" if no_permit else ""))
    else:
        deduped = raw_records
        print("No permit number field found — skipping permit dedup")

    # Filter active status if present
    status_key = find_field(sample_keys, "status")
    if status_key:
        active_vals = {"active", "valid", "current", "issued", "approved"}
        deduped = [
            r for r in deduped
            if not s(r.get(status_key)) or
               s(r.get(status_key)).lower() in active_vals
        ]
        print(f"After status filter: {len(deduped)}")

    mapped:     list[dict] = []
    seen_slugs: set[str]   = set()
    skipped    = 0

    for rec in deduped:
        rkeys     = list(rec.keys())
        name_key  = find_field(rkeys, "company_name")
        name      = s(rec.get(name_key)) if name_key else None
        if not name:
            skipped += 1
            continue

        city_key  = find_field(rkeys, "city")
        state_key = find_field(rkeys, "state")
        addr_key  = find_field(rkeys, "address")
        zip_key   = find_field(rkeys, "zip")
        phone_key = find_field(rkeys, "phone")
        perm_key  = find_field(rkeys, "permit_number")
        exp_key   = find_field(rkeys, "expiration")

        city  = s(rec.get(city_key))  if city_key  else None
        state = s(rec.get(state_key)) if state_key else "NY"
        if state and len(state) > 2:
            state = state[:2].upper()
        state = (state or "NY").upper()

        slug = slugify(name, city or "")
        if not slug:
            continue

        base_slug, counter = slug, 1
        while slug in seen_slugs:
            slug = f"{base_slug}-{counter}"
            counter += 1
        seen_slugs.add(slug)

        mapped.append({
            "name":                name,
            "slug":                slug,
            "org_type":            "hauler",
            "address":             s(rec.get(addr_key))  if addr_key  else None,
            "city":                city,
            "state":               state,
            "zip":                 s(rec.get(zip_key))   if zip_key   else None,
            "phone":               clean_phone(rec.get(phone_key) if phone_key else None),
            "license_number":      s(rec.get(perm_key))  if perm_key  else None,
            "license_expiry":      iso_date(rec.get(exp_key) if exp_key else None),
            "service_types":       ["commercial", "industrial"],
            "service_area_states": ["NY"],
            "verified":            True,
            "active":              True,
            "data_source":         DATA_SOURCE,
        })

    if skipped:
        print(f"Skipped (no name): {skipped}")
    print(f"Mapped to schema : {len(mapped)}")
    return mapped


# ── Supabase insert ───────────────────────────────────────────────────────────

def slug_dedup_and_insert(to_insert: list[dict], supabase: "Client") -> tuple[int, int, int]:
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
    new_records = [r for r in to_insert if r["slug"] not in existing_slugs]
    already_in  = len(to_insert) - len(new_records)
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
    print(f"\nProbing {len(PROBE_DATASETS)} candidate dataset(s) on data.ny.gov ...")

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    # ── 1. Probe all three datasets and collect results ───────────────────────
    probe_results = [probe_dataset(ds) for ds in PROBE_DATASETS]

    # ── 2. Print comparison table ─────────────────────────────────────────────
    print(f"\n{'=' * 60}")
    print("PROBE RESULTS SUMMARY")
    print(f"{'=' * 60}")
    for pr in probe_results:
        ds = pr["dataset"]
        if pr["success"]:
            print(f"\n  ✓ {ds['id']}  score={pr['usefulness_score']}  "
                  f"keywords={pr['matched_keywords']}")
            print(f"    Columns: {pr['columns']}")
        else:
            print(f"\n  ✗ {ds['id']}  HTTP {pr['status_code']}  "
                  f"error={pr['error']}")

    # ── 3. Select best candidate (highest usefulness score, >= 1) ────────────
    useful = [pr for pr in probe_results if pr["success"] and pr["usefulness_score"] >= 1]
    useful.sort(key=lambda r: r["usefulness_score"], reverse=True)

    if not useful:
        print(f"\n{'=' * 60}")
        print("NO USEFUL DATASET FOUND — Diagnostic Summary")
        print(f"{'=' * 60}")
        print(
            "\nNone of the probed dataset IDs returned data matching\n"
            "waste transporter keywords.\n"
            "\n"
            "What each returned:\n"
        )
        for pr in probe_results:
            ds = pr["dataset"]
            print(f"  • {ds['id']}: HTTP {pr['status_code']} — {pr['error'] or 'returned data but no matching keywords'}")
            if pr["success"] and pr["columns"]:
                print(f"    Columns seen: {pr['columns'][:10]}")

        print(
            "\nRecommended next steps:\n"
            "  a) Search data.ny.gov for 'Part 364' or 'waste transporter permit'\n"
            "     https://data.ny.gov/browse?q=waste+transporter\n"
            "  b) Check NY DEC environmental permits search:\n"
            "     https://www.dec.ny.gov/permits/6101.html\n"
            "  c) Request a bulk data export directly from NY DEC\n"
            "\n"
            "No records were modified. Exiting cleanly."
        )
        sys.exit(0)

    # ── 4. Use the best-scoring dataset ──────────────────────────────────────
    best = useful[0]
    ds   = best["dataset"]
    print(f"\n✓ Best candidate: {ds['id']} (score {best['usefulness_score']}, "
          f"keywords: {best['matched_keywords']})")
    print(f"  Proceeding to full fetch from: {ds['url']}")

    raw_records = fetch_all_records(ds["url"], ds["label"])
    if not raw_records:
        print("Full fetch returned no records. Exiting cleanly.")
        sys.exit(0)

    # ── 5. Map + insert ───────────────────────────────────────────────────────
    to_insert = map_records(raw_records)
    if not to_insert:
        print("No records mappable after filtering. Exiting cleanly.")
        sys.exit(0)

    print("\nFirst 5 records to insert:")
    for rec in to_insert[:5]:
        print(f"  {rec['name']!r:45s}  city={rec['city']!r:20s}  "
              f"state={rec['state']}  license={rec['license_number']!r}")

    supabase: Client = create_client(supabase_url, service_role_key)
    already_in, inserted, errors = slug_dedup_and_insert(to_insert, supabase)

    # ── 6. Summary ────────────────────────────────────────────────────────────
    print("\n=== Summary ===")
    print(f"  Source dataset       : {ds['id']} — {ds['label']}")
    print(f"  Total from source    : {len(raw_records)}")
    print(f"  Mapped to schema     : {len(to_insert)}")
    print(f"  Already in DB        : {already_in}")
    print(f"  Inserted             : {inserted}")
    print(f"  Errors               : {errors}")

    if errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
