#!/usr/bin/env python3
"""
scripts/geocode_facilities.py

Geocodes disposal_facilities records that are missing lat/lng coordinates.

Primary:  US Census Bureau Geocoder (free, no API key, no rate limit)
Fallback: Mapbox Geocoding API (requires MAPBOX_ACCESS_TOKEN env var, 0.1s delay)

Validates that returned coordinates fall within a broad US bounding box
(lat 36–48, lng –83 to –66) to catch bad geocoding results.

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

Optional env vars:
    MAPBOX_ACCESS_TOKEN  - enables Mapbox fallback when Census fails

Usage:
    python scripts/geocode_facilities.py
    python scripts/geocode_facilities.py --limit 100
    python scripts/geocode_facilities.py --state MA --limit 50
"""

import argparse
import os
import sys
import time
import urllib.parse

import requests
from supabase import create_client

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAPBOX_DELAY = 0.1  # seconds between Mapbox requests (rate-limit courtesy)

# Bounding box: US Northeast + mid-Atlantic + a bit of slack
LAT_MIN, LAT_MAX = 36.0, 48.0
LNG_MIN, LNG_MAX = -83.0, -66.0

CENSUS_STRUCTURED_URL = (
    "https://geocoding.geo.census.gov/geocoder/locations/address"
)
MAPBOX_GEOCODE_URL = (
    "https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json"
)

# ---------------------------------------------------------------------------
# Geocoding helpers
# ---------------------------------------------------------------------------


def geocode_census(street: str, city: str, state: str) -> tuple[float, float] | None:
    """
    Try the Census Bureau structured-address endpoint.
    Returns (lat, lng) if successful and within bounding box, else None.
    No rate limiting needed.
    """
    try:
        resp = requests.get(
            CENSUS_STRUCTURED_URL,
            params={
                "street":    street,
                "city":      city,
                "state":     state,
                "benchmark": "Public_AR_Current",
                "format":    "json",
            },
            timeout=10,
        )
        resp.raise_for_status()
        matches = resp.json().get("result", {}).get("addressMatches", [])
        if not matches:
            return None
        coords = matches[0].get("coordinates", {})
        lng = float(coords.get("x", 0))
        lat = float(coords.get("y", 0))
        if LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX:
            return lat, lng
        return None
    except Exception as exc:
        print(f"    census error: {exc}")
    return None


def geocode_mapbox(full_address: str, token: str) -> tuple[float, float] | None:
    """
    Try the Mapbox Geocoding API as a fallback.
    Returns (lat, lng) if successful and within bounding box, else None.
    Caller is responsible for the 0.1 s delay.
    """
    try:
        encoded = urllib.parse.quote(full_address)
        url = MAPBOX_GEOCODE_URL.format(query=encoded)
        resp = requests.get(
            url,
            params={
                "access_token": token,
                "country":      "US",
                "limit":        1,
            },
            timeout=10,
        )
        resp.raise_for_status()
        features = resp.json().get("features", [])
        if not features:
            return None
        coords = features[0].get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            return None
        lng, lat = float(coords[0]), float(coords[1])
        if LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX:
            return lat, lng
        return None
    except Exception as exc:
        print(f"    mapbox error: {exc}")
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Geocode disposal facilities missing lat/lng"
    )
    parser.add_argument(
        "--limit", type=int, default=500, help="Max facilities to process (default 500)"
    )
    parser.add_argument(
        "--state", type=str, default=None, help="Filter by state code, e.g. MA"
    )
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    mapbox_token = os.environ.get("MAPBOX_ACCESS_TOKEN")

    if not supabase_url or not supabase_key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        sys.exit(1)

    if not mapbox_token:
        print("INFO: MAPBOX_ACCESS_TOKEN not set - Census-only mode (no fallback)")

    supabase = create_client(supabase_url, supabase_key)

    # ── Fetch facilities missing lat/lng ──────────────────────────────────────
    print("Querying facilities missing coordinates...")

    q = (
        supabase.table("disposal_facilities")
        .select("id, name, address, city, state, zip")
        .is_("lat", "null")
        .not_.is_("address", "null")
        .not_.is_("city", "null")
    )
    if args.state:
        q = q.eq("state", args.state.upper())

    res = q.limit(args.limit).execute()
    facilities = res.data or []

    print(
        f"Found {len(facilities)} facilities missing coordinates "
        f"(limit={args.limit})"
    )

    if not facilities:
        print("Nothing to do.")
        return

    # ── Geocode each facility ─────────────────────────────────────────────────
    census_count = 0
    mapbox_count = 0
    failed_count = 0
    total = len(facilities)

    for i, f in enumerate(facilities):
        name     = f.get("name", "")
        street   = f.get("address") or ""
        city     = f.get("city") or ""
        state    = f.get("state") or ""
        zip_code = f.get("zip") or ""

        # Build the full address string for Mapbox fallback
        parts = [p for p in [street, city, state, zip_code] if p]
        full_addr = ", ".join(parts)

        if not street or not city:
            print(f"[{i+1}/{total}] SKIP (missing address/city): {name}")
            failed_count += 1
            continue

        label = f"[{i+1}/{total}] {name} - {full_addr}"

        # 1. Try Census (structured, no rate limit)
        result = geocode_census(street, city, state)
        if result:
            lat, lng = result
            print(f"{label} -> ({lat:.6f}, {lng:.6f}) [Census]")
            supabase.table("disposal_facilities").update(
                {"lat": lat, "lng": lng}
            ).eq("id", f["id"]).execute()
            census_count += 1
            continue

        # 2. Fallback: Mapbox (with rate-limit delay)
        if mapbox_token:
            time.sleep(MAPBOX_DELAY)
            result = geocode_mapbox(full_addr, mapbox_token)
            if result:
                lat, lng = result
                print(f"{label} -> ({lat:.6f}, {lng:.6f}) [Mapbox]")
                supabase.table("disposal_facilities").update(
                    {"lat": lat, "lng": lng}
                ).eq("id", f["id"]).execute()
                mapbox_count += 1
                continue

        print(f"{label} -> FAILED")
        failed_count += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'=' * 55}")
    print(f"Geocoded (Census):  {census_count}")
    print(f"Geocoded (Mapbox):  {mapbox_count}")
    print(f"Failed:             {failed_count}")
    print(f"Total:              {total}")


if __name__ == "__main__":
    main()
