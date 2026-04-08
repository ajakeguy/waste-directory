#!/usr/bin/env python3
"""
pipelines/ri-disposal-import/index.py

Imports RI DEM active solid waste facility records from RIGIS ArcGIS.

Source: RIGIS — Active Solid Waste Facility Sites (RI DEM / OWM)
  https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/
    Active_Solid_Waste_Facility_Sites/FeatureServer/0
  61 records: composting, landfill, transfer stations, recycling centers,
  and residential drop-off sites.

Fields: Facility, Fac_Type, Match_addr, Phone, Own_Type, Oper_Type,
        Mater_Hand, Cap_Desc, Tons_Year, Regulation + geometry (lat/lng)

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

# (facility_type, accepts_flags)
RI_TYPE_MAP: dict[str, tuple[str, dict]] = {
    "L&Y Composting":                            ("composting",       {"accepts_organics": True}),
    "Putrescible Composting":                    ("composting",       {"accepts_organics": True}),
    "Landfill":                                  ("landfill",         {"accepts_msw": True}),
    "Transfer and C&D":                          ("cd_facility",      {"accepts_cd": True}),
    "Transfer, C&D and Landfill":                ("landfill",         {"accepts_msw": True, "accepts_cd": True}),
    "Transfer":                                  ("transfer_station", {"accepts_msw": True}),
    "Transfer/Residential":                      ("transfer_station", {"accepts_msw": True}),
    "Recycling Center":                          ("mrf",              {"accepts_recycling": True}),
    "Recycling Center and Residental Drop-Off":  ("mrf",              {"accepts_recycling": True}),
    "Residential Drop-Off":                      ("transfer_station", {"accepts_recycling": True}),
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
    Parse '295 GEORGE WASHINGTON HWY, SMITHFIELD, 02917' → (street, city, zip).
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


def build_notes(attrs: dict) -> str | None:
    parts = []
    for label, key in [("Owner", "Own_Type"), ("Operator", "Oper_Type"),
                        ("Materials", "Mater_Hand"), ("Capacity", "Cap_Desc")]:
        val = str_or_none(attrs.get(key))
        if val:
            parts.append(f"{label}: {val}")
    return " | ".join(parts) if parts else None


def map_facility(feature: dict) -> dict | None:
    attrs = feature["attributes"]
    geo   = feature.get("geometry", {}) or {}

    fac_type_raw = str_or_none(attrs.get("Fac_Type")) or ""
    if fac_type_raw in RI_TYPE_MAP:
        facility_type, flags = RI_TYPE_MAP[fac_type_raw]
    else:
        facility_type, flags = "transfer_station", {}

    name = str_or_none(attrs.get("Facility"))
    if not name:
        return None

    match_addr = str_or_none(attrs.get("Match_addr")) or ""
    street, city, zip_ = parse_match_addr(match_addr)

    lat = geo.get("y")
    lng = geo.get("x")

    # Capacity: convert Tons_Year → tons/day
    tons_year = attrs.get("Tons_Year")
    cap_tpd: float | None = None
    if tons_year and float(tons_year) > 0:
        cap_tpd = round(float(tons_year) / 365, 2)

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
        "permitted_capacity_tons_per_day": cap_tpd,
        "notes":         build_notes(attrs),
        "service_area_states": ["RI"],
        "data_source":   "ri_rigis_2025",
        "accepts_msw":       flags.get("accepts_msw", False),
        "accepts_recycling": flags.get("accepts_recycling", False),
        "accepts_organics":  flags.get("accepts_organics", False),
        "accepts_cd":        flags.get("accepts_cd", False),
        "verified":      True,
        "active":        True,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("RI RIGIS Active Solid Waste Facilities Importer")
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("[ERR] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # Delete existing RI records from prior imports
    print("\nDeleting existing RI records ...")
    del_resp = supabase.table("disposal_facilities").delete().in_(
        "data_source", ["ri_dem_2025", "ri_rirrc_2025", "ri_2025", "ri_rigis_2025"]
    ).execute()
    deleted = len(del_resp.data) if del_resp.data else 0
    print(f"Deleted: {deleted} RI records")

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

    print("\nFetching RI RIGIS active solid waste facilities ...")
    try:
        r = requests.get(
            ARCGIS_URL,
            params={
                "where":             "1=1",
                "outFields":         "*",
                "f":                 "json",
                "returnGeometry":    "true",
                "resultRecordCount": 1000,
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
