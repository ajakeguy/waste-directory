#!/usr/bin/env python3
"""
pipelines/pa-disposal-import/index.py

Imports PA DEP municipal waste facility records by scraping the DEP website.

Source: PA DEP — Municipal Waste Landfills and Resource Recovery Facilities
  https://www.pa.gov/agencies/dep/programs-and-services/business/
    municipal-waste-permitting/mw-landfills-and-resource-recovery-facilities

  Four HTML tables on the page:
    Table 0: Municipal Waste Landfills       → 'landfill'
    Table 1: C&D Landfills                   → 'cd_facility'
    Table 2: Residual Waste Landfills        → 'landfill'
    Table 3: Resource Recovery / WTE         → 'waste_to_energy'

  Note: PA DEP does not expose a public ArcGIS or open-data API for solid
  waste facilities. This scraper is the only automated data source available.
  Transfer stations and composting facilities are not listed publicly.

Fields scraped: name, address, city, zip, county, permit_number, operator

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

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
SAFE_MAX   = 200
BATCH_SIZE = 50

# Maps preceding <p> text → facility type
PA_SECTION_TYPE: dict[str, str] = {
    "municipal waste landfills":               "landfill",
    "construction/demolition waste landfills": "cd_facility",
    "residual waste landfills":                "landfill",
    "resource recovery/waste to energy":       "waste_to_energy",
}

# ---------------------------------------------------------------------------
# Parsing helpers
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
# Slug helpers
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", "-", text.strip())
    return text[:100]


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())


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

    print(f"\nFetching PA DEP facility page ...")
    try:
        r = requests.get(PAGE_URL, headers=HEADERS, timeout=30)
        r.raise_for_status()
    except Exception as exc:
        print(f"[ERR] Fetch failed: {exc}")
        sys.exit(1)
    print(f"Page fetched: {len(r.content):,} bytes")

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
    print(f"  Scraped:  {len(records)}")
    print(f"  Skipped:  {skipped}")
    print(f"  Inserted: {inserted}")
    print(f"  Errors:   {errors}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
