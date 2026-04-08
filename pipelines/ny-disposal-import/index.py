#!/usr/bin/env python3
"""
pipelines/ny-disposal-import/index.py

Imports NY DEC Part 360 solid waste facility records from NY Open Data.

Source: NY Open Data — Solid Waste Management Facilities
  https://data.ny.gov/Energy-Environment/Solid-Waste-Management-Facilities/2fni-raj8
  2,774 active records covering transfer stations, landfills, composting,
  C&D facilities, MRFs, WTE, and hazardous waste facilities.

Fields: facility_name, location_address, city, state, zip_code, county,
        phone_number, owner_name, activity_desc, authorization_number,
        georeference (lat/lng)

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os
import re
import sys
from datetime import datetime

import requests
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HEADERS    = {"User-Agent": "Mozilla/5.0 (compatible; WasteDirectory/1.0)"}
SODA_URL   = "https://data.ny.gov/resource/2fni-raj8.json"
SAFE_MAX   = 2500
BATCH_SIZE = 50

# Keyword-based type map — checked in order, first match wins.
# None means skip this facility type entirely.
NY_TYPE_KEYWORDS: list[tuple[str, str | None]] = [
    # Transfer
    ("transfer facility",            "transfer_station"),
    ("transfer station",             "transfer_station"),
    # Landfills — specific before generic
    ("landfill - c&d",               "cd_facility"),
    ("landfill - land clearing",     "cd_facility"),
    ("landfill - msw",               "landfill"),
    ("landfill - industrial",        "landfill"),
    ("landfill - li",                "landfill"),
    ("landfill - long island",       "landfill"),
    ("landfill reclamation",         "landfill"),
    ("landfill",                     "landfill"),
    # C&D
    ("cddhrf",                       "cd_facility"),
    ("c&d processing",               "cd_facility"),
    # Recycling / MRF
    ("rhrf",                         "recycling_center"),
    ("scrap metal",                  "recycling_center"),
    ("msw processing",               "mrf"),
    # Organics
    ("composting",                   "composting"),
    ("mulch processing",             "composting"),
    ("anaerobic digestion",          "anaerobic_digestion"),
    # WTE
    ("combustion",                   "waste_to_energy"),
    ("waste combustion",             "waste_to_energy"),
    # Hazardous / Special
    ("rmw",                          "hazardous_waste"),
    ("regulated medical waste",      "hazardous_waste"),
    ("hhw",                          "hazardous_waste"),
    ("household hazardous",          "hazardous_waste"),
    ("used oil",                     "hazardous_waste"),
    ("used cooking oil",             "hazardous_waste"),
    ("wthrf",                        "recycling_center"),
    ("waste tire",                   "recycling_center"),
    ("biosolids",                    "composting"),
    # Skip — not disposal facilities
    ("vehicle dismantling",          None),
    ("vdf",                          None),
    ("land application",             None),
    ("motor vehicle repair",         None),
    ("mobile vehicle crusher",       None),
    ("animal feed production",       None),
    ("storage - ",                   None),
]


def map_ny_type(activity_desc: str) -> str | None:
    desc = (activity_desc or "").lower()
    for keyword, ftype in NY_TYPE_KEYWORDS:
        if keyword in desc:
            return ftype
    return None  # skip unrecognised types


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def str_or_none(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return None if not s or s.lower() in ("null", "none", "n/a") else s


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", "-", text.strip())
    return text[:100]


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())


def fetch_all_records(url: str) -> list[dict]:
    """Fetch all records from NY Open Data SODA API with pagination."""
    records = []
    offset  = 0
    limit   = 1000
    while True:
        r = requests.get(
            url,
            params={
                "$where":  "active='Yes'",
                "$limit":  limit,
                "$offset": offset,
                "$order":  ":id",
            },
            headers=HEADERS,
            timeout=30,
        )
        r.raise_for_status()
        batch = r.json()
        if not isinstance(batch, list):
            raise RuntimeError(f"Unexpected response: {batch}")
        records.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return records


def extract_lat_lng(geo: dict | None) -> tuple[float | None, float | None]:
    if not geo or not isinstance(geo, dict):
        return None, None
    try:
        lat = float(geo.get("latitude") or 0) or None
        lng = float(geo.get("longitude") or 0) or None
        return lat, lng
    except (TypeError, ValueError):
        return None, None


def map_facility(row: dict) -> dict | None:
    activity_desc = str_or_none(row.get("activity_desc")) or ""
    facility_type = map_ny_type(activity_desc)
    if facility_type is None:
        return None

    name = str_or_none(row.get("facility_name"))
    if not name:
        return None

    lat, lng = extract_lat_lng(row.get("georeference"))

    zip_ = str_or_none(row.get("zip_code"))
    if zip_ and zip_.isdigit() and len(zip_) < 5:
        zip_ = zip_.zfill(5)

    accepts_msw       = facility_type in ("transfer_station", "landfill", "waste_to_energy")
    accepts_recycling = facility_type in ("recycling_center", "mrf")
    accepts_cd        = facility_type == "cd_facility"
    accepts_organics  = facility_type in ("composting", "anaerobic_digestion")
    accepts_hazardous = facility_type == "hazardous_waste"

    return {
        "name":           name.strip().title(),
        "facility_type":  facility_type,
        "address":        str_or_none(row.get("location_address")),
        "city":           str_or_none(row.get("city")),
        "state":          "NY",
        "zip":            zip_,
        "phone":          str_or_none(row.get("phone_number")),
        "operator_name":  str_or_none(row.get("owner_name")),
        "lat":            lat,
        "lng":            lng,
        "permit_number":  str_or_none(row.get("authorization_number")),
        "permit_status":  "active",
        "service_area_states": ["NY"],
        "data_source":    "ny_dec_2025",
        "accepts_msw":    accepts_msw,
        "accepts_recycling": accepts_recycling,
        "accepts_cd":     accepts_cd,
        "accepts_organics": accepts_organics,
        "accepts_hazardous": accepts_hazardous,
        "verified":       True,
        "active":         True,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("NY DEC Solid Waste Facilities Importer")
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("[ERR] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    print("\nLoading existing slugs ...")
    existing_slugs: set[str] = set()
    offset = 0
    while True:
        resp  = supabase.table("disposal_facilities").select("slug").range(offset, offset + 999).execute()
        batch = resp.data or []
        for r in batch:
            existing_slugs.add(r["slug"])
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"Existing facilities in DB: {len(existing_slugs)}")

    print("\nFetching NY DEC solid waste facilities ...")
    try:
        raw = fetch_all_records(SODA_URL)
    except Exception as exc:
        print(f"[ERR] Fetch failed: {exc}")
        sys.exit(1)
    print(f"Raw records fetched: {len(raw)}")

    records = [rec for row in raw if (rec := map_facility(row))]
    print(f"Mapped records (after type filtering): {len(records)}")

    if len(records) > SAFE_MAX:
        print(f"[ERR] SAFE_MAX exceeded ({len(records)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    slug_counter: dict[str, int] = {}
    to_insert = []
    skipped   = 0

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
            n += 1; slug = f"{base_slug}-{n}"
        slug_counter[base_slug] = n + 1
        existing_slugs.add(slug)
        row = dict(rec); row["slug"] = slug
        to_insert.append(row)

    print(f"\nAlready in DB (skipped): {skipped}")
    print(f"To insert: {len(to_insert)}")

    inserted = 0
    errors   = 0
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch     = to_insert[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            supabase.table("disposal_facilities").insert(batch).execute()
            inserted += len(batch)
            print(f"  [OK] Batch {batch_num}: inserted {len(batch)}")
        except Exception as exc:
            print(f"  [ERR] Batch {batch_num}: {exc}")
            errors += 1

    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Fetched:  {len(raw)}")
    print(f"  Mapped:   {len(records)}")
    print(f"  Skipped:  {skipped}")
    print(f"  Inserted: {inserted}")
    print(f"  Errors:   {errors}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
