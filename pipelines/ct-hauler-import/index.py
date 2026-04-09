#!/usr/bin/env python3
"""
pipelines/ct-hauler-import/index.py

Imports Connecticut municipal hauler records from a locally-maintained Excel
file compiled from HRRA and town-level approved hauler lists.

Source file: pipelines/ct-hauler-import/data/ct_haulers.xlsx
  Structure: single column where the column header IS the field name string
             (CSV format), and each subsequent row is one CSV data line.
  Fields:    Hauler_Name, Address, Phone, Website, Service_Area,
             Services/Notes, Year, Data_Source

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import csv
import io
import os
import re
import sys
from datetime import datetime

import openpyxl
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATA_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
FILE_PATH = os.path.join(DATA_DIR, "ct_haulers.xlsx")

DATA_SOURCE         = "ct_municipal_2025"
STATE               = "CT"
SERVICE_AREA_STATES = ["CT"]
SAFE_MAX            = 100
BATCH_SIZE          = 50

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
    """Map free-text Services/Notes to valid service_types enum values."""
    text = (notes + " " + name).lower()
    types: list[str] = []
    if "residential" in text or "junk" in text or "bulky" in text:
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
    """Extract 5-digit zip from an address string."""
    m = re.search(r"\b(\d{5})\b", address or "")
    return m.group(1) if m else None


def parse_city_from_address(address: str) -> str | None:
    """Best-effort: extract city from 'Street, City, ST XXXXX' pattern."""
    if not address:
        return None
    # Match: <stuff>, City, ST XXXXX
    m = re.search(r",\s*([^,]+),\s*[A-Z]{2}\s+\d{5}", address)
    if m:
        return m.group(1).strip()
    return None

# ---------------------------------------------------------------------------
# Parse source file
# ---------------------------------------------------------------------------

def load_ct_haulers() -> list[dict]:
    """
    Read the Excel file. Each row in column A is a raw CSV line.
    Row 1 (index 0 in openpyxl with min_row=1) contains the field-name string
    as the column header — skip it. Rows 2+ are data.
    """
    if not os.path.exists(FILE_PATH):
        print(f"[ERR] File not found: {FILE_PATH}", file=sys.stderr)
        sys.exit(1)

    wb = openpyxl.load_workbook(FILE_PATH, read_only=True, data_only=True)
    ws = wb.active

    records: list[dict] = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        raw = row[0]
        if not raw:
            continue
        try:
            fields = next(csv.reader(io.StringIO(str(raw))))
        except StopIteration:
            continue

        # Pad to at least 8 fields
        while len(fields) < 8:
            fields.append("")

        hauler_name   = fields[0].strip()
        address_raw   = fields[1].strip()
        phone_raw     = fields[2].strip()
        website_raw   = fields[3].strip()
        service_area  = fields[4].strip()
        services_notes = fields[5].strip()
        year          = fields[6].strip()
        # fields[7] = Data_Source (already known)

        if not hauler_name:
            continue

        towns = [t.strip() for t in service_area.split(",") if t.strip()]
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
                "ct_service_towns":   towns,
                "ct_services_notes":  services_notes,
                "ct_year":            year,
            },
        })

    wb.close()
    print(f"Parsed {len(records)} haulers from source file")
    return records


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("CT Municipal Hauler Importer")
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("[ERR] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # -- Parse source file ----------------------------------------------------
    records = load_ct_haulers()

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
