#!/usr/bin/env python3
"""
pipelines/pa-disposal-import/index.py

Imports PA DEP municipal waste facility records by scraping the DEP website,
enriches existing records with volume / municipality / contact data, and
imports transfer stations from the PA DEP ArcGIS Hub CSV.

Sources:
  1. PA DEP — Municipal Waste Landfills and Resource Recovery Facilities (HTML)
       https://www.pa.gov/agencies/dep/programs-and-services/business/
         municipal-waste-permitting/mw-landfills-and-resource-recovery-facilities
       Tables: MW Landfills, C&D Landfills, Residual Waste Landfills, WTE
       (~58 records, data_source = 'pa_dep_2025')

  2. PA DEP — Solid Waste Facilities ArcGIS Hub CSV
       https://opendata.arcgis.com/datasets/00c283da2e684df4a207ce75dd7d6994_0.csv
       Filters: PRIMARY_FACILITY_STATUS=ACTIVE + SUB_FACILITY_TYPE=TRANSFER STATION
       (~72 records, data_source = 'pa_dep_transfer_2025')
       Coordinates are Web Mercator (EPSG:3857) → converted to WGS84.

Run order in main():
  1. scrape_pa_landfills_and_wte()  — insert new landfill/WTE records
  2. enrich_pa_landfills()          — UPDATE existing records with volumes, municipality, contacts
  3. import_pa_transfer_stations()  — insert new transfer station records

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import csv
import io
import math
import os
import re
import sys
from datetime import datetime

import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HEADERS  = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
PAGE_URL = (
    "https://www.pa.gov/agencies/dep/programs-and-services/business"
    "/municipal-waste-permitting/mw-landfills-and-resource-recovery-facilities"
)
CSV_URL = "https://opendata.arcgis.com/datasets/00c283da2e684df4a207ce75dd7d6994_0.csv"

SAFE_MAX          = 200   # landfill/WTE scraper guard
TRANSFER_SAFE_MAX = 200   # transfer station CSV guard
BATCH_SIZE        = 50

# Maps preceding <p> text → facility type
PA_SECTION_TYPE: dict[str, str] = {
    "municipal waste landfills":               "landfill",
    "construction/demolition waste landfills": "cd_facility",
    "residual waste landfills":                "landfill",
    "resource recovery/waste to energy":       "waste_to_energy",
}

# ---------------------------------------------------------------------------
# Parsing helpers (shared)
# ---------------------------------------------------------------------------

def parse_name_address(text: str) -> tuple[str, str | None, str | None, str | None]:
    """
    Split a combined name+address cell like:
      'Fairless Landfill 1000 New Ford Mill Rd. Morrisville, PA 19067'
    Returns (name, address, city, zip).
    """
    text = re.sub(r"\s+", " ", text.strip())

    # Extract ", PA XXXXX" or trailing 5-digit zip
    zip_match = re.search(r",?\s*P\.?A\.?\s+(\d{5})\s*$", text, re.IGNORECASE)
    if not zip_match:
        zip_match = re.search(r"\s(\d{5})\s*$", text)

    if zip_match:
        zip_  = zip_match.group(1)
        rest  = text[: zip_match.start()].strip()
        rest  = re.sub(r",?\s*P\.?A\.?\s*$", "", rest, flags=re.IGNORECASE).strip()
        city_m = re.search(r",\s*([^,]+)$", rest)
        if city_m:
            city      = city_m.group(1).strip().title()
            name_addr = rest[: city_m.start()].strip()
        else:
            city      = None
            name_addr = rest
    else:
        zip_  = None
        city  = None
        name_addr = text

    # Address starts with a street number, Route, P.O. Box, RR, or "Harvey"
    addr_m = re.search(
        r"\s+(\d{1,5}\s+\w"
        r"|\bRoute\b\s*\d"
        r"|\bRte\.?\b\s*\d"
        r"|\bP\.?\s*O\.?\s*Box\b"
        r"|\bRR\d"
        r"|\bHarvey\b"
        r")",
        name_addr,
    )
    if addr_m:
        name    = name_addr[: addr_m.start()].strip()
        address = name_addr[addr_m.start() :].strip()
    else:
        name    = name_addr
        address = None

    return (name or text[:60]), address, city, zip_


def parse_contact(text: str) -> tuple[str | None, str | None, str | None]:
    """Extract (operator_name, phone, email) from a contact cell."""
    text = re.sub(r"\s+", " ", (text or "").strip())

    email_m = re.search(r"[\w.+-]+@[\w.-]+\.\w{2,}", text)
    email   = email_m.group(0).lower() if email_m else None

    phone_m = re.search(r"\b(\d{3}[\s.\-]\d{3}[\s.\-]\d{4}|\d{10})\b", text)
    phone   = phone_m.group(1) if phone_m else None

    name_end = len(text)
    if phone_m:
        name_end = min(name_end, phone_m.start())
    if email_m:
        name_end = min(name_end, email_m.start())
    operator = text[:name_end].strip().rstrip("—–- ") or None

    return operator, phone, email


def determine_table_type(table) -> str:
    """Walk backwards from the table to find the most recent <p> section label."""
    node     = table.previous_sibling
    count    = 0
    last_p   = ""
    while node and count < 30:
        if hasattr(node, "name"):
            if node.name == "p":
                last_p = node.get_text(strip=True).lower()
            elif node.name in ("h1", "h2", "h3"):
                break
        node  = node.previous_sibling
        count += 1
    return PA_SECTION_TYPE.get(last_p, "landfill")


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", "-", text.strip())
    return text[:100]


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())


# ---------------------------------------------------------------------------
# Step 1 — Scrape landfill / WTE records (original logic, unchanged)
# ---------------------------------------------------------------------------

def scrape_facilities(html: str) -> list[dict]:
    soup   = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    results: list[dict] = []

    for table in tables:
        fac_type = determine_table_type(table)
        rows     = table.find_all("tr")

        for row in rows:
            cells = [td.get_text(" ", strip=True) for td in row.find_all(["th", "td"])]
            if len(cells) < 2:
                continue

            name_cell = cells[0].strip()

            # Skip header row
            if name_cell.lower().startswith(("landfill", "facility")):
                continue
            # Skip region/volume-only rows
            if (not name_cell
                    or name_cell.lower().startswith("mdv:")
                    or name_cell.lower().startswith("adv:")):
                continue
            # Skip if second cell (permit) is empty — region label row
            if not cells[1].strip():
                continue

            name, address, city, zip_ = parse_name_address(name_cell)
            permit  = cells[1].strip() or None
            county  = cells[3].strip().title() if len(cells) > 3 else None
            contact = cells[5] if len(cells) > 5 else ""
            operator, phone, email = parse_contact(contact)

            if not name:
                continue

            accepts_msw = fac_type in ("landfill", "waste_to_energy")
            accepts_cd  = fac_type == "cd_facility"

            results.append({
                "name":           name.strip().title(),
                "facility_type":  fac_type,
                "address":        address,
                "city":           city or county,
                "state":          "PA",
                "zip":            zip_,
                "phone":          phone,
                "email":          email,
                "operator_name":  operator,
                "permit_number":  permit,
                "permit_status":  "active",
                "notes":          f"County: {county}" if county else None,
                "service_area_states": ["PA"],
                "data_source":    "pa_dep_2025",
                "accepts_msw":    accepts_msw,
                "accepts_cd":     accepts_cd,
                "verified":       True,
                "active":         True,
            })

    return results


# ---------------------------------------------------------------------------
# Step 2 — Enrich existing PA records with volume / municipality / contacts
# ---------------------------------------------------------------------------

def scrape_pa_enriched(html: str) -> list[dict]:
    """
    Re-parse the PA DEP page to extract the richer fields not captured by the
    basic scraper: ADV, MDV, municipality (cell[4]), and full contact text.

    The table structure pairs a 6-cell facility row with an optional following
    1-cell 'mdv: X,XXX' row.  Returns a list of dicts keyed on permit_number.
    """
    soup   = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    enriched: list[dict] = []

    for table in tables:
        rows          = table.find_all("tr")
        prev_facility = None   # last valid 6-cell facility dict

        for row in rows:
            cells = [td.get_text(" ", strip=True) for td in row.find_all(["th", "td"])]
            if not cells:
                continue

            name_cell = cells[0].strip()

            # MDV continuation row  (1 cell, starts with "mdv:")
            if len(cells) == 1 and name_cell.lower().startswith("mdv:"):
                if prev_facility is not None:
                    mdv_raw = re.search(r"[\d,]+", name_cell[4:])
                    if mdv_raw:
                        try:
                            prev_facility["mdv_tpd"] = float(mdv_raw.group(0).replace(",", ""))
                        except ValueError:
                            pass
                continue

            # Reset pairing on any other single-cell or malformed row
            if len(cells) < 2:
                prev_facility = None
                continue

            # Skip header / region rows
            if name_cell.lower().startswith(("landfill", "facility")):
                prev_facility = None
                continue
            if not name_cell or name_cell.lower().startswith("adv:"):
                prev_facility = None
                continue
            if not cells[1].strip():
                prev_facility = None
                continue

            # --- Valid 6-cell facility row ---
            permit = cells[1].strip() or None

            # ADV from cell[2]: "adv: 1,234" or bare "1,234"
            adv_tpd = None
            if len(cells) > 2:
                adv_match = re.search(r"[\d,]+", cells[2])
                if adv_match:
                    try:
                        adv_tpd = float(adv_match.group(0).replace(",", ""))
                    except ValueError:
                        pass

            county       = cells[3].strip().title() if len(cells) > 3 else None
            municipality = cells[4].strip().title() if len(cells) > 4 else None
            contact_raw  = re.sub(r"\s+", " ", (cells[5] if len(cells) > 5 else "").strip())
            operator, phone, email = parse_contact(contact_raw)

            fac = {
                "permit_number": permit,
                "adv_tpd":       adv_tpd,
                "mdv_tpd":       None,   # filled in when mdv row follows
                "county":        county,
                "municipality":  municipality,
                "operator_name": operator,
                "phone":         phone,
                "email":         email,
                "contact_raw":   contact_raw,
            }
            prev_facility = fac
            enriched.append(fac)

    return enriched


def enrich_pa_landfills(supabase: Client, html: str) -> int:
    """
    Update existing PA records (data_source='pa_dep_2025') with richer data:
      - permitted_capacity_tons_per_day  (from ADV)
      - notes  (County | Municipality | ADV | MDV | Contact)
      - operator_name, phone, email
    Matches are made by permit_number.
    """
    enriched = scrape_pa_enriched(html)

    # Build lookup permit → enrichment dict
    by_permit: dict[str, dict] = {}
    for rec in enriched:
        if rec["permit_number"]:
            by_permit[rec["permit_number"]] = rec

    print(f"\n  Enrichment records parsed: {len(by_permit)}")

    # Fetch existing PA records
    pa_records = (
        supabase.table("disposal_facilities")
        .select("id,permit_number")
        .eq("state", "PA")
        .execute()
        .data or []
    )
    print(f"  Existing PA records in DB: {len(pa_records)}")

    updated = 0
    for rec in pa_records:
        pn  = rec.get("permit_number") or ""
        enr = by_permit.get(pn)
        if not enr:
            continue

        # Build notes string
        note_parts: list[str] = []
        if enr.get("county"):
            note_parts.append(f"County: {enr['county']}")
        if enr.get("municipality"):
            note_parts.append(f"Municipality: {enr['municipality']}")
        if enr.get("adv_tpd") is not None:
            note_parts.append(f"ADV: {enr['adv_tpd']:,.0f} tons/day")
        if enr.get("mdv_tpd") is not None:
            note_parts.append(f"MDV: {enr['mdv_tpd']:,.0f} tons/day")
        if enr.get("contact_raw"):
            note_parts.append(f"Contact: {enr['contact_raw']}")
        notes = " | ".join(note_parts) or None

        payload: dict = {"notes": notes}
        if enr.get("adv_tpd") is not None:
            payload["permitted_capacity_tons_per_day"] = enr["adv_tpd"]
        if enr.get("operator_name"):
            payload["operator_name"] = enr["operator_name"]
        if enr.get("phone"):
            payload["phone"] = enr["phone"]
        if enr.get("email"):
            payload["email"] = enr["email"]

        supabase.table("disposal_facilities").update(payload).eq("id", rec["id"]).execute()
        updated += 1

    print(f"  PA records enriched: {updated}")
    return updated


# ---------------------------------------------------------------------------
# Step 3 — Import PA transfer stations from ArcGIS Hub CSV
# ---------------------------------------------------------------------------

def merc_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Convert Web Mercator (EPSG:3857) X/Y to WGS84 lat/lng."""
    lng = x / 20037508.34 * 180.0
    lat = math.degrees(2.0 * math.atan(math.exp(y / 20037508.34 * math.pi)) - math.pi / 2.0)
    return round(lat, 6), round(lng, 6)


