#!/usr/bin/env python3
"""
pipelines/nj-recycling-import/index.py

Imports NJ solid & hazardous waste facility data from the NJ DEP ArcGIS
FeatureServer (no scraping, no bot detection, direct structured API).

Source:
  https://services1.arcgis.com/QWdNfRs7lkPq4g4Q/arcgis/rest/services/
  Solid_and_Hazardous_Waste_Facilities/FeatureServer/28

Covers:
  Class B  — Solid Waste Recycling Facility (C&D / Composting)
  Class C  — Solid Waste Recycling Facility (Composting)
  Class D  — Solid Waste Recycling Facility (Hazardous Waste)
  MRF      — Transfer Station / Materials Recovery Facility
  + Landfills, Incinerators, Hazardous Waste TSD (imported as-is)

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os
import re
import sys
import time
from typing import Any

import requests
from supabase import create_client

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ARCGIS_URL = (
    "https://services1.arcgis.com/QWdNfRs7lkPq4g4Q/arcgis/rest/services/"
    "Solid_and_Hazardous_Waste_Facilities/FeatureServer/28/query"
)

BATCH_SIZE = 50

# ---------------------------------------------------------------------------
# Facility type mapping: ArcGIS FACILITY_TYPE -> our facility_type enum
# ---------------------------------------------------------------------------

FACILITY_TYPE_MAP: dict[str, str] = {
    "Solid Waste Recycling Facility - Class B":           "cd_facility",
    "Solid Waste Recycling Facility - Class C":           "composting",
    "Solid Waste Recycling Facility - Class D":           "hazardous_waste",
    "Solid Waste Recycling Facility - Multi-Class B & C": "composting",
    "Transfer Station / Materials Recovery Facility":     "mrf",
    "Solid Waste Landfill - Commercial":                  "landfill",
    "Solid Waste Landfill - Sole Source":                 "landfill",
    "Resource Recovery Facility/Incinerator":             "incinerator",
    "Hazardous Waste TSD Facility":                       "hazardous_waste",
    "Medical Waste - Commercial Collection Facility":     "transfer_station",
    "Medical Waste - Commercial Treatment Facility":      "transfer_station",
    "Medical Waste - Treatment and Destruction Facility": "transfer_station",
}

# ---------------------------------------------------------------------------
# Material code -> description mapping
# ---------------------------------------------------------------------------

CODE_DESCRIPTIONS: dict[str, str] = {
    "A":   "Asphalt",
    "AM":  "Asphalt Millings",
    "AS":  "Asphalt Shingles",
    "B":   "Batteries",
    "BB":  "Brick & Block",
    "BL":  "Ballast",
    "BR":  "Brush",
    "C":   "Concrete",
    "CE":  "Consumer Electronics",
    "CW":  "Creosote Wood",
    "FW":  "Food Waste",
    "G":   "Grass",
    "GY":  "Gypsum",
    "L":   "Leaves",
    "LW":  "Lake Weed",
    "MD":  "Mercury-Containing Devices",
    "O":   "OceanGro",
    "PCS": "Petroleum Contaminated Soil",
    "PWR": "Potable Water Residue",
    "S":   "Soil",
    "SS":  "Street Sweepings",
    "T":   "Tires",
    "TL":  "Tree Limbs/Tree Branches",
    "TP":  "Tree Parts",
    "TRS": "Trees",
    "TS":  "Tree Stumps",
    "TT":  "Tree Trunks",
    "UO":  "Used Oil",
    "W":   "Wood",
    "WC":  "Wood Chips",
    "WP":  "Wood Pallets",
    "AF":  "Anti Freeze",
}

CD_CODES       = {"A", "BB", "C", "AS", "GY", "T"}
ORGANICS_CODES = {"BR", "FW", "G", "L", "LW", "TP", "TRS", "TS", "TT", "TL", "W", "WC", "WP", "S"}
HAZMAT_CODES   = {"AF", "B", "BL", "CE", "MD", "UO"}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def title_case(text: str) -> str:
    if not text:
        return text
    return " ".join(
        word if word.upper() in {"LLC", "INC", "LP", "LLP", "CO", "NJ", "NY", "PA"}
        else word.capitalize()
        for word in text.strip().split()
    )


def parse_codes(raw: str | None) -> list[str]:
    if not raw:
        return []
    codes = [c.strip().upper() for c in re.split(r"[,\s]+", raw) if c.strip()]
    return sorted(set(codes))


def build_accepted_materials(codes: list[str]) -> dict[str, list[str]]:
    descriptions = [CODE_DESCRIPTIONS.get(c, c) for c in codes]
    return {"codes": codes, "descriptions": descriptions}


def merge_accepted_materials(
    existing: dict | None, new_mat: dict
) -> dict[str, list[str]]:
    if not existing:
        return new_mat
    old_codes = set(existing.get("codes", []))
    new_codes  = set(new_mat.get("codes", []))
    combined   = sorted(old_codes | new_codes)
    descriptions = [CODE_DESCRIPTIONS.get(c, c) for c in combined]
    return {"codes": combined, "descriptions": descriptions}


def get_bool_flags(codes: list[str], ftype: str) -> dict[str, bool]:
    code_set = set(codes)
    return {
        "accepts_recycling":    ftype in {"mrf", "cd_facility", "composting"},
        "accepts_cd":           bool(code_set & CD_CODES) or ftype == "cd_facility",
        "accepts_organics":     bool(code_set & ORGANICS_CODES) or ftype == "composting",
        "accepts_hazardous":    bool(code_set & HAZMAT_CODES) or ftype == "hazardous_waste",
        "accepts_msw":          ftype in {"mrf", "transfer_station", "landfill", "incinerator"},
        "accepts_special_waste": "T" in code_set or "PCS" in code_set,
    }


# ---------------------------------------------------------------------------
# ArcGIS data fetch
# ---------------------------------------------------------------------------


def fetch_all_facilities() -> list[dict[str, Any]]:
    """Fetch all NJ DEP solid/hazardous waste facilities from ArcGIS."""
    params = {
        "where":             "1=1",
        "outFields":         "*",
        "outSR":             "4326",   # WGS84 lat/lng
        "resultRecordCount": "2000",
        "f":                 "json",
    }
    print(f"Fetching NJ DEP facilities from ArcGIS...")
    resp = requests.get(ARCGIS_URL, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    if "error" in data:
        raise RuntimeError(f"ArcGIS error: {data['error']}")

    features = data.get("features", [])
    print(f"  Retrieved {len(features)} features")
    return features


def parse_feature(feature: dict[str, Any]) -> dict[str, Any] | None:
    """Convert an ArcGIS feature into a disposal_facility record dict."""
    attrs = feature.get("attributes", {})
    geom  = feature.get("geometry", {})

    arcgis_type = attrs.get("FACILITY_TYPE", "")
    ftype = FACILITY_TYPE_MAP.get(arcgis_type)
    if not ftype:
        return None  # Unknown type — skip

    name = title_case(attrs.get("FACILITY_NAME", "").strip())
    if not name:
        return None

    address      = title_case(attrs.get("ADDRESS", "").strip())
    municipality = title_case(attrs.get("MUNICIPALITY", "").strip())
    county       = (attrs.get("COUNTY") or "").strip()
    permit_num   = str(attrs.get("PREF_ID_NUM") or "").strip()
    recycling_raw = attrs.get("RECYCLING_TYPE") or ""

    codes    = parse_codes(recycling_raw)
    # Only store accepted_materials when we have actual codes; null is cleaner
    # than {"codes": [], "descriptions": []} for facilities like landfills/MRFs
    # that have no RECYCLING_TYPE in the ArcGIS data.
    accepted = build_accepted_materials(codes) if codes else None
    flags    = get_bool_flags(codes, ftype)

    # Build a note
    class_label = arcgis_type.replace("Solid Waste Recycling Facility - ", "").replace("Solid Waste ", "")
    mat_str = ", ".join(accepted.get("descriptions", [])) if accepted else ""
    notes_parts = [f"NJ DEP: {class_label}."]
    if mat_str:
        notes_parts.append(f"Materials: {mat_str}")
    if county:
        notes_parts.append(f"County: {county}")

    # Geometry (WGS84, x=lng, y=lat)
    lng = geom.get("x")
    lat = geom.get("y")
    # Validate coords are within NJ bounding box (roughly)
    if lat and lng and not (38.9 <= lat <= 41.4 and -75.6 <= lng <= -73.9):
        lat, lng = None, None

    return {
        "name":              name,
        "address":           address or None,
        "city":              municipality or None,
        "state":             "NJ",
        "permit_number":     permit_num or None,
        "facility_type":     ftype,
        "lat":               lat,
        "lng":               lng,
        "accepted_materials": accepted,   # None for facilities with no material codes
        "notes":             " ".join(notes_parts),
        **flags,
    }


# ---------------------------------------------------------------------------
# Upsert logic
# ---------------------------------------------------------------------------


def upsert_facilities(
    supabase: Any,
    records: list[dict[str, Any]],
) -> tuple[int, int]:
    inserted = 0
    updated  = 0

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]

        for rec in batch:
            name = rec["name"]
            slug = slugify(f"{name}-nj")

            existing_res = (
                supabase.table("disposal_facilities")
                .select("id, accepted_materials")
                .eq("slug", slug)
                .maybe_single()
                .execute()
            )
            existing = existing_res.data if existing_res else None

            record: dict[str, Any] = {
                **rec,
                "slug":              slug,
                "data_source":       "nj_dep_arcgis_2025",
                "service_area_states": ["NJ"],
                "verified":          True,
                "active":            True,
            }

            new_mat = rec.get("accepted_materials") or {"codes": [], "descriptions": []}

            if existing:
                merged = merge_accepted_materials(
                    existing.get("accepted_materials"), new_mat
                )
                record["accepted_materials"] = merged
                supabase.table("disposal_facilities").update(record).eq(
                    "id", existing["id"]
                ).execute()
                updated += 1
                print(f"  UPDATED:   {name}")
            else:
                record["accepted_materials"] = new_mat
                supabase.table("disposal_facilities").insert(record).execute()
                inserted += 1
                print(f"  INSERTED:  {name}")

        time.sleep(0.05)

    return inserted, updated


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        sys.exit(1)

    supabase = create_client(supabase_url, supabase_key)

    # Fetch all features
    features = fetch_all_facilities()

    # Parse + filter
    records: list[dict[str, Any]] = []
    skipped = 0
    for feat in features:
        rec = parse_feature(feat)
        if rec:
            records.append(rec)
        else:
            skipped += 1

    # Summarize by type
    from collections import Counter
    type_counts = Counter(r["facility_type"] for r in records)
    print(f"\nParsed {len(records)} records ({skipped} skipped):")
    for ftype, count in sorted(type_counts.items()):
        print(f"  {ftype}: {count}")

    # Upsert
    print(f"\nUpserting {len(records)} facilities...")
    inserted, updated = upsert_facilities(supabase, records)

    print(f"\n{'=' * 55}")
    print(f"NJ Recycling Import Complete (ArcGIS source)")
    print(f"  Total fetched:  {len(features)}")
    print(f"  Parsed:         {len(records)}")
    print(f"  Skipped:        {skipped}")
    print(f"  Inserted:       {inserted}")
    print(f"  Updated:        {updated}")
    georef = sum(1 for r in records if r.get("lat") and r.get("lng"))
    print(f"  With coords:    {georef}")


if __name__ == "__main__":
    main()
