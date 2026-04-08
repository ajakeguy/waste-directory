#!/usr/bin/env python3
"""
pipelines/nj-disposal-import/index.py

Imports NJ DEP solid waste facility records from the NJ DEP ArcGIS REST API.

Source: NJ DEP Maps — Solid & Hazardous Waste Utilities (Layer 28)
  https://mapsdep.nj.gov/arcgis/rest/services/Features/Utilities/MapServer/28
  243 total records; includes solid waste, hazardous waste, and medical waste.

Fields: FACILITY_TYPE, FACILITY_NAME, ADDRESS, MUNICIPALITY, COUNTY,
        FACILITY_ID + geometry (lat/lng via outSR=4326)

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
    "https://mapsdep.nj.gov/arcgis/rest/services"
    "/Features/Utilities/MapServer/28/query"
)
SAFE_MAX   = 500
BATCH_SIZE = 50

NJ_TYPE_MAP = {
    "Solid Waste Recycling Facility - Class B":       "recycling_center",
    "Solid Waste Recycling Facility - Class C":       "recycling_center",
    "Solid Waste Recycling Facility - Class D":       "cd_facility",
    "Solid Waste Recycling Facility - Multi-Class B & C": "recycling_center",
    "Transfer Station / Materials Recovery Facility": "transfer_station",
    "Resource Recovery Facility/Incinerator":         "waste_to_energy",
    "Solid Waste Landfill - Commercial":              "landfill",
    "Solid Waste Landfill - Sole Source":             "landfill",
    "Hazardous Waste TSD Facility":                   "hazardous_waste",
    "Hazardous Waste Facility":                       "hazardous_waste",
    "Medical Waste - Commercial Regulated Facility":  "hazardous_waste",
    "Medical Waste - Treatment and Destruction Facility": "hazardous_waste",
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


def fetch_all_features(url: str, where: str = "1=1") -> list[dict]:
    """Fetch all features with pagination, requesting lat/lng output."""
    records = []
    offset  = 0
    batch   = 500
    while True:
        r = requests.get(
            url,
            params={
                "where":             where,
                "outFields":         "*",
                "f":                 "json",
                "resultRecordCount": batch,
                "resultOffset":      offset,
                "outSR":             "4326",
            },
            headers=HEADERS,
            timeout=30,
        )
        r.raise_for_status()
        d = r.json()
        if "error" in d:
            raise RuntimeError(f"ArcGIS error: {d['error']}")
        features = d.get("features", [])
        records.extend(features)
        if len(features) < batch:
            break
        offset += batch
    return records


def map_facility(feature: dict) -> dict | None:
    attrs = feature["attributes"]
    geo   = feature.get("geometry", {}) or {}

    fac_type      = str_or_none(attrs.get("FACILITY_TYPE")) or ""
    facility_type = NJ_TYPE_MAP.get(fac_type, "recycling_center")

    name = str_or_none(attrs.get("FACILITY_NAME"))
    if not name:
        return None

    # Municipality has trailing non-breaking spaces — strip aggressively
    city   = (attrs.get("MUNICIPALITY") or "").replace("\u00a0", " ").strip().title() or None

    lat = geo.get("y")
    lng = geo.get("x")

    accepts_msw       = facility_type in ("transfer_station", "landfill", "waste_to_energy")
    accepts_recycling = facility_type in ("recycling_center", "mrf")
    accepts_cd        = facility_type == "cd_facility"

    return {
        "name":          name.strip().title(),
        "facility_type": facility_type,
        "address":       str_or_none(attrs.get("ADDRESS")),
        "city":          city,
        "state":         "NJ",
        "lat":           float(lat) if lat else None,
        "lng":           float(lng) if lng else None,
        "permit_number": str_or_none(attrs.get("FACILITY_ID")),
        "permit_status": "active",
        "service_area_states": ["NJ"],
        "data_source":   "nj_dep_2025",
        "accepts_msw":   accepts_msw,
        "accepts_recycling": accepts_recycling,
        "accepts_cd":    accepts_cd,
        "verified":      True,
        "active":        True,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("NJ DEP Solid Waste Facilities Importer")
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

    print("\nFetching NJ DEP solid waste facilities ...")
    try:
        raw = fetch_all_features(ARCGIS_URL)
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