def clean_site_name(raw: str) -> str:
    """Expand abbreviations and title-case PA transfer station names."""
    # Title-case first so replacements are case-consistent
    name = raw.strip().title()
    # Ordered replacements — longer/more-specific patterns first
    replacements = [
        ("Transf Sta",      "Transfer Station"),
        ("Transf Station",  "Transfer Station"),
        ("Transf &",        "Transfer &"),
        ("Transf",          "Transfer"),
        ("Recyl",           "Recycling"),
        ("Rec Ctr",         "Recycling Center"),
        ("Ctr",             "Center"),
        ("Mfg",             "Manufacturing"),
        # "Sta " with trailing space avoids matching "Station"
        ("Sta ",            "Station "),
        ("Muni ",           "Municipal "),
    ]
    for abbrev, full in replacements:
        name = name.replace(abbrev, full)
    return re.sub(r"\s{2,}", " ", name).strip()


def best_ts_name(site_name: str, primary_name: str) -> str:
    """
    Return the more readable of SITE_NAME or PRIMARY_FACILITY_NAME.
    Prefer PRIMARY_FACILITY_NAME if it's non-empty and not heavily abbreviated
    (heuristic: already contains mixed case or fewer all-caps words than SITE_NAME).
    Both are cleaned before comparison; the cleaner result is returned.
    """
    cleaned_site    = clean_site_name(site_name)    if site_name    else ""
    cleaned_primary = clean_site_name(primary_name) if primary_name else ""

    if not cleaned_primary:
        return cleaned_site
    if not cleaned_site:
        return cleaned_primary

    # Count residual all-caps tokens (≥3 chars) as proxy for "still abbreviated"
    def abbrev_score(s: str) -> int:
        return sum(1 for w in s.split() if len(w) >= 3 and w.isupper())

    return cleaned_primary if abbrev_score(cleaned_primary) <= abbrev_score(cleaned_site) else cleaned_site


