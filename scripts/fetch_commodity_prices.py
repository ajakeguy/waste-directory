#!/usr/bin/env python3
"""
fetch_commodity_prices.py
Fetches commodity price data from EIA and FRED APIs and upserts
into the commodity_prices table in Supabase.

Required environment variables:
  EIA_API_KEY             - Register free at https://www.eia.gov/opendata/register.php
  SUPABASE_URL            - (preferred) or NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Usage:
  python scripts/fetch_commodity_prices.py
"""

import os
import csv
import sys
import io
from datetime import date, datetime

import requests
from supabase import create_client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

EIA_API_KEY   = os.environ.get("EIA_API_KEY", "")
SUPABASE_URL  = (
    os.environ.get("SUPABASE_URL") or
    os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or
    ""
)
SUPABASE_KEY  = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or
    os.environ.get("SUPABASE_KEY") or
    ""
)

EIA_BASE      = "https://api.eia.gov/v2"
FRED_CSV_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv"

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

if not EIA_API_KEY:
    print("WARNING: EIA_API_KEY not set. EIA fetches will be skipped.")
    print("         Register free at https://www.eia.gov/opendata/register.php")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def upsert_price(commodity_key: str, price: float, unit: str,
                  period_date: str, source: str) -> bool:
    """Upsert a single price row. Returns True on success."""
    try:
        res = supabase.table("commodity_prices").upsert(
            {
                "commodity_key": commodity_key,
                "price":         price,
                "unit":          unit,
                "period_date":   period_date,
                "source":        source,
            },
            on_conflict="commodity_key,period_date",
        ).execute()
        print(f"  -> {commodity_key}: {price} {unit} on {period_date} (source: {source})")
        return True
    except Exception as e:
        print(f"  ERROR upserting {commodity_key}: {e}")
        return False


