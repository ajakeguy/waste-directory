#!/usr/bin/env python3
"""
pipelines/ny-dec-364-import/index.py

Imports New York State Part 364/381 waste transporter permit holders from
the official NYS DEC Excel file (updated annually).

Source file: pipelines/ny-dec-364-import/data/ny_part364_transporters.xlsm
  Sheet 1: "Part 364-381 Permittees"  — ~2,397 rows
  Sheet 2: "Part 364 Registrants"     — ~974 rows
  Columns: Permit Number, Transporter Name, Location Address,
           Location Address2, City, State, Zip Code, County,
           Contact Name, Contact Phone, Expiration Date,
           Authorized Waste Types

Dedup: Sheet 1 takes priority; Sheet 2 rows whose permit number already
       appears in Sheet 1 are dropped.
Skip:  Records with Expiration Date before today.

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os
import re
import sys
from datetime import date, datetime

import pandas as pd
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATA_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
FILE_PATH = os.path.join(DATA_DIR, "ny_part364_transporters.xlsm")

DATA_SOURCE         = "ny_dec_part364_2026"
STATE               = "NY"
SERVICE_AREA_STATES = ["NY"]
TODAY               = date.today()
SAFE_MAX            = 3500
BATCH_SIZE          = 50

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", "-", text.strip())
    return text[:100]


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())


def clean_phone(raw) -> str | None:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    # Handle scientific notation (e.g. 6.318e9 stored as float)
    try:
        digits = re.sub(r"\D", "", str(int(float(raw))))
    except (ValueError, TypeError):
        digits = re.sub(r"\D", "", str(raw))
    if len(digits) == 10:
        return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"
    if len(digits) == 11 and digits[0] == "1":
        return f"({digits[1:4]}) {digits[4:7]}-{digits[7:11]}"
    return str(raw).strip() or None


def clean_zip(raw) -> str | None:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip()
    # Remove trailing .0 from float representation
    s = re.sub(r"\.0+$", "", s)
    # Zero-pad to 5 digits if purely numeric
    if re.match(r"^\d{1,5}$", s):
        return s.zfill(5)
    return s or None


def clean_name(raw: str) -> str:
    """Title-case and replace semicolons with commas in company names."""
    name = str(raw).strip()
    name = name.replace(";", ",")
    name = re.sub(r"\s{2,}", " ", name)
    return name.title()


def parse_expiry(raw) -> date | None:
    """Return a date object or None. Accepts datetime, date, or string."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    if isinstance(raw, (datetime, date)):
        return raw.date() if isinstance(raw, datetime) else raw
    s = str(raw).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def map_service_types(waste_types_raw: str) -> list[str]:
    """
    Map NYS Authorized Waste Types (semicolon-delimited) to valid
    service_types enum values.
    """
    if not waste_types_raw or pd.isna(waste_types_raw):
        return ["commercial"]

    text  = str(waste_types_raw).lower()
    types: list[str] = []

    if ("solid waste" in text or "municipal" in text or "msw" in text
            or "residential" in text or "household" in text
            or "septage" in text or "sewage" in text):
        types.append("residential")
    if ("commercial" in text or "industrial" in text
            or "non-hazardous" in text or "grease" in text):
        if "commercial" not in types:
            types.append("commercial")
    if "construction" in text or "demolition" in text or "c&d" in text or " cd " in text:
        types.append("roll_off")
    if "recycl" in text or "universal waste" in text:
        types.append("recycling")
    if ("hazardous" in text or "waste oil" in text or "petroleum" in text
            or "asbestos" in text or "infectious" in text or "biomedical" in text):
        types.append("hazmat")
    if "medical" in text or "regulated medical" in text:
        if "medical" not in types:
            types.append("medical")
    if "compost" in text or "organic" in text or "food" in text:
        types.append("composting")

    if not types:
        types = ["commercial"]
    return types


# ---------------------------------------------------------------------------
# Load and merge both sheets
# ---------------------------------------------------------------------------

