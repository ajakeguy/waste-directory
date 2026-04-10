#!/usr/bin/env python3
"""
pipelines/pa-tsdf-import/index.py

Imports PA DEP Commercial Treatment, Storage & Disposal Facilities (TSDFs)
for hazardous waste.

Source:
  PA DEP — Commercial TSDFs
  https://www.pa.gov/agencies/dep/programs-and-services/waste-programs/
    solid-waste-programs/hazardous-waste-program/commercial-tsdfs

  Table columns:
    Facility Name (linked) | EPA ID Number | Address & Phone Number |
    County | Host Municipality | Facility Information

  ~23 active facilities. INMETCO (last row) is inactive — skipped.

Inserts into disposal_facilities with:
  facility_type = 'hazardous_waste'
  verified      = True
  data_source   = 'pa_dep_tsdf_2024'
  license_metadata = {
      "pa_epa_id": ..., "pa_county": ...,
      "pa_municipality": ..., "pa_facility_info": ...
  }

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os
import re
import sys
import json
from datetime import datetime

import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HEADERS  = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
PAGE_URL = (
    "https://www.pa.gov/agencies/dep/programs-and-services/waste-programs"
    "/solid-waste-programs/hazardous-waste-program/commercial-tsdfs"
)

DATA_SOURCE = "pa_dep_tsdf_2024"
BATCH_SIZE  = 50
SAFE_MAX    = 50   # guard against runaway parsing

# Facility to skip (inactive)
SKIP_NAMES  = {"inmetco"}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text


def make_slug(name: str, state: str, supabase: Client) -> str:
    base = slugify(f"{name}-{state}")
    candidate = base
    n = 1
    while True:
        existing = supabase.table("disposal_facilities") \
            .select("id") \
            .eq("slug", candidate) \
            .limit(1) \
            .execute()
        if not existing.data:
            return candidate
        candidate = f"{base}-{n}"
        n += 1


def parse_address_phone(cell_text: str) -> tuple[str | None, str | None, str | None, str | None, str | None]:
    """
    Parse combined Address & Phone cell.
    Format: "2869 Sandstone Dr., Hatfield, PA 19440 / 215-822-8996"
    Returns: (address, city, zip, state_code, phone)
    """
    text = re.sub(r"\s+", " ", cell_text.strip())

    # Split on ' / ' to separate address from phone
    phone = None
    if " / " in text:
        parts = text.split(" / ", 1)
        text  = parts[0].strip()
        phone_raw = parts[1].strip()
        # Normalize phone: keep digits+formatting
        phone_digits = re.sub(r"\D", "", phone_raw)
        if len(phone_digits) == 10:
            phone = f"({phone_digits[:3]}) {phone_digits[3:6]}-{phone_digits[6:]}"
        elif phone_raw:
            phone = phone_raw
    else:
        # Phone might appear at end with just a pattern
        phone_match = re.search(r"(\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})\s*$", text)
        if phone_match:
            phone = phone_match.group(1).strip()
            text  = text[:phone_match.start()].strip().rstrip(",")

    # Extract zip
    zip_match = re.search(r"\b(\d{5})(?:-\d{4})?\s*$", text)
    zip_code  = zip_match.group(1) if zip_match else None

    # Extract state code (PA is expected, but be generic)
    state_match = re.search(r",\s*([A-Z]{2})\b", text)
    state_code  = state_match.group(1) if state_match else "PA"

    # Extract city (text before ", PA")
    city = None
    city_match = re.search(r",\s*([^,]+),\s*[A-Z]{2}\b", text)
    if city_match:
        city = city_match.group(1).strip()

    # Street address = everything before the city
    address = None
    if city and city in text:
        idx = text.index(city)
        address = text[:idx].rstrip(", ").strip() or None

    return address, city, zip_code, state_code, phone


# ---------------------------------------------------------------------------
# Scraper
# ---------------------------------------------------------------------------

def scrape_tsdfs(supabase: Client) -> None:
    print(f"Fetching {PAGE_URL} ...")
    resp = requests.get(PAGE_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Find the first <table> on the page
    table = soup.find("table")
    if not table:
        print("ERROR: No table found on page.")
        sys.exit(1)

    rows = table.find_all("tr")
    # Skip header row(s)
    data_rows = [r for r in rows if r.find("td")]
    print(f"Found {len(data_rows)} data rows in table.")

    records = []
    skipped = 0

    for row in data_rows[:SAFE_MAX]:
        cells = [c.get_text(separator=" ", strip=True) for c in row.find_all(["td", "th"])]
        if len(cells) < 5:
            continue

        # Columns: Facility Name | EPA ID | Address & Phone | County | Municipality | [Facility Info]
        facility_name  = cells[0].strip()
        epa_id         = cells[1].strip() if len(cells) > 1 else ""
        addr_phone     = cells[2].strip() if len(cells) > 2 else ""
        county         = cells[3].strip() if len(cells) > 3 else ""
        municipality   = cells[4].strip() if len(cells) > 4 else ""
        facility_info  = cells[5].strip() if len(cells) > 5 else ""

        # Skip empty rows
        if not facility_name:
            continue

        # Skip inactive facilities
        if facility_name.strip().lower() in SKIP_NAMES:
            print(f"  SKIP (inactive): {facility_name}")
            skipped += 1
            continue

        # Parse address/phone
        address, city, zip_code, state_code, phone = parse_address_phone(addr_phone)

        # Build license_metadata
        license_metadata: dict = {}
        if epa_id:
            license_metadata["pa_epa_id"] = epa_id
        if county:
            license_metadata["pa_county"] = county
        if municipality:
            license_metadata["pa_municipality"] = municipality
        if facility_info:
            license_metadata["pa_facility_info"] = facility_info

        slug = make_slug(facility_name, state_code or "PA", supabase)

        record = {
            "name":          facility_name,
            "slug":          slug,
            "facility_type": "hazardous_waste",
            "address":       address,
            "city":          city,
            "state":         state_code or "PA",
            "zip":           zip_code,
            "phone":         phone,
            "verified":      True,
            "active":        True,
            "data_source":   DATA_SOURCE,
            "accepts_msw":          False,
            "accepts_recycling":    False,
            "accepts_cd":           False,
            "accepts_organics":     False,
            "accepts_hazardous":    True,
            "accepts_special_waste":False,
            "service_area_states":  [state_code or "PA"],
            "license_metadata":     license_metadata if license_metadata else None,
            "created_at":    datetime.utcnow().isoformat(),
            "updated_at":    datetime.utcnow().isoformat(),
        }
        records.append(record)
        print(f"  + {facility_name} | EPA: {epa_id} | {city}, {state_code}")

    print(f"\nParsed {len(records)} records ({skipped} skipped).")

    if not records:
        print("Nothing to insert.")
        return

    # Upsert in batches (slug is unique; update on conflict)
    inserted = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        supabase.table("disposal_facilities") \
            .upsert(batch, on_conflict="slug") \
            .execute()
        inserted += len(batch)
        print(f"  Upserted batch {i // BATCH_SIZE + 1}: {len(batch)} records")

    print(f"\nDone. Total upserted: {inserted}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
        sys.exit(1)

    supabase = create_client(supabase_url, supabase_key)
    scrape_tsdfs(supabase)


if __name__ == "__main__":
    main()