def eia_fetch(endpoint: str, params: dict) -> dict | None:
    """Call EIA v2 API and return the parsed JSON response or None on error."""
    if not EIA_API_KEY:
        print(f"  SKIP {endpoint} (no EIA_API_KEY)")
        return None
    url = f"{EIA_BASE}{endpoint}"
    params["api_key"] = EIA_API_KEY
    params["sort[0][column]"]    = "period"
    params["sort[0][direction]"] = "desc"
    params["length"]             = 5
    try:
        r = requests.get(url, params=params, timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  ERROR fetching EIA {endpoint}: {e}")
        return None


def fred_csv_fetch(series_id: str) -> tuple[str, float] | None:
    """
    Fetch a FRED CSV series and return (period_date, value) for the
    most recent non-null observation. Returns None on error.

    FRED CSV format: two columns.
      - First column header is typically 'DATE' (but we use positional index for robustness)
      - Second column header is the series_id (e.g. 'WPU101707'), not 'VALUE'
      - Missing values are represented as '.'
    """
    url = f"{FRED_CSV_BASE}?id={series_id}"
    try:
        r = requests.get(url, timeout=45, headers={
            "User-Agent": "WasteMarkets/1.0 (prices pipeline; contact hello@waste.markets)"
        })
        r.raise_for_status()
        text = r.text.strip()
        if not text or "<html" in text.lower():
            print(f"  WARN: FRED returned non-CSV response for {series_id}")
            return None

        # Parse positionally — first col = date, second col = value
        # This avoids issues with varying column header names
        lines = [l for l in text.splitlines() if l.strip()]
        if len(lines) < 2:
            print(f"  WARN: No data rows for FRED series {series_id}")
            return None

        valid_rows: list[tuple[str, float]] = []
        for line in lines[1:]:   # skip header row
            parts = line.split(",")
            if len(parts) < 2:
                continue
            date_val  = parts[0].strip()
            price_val = parts[1].strip()
            if price_val in (".", "", "NA"):
                continue
            try:
                valid_rows.append((date_val, float(price_val)))
            except ValueError:
                continue

        if not valid_rows:
            print(f"  WARN: No valid (non-null) data rows for FRED series {series_id}")
            return None

        # Last valid row = most recent observation
        period, value = valid_rows[-1]
        return period, value

    except Exception as e:
        print(f"  ERROR fetching FRED {series_id}: {e}")
        return None


# ---------------------------------------------------------------------------
# EIA fetches (only ULSD diesel — WTI and Henry Hub moved to FRED)
# ---------------------------------------------------------------------------

def fetch_ulsd_diesel():
    """ULSD Diesel national average (weekly) — EIA series EPD2DXL0."""
    print("\n[EIA] ULSD Diesel - National Average")
    data = eia_fetch(
        "/petroleum/pri/gnd/data/",
        {
            "frequency":            "weekly",
            "data[]":               "value",
            "facets[duoarea][]":    "NUS",
            "facets[product][]":    "EPD2DXL0",
        },
    )
    if not data:
        return
    rows = data.get("response", {}).get("data", [])
    if not rows:
        print("  WARN: No data returned")
        return
    for row in rows:
        val = row.get("value")
        if val is not None:
            period = row.get("period")
            upsert_price("ulsd_diesel", float(val), "$/gallon", period, "EIA")
            return
    print("  WARN: All returned rows have null values")


def fetch_electricity_commercial():
    """US average commercial electricity price (monthly, cents/kWh).

    Fixed facet: sectorid=COM (not sectorName=commercial — that param is ignored).
    """
    print("\n[EIA] US Commercial Electricity Price")
    data = eia_fetch(
        "/electricity/retail-sales/data/",
        {
            "frequency":            "monthly",
            "data[]":               "price",
            "facets[sectorid][]":   "COM",
            "facets[stateid][]":    "US",
            "length":               3,
        },
    )
    if not data:
        return
    rows = data.get("response", {}).get("data", [])
    if not rows:
        print("  WARN: No data returned")
        return
    for row in rows:
        val = row.get("price")
        if val is not None:
            # EIA monthly periods are formatted as YYYY-MM — normalise to YYYY-MM-01
            period_raw = row.get("period", "")
            period = period_raw + "-01" if len(period_raw) == 7 else period_raw
            upsert_price("electricity_commercial", float(val), "cents/kWh", period, "EIA")
            return
    print("  WARN: All returned rows have null values")


# ---------------------------------------------------------------------------
# FRED fetches (WTI, Henry Hub, steel scrap, aluminum)
# ---------------------------------------------------------------------------

def fetch_wti_crude():
    """WTI Crude Oil spot price (daily) — FRED series DCOILWTICO."""
    print("\n[FRED] WTI Crude Oil (DCOILWTICO)")
    result = fred_csv_fetch("DCOILWTICO")
    if result:
        period, value = result
        upsert_price("wti_crude", value, "$/barrel", period, "FRED")


def fetch_henry_hub_gas():
    """Henry Hub Natural Gas spot price (daily) — FRED series DHHNGSP."""
    print("\n[FRED] Henry Hub Natural Gas (DHHNGSP)")
    result = fred_csv_fetch("DHHNGSP")
    if result:
        period, value = result
        upsert_price("henry_hub_gas", value, "$/MMBtu", period, "FRED")


def fetch_steel_scrap():
    """Steel scrap HMS #1 price index (monthly) — FRED series WPU101707."""
    print("\n[FRED] Steel Scrap HMS #1 (WPU101707)")
    result = fred_csv_fetch("WPU101707")
    if result:
        period, value = result
        upsert_price("steel_scrap_hms1", value, "$/gross ton (index)", period, "FRED")


def fetch_aluminum_lme():
    """LME Aluminum price (monthly, USD/metric ton) — FRED series PALUMUSDM."""
    print("\n[FRED] Aluminum LME Price (PALUMUSDM)")
    result = fred_csv_fetch("PALUMUSDM")
    if result:
        period, value = result
        upsert_price("aluminum_lme", value, "$/metric ton", period, "FRED")


# ---------------------------------------------------------------------------
# Manual / SMP placeholder commodities
# ---------------------------------------------------------------------------

MANUAL_COMMODITIES = [
    ("occ_cardboard",  0.0, "$/ton"),
    ("mixed_paper",    0.0, "$/ton"),
    ("pet_plastic",    0.0, "$/lb"),
    ("hdpe_plastic",   0.0, "$/lb"),
    ("aluminum_cans",  0.0, "cents/lb"),
    ("glass_cullet",   0.0, "$/ton"),
    ("compost",        0.0, "$/ton"),
    ("rng",            0.0, "$/MMBtu"),
]

def insert_manual_placeholders():
    """
    Insert placeholder rows (price=0) for community-sourced commodities
    if no row exists yet for the current month.
    """
    print("\n[Manual] Placeholder commodities")
    today = date.today()
    period_date = today.replace(day=1).isoformat()  # first of current month

    for key, price, unit in MANUAL_COMMODITIES:
        # Check if a row already exists for this month
        try:
            existing = supabase.table("commodity_prices") \
                .select("id") \
                .eq("commodity_key", key) \
                .eq("period_date", period_date) \
                .maybe_single() \
                .execute()
            if existing.data:
                print(f"  SKIP {key}: row already exists for {period_date}")
                continue
        except Exception as e:
            print(f"  WARN checking {key}: {e}")

        upsert_price(key, price, unit, period_date, "Manual")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("Commodity Price Fetch")
    print(f"Run time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    # EIA feeds (diesel + electricity)
    fetch_ulsd_diesel()
    fetch_electricity_commercial()

    # FRED feeds (WTI, Henry Hub, steel scrap, aluminum)
    fetch_wti_crude()
    fetch_henry_hub_gas()
    fetch_steel_scrap()
    fetch_aluminum_lme()

    # Manual placeholders
    insert_manual_placeholders()

    print("\n" + "=" * 60)
    print("Done.")
    print("=" * 60)
