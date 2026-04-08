#!/usr/bin/env python3
"""
pipelines/vt-disposal-import/index.py

Imports VT DEC waste facility records from the VT ANR ArcGIS REST API.

Source: VT ANR Open Data — Waste Facilities (Layer 164)
  https://anrmaps.vermont.gov/arcgis/rest/services/Open_Data/
    OPENDATA_ANR_FACILITIES_SP_NOCACHE_v2/MapServer/164
  ~195 VT active facilities: Transfer Stations, Recycling Centers,
  Food Scraps Management, Hazardous Waste

Fields: Name, Type, Address, Town, State, Zip, County, Telephone, Email,
        Website, Active, Latitude, Longitude + bool flags per material type

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
    "https://anrmaps.vermont.gov/arcgis/rest/services/Open_Data"
    "/OPENDATA_ANR_FACILITIES_SP_NOCACHE_v2/MapServer/164/query"
)
SAFE_MAX   = 500
BATCH_SIZE = 50

VT_TYPE_MAP = {
    "Transfer Station":               "transfer_station",
    "Recycling Center":               "recycling_center",
    "Food Scraps Management Facility":"composting",
    "Hazardous Waste":                "hazardous_waste",
}

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


def fetch_all_features(url: str, where: str = "1=1") -> list[dict]:
    records = []
    offset  = 0
    batch   = 1000
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

    vt_type       = str_or_none(attrs.get("Type")) or ""
    facility_type = VT_TYPE_MAP.get(vt_type, "recycling_center")

    name = str_or_none(attrs.get("Name"))
    if not name:
        return None

    city    = str_or_none(attrs.get("Town"))
    zip_    = str_or_none(attrs.get("Zip"))
    if zip_ and zip_.isdigit() and len(zip_) < 5:
        zip_ = zip_.zfill(5)

    lat = attrs.get("Latitude") or geo.get("y")
    lng = attrs.get("Longitude") or geo.get("x")

    accepts_msw       = facility_type in ("transfer_station", "landfill")
    accepts_recycling = facility_type == "recycling_center"
    accepts_organics  = facility_type == "composting"

    # Material flags from boolean columns
    if str(attrs.get("FoodScraps", "")).upper() in ("YES", "TRUE", "1"):
        accepts_organics = True
    if str(attrs.get("Recycling", "")).upper() in ("YES", "TRUE", "1"):
        accepts_recycling = True
    if str(attrs.get("Trash", "")).upper() in ("YES", "TRUE", "1"):
        accepts_msw = True

    return {
        "name":          name.strip(),
        "facility_type": facility_type,
        "address":       str_or_none(attrs.get("Address")),
        "city":          city,
        "state":         "VT",
        "zip":           zip_,
        "phone":         str_or_none(attrs.get("Telephone")),
        "email":         str_or_none(attrs.get("Email")),
        "website":       str_or_none(attrs.get("Website")),
        "lat":           float(lat) if lat else None,
        "lng":           float(lng) if lng else None,
        "permit_status": "active",
        "service_area_states": ["VT"],
        "data_source":   "vt_dec_2025",
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
    print("VT DEC Waste Facilities Importer")
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

    # Fetch VT active facilities
    print("\nFetching VT waste facilities (State='VT', Active=1) ...")
    try:
        raw = fetch_all_features(ARCGIS_URL, where="State='VT' AND Active=1")
    except Exception as exc:
        print(f"[ERR] Fetch failed: {exc}")
        sys.exit(1)
    print(f"Raw records fetched: {len(raw)}")

    records = [r for f in raw if (r := map_facility(f))]
    print(f"Mapped records: {len(records)}")

    if len(records) > SAFE_MAX:
        print(f"[ERR] SAFE_MAX exceeded ({len(records)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # Dedup + insert
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
