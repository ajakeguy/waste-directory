#!/usr/bin/env python3
"""
pipelines/ma-disposal-import/index.py

Imports MA DEP disposal facility records into disposal_facilities.

Three sources run in sequence -- each is independent and skipped if its data
file is missing:

  1. XLSX  -- MA DEP Solid Waste Facility Master List (active sites only)
             pipelines/ma-disposal-import/data/ma_solid_waste_facilities.xlsx
             Download: MassDEP Solid Waste Management Program -- Master Facility List

  2. MRFs  -- MassDEP MRF / Recycling Facility list (PDF)
             pipelines/ma-disposal-import/data/ma_mrfs.pdf
             Download: https://www.mass.gov/doc/map-list-of-materials-recoveryrecycling-facilities-mrfs-in-massachusetts/download
             (mass.gov blocks bots -- download manually in a browser)

  3. Composting -- MassDEP sites accepting diverted food material (PDF)
             pipelines/ma-disposal-import/data/ma_composting.pdf
             Download: https://www.mass.gov/doc/map-list-of-massachusetts-sites-accepting-diverted-food-material/download
             (mass.gov blocks bots -- download manually in a browser)

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import io
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import pdfplumber
from supabase import create_client, Client

# -- Paths & constants ---------------------------------------------------------

DATA_DIR  = Path(__file__).parent / "data"
XLSX_PATH = DATA_DIR / "ma_solid_waste_facilities.xlsx"
MRF_PDF   = DATA_DIR / "ma_mrfs.pdf"
COMP_PDF  = DATA_DIR / "ma_composting.pdf"

DATA_SHEET  = "AllSites"
BATCH_SIZE  = 50
SAFE_MAX    = 2000

CITY_STATE_ZIP_RE = re.compile(r"^(.+),\s+([A-Z]{2})\s+(\d{5})")
PHONE_RE          = re.compile(r"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}")
ZIP_RE            = re.compile(r"\b(\d{5})(?:-\d{4})?\b")


# -- Shared helpers ------------------------------------------------------------

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
    return None if s.lower() in {"nan", "none", "nat", ""} else s


def clean_phone(raw) -> str | None:
    if not raw or str(raw).strip() in {"nan", "none", ""}:
        return None
    digits = re.sub(r"[^\d]", "", str(raw))
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    if len(digits) == 11 and digits[0] == "1":
        d = digits[1:]
        return f"({d[:3]}) {d[3:6]}-{d[6:]}"
    s = str(raw).strip()
    return s if s and s not in {"nan", "none"} else None


def parse_city_state_zip(raw) -> tuple[str | None, str | None, str | None]:
    if not raw or str(raw).strip() in {"nan", "none", ""}:
        return None, None, None
    m = CITY_STATE_ZIP_RE.match(str(raw).strip())
    if m:
        return m.group(1).title(), m.group(2), m.group(3)
    return None, None, None


def clean_capacity(val) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
        return f if f > 0 else None
    except (ValueError, TypeError):
        return None


def map_facility_type(class_grp: str, class_desc: str) -> str:
    grp  = (class_grp  or "").strip()
    desc = (class_desc or "").lower()
    if grp == "Combustion":
        return "waste_to_energy"
    if grp == "Land Disposal":
        return "landfill"
    if "compost" in desc:
        return "composting"
    if "c&d" in desc:
        return "cd_facility"
    return "transfer_station"


def batch_insert(
    supabase: Client,
    records: list[dict],
    existing_slugs: set[str],
    slug_counter: dict[str, int],
    label: str,
) -> tuple[int, int, int]:
    """
    Dedup by slug, build insert list, and batch-insert into disposal_facilities.
    Returns (skipped, inserted, errors).  Mutates existing_slugs and slug_counter.
    """
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
        row = dict(rec)
        row["slug"] = slug
        row.pop("is_active", None)
        to_insert.append(row)

    print(f"  [{label}] Already in DB: {skipped}  To insert: {len(to_insert)}")

    inserted = errors = 0
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch     = to_insert[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            supabase.table("disposal_facilities").insert(batch).execute()
            inserted += len(batch)
            print(f"  [{label}] [OK] Batch {batch_num}: inserted {len(batch)}")
        except Exception as exc:
            print(f"  [{label}] [ERR] Batch {batch_num}: {exc}")
            errors += 1

    return skipped, inserted, errors


# -- Source 1: XLSX active sites -----------------------------------------------

def import_active_sites(
    supabase: Client,
    existing_slugs: set[str],
    slug_counter: dict[str, int],
) -> tuple[int, int, int, int]:
    """Returns (total_rows, parsed, skipped, inserted, errors) -- actually 5-tuple."""
    print(f"\n{'-'*50}")
    print("SOURCE 1: MA DEP AllSites XLSX (active only)")
    print("-" * 50)

    if not XLSX_PATH.exists():
        print(f"  [SKIP] XLSX not found: {XLSX_PATH}")
        print("  Copy from Downloads: cp ~/Downloads/ma_solid_waste_facilities.xlsx data/")
        return 0, 0, 0, 0, 0

    df_all = pd.read_excel(XLSX_PATH, sheet_name=DATA_SHEET, dtype=str)
    total_rows = len(df_all)
    print(f"  Rows loaded:       {total_rows}")
    df = df_all[df_all["Status"] == "Active"].copy()
    print(f"  Active facilities: {len(df)}")

    records: list[dict] = []
    for _, row in df.iterrows():
        site_name = str_or_none(row.get("SiteName"))
        if not site_name:
            continue
        muni = str_or_none(row.get("Muni"))
        city_raw, _, zip_raw = parse_city_state_zip(row.get("SiteCityStateZip"))
        city      = (muni.title() if muni else city_raw) or city_raw
        class_grp = str_or_none(row.get("ClassGrp"))  or ""
        class_desc = str_or_none(row.get("ClassLastDesc")) or ""
        phone     = clean_phone(row.get("SitePhn")) or clean_phone(row.get("CntPhnWhole"))

        records.append({
            "name":                          site_name.title(),
            "city":                          city,
            "address":                       str_or_none(row.get("SiteStreet")),
            "state":                         "MA",
            "zip":                           str_or_none(zip_raw),
            "phone":                         phone,
            "operator_name":                 str_or_none(row.get("CntOrgName")),
            "permit_number":                 str_or_none(row.get("OldID")),
            "permit_status":                 "active",
            "permitted_capacity_tons_per_day": clean_capacity(row.get("TPD_Max")),
            "facility_type":                 map_facility_type(class_grp, class_desc),
            "service_area_states":           ["MA"],
            "data_source":                   "ma_dep_2025",
            "verified":                      True,
            "active":                        True,
        })

    by_type: dict[str, int] = {}
    for r in records:
        t = r["facility_type"]
        by_type[t] = by_type.get(t, 0) + 1
    for t, n in sorted(by_type.items()):
        print(f"    {t}: {n}")

    skipped, inserted, errors = batch_insert(supabase, records, existing_slugs, slug_counter, "XLSX")
    return total_rows, len(records), skipped, inserted, errors


# -- PDF helpers ---------------------------------------------------------------

def pdf_to_text(pdf_path: Path) -> str:
    """Extract all text from a PDF using pdfplumber."""
    with pdfplumber.open(pdf_path) as pdf:
        pages = len(pdf.pages)
        text  = "\n".join(page.extract_text() or "" for page in pdf.pages)
    print(f"  Pages: {pages}  Characters: {len(text):,}")
    return text


def parse_pdf_table_rows(pdf_path: Path) -> list[list[str]]:
    """
    Try pdfplumber table extraction first; fall back to text lines.
    Returns a list of string-cell rows, skipping header/empty rows.
    """
    rows: list[list[str]] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            if tables:
                for table in tables:
                    for row in table:
                        cells = [str(c or "").strip() for c in row]
                        if any(cells):
                            rows.append(cells)
    return rows


def extract_phone_from_text(text: str) -> str | None:
    m = PHONE_RE.search(text)
    return clean_phone(m.group(0)) if m else None


def extract_zip_from_text(text: str) -> str | None:
    m = ZIP_RE.search(text)
    return m.group(1) if m else None


# -- Source 2: MRF PDF ---------------------------------------------------------

def import_mrfs(
    supabase: Client,
    existing_slugs: set[str],
    slug_counter: dict[str, int],
) -> tuple[int, int, int]:
    """Returns (parsed, skipped, inserted, errors) -- 4-tuple."""
    print(f"\n{'-'*50}")
    print("SOURCE 2: MassDEP MRF / Recycling Facilities PDF")
    print("-" * 50)

    if not MRF_PDF.exists():
        print(f"  [SKIP] PDF not found: {MRF_PDF}")
        print(f"  Download manually from a browser:")
        print(f"  https://www.mass.gov/doc/map-list-of-materials-recoveryrecycling-facilities-mrfs-in-massachusetts/download")
        print(f"  Save as: {MRF_PDF}")
        return 0, 0, 0, 0

    print(f"  Reading: {MRF_PDF}")
    text = pdf_to_text(MRF_PDF)

    # Try table extraction first
    table_rows = parse_pdf_table_rows(MRF_PDF)
    records: list[dict] = []

    if table_rows:
        print(f"  Table rows found: {len(table_rows)}")
        # Detect header row -- skip rows where first cell looks like a column heading
        header_keywords = {"facility", "name", "address", "city", "phone", "operator", "material"}
        for row in table_rows:
            if not row or not row[0]:
                continue
            if row[0].lower().strip() in header_keywords:
                continue
            name = row[0].strip()
            if not name or len(name) < 3:
                continue
            # Best-effort field mapping from table columns
            address = row[1].strip() if len(row) > 1 else None
            city    = row[2].strip() if len(row) > 2 else None
            phone   = clean_phone(row[3]) if len(row) > 3 else None
            if not phone:
                # Try to find phone anywhere in the row
                phone = extract_phone_from_text(" ".join(row))

            records.append({
                "name":                "".join(name.title().splitlines()),
                "facility_type":       "mrf",
                "address":             str_or_none(address),
                "city":                city.title() if city else None,
                "state":               "MA",
                "zip":                 extract_zip_from_text(" ".join(row)),
                "phone":               phone,
                "permit_status":       "active",
                "accepts_recycling":   True,
                "service_area_states": ["MA"],
                "data_source":         "ma_dep_mrf_2026",
                "verified":            True,
                "active":              True,
            })
    else:
        # Text-line fallback: look for lines that start with an uppercase facility name
        print("  No tables found -- using text-line fallback")
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        # Heuristic: a facility name line is mostly uppercase/title-case, >=10 chars,
        # followed by an address line (starts with a digit)
        i = 0
        while i < len(lines):
            line = lines[i]
            if (len(line) >= 5
                    and not line[0].isdigit()
                    and not PHONE_RE.match(line)
                    and re.match(r"[A-Z]", line)):
                name    = line.title()
                address = lines[i + 1] if i + 1 < len(lines) and lines[i+1][0:1].isdigit() else None
                block   = " ".join(lines[i : i + 4])
                phone   = extract_phone_from_text(block)
                zip_val = extract_zip_from_text(block)
                # Try to find city from "CITY, MA XXXXX" pattern
                city = None
                csz_m = CITY_STATE_ZIP_RE.search(block)
                if csz_m:
                    city = csz_m.group(1).title()

                if name and len(name) >= 5:
                    records.append({
                        "name":                name,
                        "facility_type":       "mrf",
                        "address":             str_or_none(address),
                        "city":                city,
                        "state":               "MA",
                        "zip":                 zip_val,
                        "phone":               phone,
                        "permit_status":       "active",
                        "accepts_recycling":   True,
                        "service_area_states": ["MA"],
                        "data_source":         "ma_dep_mrf_2026",
                        "verified":            True,
                        "active":              True,
                    })
            i += 1

    print(f"  Records parsed: {len(records)}")
    skipped, inserted, errors = batch_insert(supabase, records, existing_slugs, slug_counter, "MRF")
    return len(records), skipped, inserted, errors


# -- Source 3: Composting PDF --------------------------------------------------

def import_composting(
    supabase: Client,
    existing_slugs: set[str],
    slug_counter: dict[str, int],
) -> tuple[int, int, int, int]:
    """Returns (parsed, skipped, inserted, errors)."""
    print(f"\n{'-'*50}")
    print("SOURCE 3: MassDEP Sites Accepting Diverted Food Material PDF")
    print("-" * 50)

    if not COMP_PDF.exists():
        print(f"  [SKIP] PDF not found: {COMP_PDF}")
        print(f"  Download manually from a browser:")
        print(f"  https://www.mass.gov/doc/map-list-of-massachusetts-sites-accepting-diverted-food-material/download")
        print(f"  Save as: {COMP_PDF}")
        return 0, 0, 0, 0

    print(f"  Reading: {COMP_PDF}")
    text = pdf_to_text(COMP_PDF)

    table_rows = parse_pdf_table_rows(COMP_PDF)
    records: list[dict] = []

    if table_rows:
        print(f"  Table rows found: {len(table_rows)}")
        header_keywords = {"facility", "name", "address", "city", "phone", "operator", "site", "town"}
        for row in table_rows:
            if not row or not row[0]:
                continue
            if row[0].lower().strip() in header_keywords:
                continue
            name = row[0].strip()
            if not name or len(name) < 3:
                continue
            address = row[1].strip() if len(row) > 1 else None
            city    = row[2].strip() if len(row) > 2 else None
            phone   = clean_phone(row[3]) if len(row) > 3 else None
            if not phone:
                phone = extract_phone_from_text(" ".join(row))

            records.append({
                "name":                "".join(name.title().splitlines()),
                "facility_type":       "composting",
                "address":             str_or_none(address),
                "city":                city.title() if city else None,
                "state":               "MA",
                "zip":                 extract_zip_from_text(" ".join(row)),
                "phone":               phone,
                "permit_status":       "active",
                "accepts_organics":    True,
                "service_area_states": ["MA"],
                "data_source":         "ma_dep_composting_2025",
                "verified":            True,
                "active":              True,
            })
    else:
        print("  No tables found -- using text-line fallback")
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        i = 0
        while i < len(lines):
            line = lines[i]
            if (len(line) >= 5
                    and not line[0].isdigit()
                    and not PHONE_RE.match(line)
                    and re.match(r"[A-Z]", line)):
                name    = line.title()
                address = lines[i + 1] if i + 1 < len(lines) and lines[i+1][0:1].isdigit() else None
                block   = " ".join(lines[i : i + 4])
                phone   = extract_phone_from_text(block)
                zip_val = extract_zip_from_text(block)
                city    = None
                csz_m   = CITY_STATE_ZIP_RE.search(block)
                if csz_m:
                    city = csz_m.group(1).title()

                if name and len(name) >= 5:
                    records.append({
                        "name":                name,
                        "facility_type":       "composting",
                        "address":             str_or_none(address),
                        "city":                city,
                        "state":               "MA",
                        "zip":                 zip_val,
                        "phone":               phone,
                        "permit_status":       "active",
                        "accepts_organics":    True,
                        "service_area_states": ["MA"],
                        "data_source":         "ma_dep_composting_2025",
                        "verified":            True,
                        "active":              True,
                    })
            i += 1

    print(f"  Records parsed: {len(records)}")
    skipped, inserted, errors = batch_insert(supabase, records, existing_slugs, slug_counter, "COMP")
    return len(records), skipped, inserted, errors


# -- Main ----------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("MA DEP Disposal Facilities Importer")
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    # -- Connect to Supabase ---------------------------------------------------
    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("\n[ERR] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # -- Load existing slugs once, shared across all sources -------------------
    print("\n  Loading existing slugs from disposal_facilities...")
    existing_slugs: set[str] = set()
    slug_counter:   dict[str, int] = {}
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

    # -- Run all three sources -------------------------------------------------
    xlsx_total, xlsx_parsed, xlsx_skip, xlsx_ins, xlsx_err = import_active_sites(
        supabase, existing_slugs, slug_counter
    )
    mrf_parsed,  mrf_skip,  mrf_ins,  mrf_err  = import_mrfs(
        supabase, existing_slugs, slug_counter
    )
    comp_parsed, comp_skip, comp_ins, comp_err = import_composting(
        supabase, existing_slugs, slug_counter
    )

    total_errors = xlsx_err + mrf_err + comp_err

    # -- Combined summary ------------------------------------------------------
    print("\n" + "=" * 60)
    print("COMBINED SUMMARY")
    print("=" * 60)
    print(f"  XLSX  -- total rows: {xlsx_total:>4}  active: {xlsx_parsed:>4}  "
          f"skipped: {xlsx_skip:>3}  inserted: {xlsx_ins:>4}  errors: {xlsx_err}")
    print(f"  MRFs  -- parsed:     {mrf_parsed:>4}  "
          f"skipped: {mrf_skip:>3}  inserted: {mrf_ins:>4}  errors: {mrf_err}")
    print(f"  Comp  -- parsed:     {comp_parsed:>4}  "
          f"skipped: {comp_skip:>3}  inserted: {comp_ins:>4}  errors: {comp_err}")
    print(f"  {'-'*50}")
    print(f"  Total inserted:  {xlsx_ins + mrf_ins + comp_ins}")
    print(f"  Total errors:    {total_errors}")

    if total_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
