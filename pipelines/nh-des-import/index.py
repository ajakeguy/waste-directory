#!/usr/bin/env python3
"""
pipelines/nh-des-import/index.py

Imports NH DES registered solid waste haulers from a CSV file provided
directly by NH DES. Place the CSV at:
    pipelines/nh-des-import/data/nh_haulers.csv

Column layout (col index 5 has no header — it's the street ZIP):
  0  date_registered
  1  company_name
  2  street_address
  3  street_city
  4  street_state
  5  street_zip    ← no header
  6  mailing_address
  7  mailing_city
  8  mailing_state
  9  mailing_zip
  10 hauler_phone
  11 contact_name
  12 contact_email
  13 contact_telephone
  14 company_website

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os
import re
import sys
from pathlib import Path
from datetime import datetime

import pandas as pd
from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

DATA_SOURCE = "nh_des_2025"
SAFE_MAX    = 500
BATCH_SIZE  = 50

HERE     = Path(__file__).parent
CSV_PATH = HERE / "data" / "nh_haulers.csv"

# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())[:80]


def str_or_none(val) -> str | None:
    """Return stripped string or None for blank/nan values."""
    if val is None:
        return None
    s = str(val).strip()
    return None if s.lower() in {"nan", "none", ""} else s


def clean_zip(raw) -> str | None:
    """Normalize to 5-digit ZIP, stripping ZIP+4 extensions."""
    s = str_or_none(raw)
    if not s:
        return None
    digits = re.sub(r"[^\d]", "", s)
    return digits[:5] if len(digits) >= 5 else (digits or None)


def clean_phone(raw) -> str | None:
    """Normalize to (NNN) NNN-NNNN format."""
    s = str_or_none(raw)
    if not s:
        return None
    digits = re.sub(r"[^\d]", "", s)
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    if len(digits) == 11 and digits[0] == "1":
        d = digits[1:]
        return f"({d[:3]}) {d[3:6]}-{d[6:]}"
    return s  # return as-is if we can't normalise


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("NH DES Solid Waste Hauler CSV Importer")
    print(f"Run date: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    # ── Load CSV ─────────────────────────────────────────────────────────────

    if not CSV_PATH.exists():
        print(f"\n✗ CSV not found: {CSV_PATH}", file=sys.stderr)
        print("  Place the NH DES hauler CSV at that path and rerun.")
        sys.exit(1)

    df = pd.read_csv(CSV_PATH, header=0, dtype=str)

    # Column 5 has no header — rename it positionally
    cols = list(df.columns)
    cols[5] = "street_zip"
    df.columns = cols

    total_rows = len(df)
    print(f"\n  Rows in file: {total_rows}")

    # ── Map rows to org records ───────────────────────────────────────────────

    records: list[dict] = []
    skipped_blank = 0

    for _, row in df.iterrows():
        company_name = str_or_none(row.get("company_name"))
        if not company_name:
            skipped_blank += 1
            continue

        # Name: title-case
        name = company_name.title()

        # Address fields: prefer street, fall back to mailing
        address = str_or_none(row.get("street_address")) or str_or_none(row.get("mailing_address"))
        city    = str_or_none(row.get("street_city"))    or str_or_none(row.get("mailing_city"))
        state   = str_or_none(row.get("street_state"))   or str_or_none(row.get("mailing_state")) or "NH"
        if state:
            state = state.strip().upper()

        raw_zip  = str_or_none(row.get("street_zip")) or str_or_none(row.get("mailing_zip"))
        zip_code = clean_zip(raw_zip)

        raw_phone = str_or_none(row.get("hauler_phone")) or str_or_none(row.get("contact_telephone"))
        phone = clean_phone(raw_phone)

        # License metadata
        license_metadata: dict[str, str] = {}
        date_reg = str_or_none(row.get("date_registered"))
        if date_reg:
            license_metadata["nh_date_registered"] = date_reg
        contact_name = str_or_none(row.get("contact_name"))
        if contact_name:
            license_metadata["nh_contact_name"] = contact_name
        contact_email = str_or_none(row.get("contact_email"))
        if contact_email:
            license_metadata["nh_contact_email"] = contact_email
        website = str_or_none(row.get("company_website"))
        if website:
            license_metadata["nh_website"] = website

        records.append({
            "name":                name,
            "address":             address,
            "city":                city,
            "state":               state,
            "zip":                 zip_code,
            "phone":               phone,
            "org_type":            "hauler",
            "service_types":       ["residential", "commercial"],
            "service_area_states": ["NH"],
            "license_metadata":    license_metadata,
            "data_source":         DATA_SOURCE,
            "verified":            True,
            "active":              True,
        })

    print(f"  Skipped (blank name): {skipped_blank}")
    print(f"  Records to process:   {len(records)}")

    if len(records) > SAFE_MAX:
        print(f"\n✗ SAFE_MAX exceeded ({len(records)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # ── Connect to Supabase ───────────────────────────────────────────────────

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("\n✗ Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # ── Load existing slugs for dedup ─────────────────────────────────────────

    print("\n  Loading existing slugs from DB...")
    existing_slugs: set[str] = set()
    page_size = 1000
    offset    = 0
    while True:
        resp = (
            supabase.table("organizations")
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
    print(f"  Existing orgs in DB: {len(existing_slugs)}")

    # ── Classify: skip slug matches, queue the rest for insert ───────────────

    to_insert:    list[dict]     = []
    already_in:   int            = 0
    slug_counter: dict[str, int] = {}

    for rec in records:
        base_slug = make_slug(rec["name"], rec.get("city") or "")
        if not base_slug:
            skipped_blank += 1
            continue

        if base_slug in existing_slugs:
            already_in += 1
            continue

        # Ensure batch-level uniqueness
        n    = slug_counter.get(base_slug, 0)
        slug = base_slug if n == 0 else f"{base_slug}-{n}"
        slug_counter[base_slug] = n + 1
        existing_slugs.add(slug)

        rec["slug"] = slug
        to_insert.append(rec)

    print(f"  Already in DB:  {already_in}")
    print(f"  To insert:      {len(to_insert)}")

    # ── Batch insert ──────────────────────────────────────────────────────────

    inserted = 0
    errors   = 0

    for i in range(0, len(to_insert), BATCH_SIZE):
        batch     = to_insert[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            supabase.table("organizations").insert(batch).execute()
            inserted += len(batch)
            print(f"  ✓ Batch {batch_num}: inserted {len(batch)} records")
        except Exception as exc:
            print(f"  ✗ Batch {batch_num} failed: {exc}")
            errors += 1

    # ── Summary ───────────────────────────────────────────────────────────────

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Rows in file:         {total_rows}")
    print(f"  Skipped (blank name): {skipped_blank}")
    print(f"  Already in DB:        {already_in}")
    print(f"  Inserted:             {inserted}")
    print(f"  Errors:               {errors}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
