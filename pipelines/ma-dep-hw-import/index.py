#!/usr/bin/env python3
"""
pipelines/ma-dep-hw-import/index.py

Imports MassDEP Licensed Hazardous Waste Transporter records.

Source PDF (updated periodically, must be placed manually):
  pipelines/ma-dep-hw-import/data/ma_hw_transporters.pdf

  Download from:
  https://www.mass.gov/doc/massdep-licensed-hazardous-waste-transporter-list-0/download

  mass.gov blocks automated downloads (403). Download manually in a browser
  and save as: pipelines/ma-dep-hw-import/data/ma_hw_transporters.pdf

PDF text format — each record starts with a license number:
  HW05-MA-XXXX  COMPANY NAME  MM/DD/YYYY  (NNN) NNN-NNNN  ADDRESS  CITY  ST  ZIP  EPA#

Records are split on the HW05-MA-\\d+ pattern, then parsed field-by-field.

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import io
import os
import re
import sys
from datetime import datetime, date
from pathlib import Path

import pdfplumber
from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

PDF_PATH    = Path(__file__).parent / "data" / "ma_hw_transporters.pdf"
DATA_SOURCE = "ma_dep_hazardous_waste_2025"
SAFE_MAX    = 300
BATCH_SIZE  = 50

# License number pattern: HW05-MA-NNNN
LICENSE_RE = re.compile(r"HW05-MA-\d+")

# Date pattern: MM/DD/YYYY
DATE_RE    = re.compile(r"\b(\d{1,2}/\d{1,2}/\d{4})\b")

# Phone pattern: (NNN) NNN-NNNN or NNN-NNN-NNNN or NNN.NNN.NNNN
PHONE_RE   = re.compile(r"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}")

# ZIP: 5-digit (optionally followed by -NNNN)
ZIP_RE     = re.compile(r"\b(\d{5})(?:-\d{4})?\b")

# State abbreviation before ZIP
STATE_ADDR_RE = re.compile(r"\b([A-Z]{2})\s+\d{5}")

# EPA ID: pattern like MAD000123456 or similar
EPA_RE     = re.compile(r"\b[A-Z]{3}\d{6,}\b")


# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())[:80]


def str_or_none(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return None if s.lower() in {"nan", "none", ""} else s


def clean_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"[^\d]", "", raw)
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    if len(digits) == 11 and digits[0] == "1":
        d = digits[1:]
        return f"({d[:3]}) {d[3:6]}-{d[6:]}"
    return raw.strip() or None


def clean_zip(raw: str | None) -> str | None:
    if not raw:
        return None
    m = ZIP_RE.search(raw)
    return m.group(1) if m else None


def parse_expiry(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return datetime.strptime(raw.strip(), "%m/%d/%Y").date()
    except ValueError:
        return None


def is_active(expiry: date | None) -> bool:
    """
    Skip only licenses that expired before 2024.
    Allows recent expirations (administrative lag) through.
    """
    if expiry is None:
        return True
    return expiry.year >= 2024


# ── Read PDF from disk ────────────────────────────────────────────────────────

def load_pdf() -> bytes:
    if not PDF_PATH.exists():
        print(f"[ERR] PDF not found at {PDF_PATH}")
        print("  Download it manually from a browser and save it to that path:")
        print("  https://www.mass.gov/doc/massdep-licensed-hazardous-waste-transporter-list-0/download")
        sys.exit(1)

    print(f"  Reading PDF from disk: {PDF_PATH}")
    with open(PDF_PATH, "rb") as f:
        pdf_bytes = f.read()
    print(f"  File size: {len(pdf_bytes):,} bytes")
    return pdf_bytes


# ── Extract text from PDF ─────────────────────────────────────────────────────

def extract_text(pdf_bytes: bytes) -> str:
    """Extract all text from all pages, joined with newlines."""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"  PDF pages: {len(pdf.pages)}")
        full_text = "\n".join(
            page.extract_text() or ""
            for page in pdf.pages
        )
    print(f"  Total text characters: {len(full_text):,}")
    return full_text


# ── Parse records ─────────────────────────────────────────────────────────────

def parse_records(full_text: str) -> list[dict]:
    """
    Split on each HW05-MA-\\d+ occurrence (look-ahead so the delimiter is
    kept as the start of each chunk), then parse each chunk into a record dict.
    """
    # Normalise whitespace but preserve enough structure to parse
    chunks = re.split(r"(?=HW05-MA-\d+)", full_text)
    chunks = [c.strip() for c in chunks if c.strip()]
    print(f"\n  Raw chunks (license blocks): {len(chunks)}")

    records: list[dict] = []

    for chunk in chunks:
        if not LICENSE_RE.match(chunk):
            continue  # header/footer noise

        # ── License number ────────────────────────────────────────────────────
        lic_m = LICENSE_RE.match(chunk)
        license_number = lic_m.group(0)
        remainder = chunk[lic_m.end():].strip()

        # ── Expiration date ───────────────────────────────────────────────────
        date_m = DATE_RE.search(remainder)
        expiry_str = date_m.group(1) if date_m else None
        if date_m:
            remainder = remainder[:date_m.start()] + remainder[date_m.end():]

        # ── Phone ─────────────────────────────────────────────────────────────
        phone_m = PHONE_RE.search(remainder)
        phone_raw = phone_m.group(0) if phone_m else None
        if phone_m:
            remainder = remainder[:phone_m.start()] + remainder[phone_m.end():]

        # ── EPA number ────────────────────────────────────────────────────────
        epa_m = EPA_RE.search(remainder)
        epa_number = epa_m.group(0) if epa_m else None
        if epa_m:
            remainder = remainder[:epa_m.start()] + remainder[epa_m.end():]

        # ── ZIP & state from address block ────────────────────────────────────
        zip_m  = ZIP_RE.search(remainder)
        zip_code = zip_m.group(1) if zip_m else None

        state_m = STATE_ADDR_RE.search(remainder)
        state   = state_m.group(1) if state_m else None

        # ── Clean up remainder to get name + address fragments ────────────────
        # Remove extracted fields' surrounding noise
        remainder = re.sub(r"\s+", " ", remainder).strip()

        # Heuristic: the company name is the first "word group" before an
        # address indicator (digit-led street, PO Box) or state/zip.
        # Try splitting on address boundary first.
        addr_start = re.search(
            r"(?:^|\s)(\d+\s+[A-Z]|P\.?O\.?\s*BOX|\d{5})",
            remainder, re.IGNORECASE
        )

        if addr_start:
            name_raw    = remainder[:addr_start.start()].strip()
            address_raw = remainder[addr_start.start():].strip()
        else:
            # Fall back: split on double-space or newline
            parts = re.split(r"\s{2,}|\n", remainder)
            name_raw    = parts[0].strip() if parts else remainder.strip()
            address_raw = " ".join(parts[1:]).strip() if len(parts) > 1 else ""

        name = name_raw.title().strip()
        if not name or len(name) < 2:
            continue

        # City: text before "STATE ZIP" pattern at end of address block
        city = None
        if address_raw:
            city_m = re.search(r"([A-Za-z\s]+)\s+[A-Z]{2}\s+\d{5}", address_raw)
            if city_m:
                city_parts = city_m.group(1).strip().split()
                city = " ".join(city_parts[-3:]).title() if city_parts else None

        # Street: everything before the city/state/zip
        street = None
        if address_raw and city:
            idx = address_raw.upper().find(city.upper())
            street = address_raw[:idx].strip() if idx > 0 else address_raw.strip()
        elif address_raw:
            street = address_raw.strip()

        expiry_date = parse_expiry(expiry_str)

        records.append({
            "license_number": license_number,
            "name":           name,
            "expiry_str":     expiry_str,
            "expiry_date":    expiry_date,
            "phone":          clean_phone(phone_raw),
            "address":        str_or_none(street),
            "city":           city,
            "state":          state,
            "zip":            zip_code,
            "epa_number":     epa_number,
        })

    print(f"  Records parsed: {len(records)}")
    return records


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("MA DEP Hazardous Waste Transporter Importer")
    print(f"Run date: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    # ── Load PDF from disk ────────────────────────────────────────────────────
    pdf_bytes = load_pdf()
    full_text = extract_text(pdf_bytes)
    parsed    = parse_records(full_text)

    if not parsed:
        print("\n[ERR] No records parsed — check PDF format.")
        print("First 500 chars of text:")
        print(full_text[:500])
        sys.exit(1)

    # ── Filter expired ────────────────────────────────────────────────────────
    active_records   = [r for r in parsed if is_active(r["expiry_date"])]
    skipped_expired  = len(parsed) - len(active_records)
    print(f"\n  Active licenses (>= 2024): {len(active_records)}")
    print(f"  Skipped (expired pre-2024): {skipped_expired}")

    if len(active_records) > SAFE_MAX:
        print(f"\n[ERR] SAFE_MAX exceeded ({len(active_records)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # ── Connect to Supabase ───────────────────────────────────────────────────
    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("\n[ERR] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # ── Load existing slugs ───────────────────────────────────────────────────
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

    # ── Build insert list ─────────────────────────────────────────────────────
    to_insert:    list[dict]     = []
    already_in:   int            = 0
    slug_counter: dict[str, int] = {}

    for rec in active_records:
        base_slug = make_slug(rec["name"], rec.get("city") or "")
        if not base_slug:
            continue
        if base_slug in existing_slugs:
            already_in += 1
            continue
        n    = slug_counter.get(base_slug, 0)
        slug = base_slug if n == 0 else f"{base_slug}-{n}"
        slug_counter[base_slug] = n + 1
        existing_slugs.add(slug)

        license_metadata: dict[str, str] = {}
        if rec["license_number"]:
            license_metadata["ma_hw_license"]    = rec["license_number"]
        if rec["expiry_str"]:
            license_metadata["ma_hw_expiration"] = rec["expiry_str"]
        if rec["epa_number"]:
            license_metadata["ma_hw_epa_number"] = rec["epa_number"]

        to_insert.append({
            "slug":                slug,
            "name":                rec["name"],
            "address":             rec["address"],
            "city":                rec["city"],
            "state":               rec["state"] or "MA",
            "zip":                 rec["zip"],
            "phone":               rec["phone"],
            "org_type":            "hauler",
            "service_types":       ["hazardous_waste"],
            "service_area_states": ["MA"],
            "license_metadata":    license_metadata,
            "data_source":         DATA_SOURCE,
            "verified":            True,
            "active":              True,
        })

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
            print(f"  [OK] Batch {batch_num}: inserted {len(batch)} records")
        except Exception as exc:
            print(f"  [ERR] Batch {batch_num} failed: {exc}")
            errors += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Records parsed:             {len(parsed)}")
    print(f"  Active licenses:            {len(active_records)}")
    print(f"  Skipped (expired pre-2024): {skipped_expired}")
    print(f"  Already in DB:              {already_in}")
    print(f"  Inserted:                   {inserted}")
    print(f"  Errors:                     {errors}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
