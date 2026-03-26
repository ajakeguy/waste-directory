#!/usr/bin/env python3
"""
pipelines/nyc-bic-import/index.py

Imports NYC Business Integrity Commission (BIC) licensed trade waste
haulers from the official BIC approval list PDF.

Only records with TYPE = "License" are imported (not Exempt or Registration).

Usage:
    python pipelines/nyc-bic-import/index.py <path-to-pdf>
    python pipelines/nyc-bic-import/index.py            # downloads from nyc.gov

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

PDF source:
    https://www.nyc.gov/assets/bic/downloads/pdf/approved_list.pdf
"""

import sys
import os
import re
import tempfile
from datetime import datetime

# Auto-install pdfplumber if not available
try:
    import pdfplumber
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pdfplumber", "-q"])
    import pdfplumber

try:
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

BIC_PDF_URL = "https://www.nyc.gov/assets/bic/downloads/pdf/approved_list.pdf"
DATA_SOURCE = "nyc_bic_license_2026"
BATCH_SIZE = 50

# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(name: str, city: str) -> str:
    """Generate a URL-friendly slug from name and city."""
    combined = f"{name} {city}"
    combined = combined.lower()
    combined = re.sub(r"[^a-z0-9]+", "-", combined)
    combined = combined.strip("-")
    return combined


