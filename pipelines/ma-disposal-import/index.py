#!/usr/bin/env python3
"""
pipelines/ma-disposal-import/index.py

Imports MA DEP Solid Waste Facility Master List into the disposal_facilities table.

Source:
  pipelines/ma-disposal-import/data/ma_solid_waste_facilities.xlsx
  (Download from MassDEP Solid Waste Management Program — Master Facility List)

The XLSX has a single data sheet: AllSites
Includes landfills, transfer stations, composting, combustion, and C&D facilities.

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os
import re
import sys
from pathlib import Path

import pandas as pd
from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

XLSX_PATH   = Path(__file__).parent / "data" / "ma_solid_waste_facilities.xlsx"
DATA_SHEET  = "AllSites"
DATA_SOURCE = "ma_dep_2025"
SAFE_MAX    = 2000
BATCH_SIZE  = 50

CITY_STATE_ZIP_RE = re.compile(r"^(.+),\s+([A-Z]{2})\s+(\d{5})")

# ── Facility type mapping ─────────────────────────────────────────────────────

def map_facility_type(class_grp: str, class_desc: str) -> str:
    grp  = (class_grp  or "").strip()
    desc = (class_desc or "").lower()

    if grp == "Combustion":
        return "waste_to_energy"
    if grp == "Land Disposal":
        return "landfill"
    # Handling/Transfer — disambiguate by description
    if "compost" in desc:
        return "composting"
    if "c&d" in desc:
        return "cd_facility"
    return "transfer_station"


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
    """Parse 'CITY, MA  02351' into (city, state, zip)."""
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


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    from datetime import datetime
    print("=" * 60)
    print("MA DEP Solid Waste Facilities Importer")
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    if not XLSX_PATH.exists():
        print(f"[ERR] XLSX not found at {XLSX_PATH}")
        print("  Copy it from Downloads:")
        print("  cp ~/Downloads/ma_solid_waste_facilities.xlsx pipelines/ma-disposal-import/data/")
        sys.exit(1)

    print(f"\n  Reading XLSX: {XLSX_PATH}")
    df = pd.read_excel(XLSX_PATH, sheet_name=DATA_SHEET, dtype=str)
    print(f"  Rows loaded:  {len(df)}")

    # Only import active facilities — closed/inactive are excluded
    df = df[df["Status"] == "Active"].copy()
    print(f"  Active facilities: {len(df)}")

    # ── Build records ─────────────────────────────────────────────────────────
    records = []
    for _, row in df.iterrows():
        site_name = str_or_none(row.get("SiteName"))
        if not site_name:
            continue

        muni = str_or_none(row.get("Muni"))
        city_raw, _, zip_raw = parse_city_state_zip(row.get("SiteCityStateZip"))
        city = (muni.title() if muni else city_raw) or city_raw

        # All rows in df are Active (filtered above)
        is_active = True
        perm_stat = "active"

        class_grp  = str_or_none(row.get("ClassGrp"))  or ""
        class_desc = str_or_none(row.get("ClassLastDesc")) or ""
        fac_type   = map_facility_type(class_grp, class_desc)

        phone = clean_phone(row.get("SitePhn")) or clean_phone(row.get("CntPhnWhole"))

        records.append({
            "name":                         site_name.title(),
            "city":                         city,
            "address":                      str_or_none(row.get("SiteStreet")),
            "state":                        "MA",
            "zip":                          str_or_none(zip_raw) or str_or_none(row.get("SiteCityStateZip")),
            "phone":                        phone,
            "operator_name":                str_or_none(row.get("CntOrgName")),
            "permit_number":                str_or_none(row.get("OldID")),
            "permit_status":                perm_stat,
            "permitted_capacity_tons_per_day": clean_capacity(row.get("TPD_Max")),
            "facility_type":                fac_type,
            "class_desc":                   class_desc,
            "is_active":                    is_active,
        })

    print(f"  Records built: {len(records)}")

    by_type = {}
    for r in records:
        t = r["facility_type"]
        by_type[t] = by_type.get(t, 0) + 1
    for t, n in sorted(by_type.items()):
        print(f"    {t}: {n}")

    print(f"  (Closed/inactive sites excluded from import)")

    if len(records) > SAFE_MAX:
        print(f"\n[ERR] SAFE_MAX exceeded ({len(records)} > {SAFE_MAX}). Aborting.")
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

        to_insert.append({
            "slug":                          slug,
            "name":                          rec["name"],
            "facility_type":                 rec["facility_type"],
            "address":                       rec["address"],
            "city":                          rec["city"],
            "state":                         rec["state"],
            "zip":                           rec["zip"],
            "phone":                         rec["phone"],
            "operator_name":                 rec["operator_name"],
            "permit_number":                 rec["permit_number"],
            "permit_status":                 rec["permit_status"],
            "permitted_capacity_tons_per_day": rec["permitted_capacity_tons_per_day"],
            "service_area_states":           ["MA"],
            "data_source":                   DATA_SOURCE,
            "verified":                      True,
            "active":                        rec["is_active"],
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
    print(f"  Total rows in XLSX:    1396")
    print(f"  Active records:        {len(records)}")
    print(f"  Already in DB:         {skipped}")
    print(f"  Inserted:              {inserted}")
    print(f"  Errors:                {errors}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
