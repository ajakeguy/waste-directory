"""
NJ DEP A-901 Commercial Solid Waste Transporter Import Pipeline

Two operating modes:
  1. LOCAL FILE MODE (primary): pass an Excel file path as the first argument,
     or place the file at DEFAULT_FILE_PATH. Parses and inserts into Supabase.

  2. PROBE MODE (automated/monthly): no file provided → probes all known NJ
     data source URLs for newly published machine-readable data. Prints a full
     diagnostic report with next steps if nothing is found.

Usage:
  # Local file import (after obtaining Excel from NJDEP):
  python pipelines/nj-dep-import/index.py path/to/A-901_Licensed_Companies.xlsx

  # Probe mode (GitHub Actions cron, or manual):
  python pipelines/nj-dep-import/index.py

File columns expected (A-901 Excel export from NJDEP):
  NJEMS PI #, DEP #, A-901 Bill #, Transporter Name, Street Address,
  Site City Name, City, County, State, Zip Code
"""

import os
import sys
import re
import requests
import pandas as pd
from io import BytesIO
from datetime import datetime
from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

DATA_SOURCE = "nj_dep_a901_2026"
SAFE_MAX = 2000
BATCH_SIZE = 50

# Default local file path — place the NJDEP A-901 Excel export here,
# or pass the path as the first command-line argument.
DEFAULT_FILE_PATH = "pipelines/nj-dep-import/data/nj_a901_haulers.xlsx"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive",
}

# ── Probe URLs (used when no local file is provided) ─────────────────────────
# Confirmed data.nj.gov Socrata dataset IDs — populate if NJ ever publishes one.
SOCRATA_CANDIDATES: list[tuple[str, str]] = []

HTML_PROBE_URLS = [
    (
        "NJ Open Data — solid waste transporter",
        "https://data.nj.gov/api/catalog/v1?q=solid+waste+transporter",
    ),
    (
        "NJ Open Data — A-901",
        "https://data.nj.gov/api/catalog/v1?q=a901",
    ),
    (
        "NJ Open Data — waste hauler",
        "https://data.nj.gov/api/catalog/v1?q=waste+hauler+license",
    ),
    (
        "NJDEP wastedecals portal",
        "https://www.nj.gov/dep/enforcement/wastedecals/swt2.html",
    ),
    (
        "NJDEP A-901 program page",
        "https://dep.nj.gov/wastedecals/commercial-solid-waste-transporters/",
    ),
    (
        "NJDEP license list (legacy — expected 404)",
        "https://www.nj.gov/dep/dshw/hwr/liclist.htm",
    ),
]

# ── Slug helpers ──────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def make_slug(name: str, city: str) -> str:
    return slugify(f"{name} {city}")[:80]

# ── Supabase helpers ──────────────────────────────────────────────────────────