def normalize_name(name: str) -> str:
    """Normalize company name for dedup matching."""
    name = name.lower()
    name = re.sub(r"[^a-z0-9 ]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def clean_cell(value) -> str:
    """Strip whitespace and collapse embedded newlines in a cell value."""
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def clean_zip(raw: str) -> str:
    """Remove trailing hyphen from truncated ZIP+4 codes like '10301-'."""
    return raw.rstrip("-").strip()


def clean_phone(raw: str) -> str | None:
    """Normalize phone to NNN-NNN-NNNN format. Returns None for empty/invalid."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"{digits[0:3]}-{digits[3:6]}-{digits[6:10]}"
    if len(digits) == 11 and digits[0] == "1":
        return f"{digits[1:4]}-{digits[4:7]}-{digits[7:11]}"
    trimmed = raw.strip()
    return trimmed if trimmed else None


def parse_date(raw: str) -> str | None:
    """Convert MM/DD/YYYY to ISO YYYY-MM-DD. Returns None if unparseable."""
    if not raw:
        return None
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw.strip())
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    return None


# ── PDF download ──────────────────────────────────────────────────────────────

def download_pdf(url: str) -> str:
    """Download PDF to a temp file and return the path."""
    print(f"  Downloading PDF from {url} ...")
    resp = requests.get(
        url,
        headers={"User-Agent": "WasteDirectory-DataImport/1.0"},
        timeout=60,
    )
    resp.raise_for_status()
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.write(resp.content)
    tmp.close()
    print(f"  Downloaded {len(resp.content):,} bytes → {tmp.name}")
    return tmp.name


# ── PDF parsing ───────────────────────────────────────────────────────────────

def parse_pdf(pdf_path: str) -> list[dict]:
    """
    Extract all records from the BIC approval list PDF.

    Uses pdfplumber's extract_tables() for reliable column separation.
    The PDF has 10 columns:
        BIC NUMBER | ACCOUNT NAME | TRADE NAME | ADDRESS | CITY |
        STATE | ZIP | PHONE | EXPIRATION DATE | TYPE

    Quirks handled:
    - Header row only appears on page 1 (detected and skipped by column name)
    - Footer rows contain "nyc.gov/bic" / "list current" (skipped)
    - Multi-line cell values (CITY, PHONE) are collapsed to single spaces
    - ZIP codes may have trailing hyphens ('10301-') — stripped
    """
    records = []

    with pdfplumber.open(pdf_path) as pdf:
        print(f"  PDF pages: {len(pdf.pages)}")

        for page_num, page in enumerate(pdf.pages, start=1):
            tables = page.extract_tables()
            for table in tables:
                if not table:
                    continue
                for row in table:
                    # Need at least 10 columns
                    if not row or len(row) < 10:
                        continue

                    # Skip header row (only on page 1)
                    if row[0] and clean_cell(row[0]).upper() == "BIC NUMBER":
                        continue

                    # Skip footer rows (page number / URL line)
                    row_text = " ".join(str(c) for c in row if c)
                    if "nyc.gov/bic" in row_text.lower() or "list current" in row_text.lower():
                        continue

                    # Skip completely empty rows
                    if not any(row):
                        continue

                    bic_number = clean_cell(row[0])
                    if not bic_number.upper().startswith("BIC-"):
                        continue  # Not a real data row

                    record = {
                        "bic_number":      bic_number.upper(),
                        "account_name":    clean_cell(row[1]),
                        "trade_name":      clean_cell(row[2]),
                        "address":         clean_cell(row[3]),
                        "city":            clean_cell(row[4]),
                        "state":           clean_cell(row[5]) or "NY",
                        "zip":             clean_zip(clean_cell(row[6])),
                        "phone":           clean_phone(clean_cell(row[7])),
                        "expiration_date": parse_date(clean_cell(row[8])),
                        "type":            clean_cell(row[9]),
                    }
                    records.append(record)

    return records


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=== WasteDirectory — NYC BIC License Importer ===")
    print(datetime.utcnow().isoformat())

    # PDF path: use argument if given, otherwise download from nyc.gov
    tmp_pdf = None
    if len(sys.argv) >= 2:
        pdf_path = sys.argv[1]
        print(f"\nUsing local PDF: {pdf_path}")
    else:
        print("\nNo PDF path provided — downloading from nyc.gov ...")
        try:
            pdf_path = download_pdf(BIC_PDF_URL)
            tmp_pdf = pdf_path  # remember to clean up
        except Exception as exc:
            print(f"Failed to download PDF: {exc}", file=sys.stderr)
            sys.exit(1)

    # Supabase credentials
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print(
            "Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        sys.exit(1)

    # ── 1. Parse PDF ──────────────────────────────────────────────────────────
    print(f"\nParsing PDF: {pdf_path}")
    try:
        all_records = parse_pdf(pdf_path)
    except Exception as exc:
        print(f"Failed to parse PDF: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        if tmp_pdf and os.path.exists(tmp_pdf):
            os.unlink(tmp_pdf)

    print(f"  Total records parsed: {len(all_records)}")

    # ── 2. Filter to License type only ────────────────────────────────────────
    license_records = [r for r in all_records if r["type"].lower() == "license"]
    skipped_type = len(all_records) - len(license_records)
    print(f"  License type only:    {len(license_records)}  ({skipped_type} Exempt/Registration skipped)")

    if not license_records:
        print("\nNo License-type records found — check PDF structure.")
        return

    # ── 3. Connect to Supabase ────────────────────────────────────────────────
    supabase: Client = create_client(supabase_url, service_role_key)

    # ── 4. Load existing orgs for name-match dedup ────────────────────────────
    print("\nLoading existing organizations for dedup...")
    existing_name_map: dict[str, dict] = {}
    existing_slug_set: set[str] = set()
    page_size = 1000
    offset = 0

    while True:
        result = (
            supabase.table("organizations")
            .select("id, name, slug, service_area_states")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        for org in result.data:
            key = normalize_name(org["name"] or "")
            if key:
                existing_name_map[key] = org
            if org.get("slug"):
                existing_slug_set.add(org["slug"])
        if len(result.data) < page_size:
            break
        offset += page_size

    print(f"  Loaded {len(existing_name_map)} existing organizations")

    # ── 5. Classify records ───────────────────────────────────────────────────
    to_update:       list[tuple[dict, dict]] = []  # (existing_org, record)
    already_existed: list[dict]              = []
    to_insert:       list[dict]              = []
    seen_slugs:      set[str]               = set()
    skipped_no_name  = 0

    for record in license_records:
        account_name = record["account_name"].strip()
        if not account_name:
            skipped_no_name += 1
            continue

        name_key = normalize_name(account_name)
        existing = existing_name_map.get(name_key)

        if existing:
            current_states = existing.get("service_area_states") or []
            if "NY" not in current_states:
                to_update.append((existing, record))
            else:
                already_existed.append(existing)
            continue

        # New record — generate a unique slug
        city = record["city"] or ""
        base_slug = slugify(account_name, city)
        if not base_slug:
            skipped_no_name += 1
            continue

        slug = base_slug
        counter = 1
        while slug in existing_slug_set or slug in seen_slugs:
            slug = f"{base_slug}-{counter}"
            counter += 1
        seen_slugs.add(slug)

        trade_name = record["trade_name"].strip() if record["trade_name"] else ""
        description = (
            trade_name
            if trade_name and normalize_name(trade_name) != name_key
            else None
        )

        to_insert.append({
            "name":                account_name,
            "slug":                slug,
            "org_type":            "hauler",
            "description":         description,
            "phone":               record["phone"],
            "address":             record["address"] or None,
            "city":                city or None,
            "state":               record["state"],
            "zip":                 record["zip"] or None,
            "hq_state":            record["state"],
            "license_number":      record["bic_number"],
            "license_expiry":      record["expiration_date"],
            "service_types":       ["commercial"],
            "service_area_states": ["NY"],
            "verified":            True,
            "active":              True,
            "data_source":         DATA_SOURCE,
        })

    print(f"  Name-matched (NY update needed): {len(to_update)}")
    print(f"  Name-matched (already complete): {len(already_existed)}")
    print(f"  New records to insert:           {len(to_insert)}")
    if skipped_no_name:
        print(f"  Skipped (no name):               {skipped_no_name}")

    # ── 6. Update service_area_states for name-matched orgs ───────────────────
    update_errors = 0
    for existing, record in to_update:
        current_states = existing.get("service_area_states") or []
        try:
            supabase.table("organizations").update({
                "service_area_states": list(current_states) + ["NY"],
                "license_number":      record["bic_number"],
                "license_expiry":      record["expiration_date"],
            }).eq("id", existing["id"]).execute()
            print(f"  ✓ Updated {existing['slug']} — added NY to service_area_states")
        except Exception as exc:
            print(f"  ✗ Update failed for {existing['slug']}: {exc}")
            update_errors += 1

    # ── 7. Slug dedup against DB then insert ──────────────────────────────────
    insert_errors = 0
    newly_inserted = 0
    slug_dupes = 0

    if to_insert:
        slugs_to_check = [o["slug"] for o in to_insert]
        result = (
            supabase.table("organizations")
            .select("slug")
            .in_("slug", slugs_to_check)
            .execute()
        )
        db_slugs = {row["slug"] for row in result.data}
        slug_dupes = len(db_slugs)
        new_orgs = [o for o in to_insert if o["slug"] not in db_slugs]

        if slug_dupes:
            print(f"  Slug-matched to existing (skipped): {slug_dupes}")
        print(f"  Net new to insert after slug dedup: {len(new_orgs)}")

        # Insert in batches of BATCH_SIZE
        for i in range(0, len(new_orgs), BATCH_SIZE):
            batch = new_orgs[i : i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            try:
                supabase.table("organizations").insert(batch).execute()
                newly_inserted += len(batch)
                print(f"  ✓ Batch {batch_num}: inserted {len(batch)} records")
            except Exception as exc:
                print(f"  ✗ Batch {batch_num} failed: {exc}")
                insert_errors += 1

    # ── 8. Summary ────────────────────────────────────────────────────────────
    total_errors = update_errors + insert_errors
    print("\n=== Summary ===")
    print(f"  Total parsed     : {len(all_records)}")
    print(f"  License type     : {len(license_records)}")
    print(f"  Name-matched     : {len(to_update) + len(already_existed)}")
    print(f"  Already existed  : {len(already_existed)}")
    print(f"  Newly inserted   : {newly_inserted}")
    print(f"  Errors           : {total_errors}")

    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
