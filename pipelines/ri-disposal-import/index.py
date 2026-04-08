#!/usr/bin/env python3
"""
pipelines/ri-disposal-import/index.py

Imports RI DEM active solid waste facility records from ArcGIS.

Source: RI DEM Office of Water Resources — Active Solid Waste Facility Sites
  https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/
    Active_Solid_Waste_Facility_Sites/FeatureServer/0
  61 records covering composting, transfer stations, recycling centers,
  residential drop-offs, and the RIRRC Central Landfill.

Fields: Facility, Fac_Type, Match_addr, Phone, Map_Catego, Mater_Hand,
        Tons_Year + geometry (lat/lng)

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
ARCGIS_URL = (
    "https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services"
    "/Active_Solid_Waste_Facility_Sites/FeatureServer/0/query"
)
SAFE_MAX   = 500
BATCH_SIZE = 50

RI_TYPE_MAP = {
    "L&Y Composting":                          "composting",
    "Putrescible Composting":                  "composting",
    "Residential Drop-Off":                    "recycling_center",
    "Transfer":                                "transfer_station",
    "Transfer and C&D":                        "transfer_station",
    "Transfer/Residential":                    "transfer_station",
    "Transfer, C&D and Landfill":              "transfer_station",
    "Landfill":                                "landfill",
    "Recycling Center":                        "recycling_center",
    "Recycling Center and Residental Drop-Off":"recycling_center",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def str_or_none(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return None if not s or s.lower() in ("null", "none") else s


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", "-", text.strip())
    return text[:100]


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())


def parse_match_addr(addr: str) -> tuple[str | None, str | None, str | None]:
    """
    Parse a geocoded address like:
      '295 GEORGE WASHINGTON HWY, SMITHFIELD, 02917'
    Returns (street, city, zip).
    """
    if not addr:
        return None, None, None
    parts = [p.strip() for p in addr.split(",")]
    if len(parts) >= 3:
        street = parts[0].title()
        city   = parts[1].title()
        zip_   = parts[2].strip()
        if not zip_.isdigit():
            zip_ = None
        elif len(zip_) < 5:
            zip_ = zip_.zfill(5)
        return street, city, zip_
    elif len(parts) == 2:
        return parts[0].title(), parts[1].title(), None
    return addr.title(), None, None


def map_facility(feature: dict) -> dict | None:
    attrs = feature["attributes"]
    geo   = feature.get("geometry", {}) or {}

    fac_type      = str_or_none(attrs.get("Fac_Type")) or ""
    facility_type = RI_TYPE_MAP.get(fac_type, "recycling_center")

    name = str_or_none(attrs.get("Facility"))
    if not name:
        return None

    match_addr       = str_or_none(attrs.get("Match_addr")) or ""
    street, city, zip_ = parse_match_addr(match_addr)

    lat = geo.get("y")
    lng = geo.get("x")

    accepts_msw       = facility_type in ("transfer_station", "landfill")
    accepts_recycling = facility_type == "recycling_center"
    accepts_organics  = facility_type == "composting"
    accepts_cd        = "C&D" in fac_type

    return {
        "name":          name.strip().title(),
        "facility_type": facility_type,
        "address":       street,
        "city":          city,
        "state":         "RI",
        "zip":           zip_,
        "phone":         str_or_none(attrs.get("Phone")),
        "lat":           float(lat) if lat else None,
        "lng":           float(lng) if lng else None,
        "permit_status": "active",
        "service_area_states": ["RI"],
        "data_source":   "ri_dem_2025",
        "accepts_msw":   accepts_msw,
        "accepts_recycling": accepts_recycling,
        "accepts_organics": accepts_organics,
        "accepts_cd":    accepts_cd,
        "verified":      True,
        "active":        True,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("RI DEM Active Solid Waste Facilities Importer")
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

    print("\nFetching RI active solid waste facilities ...")
    try:
        r = requests.get(
            ARCGIS_URL,
            params={
                "where":             "1=1",
                "outFields":         "*",
                "f":                 "json",
                "resultRecordCount": 500,
                "outSR":             "4326",
            },
            headers=HEADERS,
            timeout=30,
        )
        r.raise_for_status()
        d = r.json()
        if "error" in d:
            raise RuntimeError(f"ArcGIS error: {d['error']}")
        raw = d.get("features", [])
    except Exception as exc:
        print(f"[ERR] Fetch failed: {exc}")
        sys.exit(1)
    print(f"Raw records fetched: {len(raw)}")

    records = [rec for f in raw if (rec := map_facility(f))]
    print(f"Mapped records: {len(records)}")

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
