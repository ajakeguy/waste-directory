#!/usr/bin/env python3
"""
pipelines/ct-disposal-import/index.py

Imports CT DEEP disposal facility records into the disposal_facilities table.

Sources (public ArcGIS Feature Services, no auth required):
  1. Transfer Stations (truck-to-truck)  → transfer_station
  2. Rail Transfer Stations              → transfer_station
  3. Resource Recovery Facilities        → waste_to_energy

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

# ── Constants ─────────────────────────────────────────────────────────────────

BASE_URL    = "https://services1.arcgis.com/FjPcSmEFuDYlIdKC/arcgis/rest/services"
DATA_SOURCE = "ct_deep_arcgis_2025"
SAFE_MAX    = 500
BATCH_SIZE  = 50

ENDPOINTS = [
    {
        "path":  "TransferStations_VolumeReductionPlant_TrucktoTruckTransfer/FeatureServer/0/query",
        "type":  "transfer_station",
        "label": "Transfer Stations (truck-to-truck)",
        "name_permit_field": "PERMITTEE_APPLICANT___PERMIT_NU",
        "active_field":      "Truck_to_Truck__Active_In_use_o",
        "state_field":       "State",
        "phone_field":       "Telephone_Number",
        "contact_field":     "Contact_Person",
    },
    {
        "path":  "TransferStations_VolumeReduction_RailTransfer/FeatureServer/0/query",
        "type":  "transfer_station",
        "label": "Rail Transfer Stations",
        "name_permit_field": "PERMITTEE",
        "active_field":      "Rail_Active_Inactive",
        "state_field":       "State_1",
        "phone_field":       "Telephone_Number",
        "contact_field":     "Contact_Name",
    },
    {
        "path":  "ResourceRecovery_Facilities/FeatureServer/0/query",
        "type":  "waste_to_energy",
        "label": "Resource Recovery Facilities",
        "name_permit_field": "PERMITTEE___PERMIT_NUMBER",
        "active_field":      None,   # no status field — all active
        "state_field":       "State_1",
        "phone_field":       "Phone_Number",
        "contact_field":     "Company_Contact",
    },
]

QUERY_PARAMS = {
    "f":                  "json",
    "where":              "1=1",
    "outFields":          "*",
    "returnGeometry":     "true",
    "outSR":              "4326",
    "resultRecordCount":  "1000",
}

HEADERS = {
    "User-Agent": "WasteDirectory-DataImport/1.0 (+https://wastedirectory.com)"
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", "-", text.strip())
    return text[:100]


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())


def str_or_none(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return None if s.lower() in {"nan", "none", "null", ""} else s


def clean_phone(raw) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"[^\d]", "", str(raw))
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    if len(digits) == 11 and digits[0] == "1":
        d = digits[1:]
        return f"({d[:3]}) {d[3:6]}-{d[6:]}"
    return str_or_none(raw)


def parse_name_permit(raw: str | None) -> tuple[str, str | None]:
    """Split 'Company Name / PERMIT-NUMBER' into (name, permit_number)."""
    if not raw:
        return "", None
    if " / " in raw:
        parts = raw.rsplit(" / ", 1)
        return parts[0].strip(), parts[1].strip()
    return raw.strip(), None


def normalize_state(raw) -> str:
    """Convert 'Connecticut' or 'CT' → 'CT'."""
    if not raw:
        return "CT"
    s = str(raw).strip()
    if len(s) == 2:
        return s.upper()
    # Full name → abbreviation (only CT expected here)
    return "CT"


def is_active_status(val, field_name: str | None) -> bool:
    """Return True if the status field indicates active."""
    if field_name is None:
        return True  # no field → assume active
    if not val:
        return False
    return str(val).upper().startswith("Y")


# ── Fetch from ArcGIS ─────────────────────────────────────────────────────────

def fetch_features(endpoint: dict) -> list[dict]:
    url  = f"{BASE_URL}/{endpoint['path']}"
    label = endpoint["label"]
    print(f"\n  Fetching {label}...")
    try:
        resp = requests.get(url, params=QUERY_PARAMS, headers=HEADERS, timeout=30)
        data = resp.json()
    except Exception as exc:
        print(f"  [ERR] Request failed: {exc}")
        return []

    features = data.get("features", [])
    print(f"  Features returned: {len(features)}")
    return features


# ── Parse features into records ───────────────────────────────────────────────

def parse_features(features: list[dict], endpoint: dict) -> list[dict]:
    records = []
    np_field     = endpoint["name_permit_field"]
    active_field = endpoint["active_field"]
    state_field  = endpoint["state_field"]
    phone_field  = endpoint["phone_field"]
    fac_type     = endpoint["type"]

    for feat in features:
        attrs = feat.get("attributes", {})
        geom  = feat.get("geometry", {}) or {}

        raw_np = str_or_none(attrs.get(np_field))
        name, permit_number = parse_name_permit(raw_np)
        if not name:
            continue

        # Strip trailing parenthetical permit codes from name, e.g. "(1030914-Po)"
        name = re.sub(r"\s*\(\d+[\w-]*\)\s*$", "", name).strip()
        if not name:
            continue

        active  = is_active_status(attrs.get(active_field) if active_field else None, active_field)
        lat     = geom.get("y")
        lng     = geom.get("x")
        city    = str_or_none(attrs.get("Town"))
        phone   = clean_phone(attrs.get(phone_field))
        state   = normalize_state(attrs.get(state_field))

        # Zero-pad ZIP codes (ArcGIS returns CT ZIPs as integers, dropping leading 0)
        zip_raw = str(attrs.get("Zip_Code") or "").strip()
        if zip_raw and zip_raw.isdigit() and len(zip_raw) < 5:
            zip_raw = zip_raw.zfill(5)
        zip_val = zip_raw if zip_raw and zip_raw not in {"nan", "none", "null"} else None

        records.append({
            "name":          name.title(),
            "facility_type": fac_type,
            "address":       str_or_none(attrs.get("Street")),
            "city":          city.title() if city else None,
            "state":         state,
            "zip":           zip_val,
            "phone":         phone,
            "permit_number": permit_number,
            "permit_status": "active" if active else "inactive",
            "lat":           float(lat) if lat is not None else None,
            "lng":           float(lng) if lng is not None else None,
            "is_active":     active,
        })

    return records


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("CT DEEP Disposal Facilities Importer")
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    # ── Fetch all endpoints ───────────────────────────────────────────────────
    all_records: list[dict] = []
    for ep in ENDPOINTS:
        features = fetch_features(ep)
        records  = parse_features(features, ep)
        print(f"  Records parsed: {len(records)}")
        all_records.extend(records)

    print(f"\n  Total records: {len(all_records)}")

    if not all_records:
        print("\n[ERR] No records parsed — check ArcGIS endpoints.")
        sys.exit(1)

    if len(all_records) > SAFE_MAX:
        print(f"\n[ERR] SAFE_MAX exceeded ({len(all_records)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # ── Connect to Supabase ───────────────────────────────────────────────────
    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("\n[ERR] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # ── Load existing slugs ───────────────────────────────────────────────────
    print("\n  Loading existing slugs from disposal_facilities...")
    existing_slugs: set[str] = set()
    page_size = 1000
    offset    = 0
    while True:
        resp = (
            supabase.table("disposal_facilities")
            .select("slug")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows_page = resp.data or []
        for r in rows_page:
            existing_slugs.add(r["slug"])
        if len(rows_page) < page_size:
            break
        offset += page_size
    print(f"  Existing facilities in DB: {len(existing_slugs)}")

    # ── Build insert list ─────────────────────────────────────────────────────
    to_insert:    list[dict]     = []
    skipped:      int            = 0
    slug_counter: dict[str, int] = {}

    for rec in all_records:
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
            "slug":                slug,
            "name":                rec["name"],
            "facility_type":       rec["facility_type"],
            "address":             rec["address"],
            "city":                rec["city"],
            "state":               rec["state"],
            "zip":                 rec["zip"],
            "phone":               rec["phone"],
            "permit_number":       rec["permit_number"],
            "permit_status":       rec["permit_status"],
            "lat":                 rec["lat"],
            "lng":                 rec["lng"],
            "service_area_states": ["CT"],
            "data_source":         DATA_SOURCE,
            "verified":            True,
            "active":              rec["is_active"],
        })

    print(f"  Already in DB: {skipped}")
    print(f"  To insert:     {len(to_insert)}")

    # ── Batch insert ──────────────────────────────────────────────────────────
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
            print(f"  [ERR] Batch {batch_num} failed: {exc}")
            errors += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Total features fetched:  {len(all_records)}")
    print(f"  Already in DB:           {skipped}")
    print(f"  Inserted:                {inserted}")
    print(f"  Errors:                  {errors}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