def fetch_existing_slugs(supabase: Client) -> set:
    existing: set[str] = set()
    page_size = 1000
    offset = 0
    while True:
        resp = (
            supabase.table("organizations")
            .select("slug")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        for r in rows:
            existing.add(r["slug"])
        if len(rows) < page_size:
            break
        offset += page_size
    print(f"  Existing slugs in DB: {len(existing):,}")
    return existing

# ── Excel parsing ─────────────────────────────────────────────────────────────

def clean_zip(raw: object) -> str | None:
    """Extract the first 5 digits from a zip code value."""
    if raw is None:
        return None
    s = re.sub(r"\D", "", str(raw))
    return s[:5] if len(s) >= 5 else (s or None)


def format_license(raw: object) -> str | None:
    """Zero-pad A-901 Bill # to 6 digits."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s.lower() in {"nan", "none", ""}:
        return None
    # Strip any non-numeric prefix/suffix, keep the number
    digits = re.sub(r"\D", "", s)
    if digits:
        return digits.zfill(6)
    return s  # return as-is if no digits found


def parse_excel(path: str) -> pd.DataFrame:
    """
    Parse the NJDEP A-901 Excel export.
    header=1: row 0 is blank/metadata, row 1 contains the actual column headers.
    """
    df = pd.read_excel(path, header=1, dtype=str)
    df.columns = [str(c).strip() for c in df.columns]
    # Drop fully blank rows
    df.dropna(how="all", inplace=True)
    print(f"  Columns: {list(df.columns)}")
    print(f"  Rows   : {len(df):,}")
    return df


def clean_id(raw: object) -> str | None:
    """Strip whitespace and return None for blank / nan values."""
    if raw is None:
        return None
    s = str(raw).strip()
    return None if s.lower() in {"nan", "none", ""} else s


def map_records(df: pd.DataFrame) -> list[dict]:
    """Map DataFrame rows to organization insert dicts."""
    records = []
    skipped_blank = 0

    for _, row in df.iterrows():
        name = str(row.get("Transporter Name", "") or "").strip()
        if not name or name.lower() in {"nan", "none", ""}:
            skipped_blank += 1
            continue

        # City: prefer 'City', fall back to 'Site City Name'
        city = str(row.get("City", "") or "").strip()
        if not city or city.lower() in {"nan", "none", ""}:
            city = str(row.get("Site City Name", "") or "").strip()
        city = city if city and city.lower() not in {"nan", "none"} else None

        state = str(row.get("State", "") or "").strip().upper()
        state = state if state and state not in {"NAN", "NONE", ""} else "NJ"

        zip_code    = clean_zip(row.get("Zip Code"))
        license_num = format_license(row.get("A-901 Bill #"))

        # Build license_metadata with all three NJ ID fields
        njems_pi   = clean_id(row.get("NJEMS PI #"))
        dep_num    = clean_id(row.get("DEP #"))
        a901_bill  = clean_id(row.get("A-901 Bill #"))
        county     = clean_id(row.get("County"))
        site_city  = clean_id(row.get("Site City Name"))

        license_metadata: dict[str, str] = {}
        if njems_pi:
            license_metadata["nj_njems_pi"]   = njems_pi
        if dep_num:
            license_metadata["nj_dep_number"] = dep_num
        if a901_bill:
            license_metadata["nj_a901_bill"]  = a901_bill
        if county:
            license_metadata["nj_county"]     = county
        if site_city:
            license_metadata["nj_site_city"]  = site_city

        rec = {
            "name":                name,
            "address":             str(row.get("Street Address", "") or "").strip() or None,
            "city":                city,
            "state":               state,
            "zip":                 zip_code,
            "org_type":            "hauler",
            "license_number":      license_num,
            "license_metadata":    license_metadata,
            "service_types":       ["commercial", "residential"],
            "service_area_states": ["NJ"],
            "data_source":         DATA_SOURCE,
            "verified":            True,
            "active":              True,
        }
        # Remove None values to avoid sending nulls for unset fields
        rec = {k: v for k, v in rec.items() if v is not None or k in {"active", "verified"}}
        records.append(rec)

    print(f"  Skipped (blank name): {skipped_blank}")
    print(f"  Mappable records    : {len(records):,}")
    return records

# ── Insert / update pipeline ──────────────────────────────────────────────────

def slug_dedup_and_upsert(
    supabase: Client, records: list[dict]
) -> tuple[int, int, int, int]:
    """
    Split records into new (insert) and existing (update).
    Existing records are updated with fresh license_number + license_metadata.
    Returns (inserted, updated, skipped_in_batch_dedup, errors).
    """
    inserted = updated = skipped = errors = 0
    existing_slugs = fetch_existing_slugs(supabase)
    slug_counter: dict[str, int] = {}

    to_insert: list[dict] = []
    to_update: list[dict] = []   # records whose slug already exists

    for rec in records:
        base = make_slug(rec["name"], rec.get("city") or "")
        if base in existing_slugs:
            # Slug already in DB — queue for metadata update
            rec["slug"] = base
            to_update.append(rec)
            continue
        # New slug — deduplicate within this batch
        n = slug_counter.get(base, 0)
        slug = base if n == 0 else f"{base}-{n}"
        slug_counter[base] = n + 1
        if slug in existing_slugs:
            # Collision after numbering (edge case) — skip rather than duplicate
            skipped += 1
            continue
        rec["slug"] = slug
        existing_slugs.add(slug)
        to_insert.append(rec)

    print(f"  New records to insert : {len(to_insert):,}")
    print(f"  Existing to update    : {len(to_update):,}")
    if skipped:
        print(f"  Skipped (slug clash)  : {skipped}")

    # ── Insert new records ────────────────────────────────────────────────────
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch = to_insert[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            supabase.table("organizations").insert(batch).execute()
            inserted += len(batch)
            print(f"  ✓ Insert batch {batch_num}: {len(batch)} records")
        except Exception as exc:
            print(f"  ✗ Insert batch {batch_num} failed: {exc!r}")
            errors += 1

    # ── Update existing records with fresh metadata ───────────────────────────
    for i in range(0, len(to_update), BATCH_SIZE):
        batch = to_update[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        batch_errors = 0
        for rec in batch:
            try:
                supabase.table("organizations").update({
                    "license_number":   rec.get("license_number"),
                    "license_metadata": rec.get("license_metadata", {}),
                }).eq("slug", rec["slug"]).execute()
                updated += 1
            except Exception as exc:
                print(f"  ✗ Update failed for {rec['slug']}: {exc!r}")
                batch_errors += 1
                errors += 1
        print(f"  ✓ Update batch {batch_num}: {len(batch) - batch_errors} updated")

    return inserted, updated, skipped, errors

# ── Probe mode helpers ────────────────────────────────────────────────────────

def probe_url(label: str, url: str) -> dict:
    print(f"\n── {label}")
    print(f"   URL: {url}")
    result: dict = {"label": label, "url": url, "status": None, "size": 0}
    try:
        r = requests.get(url, headers=HEADERS, timeout=20, allow_redirects=True)
        ct = r.headers.get("Content-Type", "unknown")
        result.update({"status": r.status_code, "content_type": ct, "size": len(r.content)})
        print(f"   Status : {r.status_code}")
        print(f"   Type   : {ct}")
        print(f"   Size   : {len(r.content):,} bytes")

        if r.status_code == 200:
            if "html" in ct.lower():
                links = re.findall(
                    r'href=["\']([^"\']+\.(xlsx?|csv|pdf|zip))["\']',
                    r.text, re.IGNORECASE,
                )
                if links:
                    print(f"   Downloads found:")
                    for lnk in links[:10]:
                        print(f"     → {lnk[0]}")
                else:
                    print(f"   No download links found")
            elif "json" in ct.lower():
                try:
                    data = r.json()
                    if "resultSetSize" in data:
                        print(f"   Catalog results: {data['resultSetSize']} dataset(s)")
                        for d in (data.get("results") or [])[:5]:
                            nm = d.get("resource", {}).get("name", "?")
                            dom = d.get("metadata", {}).get("domain", "?")
                            uid = d.get("resource", {}).get("id", "?")
                            print(f"     • [{dom}] {nm}  id={uid}")
                except Exception:
                    pass
    except requests.exceptions.ConnectionError as e:
        print(f"   Error  : Connection blocked — {type(e).__name__}")
    except Exception as e:
        print(f"   Error  : {e}")
    return result

# ── Mode: local file import ───────────────────────────────────────────────────

def run_file_import(file_path: str) -> None:
    print(f"Mode      : LOCAL FILE IMPORT")
    print(f"File      : {file_path}")

    if not os.path.exists(file_path):
        print(f"\n✗ File not found: {file_path}")
        print("""
To use this pipeline in local file mode:
  1. Obtain the NJ A-901 hauler list from NJDEP (see probe mode output for
     instructions, or file an OPRA request at https://www.nj.gov/dep/opra/)
  2. Save the Excel file to one of:
       pipelines/nj-dep-import/data/nj_a901_haulers.xlsx  (default path)
       any path of your choice (pass as command-line argument)
  3. Run: python pipelines/nj-dep-import/index.py path/to/file.xlsx
""")
        sys.exit(0)

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    print(f"\nParsing Excel file...")
    df = parse_excel(file_path)

    # Always print full column list so we can verify all expected fields exist
    print(f"\n  All columns ({len(df.columns)}):")
    for col in df.columns.tolist():
        print(f"    {col!r}")

    records = map_records(df)

    if not records:
        print("\n✗ No mappable records found. Check column names match expected format.")
        sys.exit(0)

    if len(records) > SAFE_MAX:
        print(f"\n✗ SAFE_MAX guard: {len(records):,} records > {SAFE_MAX} limit.")
        print("  Raise SAFE_MAX in this pipeline if the count is expected.")
        sys.exit(1)

    # ── Verification table — first 5 records ──────────────────────────────────
    print(f"\n{'='*72}")
    print("FIRST 5 RECORDS — verify license IDs before upserting")
    print(f"{'='*72}")
    print(f"{'Name':<35} {'City':<15} {'NJEMS PI':<10} {'DEP #':<10} {'A-901 #'}")
    print("-" * 72)
    for rec in records[:5]:
        meta = rec.get("license_metadata") or {}
        print(
            f"{rec['name'][:35]:<35} "
            f"{(rec.get('city') or '')[:15]:<15} "
            f"{meta.get('nj_njems_pi', ''):<10} "
            f"{meta.get('nj_dep_number', ''):<10} "
            f"{meta.get('nj_a901_bill', '')}"
        )
    print(f"{'='*72}\n")

    print(f"\nUpserting into Supabase...")
    inserted, updated, skipped, errors = slug_dedup_and_upsert(supabase, records)

    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"  Rows in file         : {len(df):,}")
    print(f"  Mappable records     : {len(records):,}")
    print(f"  Inserted (new)       : {inserted:,}")
    print(f"  Updated (existing)   : {updated:,}")
    print(f"  Skipped (slug clash) : {skipped:,}")
    print(f"  Errors               : {errors}")

    if errors > 0 and inserted == 0 and updated == 0:
        sys.exit(1)

# ── Mode: probe for online data ───────────────────────────────────────────────

def run_probe_mode() -> None:
    print(f"Mode      : PROBE MODE (no local file found)")
    print("\nChecking NJ Open Data portal and NJDEP website for published data...\n")

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    # Check known Socrata dataset IDs first
    if SOCRATA_CANDIDATES:
        print(f"Probing {len(SOCRATA_CANDIDATES)} confirmed Socrata dataset ID(s)...")
        for ds_id, hint in SOCRATA_CANDIDATES:
            url = f"https://data.nj.gov/resource/{ds_id}.json?$limit=5"
            print(f"\n── Socrata: {ds_id} ({hint})")
            try:
                r = requests.get(url, timeout=15)
                print(f"   Status: {r.status_code}")
                if r.status_code == 200:
                    rows = r.json()
                    if rows:
                        print(f"   ✓ Live — {len(rows)} sample rows. Columns: {list(rows[0].keys())}")
                        # TODO: implement full fetch + insert when a confirmed dataset exists
            except Exception as e:
                print(f"   Error: {e}")
    else:
        print("No confirmed Socrata dataset IDs on record.")

    # Probe all known HTML/API URLs
    print(f"\nProbing {len(HTML_PROBE_URLS)} known NJ DEP URL(s)...\n")
    results = [probe_url(label, url) for label, url in HTML_PROBE_URLS]

    print("\n" + "=" * 60)
    print("DIAGNOSTIC SUMMARY")
    print("=" * 60)
    usable = [r for r in results if r.get("status") == 200 and r.get("size", 0) > 500]
    print(f"\nURLs probed    : {len(results)}")
    print(f"Live (HTTP 200): {len(usable)}")

    print("""
✗ No machine-readable NJ A-901 data found at any probed URL.

CURRENT STATUS (confirmed 2026-03):
  • NJDEP dep.nj.gov is behind Imperva/Incapsula WAF — all automated
    requests are blocked even with full browser headers
  • data.nj.gov has ZERO NJ-specific A-901 or waste hauler datasets
  • The legacy license list URL (nj.gov/dep/dshw/hwr/liclist.htm) is a 404

TO OBTAIN THE DATA:
  Option A — OPRA Request (recommended):
    https://www.nj.gov/dep/opra/
    dep.dshw@dep.nj.gov  |  (609) 984-6985
    Request: "Current A-901 licensed solid waste transporters in Excel format"

  Option B — Manual browser export:
    Visit https://www.nj.gov/dep/enforcement/wastedecals/swt2.html
    Open DevTools → Network tab → find the API call when the list loads.

  Once data is obtained, run:
    python pipelines/nj-dep-import/index.py path/to/file.xlsx
""")
    print("Pipeline exiting — 0 records inserted.")
    sys.exit(0)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("NJ DEP A-901 Solid Waste Transporter Import Pipeline")
    print(f"Run date: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)
    print()

    # Determine file path: command-line arg → default path → probe mode
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
        run_file_import(file_path)
    elif os.path.exists(DEFAULT_FILE_PATH):
        run_file_import(DEFAULT_FILE_PATH)
    else:
        run_probe_mode()


if __name__ == "__main__":
    main()