def load_ny_transporters() -> pd.DataFrame:
    if not os.path.exists(FILE_PATH):
        print(f"[ERR] File not found: {FILE_PATH}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading {FILE_PATH} ...")
    df1 = pd.read_excel(FILE_PATH, sheet_name="Part 364-381 Permittees", engine="openpyxl")
    df2 = pd.read_excel(FILE_PATH, sheet_name="Part 364 Registrants",    engine="openpyxl")

    print(f"  Sheet 1 (Permittees):  {len(df1):,} rows")
    print(f"  Sheet 2 (Registrants): {len(df2):,} rows")

    # Fix Sheet 2 column name typo
    df2 = df2.rename(columns={"Contact Nmae": "Contact Name"})

    # Normalise permit numbers to string for dedup
    df1["Permit Number"] = df1["Permit Number"].astype(str).str.strip()
    df2["Permit Number"] = df2["Permit Number"].astype(str).str.strip()

    # Sheet 1 takes priority — drop Sheet 2 rows already in Sheet 1
    s1_permits = set(df1["Permit Number"].dropna())
    df2_new    = df2[~df2["Permit Number"].isin(s1_permits)]
    print(f"  Sheet 2 rows after dedup: {len(df2_new):,} (removed {len(df2) - len(df2_new):,} duplicates)")

    combined = pd.concat([df1, df2_new], ignore_index=True)
    print(f"  Combined total: {len(combined):,} rows")
    return combined


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("NY DEC Part 364 Hauler Importer")
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"Skipping records expired before: {TODAY}")
    print("=" * 60)

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("[ERR] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # -- Load and combine sheets ----------------------------------------------
    df = load_ny_transporters()

    # -- Map rows to records --------------------------------------------------
    records: list[dict] = []
    skipped_expired   = 0
    skipped_no_name   = 0

    for _, row in df.iterrows():
        name_raw = str(row.get("Transporter Name") or "").strip()
        if not name_raw:
            skipped_no_name += 1
            continue

        expiry = parse_expiry(row.get("Expiration Date"))
        if expiry and expiry < TODAY:
            skipped_expired += 1
            continue

        name   = clean_name(name_raw)
        addr1  = str(row.get("Location Address")  or "").strip()
        addr2  = str(row.get("Location Address2") or "").strip()
        address = " ".join(filter(None, [addr1, addr2])).strip() or None

        city   = str(row.get("City")    or "").strip().title() or None
        state  = str(row.get("State")   or STATE).strip().upper()[:2] or STATE
        county = str(row.get("County")  or "").strip().title() or None
        zip_   = clean_zip(row.get("Zip Code"))
        phone  = clean_phone(row.get("Contact Phone"))
        permit = str(row.get("Permit Number") or "").strip() or None

        contact_raw   = str(row.get("Contact Name") or "").strip()
        # "FIRST LAST / FIRST LAST" — take first contact as primary
        primary_contact = contact_raw.split(" / ")[0].strip().title() or None

        waste_types_raw = str(row.get("Authorized Waste Types") or "")
        service_types   = map_service_types(waste_types_raw)

        records.append({
            "name":    name,
            "address": address,
            "city":    city,
            "state":   state,
            "zip":     zip_,
            "county":  county,
            "phone":   phone,
            "service_types":      service_types,
            "license_metadata": {
                "ny_permit_number":        permit,
                "ny_expiration_date":      expiry.isoformat() if expiry else None,
                "ny_authorized_waste_types": waste_types_raw,
                "ny_contact_name":         primary_contact,
                "ny_county":               county,
                "ny_contact_phone":        phone,
            },
        })

    print(f"\nMapped records:    {len(records):,}")
    print(f"Skipped (expired): {skipped_expired:,}")
    print(f"Skipped (no name): {skipped_no_name:,}")

    if len(records) > SAFE_MAX:
        print(f"[ERR] SAFE_MAX exceeded ({len(records)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # -- Load existing slugs for dedup ----------------------------------------
    print("\nLoading existing slugs ...")
    existing_slugs: set[str] = set()
    offset = 0
    while True:
        resp  = supabase.table("organizations").select("slug").range(offset, offset + 999).execute()
        batch = resp.data or []
        for r in batch:
            existing_slugs.add(r["slug"])
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"Existing organizations in DB: {len(existing_slugs)}")

    # -- Build insert list -----------------------------------------------------
    slug_counter: dict[str, int] = {}
    to_insert: list[dict] = []
    skipped_slug = 0

    for rec in records:
        base_slug = make_slug(rec["name"], rec.get("city") or "")
        if not base_slug:
            continue
        if base_slug in existing_slugs:
            skipped_slug += 1
            continue
        n    = slug_counter.get(base_slug, 0)
        slug = base_slug if n == 0 else f"{base_slug}-{n}"
        while slug in existing_slugs:
            n += 1
            slug = f"{base_slug}-{n}"
        slug_counter[base_slug] = n + 1
        existing_slugs.add(slug)

        to_insert.append({
            "slug":               slug,
            "name":               rec["name"],
            "org_type":           "hauler",
            "address":            rec["address"],
            "city":               rec["city"],
            "state":              rec["state"],
            "zip":                rec["zip"],
            "county":             rec["county"],
            "phone":              rec["phone"],
            "service_types":      rec["service_types"],
            "service_area_states": SERVICE_AREA_STATES,
            "license_metadata":   rec["license_metadata"],
            "data_source":        DATA_SOURCE,
            "verified":           True,
            "active":             True,
        })

    print(f"\nAlready in DB (slug match, skipped): {skipped_slug}")
    print(f"To insert: {len(to_insert)}")

    # -- Insert ----------------------------------------------------------------
    inserted = 0
    errors   = 0
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch     = to_insert[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            supabase.table("organizations").insert(batch).execute()
            inserted += len(batch)
            print(f"  [OK] Batch {batch_num}: inserted {len(batch)}")
        except Exception as exc:
            print(f"  [ERR] Batch {batch_num}: {exc}")
            errors += 1

    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Combined rows:     {len(df):,}")
    print(f"  Skipped expired:   {skipped_expired:,}")
    print(f"  Skipped no name:   {skipped_no_name:,}")
    print(f"  Mapped:            {len(records):,}")
    print(f"  Skipped (slug):    {skipped_slug:,}")
    print(f"  Inserted:          {inserted:,}")
    print(f"  Errors:            {errors:,}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
