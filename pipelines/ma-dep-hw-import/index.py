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

Records are split on the HW05-MA-\\d+ pattern. The company name is extracted
as everything between the license number and the first MM/DD/YYYY date.

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

# Name is everything between the license number and the first date (MM/DD/YYYY).
# The date anchors the end of the name — the PDF format is always:
#   LICENSE  NAME  DATE  PHONE  ADDRESS  STATE  ZIP  EPA#
NAME_DATE_RE = re.compile(
    r"^([A-Z][A-Z0-9\s\&\.\,\-\/\(\)]+?)\s+(\d{1,2}/\d{1,2}/\d{4})"
)

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

# Acronyms to keep uppercase after title-casing
_ACRONYMS = {"LLC", "INC", "LTD", "DBA", "NE", "NW", "SE", "SW", "USA", "US", "EPA"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def title_case(s: str) -> str:
    """Title-case a string, preserving common business acronyms."""
    words = s.strip().title().split()
    result = []
    for w in words:
        result.append(w.upper() if w.upper() in _ACRONYMS else w)
    return " ".join(result)


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

    Name is extracted as everything between the license number and the first
    MM/DD/YYYY date — this cleanly avoids address text bleeding into the name.
    """
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

        # ── Name: everything before the first date ────────────────────────────
        # The PDF format is: LICENSE  NAME  DATE  PHONE  ADDRESS  ZIP  EPA#
        # Using the date as an anchor gives a clean name boundary.
        nd_m = NAME_DATE_RE.match(remainder)
        if nd_m:
            name_raw   = nd_m.group(1).strip()
            expiry_str = nd_m.group(2)
            # Advance past the name+date
            remainder  = remainder[nd_m.end():].strip()
        else:
            # Fallback: try the date-only extraction used previously
            name_raw   = ""
            date_m     = DATE_RE.search(remainder)
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
        zip_m    = ZIP_RE.search(remainder)
        zip_code = zip_m.group(1) if zip_m else None

        state_m = STATE_ADDR_RE.search(remainder)
        state   = state_m.group(1) if state_m else None

        # ── If name wasn't captured by date-anchor, fall back to address split ─
        remainder = re.sub(r"\s+", " ", remainder).strip()
        if not name_raw:
            addr_start = re.search(
                r"(?:^|\s)(\d+\s+[A-Z]|P\.?O\.?\s*BOX|\d{5})",
                remainder, re.IGNORECASE
            )
            if addr_start:
                name_raw    = remainder[:addr_start.start()].strip()
                address_raw = remainder[addr_start.start():].strip()
            else:
                parts       = re.split(r"\s{2,}|\n", remainder)
                name_raw    = parts[0].strip() if parts else remainder.strip()
                address_raw = " ".join(parts[1:]).strip() if len(parts) > 1 else ""
        else:
            address_raw = remainder

        name = title_case(name_raw)
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
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}")
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
    active_records  = [r for r in parsed if is_active(r["expiry_date"])]
    skipped_expired = len(parsed) - len(active_records)
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

    # ── Process each active record: upsert ───────────────────────────────────
    print("\n  Processing records (upsert)...")

    inserted      = 0
    updated       = 0
    errors        = 0
    slug_counter: dict[str, int] = {}

    # Track slugs assigned this run to avoid intra-run collisions on inserts
    assigned_slugs: set[str] = set()

    for rec in active_records:
        base_slug = make_slug(rec["name"], rec.get("city") or "")
        if not base_slug:
            continue

        # ── Build license metadata for this record ────────────────────────────
        license_metadata: dict[str, str] = {}
        if rec["license_number"]:
            license_metadata["ma_hw_license"]    = rec["license_number"]
        if rec["expiry_str"]:
            license_metadata["ma_hw_expiration"] = rec["expiry_str"]
        if rec["epa_number"]:
            license_metadata["ma_hw_epa_number"] = rec["epa_number"]

        # ── Look up existing record by slug ───────────────────────────────────
        try:
            existing = (
                supabase.table("organizations")
                .select("id,service_area_states,service_types,license_metadata")
                .eq("slug", base_slug)
                .execute()
            )
        except Exception as exc:
            print(f"  [ERR] Lookup failed for {base_slug}: {exc}")
            errors += 1
            continue

        if existing.data:
            # ── UPDATE existing record ────────────────────────────────────────
            row   = existing.data[0]
            areas = list(row.get("service_area_states") or [])
            types = list(row.get("service_types") or [])
            meta  = dict(row.get("license_metadata") or {})

            if "MA" not in areas:
                areas.append("MA")
            if "hazardous_waste" not in types:
                types.append("hazardous_waste")
            meta.update(license_metadata)

            try:
                supabase.table("organizations").update({
                    "service_area_states": areas,
                    "service_types":       types,
                    "license_metadata":    meta,
                }).eq("id", row["id"]).execute()
                updated += 1
            except Exception as exc:
                print(f"  [ERR] Update failed for {base_slug}: {exc}")
                errors += 1

        else:
            # ── INSERT new record ─────────────────────────────────────────────
            n    = slug_counter.get(base_slug, 0)
            slug = base_slug if n == 0 else f"{base_slug}-{n}"
            # Increment until we find a slug not used this run
            while slug in assigned_slugs:
                n += 1
                slug = f"{base_slug}-{n}"
            slug_counter[base_slug] = n + 1
            assigned_slugs.add(slug)

            try:
                supabase.table("organizations").insert({
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
                }).execute()
                inserted += 1
            except Exception as exc:
                print(f"  [ERR] Insert failed for {slug}: {exc}")
                errors += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Records parsed:             {len(parsed)}")
    print(f"  Active licenses:            {len(active_records)}")
    print(f"  Skipped (expired pre-2024): {skipped_expired}")
    print(f"  Inserted (new):             {inserted}")
    print(f"  Updated (existing):         {updated}")
    print(f"  Errors:                     {errors}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
