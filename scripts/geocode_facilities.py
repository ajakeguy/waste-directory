#!/usr/bin/env python3
"""
scripts/geocode_facilities.py

Geocodes disposal_facilities records that are missing lat/lng coordinates,
using the OpenRouteService Pelias geocoding API.

Validates that returned coordinates fall within the US Northeast bounding box
(lat 38–48, lng -80 to -66) to catch bad geocoding results.

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    ORS_API_KEY  (or NEXT_PUBLIC_ORS_API_KEY)

Usage:
    python scripts/geocode_facilities.py
    python scripts/geocode_facilities.py --dry-run
    python scripts/geocode_facilities.py --limit 100
    python scripts/geocode_facilities.py --state MA --limit 50
"""

import argparse
import os
import sys
import time

import requests
from supabase import create_client

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RATE_LIMIT_DELAY = 0.5  # seconds between API calls (free tier: 2 000 req/day)

# Bounding box: US Northeast (CT ME MA NH NJ NY PA RI VT) + a bit of slack
LAT_MIN, LAT_MAX = 38.0, 48.0
LNG_MIN, LNG_MAX = -80.0, -66.0

ORS_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"

# ---------------------------------------------------------------------------
# Geocoding
# ---------------------------------------------------------------------------

def geocode(address: str, api_key: str) -> tuple[float, float] | None:
    """
    Returns (lat, lng) if geocoding succeeds and coords pass the bounding-box
    check, otherwise None.
    """
    try:
        resp = requests.get(
            ORS_GEOCODE_URL,
            params={
                "api_key":          api_key,
                "text":             address,
                "size":             1,
                "boundary.country": "US",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data   = resp.json()
        coords = (
            data.get("features", [{}])[0]
                .get("geometry", {})
                .get("coordinates")
        )
        if coords:
            lng, lat = float(coords[0]), float(coords[1])  # ORS returns [lng, lat]
            if LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX:
                return lat, lng
            else:
                return None  # out-of-range — likely a bad match
    except Exception as exc:
        print(f"    geocode error: {exc}")
    return None

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Geocode disposal facilities missing lat/lng")
    parser.add_argument("--dry-run", action="store_true", help="Preview only — do not update database")
    parser.add_argument("--limit",   type=int, default=500,  help="Max facilities to process (default 500)")
    parser.add_argument("--state",   type=str, default=None, help="Filter by state code, e.g. MA")
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    ors_key      = os.environ.get("ORS_API_KEY") or os.environ.get("NEXT_PUBLIC_ORS_API_KEY")

    if not supabase_url or not supabase_key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        sys.exit(1)
    if not ors_key:
        print("ERROR: ORS_API_KEY or NEXT_PUBLIC_ORS_API_KEY is required")
        sys.exit(1)

    supabase = create_client(supabase_url, supabase_key)

    # ── Fetch facilities missing lat or lng ───────────────────────────────────
    print("Querying facilities missing coordinates...")

    q = (
        supabase.table("disposal_facilities")
        .select("id, name, address, city, state, zip")
        .is_("lat", "null")
    )
    if args.state:
        q = q.eq("state", args.state.upper())

    res  = q.limit(args.limit * 2).execute()
    rows = res.data or []

    # Keep only rows that have at least address or city to geocode
    facilities = [
        r for r in rows
        if r.get("address") or r.get("city")
    ][: args.limit]
    print(f"Found {len(facilities)} facilities missing coordinates "
          f"({'dry run' if args.dry_run else 'will update'})")

    if not facilities:
        print("Nothing to do.")
        return

    # ── Geocode each facility ─────────────────────────────────────────────────
    success = 0
    skipped = 0
    failed  = 0

    for i, f in enumerate(facilities):
        parts   = [f.get("address"), f.get("city"), f.get("state"), f.get("zip")]
        addr_str = ", ".join(p for p in parts if p)

        if not addr_str:
            print(f"[{i+1}/{len(facilities)}] SKIP (no address data): {f['name']}")
            skipped += 1
            continue

        print(f"[{i+1}/{len(facilities)}] {f['name']} — {addr_str}")

        result = geocode(addr_str, ors_key)

        if result:
            lat, lng = result
            print(f"    ->({lat:.6f}, {lng:.6f})")
            if not args.dry_run:
                supabase.table("disposal_facilities") \
                    .update({"lat": lat, "lng": lng}) \
                    .eq("id", f["id"]) \
                    .execute()
            success += 1
        else:
            print(f"    ->FAILED / out-of-range")
            failed += 1

        time.sleep(RATE_LIMIT_DELAY)

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'=' * 50}")
    print(f"Geocoding complete{'  (DRY RUN)' if args.dry_run else ''}:")
    print(f"  Success : {success}")
    print(f"  Skipped : {skipped}")
    print(f"  Failed  : {failed}")
    print(f"  Total   : {len(facilities)}")


if __name__ == "__main__":
    main()