def import_pa_transfer_stations(
    supabase: Client,
    existing_slugs: set[str],
) -> tuple[int, int]:
    """
    Download the PA DEP Solid Waste Facilities CSV, filter to active transfer
    stations, convert coordinates, and insert new records.
    Returns (inserted, error_count).
    """
    print("\nFetching PA transfer station CSV ...")
    try:
        resp = requests.get(CSV_URL, headers=HEADERS, timeout=60)
        resp.raise_for_status()
    except Exception as exc:
        print(f"  [ERR] CSV fetch failed: {exc}")
        return 0, 1

    print(f"  CSV fetched: {len(resp.content):,} bytes")

    # utf-8-sig automatically strips the UTF-8 BOM from the first column header
    text   = resp.content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    records: list[dict] = []
    for row in reader:
        status   = (row.get("PRIMARY_FACILITY_STATUS") or "").strip().upper()
        sub_type = (row.get("SUB_FACILITY_TYPE") or "").strip().upper()

        if status != "ACTIVE":
            continue
        if sub_type != "TRANSFER STATION":
            continue

        site_name    = (row.get("SITE_NAME") or "").strip()
        primary_name = (row.get("PRIMARY_FACILITY_NAME") or "").strip()
        if not site_name and not primary_name:
            continue

        name = best_ts_name(site_name, primary_name)

        # Coordinates: Web Mercator → WGS84
        lat: float | None = None
        lng: float | None = None
        try:
            x_val = row.get("X") or ""
            y_val = row.get("Y") or ""
            if x_val and y_val:
                x = float(x_val)
                y = float(y_val)
                if x != 0 and y != 0:
                    lat, lng = merc_to_wgs84(x, y)
        except (ValueError, TypeError):
            pass

        permit   = (row.get("OTHER_FACILITY_ID") or "").strip() or None
        operator = (row.get("ORGANIZATION_NAME") or "").strip().title() or None
        county   = (row.get("COUNTY_NAME") or "").strip().title() or None
        address  = (row.get("LOCATION_ADDRESS") or "").strip().title() or None
        city     = (row.get("MUNICIPALITY_NAME") or "").strip().title() or None

        records.append({
            "name":                name,
            "facility_type":       "transfer_station",
            "address":             address,
            "city":                city,
            "state":               "PA",
            "operator_name":       operator,
            "permit_number":       permit,
            "permit_status":       "active",
            "lat":                 lat,
            "lng":                 lng,
            "notes":               f"County: {county}" if county else None,
            "service_area_states": ["PA"],
            "data_source":         "pa_dep_transfer_2025",
            "accepts_msw":         True,
            "verified":            True,
            "active":              True,
        })

    print(f"  Active transfer stations parsed: {len(records)}")

    if len(records) > TRANSFER_SAFE_MAX:
        print(f"  [ERR] TRANSFER_SAFE_MAX exceeded ({len(records)} > {TRANSFER_SAFE_MAX}). Aborting.")
        return 0, 1

    # Dedup against existing slugs
    slug_counter: dict[str, int] = {}
    to_insert: list[dict] = []
    skipped = 0

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
            n += 1
            slug = f"{base_slug}-{n}"
        slug_counter[base_slug] = n + 1
        existing_slugs.add(slug)
        row_data = dict(rec)
        row_data["slug"] = slug
        to_insert.append(row_data)

    print(f"  Transfer stations skipped (already in DB): {skipped}")
    print(f"  Transfer stations to insert: {len(to_insert)}")

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

    return inserted, errors


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("PA DEP Disposal Facilities Importer")
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("[ERR] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # ── Load existing slugs ───────────────────────────────────────────────────
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

    # ── Fetch PA DEP page (used by both Step 1 and Step 2) ───────────────────
    print(f"\nFetching PA DEP facility page ...")
    try:
        r = requests.get(PAGE_URL, headers=HEADERS, timeout=30)
        r.raise_for_status()
    except Exception as exc:
        print(f"[ERR] Fetch failed: {exc}")
        sys.exit(1)
    print(f"Page fetched: {len(r.content):,} bytes")

    # ── Step 1: Scrape landfills + WTE, insert new records ───────────────────
    print("\n-- Step 1: Landfill / WTE scrape --")
    records = scrape_facilities(r.text)
    print(f"Scraped records: {len(records)}")

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

    print(f"  Already in DB (skipped): {skipped}")
    print(f"  To insert: {len(to_insert)}")

    landfill_inserted = 0
    landfill_errors   = 0
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch     = to_insert[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            supabase.table("disposal_facilities").insert(batch).execute()
            landfill_inserted += len(batch)
            print(f"  [OK] Batch {batch_num}: inserted {len(batch)}")
        except Exception as exc:
            print(f"  [ERR] Batch {batch_num}: {exc}")
            landfill_errors += 1

    # ── Step 2: Enrich existing PA records with volume / municipality / contacts
    print("\n-- Step 2: Enrich existing PA records --")
    enrich_pa_landfills(supabase, r.text)

    # ── Step 3: Import PA transfer stations from CSV ──────────────────────────
    print("\n-- Step 3: PA transfer stations (CSV) --")
    ts_inserted, ts_errors = import_pa_transfer_stations(supabase, existing_slugs)

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Landfill/WTE scraped:    {len(records)}")
    print(f"  Landfill/WTE skipped:    {skipped}")
    print(f"  Landfill/WTE inserted:   {landfill_inserted}")
    print(f"  Landfill/WTE errors:     {landfill_errors}")
    print(f"  Transfer stations ins.:  {ts_inserted}")
    print(f"  Transfer stations errs:  {ts_errors}")

    if landfill_errors or ts_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
