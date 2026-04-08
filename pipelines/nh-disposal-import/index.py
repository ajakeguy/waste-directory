#!/usr/bin/env python3
"""
pipelines/nh-disposal-import/index.py

Imports NH DES solid waste facility records from the NH DES ArcGIS REST API.

Source: NH DES Core GIS Datasets — Solid Waste Facility Locations
  https://gis.des.nh.gov/server/rest/services/Core_GIS_Datasets/DES_Data_Public/MapServer/12
  ~684 total facilities; filters to OPERATING status only (~200 records)

Fields: SWF_TYPE, SWF_STATUS, SWF_PERMIT, SWF_NAME, SWF_ADD_1, SWF_ADD_2,
        SWF_CITY, SWF_LAT, SWF_LONG, ONESTOP_LINK

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
    "https://gis.des.nh.gov/server/rest/services"
    "/Core_GIS_Datasets/DES_Data_Public/MapServer/12/query"
)
SAFE_MAX   = 500
BATCH_SIZE = 50

NH_TYPE_MAP = {
    "C/S/T":                      "transfer_station",
    "C/S/T - SELECT RECYCLABLES": "recycling_center",
    "C/S/T - MRF":                "mrf",
    "C/S/T - ASBESTOS":           "transfer_station",
    "P/T":                        "recycling_center",
    "P/T - COMPOST":              "composting",
    "P/T - INCINERATOR":          "waste_to_energy",
    "P/T - WASTE-TO-ENERGY":      "waste_to_energy",
    "LINED LANDFILL":             "landfill",
    "LINED LANDFILL - 40 CFR 258":"landfill",
    "UNLINED LANDFILL":           "landfill",
    "UNLINED LANDFILL - 40 CFR 258": "landfill",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def title_case(s: str | None) -> str | None:
    if not s or not s.strip():
        return None
    return s.strip().title()


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", "-", text.strip())
    return text[:100]


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())


def fetch_all_features(url: str, where: str = "1=1") -> list[dict]:
    """Fetch all features from ArcGIS REST API with pagination."""
    records = []
    offset  = 0
    batch   = 1000
    while True:
        r = requests.get(
            url,
            params={
                "where":            where,
                "outFields":        "*",
                "f":                "json",
                "resultRecordCount": batch,
                "resultOffset":     offset,
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


def map_facility(attrs: dict) -> dict | None:
    swf_type = (attrs.get("SWF_TYPE") or "").strip()
    facility_type = NH_TYPE_MAP.get(swf_type, "transfer_station")

    name = title_case(attrs.get("SWF_NAME") or "")
    if not name:
        return None

    city    = title_case(attrs.get("SWF_CITY") or "")
    add1    = title_case(attrs.get("SWF_ADD_1") or "")
    add2    = title_case(attrs.get("SWF_ADD_2") or "")
    address = " ".join(filter(None, [add1, add2])) or None
    permit  = (attrs.get("SWF_PERMIT") or "").strip() or None
    lat     = attrs.get("SWF_LAT")
    lng     = attrs.get("SWF_LONG")

    accepts_msw       = facility_type in ("transfer_station", "landfill", "waste_to_energy")
    accepts_recycling = facility_type in ("mrf", "recycling_center")
    accepts_organics  = facility_type == "composting"

    # NH DES OneStop direct facility URL — from ONESTOP_LINK field in ArcGIS data
    # Format: http://www4.des.state.nh.us/DESOneStop/SWFDetail.aspx?ID=XXXXXXX
    website = (attrs.get("ONESTOP_LINK") or "").strip() or None

    return {
        "name":          name,
        "facility_type": facility_type,
        "address":       address,
        "city":          city,
        "state":         "NH",
        "lat":           lat if lat and lat != 0 else None,
        "lng":           lng if lng and lng != 0 else None,
        "permit_number": permit,
        "permit_status": "active",
        "website":       website,
        "service_area_states": ["NH"],
        "data_source":   "nh_des_2025",
        "accepts_msw":   accepts_msw,
        "accepts_recycling": accepts_recycling,
        "accepts_organics": accepts_organics,
        "verified":      True,
        "active":        True,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("NH DES Disposal Facilities Importer")
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

    # Fetch OPERATING facilities
    print("\nFetching NH DES OPERATING facilities ...")
    try:
        raw = fetch_all_features(ARCGIS_URL, where="SWF_STATUS='OPERATING'")
    except Exception as exc:
        print(f"[ERR] Fetch failed: {exc}")
        sys.exit(1)
    print(f"Raw records fetched: {len(raw)}")

    # Map to records
    records = [r for f in raw if (r := map_facility(f["attributes"]))]
    print(f"Mapped records: {len(records)}")

    if len(records) > SAFE_MAX:
        print(f"[ERR] SAFE_MAX exceeded ({len(records)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # Update website URLs for existing NH records using ONESTOP_LINK
    print("\nUpdating OneStop URLs for existing NH records ...")
    permit_to_url: dict[str, str] = {}
    for f in raw:
        attrs = f["attributes"]
        permit = (attrs.get("SWF_PERMIT") or "").strip()
        link   = (attrs.get("ONESTOP_LINK") or "").strip()
        if permit and link:
            permit_to_url[permit] = link

    updated_links = 0
    nh_existing = supabase.table("disposal_facilities").select("id,permit_number,website").eq("state","NH").execute().data or []
    for rec in nh_existing:
        pn  = rec.get("permit_number") or ""
        url = permit_to_url.get(pn)
        if url and rec.get("website") != url:
            supabase.table("disposal_facilities").update({"website": url}).eq("id", rec["id"]).execute()
            updated_links += 1
    print(f"Updated OneStop URLs: {updated_links}")

    # Dedup + insert new records
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
    print(f"  URL fixes:{updated_links}")
    print(f"  Errors:   {errors}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
