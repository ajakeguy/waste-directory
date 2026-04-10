#!/usr/bin/env python3
"""
pipelines/nj-recycling-import/index.py

Imports NJ DEP recycling facility data into disposal_facilities:

  Class A  — PDF  — MRFs (Mixed Recyclables)
  Class B  — HTML — C&D / Composting Recycling Facilities
  Class C  — HTML — Composting Facilities
  Class D  — HTML — Hazardous Waste Recycling Facilities

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import io
import os
import re
import sys
import time
from typing import Any

import pdfplumber
import requests
from bs4 import BeautifulSoup
from supabase import create_client

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SAFE_MAX    = 500
BATCH_SIZE  = 50

CLASS_A_PDF  = "https://dep.nj.gov/wp-content/uploads/dshw/classa.pdf"
CLASS_B_HTML = "https://dep.nj.gov/dshw/rhwm/classbrf/"
CLASS_C_HTML = "https://dep.nj.gov/dshw/rhwm/classcrf/"
CLASS_D_HTML = "https://dep.nj.gov/dshw/rhwm/classdrf/"

# ---------------------------------------------------------------------------
# Material code → description mapping
# ---------------------------------------------------------------------------

CODE_DESCRIPTIONS: dict[str, str] = {
    "A":   "Asphalt",
    "AM":  "Asphalt Millings",
    "AS":  "Asphalt Shingles",
    "BB":  "Brick & Block",
    "BR":  "Brush",
    "C":   "Concrete",
    "CW":  "Creosote Wood",
    "FW":  "Food Waste",
    "G":   "Grass",
    "GY":  "Gypsum",
    "L":   "Leaves",
    "LW":  "Lake Weed",
    "PCS": "Petroleum Contaminated Soil",
    "PWR": "Potable Water Residue",
    "SS":  "Street Sweepings",
    "T":   "Tires",
    "TL":  "Tree Limbs/Tree Branches",
    "TP":  "Tree Parts",
    "TRS": "Trees",
    "TS":  "Tree Stumps",
    "TT":  "Tree Trunks",
    "W":   "Wood",
    "WC":  "Wood Chips",
    "WP":  "Wood Pallets",
    "O":   "OceanGro",
    # Class D
    "AF":  "Anti Freeze",
    "B":   "Batteries",
    "BL":  "Ballast",
    "CE":  "Consumer Electronics",
    "MD":  "Mercury-Containing Devices",
    "UO":  "Used Oil",
}

# Codes that indicate C&D facility classification
CD_CODES = {"A", "BB", "C", "AS", "GY", "T"}
# Codes that indicate organics/composting classification
ORGANICS_CODES = {"BR", "FW", "G", "L", "LW", "TP", "TRS", "TS", "TT", "TL", "W", "WC", "WP"}

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
    """Title-case but keep common abbreviations uppercase."""
    if not text:
        return text
    return " ".join(
        word if word.upper() in {"LLC", "INC", "LP", "LLP", "CO", "NJ", "NY", "PA"} else word.capitalize()
        for word in text.strip().split()
    )


def clean_phone(phone: str) -> str:
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    if len(digits) == 11 and digits[0] == "1":
        return f"({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
    return phone.strip()


def parse_codes(raw: str) -> list[str]:
    """Parse a comma/space-separated code string into a sorted list of codes."""
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
    """Merge two accepted_materials dicts, deduplicating codes."""
    if not existing:
        return new_mat
    old_codes = set(existing.get("codes", []))
    new_codes = set(new_mat.get("codes", []))
    combined = sorted(old_codes | new_codes)
    descriptions = [CODE_DESCRIPTIONS.get(c, c) for c in combined]
    return {"codes": combined, "descriptions": descriptions}


def get_bool_flags(codes: list[str]) -> dict[str, bool]:
    code_set = set(codes)
    accepts_cd        = bool(code_set & CD_CODES)
    accepts_organics  = bool(code_set & ORGANICS_CODES)
    accepts_recycling = True  # All NJ recycling facilities accept recycling by definition
    accepts_hazardous = any(c in code_set for c in {"AF", "B", "BL", "CE", "MD", "UO"})
    return {
        "accepts_recycling": accepts_recycling,
        "accepts_cd":        accepts_cd,
        "accepts_organics":  accepts_organics,
        "accepts_hazardous": accepts_hazardous,
        "accepts_msw":       False,
        "accepts_special_waste": "T" in code_set or "PCS" in code_set,
    }


def determine_facility_type_b(codes: list[str]) -> str:
    """Class B: cd_facility if primarily C&D codes, composting if primarily organics."""
    code_set = set(codes)
    cd_count      = len(code_set & CD_CODES)
    organics_count = len(code_set & ORGANICS_CODES)
    if organics_count > cd_count:
        return "composting"
    return "cd_facility"


# ---------------------------------------------------------------------------
# Fetch helpers
# ---------------------------------------------------------------------------


def fetch_pdf_bytes(url: str) -> bytes:
    print(f"Fetching PDF: {url}")
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.content


def fetch_html(url: str) -> BeautifulSoup:
    print(f"Fetching HTML: {url}")
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------


def parse_class_a(pdf_bytes: bytes) -> list[dict[str, Any]]:
    """
    Parse the Class A MRF PDF.
    Expected columns: Facility Name | NJEMS PI | County | Municipality | Phone | Address
    """
    facilities: list[dict[str, Any]] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            table = page.extract_table()
            if not table:
                continue
            for row in table:
                if not row or len(row) < 6:
                    continue
                # Skip header rows
                raw_name = row[0] or ""
                if not raw_name or raw_name.strip().lower() in {"facility name", "name", ""}:
                    continue

                name        = title_case(raw_name.strip())
                permit_num  = (row[1] or "").strip()
                # county    = (row[2] or "").strip()  # not stored in schema
                municipality = title_case((row[3] or "").strip())
                phone       = clean_phone((row[4] or "").strip())
                address     = title_case((row[5] or "").strip())

                if not name:
                    continue

                facilities.append({
                    "name":              name,
                    "city":              municipality,
                    "state":             "NJ",
                    "phone":             phone,
                    "address":           address,
                    "permit_number":     permit_num,
                    "facility_type":     "mrf",
                    "accepts_recycling": True,
                    "accepts_cd":        False,
                    "accepts_organics":  False,
                    "accepts_hazardous": False,
                    "accepts_msw":       False,
                    "accepts_special_waste": False,
                    "accepted_materials": {"codes": [], "descriptions": []},
                    "notes": "NJ Class A Recycling Facility (MRF).",
                })

    return facilities[:SAFE_MAX]


def parse_html_county_tables(
    soup: BeautifulSoup,
    class_label: str,
) -> list[dict[str, Any]]:
    """
    Generic parser for Class B/C/D HTML pages.
    Structure: <h3>County Name</h3> followed by a <table> with rows:
      Facility Name | NJEMS PI | Waste Type | Phone | Location (Address) | Municipality
    """
    facilities: list[dict[str, Any]] = []
    current_county = ""

    for element in soup.find_all(["h3", "table"]):
        if element.name == "h3":
            current_county = element.get_text(strip=True)
            continue

        if element.name != "table":
            continue

        rows = element.find_all("tr")
        for row in rows:
            cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
            if len(cells) < 5:
                continue
            # Skip header rows
            if cells[0].lower() in {"facility name", "name", ""}:
                continue
            if not cells[0].strip():
                continue

            name        = title_case(cells[0].strip())
            permit_num  = cells[1].strip() if len(cells) > 1 else ""
            waste_raw   = cells[2].strip() if len(cells) > 2 else ""
            phone       = clean_phone(cells[3].strip() if len(cells) > 3 else "")
            address     = title_case(cells[4].strip() if len(cells) > 4 else "")
            municipality = title_case(cells[5].strip() if len(cells) > 5 else "")

            codes = parse_codes(waste_raw)
            accepted = build_accepted_materials(codes)
            bool_flags = get_bool_flags(codes)
            descriptions_str = ", ".join(accepted.get("descriptions", []))

            if class_label == "B":
                ftype = determine_facility_type_b(codes)
                notes = (
                    f"NJ Class B Recycling Facility. "
                    f"Materials: {descriptions_str}"
                )
            elif class_label == "C":
                ftype = "composting"
                bool_flags["accepts_organics"] = True
                notes = (
                    f"NJ Class C Composting Facility. "
                    f"Materials: {descriptions_str}"
                )
            else:  # D
                ftype = "hazardous_waste"
                bool_flags["accepts_hazardous"] = True
                notes = (
                    f"NJ Class D Hazardous Waste Recycling Facility. "
                    f"Materials: {descriptions_str}"
                )

            if not name:
                continue

            facilities.append({
                "name":          name,
                "city":          municipality,
                "state":         "NJ",
                "phone":         phone,
                "address":       address,
                "permit_number": permit_num,
                "facility_type": ftype,
                "accepted_materials": accepted,
                "notes":         notes,
                **bool_flags,
            })

    return facilities[:SAFE_MAX]


# ---------------------------------------------------------------------------
# Upsert logic
# ---------------------------------------------------------------------------


def upsert_facilities(
    supabase: Any,
    facilities: list[dict[str, Any]],
) -> tuple[int, int]:
    """
    Insert new facilities or UPDATE existing ones (merging accepted_materials).
    Returns (inserted, updated) counts.
    """
    inserted = 0
    updated  = 0

    for i in range(0, len(facilities), BATCH_SIZE):
        batch = facilities[i : i + BATCH_SIZE]

        for fac in batch:
            name  = fac["name"]
            state = fac.get("state", "NJ")
            slug  = slugify(f"{name}-nj")

            # Check existing
            existing_res = (
                supabase.table("disposal_facilities")
                .select("id, accepted_materials")
                .eq("slug", slug)
                .maybeSingle()
                .execute()
            )
            existing = existing_res.data

            record: dict[str, Any] = {
                "name":              name,
                "slug":              slug,
                "state":             state,
                "city":              fac.get("city") or None,
                "address":           fac.get("address") or None,
                "phone":             fac.get("phone") or None,
                "permit_number":     fac.get("permit_number") or None,
                "facility_type":     fac.get("facility_type", "mrf"),
                "data_source":       "nj_dep_recycling_2025",
                "service_area_states": ["NJ"],
                "verified":          True,
                "active":            True,
                "accepts_msw":       fac.get("accepts_msw", False),
                "accepts_cd":        fac.get("accepts_cd", False),
                "accepts_recycling": fac.get("accepts_recycling", False),
                "accepts_organics":  fac.get("accepts_organics", False),
                "accepts_hazardous": fac.get("accepts_hazardous", False),
                "accepts_special_waste": fac.get("accepts_special_waste", False),
                "notes":             fac.get("notes") or None,
            }

            new_mat = fac.get("accepted_materials") or {"codes": [], "descriptions": []}

            if existing:
                # Merge accepted_materials
                merged = merge_accepted_materials(
                    existing.get("accepted_materials"), new_mat
                )
                record["accepted_materials"] = merged
                supabase.table("disposal_facilities").update(record).eq(
                    "id", existing["id"]
                ).execute()
                updated += 1
                print(f"  UPDATED: {name} ({slug})")
            else:
                record["accepted_materials"] = new_mat
                supabase.table("disposal_facilities").insert(record).execute()
                inserted += 1
                print(f"  INSERTED: {name} ({slug})")

        # Small courtesy pause between batches
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

    total_inserted = 0
    total_updated  = 0
    total_parsed   = 0

    # ── Class A (PDF — MRFs) ──────────────────────────────────────────────────
    print("\n=== Class A: MRF Facilities (PDF) ===")
    try:
        pdf_bytes   = fetch_pdf_bytes(CLASS_A_PDF)
        class_a     = parse_class_a(pdf_bytes)
        total_parsed += len(class_a)
        print(f"Parsed {len(class_a)} Class A facilities")
        ins, upd = upsert_facilities(supabase, class_a)
        total_inserted += ins
        total_updated  += upd
    except Exception as exc:
        print(f"ERROR processing Class A: {exc}")

    # ── Class B (HTML — C&D / Composting) ────────────────────────────────────
    print("\n=== Class B: C&D / Composting Recycling Facilities (HTML) ===")
    try:
        soup_b  = fetch_html(CLASS_B_HTML)
        class_b = parse_html_county_tables(soup_b, "B")
        total_parsed += len(class_b)
        print(f"Parsed {len(class_b)} Class B facilities")
        ins, upd = upsert_facilities(supabase, class_b)
        total_inserted += ins
        total_updated  += upd
    except Exception as exc:
        print(f"ERROR processing Class B: {exc}")

    # ── Class C (HTML — Composting) ───────────────────────────────────────────
    print("\n=== Class C: Composting Facilities (HTML) ===")
    try:
        soup_c  = fetch_html(CLASS_C_HTML)
        class_c = parse_html_county_tables(soup_c, "C")
        total_parsed += len(class_c)
        print(f"Parsed {len(class_c)} Class C facilities")
        ins, upd = upsert_facilities(supabase, class_c)
        total_inserted += ins
        total_updated  += upd
    except Exception as exc:
        print(f"ERROR processing Class C: {exc}")

    # ── Class D (HTML — Hazardous Waste) ─────────────────────────────────────
    print("\n=== Class D: Hazardous Waste Recycling Facilities (HTML) ===")
    try:
        soup_d  = fetch_html(CLASS_D_HTML)
        class_d = parse_html_county_tables(soup_d, "D")
        total_parsed += len(class_d)
        print(f"Parsed {len(class_d)} Class D facilities")
        ins, upd = upsert_facilities(supabase, class_d)
        total_inserted += ins
        total_updated  += upd
    except Exception as exc:
        print(f"ERROR processing Class D: {exc}")

    # ── Final summary ─────────────────────────────────────────────────────────
    print(f"\n{'=' * 55}")
    print(f"NJ Recycling Import Complete")
    print(f"  Total parsed:   {total_parsed}")
    print(f"  Inserted:       {total_inserted}")
    print(f"  Updated:        {total_updated}")


if __name__ == "__main__":
    main()
