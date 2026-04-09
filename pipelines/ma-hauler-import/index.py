#!/usr/bin/env python3
"""
pipelines/ma-hauler-import/index.py

Imports Massachusetts municipal hauler records from a locally-maintained CSV
compiled from MassDEP and town-level approved hauler lists.

Source file: pipelines/ma-hauler-import/data/ma_haulers.csv
  Structure: Standard CSV but service area towns are stored as unquoted
             comma-separated values, causing them to spill across extra
             columns. Last column is boilerplate and is discarded.
  Fields:    Hauler_Name, Address, Phone, Website, <towns...>,
             Services/Notes, Year, Recycling_Policy_Note (discard)

Parsing strategy:
  - col[0]    = Hauler_Name
  - col[1]    = Address
  - col[2]    = Phone
  - col[3]    = Website
  - col[-1]   = Recycling_Policy_Note (discarded)
  - col[-2]   = Year  (if it matches NNNN-NNNN pattern)
  - col[-3]   = Services/Notes  (if year detected in col[-2])
  - col[4:-3] = Service area towns  (variable count)

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import csv
import os
import re
import sys
from datetime import datetime

from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATA_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
FILE_PATH = os.path.join(DATA_DIR, "ma_haulers.csv")

DATA_SOURCE         = "ma_municipal_2025"
STATE               = "MA"
SERVICE_AREA_STATES = ["MA"]
SAFE_MAX            = 200
BATCH_SIZE          = 50

YEAR_RE = re.compile(r"^\d{4}[-/]\d{4}$")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", "-", text.strip())
    return text[:100]


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())


def clean_phone(raw: str) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"
    if len(digits) == 11 and digits[0] == "1":
        return f"({digits[1:4]}) {digits[4:7]}-{digits[7:11]}"
    return raw.strip() or None


def ensure_https(url: str) -> str | None:
    url = url.strip()
    if not url:
        return None
    if url.startswith("http://"):
        return "https://" + url[7:]
    if not url.startswith("https://"):
        return "https://" + url
    return url


def map_service_types(notes: str, name: str = "") -> list[str]:
    """Map free-text Services/Notes + name to valid service_types enum values."""
    text = (notes + " " + name).lower()
    types: list[str] = []
    if "residential" in text or "trash" in text or "rubbish" in text or "junk" in text:
        types.append("residential")
    if "commercial" in text:
        types.append("commercial")
    if "dumpster" in text or "roll-off" in text or "rolloff" in text or "roll off" in text:
        if "roll_off" not in types:
            types.append("roll_off")
    if "recycl" in text or "recycle" in text:
        types.append("recycling")
    if "compost" in text or "food waste" in text or "organics" in text:
        types.append("composting")
    if not types:
        types = ["residential", "commercial"]
    return types


def parse_zip(address: str) -> str | None:
    m = re.search(r"\b(\d{5})\b", address or "")
    return m.group(1) if m else None


def parse_city_from_address(address: str) -> str | None:
    if not address:
        return None
    m = re.search(r",\s*([^,]+),\s*MA\b", address, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None


# ---------------------------------------------------------------------------
# Parse source file
# ---------------------------------------------------------------------------

def load_ma_haulers() -> list[dict]:
    """
    Read the CSV with variable-length rows due to unquoted service area towns.
    Row 0 is the header — skip it.
    """
    if not os.path.exists(FILE_PATH):
        print(f"[ERR] File not found: {FILE_PATH}", file=sys.stderr)
        sys.exit(1)

    records: list[dict] = []
    skipped_header = False

    for enc in ("utf-8", "latin-1", "cp1252"):
        try:
            with open(FILE_PATH, encoding=enc, errors="replace", newline="") as f:
                reader = csv.reader(f)
                for row in reader:
                    if not skipped_header:
                        skipped_header = True   # skip header row
                        continue
                    if len(row) < 2:
                        continue

                    hauler_name = row[0].strip()
                    address_raw = row[1].strip() if len(row) > 1 else ""
                    phone_raw   = row[2].strip() if len(row) > 2 else ""
                    website_raw = row[3].strip() if len(row) > 3 else ""

                    if not hauler_name:
                        continue

                    # Detect structured tail columns
                    # col[-1] = Recycling_Policy_Note (discard)
                    # col[-2] = Year if it matches NNNN-NNNN
                    # col[-3] = Services/Notes if year in col[-2]
                    services_notes = ""
                    year           = ""
                    if len(row) >= 7 and YEAR_RE.match(row[-2].strip()):
                        year           = row[-2].strip()
                        services_notes = row[-3].strip()
                        town_cols      = row[4:-3]
                    else:
                        # Fallback: everything from col 4 to second-to-last is
                        # service area (including any services text mixed in)
                        town_cols = row[4:-1]

                    towns = [t.strip() for t in town_cols if t.strip()]
                    city  = parse_city_from_address(address_raw) or (towns[0] if towns else None)
                    zip_  = parse_zip(address_raw)

                    records.append({
                        "name":          hauler_name,
                        "address":       address_raw or None,
                        "city":          city,
                        "zip":           zip_,
                        "phone":         clean_phone(phone_raw),
                        "website":       ensure_https(website_raw),
                        "service_types": map_service_types(services_notes, hauler_name),
                        "license_metadata": {
                            "ma_service_towns": towns,
                            "ma_year":          year,
                        },
                    })
            break   # encoding worked
        except UnicodeDecodeError:
            skipped_header = False
            records.clear()
            continue

    print(f"Parsed {len(records)} haulers from source file")
    return records


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("MA Municipal Hauler Importer")
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("[ERR] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # -- Parse source file ----------------------------------------------------
    records = load_ma_haulers()

    if len(records) > SAFE_MAX:
        print(f"[ERR] SAFE_MAX exceeded ({len(records)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # -- Load existing slugs for dedup ----------------------------------------
    print("\nLoading existing slugs ...")
    existing_slugs: set[str] = set()
    offset = 0
    while True:
        resp  = supabase.table("organizations").select("slug").range(offset, offset + 999).execute()
        batch = resp.data or []
        for r in batch:
            existing_slugs.add(r["slug"])
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"Existing organizations in DB: {len(existing_slugs)}")

    # -- Build insert list -----------------------------------------------------
    slug_counter: dict[str, int] = {}
    to_insert: list[dict] = []
    skipped = 0

    for rec in records:
        base_slug = make_slug(rec["name"], rec.get("city") or "")
        if not base_slug:
            continue
        if base_slug in existing_slugs:
            skipped += 1
            continue
        n    = slug_counter.get(base_slug, 0)
        slug = base_slug if n == 0 else f"{base_slug}-{n}"
        while slug in existing_slugs:
            n += 1
            slug = f"{base_slug}-{n}"
        slug_counter[base_slug] = n + 1
        existing_slugs.add(slug)

        to_insert.append({
            "slug":               slug,
            "name":               rec["name"],
            "org_type":           "hauler",
            "address":            rec["address"],
            "city":               rec["city"],
            "state":              STATE,
            "zip":                rec["zip"],
            "phone":              rec["phone"],
            "website":            rec["website"],
            "service_types":      rec["service_types"],
            "service_area_states": SERVICE_AREA_STATES,
            "license_metadata":   rec["license_metadata"],
            "data_source":        DATA_SOURCE,
            "verified":           False,
            "active":             True,
        })

    print(f"\nAlready in DB (skipped): {skipped}")
    print(f"To insert: {len(to_insert)}")

    # -- Insert ----------------------------------------------------------------
    inserted = 0
    errors   = 0
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch     = to_insert[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            supabase.table("organizations").insert(batch).execute()
            inserted += len(batch)
            print(f"  [OK] Batch {batch_num}: inserted {len(batch)}")
        except Exception as exc:
            print(f"  [ERR] Batch {batch_num}: {exc}")
            errors += 1

    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Parsed:   {len(records)}")
    print(f"  Skipped:  {skipped}")
    print(f"  Inserted: {inserted}")
    print(f"  Errors:   {errors}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
