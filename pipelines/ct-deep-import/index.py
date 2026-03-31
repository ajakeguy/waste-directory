#!/usr/bin/env python3
"""
pipelines/ct-deep-import/index.py

Imports Connecticut DEEP waste transporter records from the official
CT DEEP waste transporter list PDF.

PDF source:
    https://portal.ct.gov/-/media/deep/waste_management_and_disposal/transporters/deep-waste-transporter-list.pdf

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os
import re
import io
import sys
from datetime import datetime

import requests
import pdfplumber
from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

DATA_SOURCE = "ct_deep_2026"
SERVICE_AREA_STATES = ["CT"]
SERVICE_TYPES = ["commercial", "residential"]
SAFE_MAX = 1000
BATCH_SIZE = 50

PDF_URL = (
    "https://portal.ct.gov/-/media/deep/waste_management_and_disposal"
    "/transporters/deep-waste-transporter-list.pdf"
)

HEADERS = {"User-Agent": "WasteDirectory-DataImport/1.0 (contact@wastedirectory.com)"}

# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(name: str, city: str = "") -> str:
    combined = f"{name} {city}".strip()
    combined = combined.lower()
    combined = re.sub(r"[^a-z0-9]+", "-", combined)
    return combined.strip("-")


def normalize_name(name: str) -> str:
    name = name.lower()
    name = re.sub(r"[^a-z0-9 ]", "", name)
    return re.sub(r"\s+", " ", name).strip()


def clean_cell(value) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def clean_phone(raw: str) -> str | None:
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
    """Convert MM/DD/YYYY or M/D/YYYY to ISO YYYY-MM-DD."""
    if not raw:
        return None
    m = re.match(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", raw.strip())
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    return None


# ── PDF download ──────────────────────────────────────────────────────────────

def download_pdf(url: str) -> bytes:
    print(f"\nDownloading PDF: {url}")
    resp = requests.get(url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    print(f"  Downloaded {len(resp.content):,} bytes")
    return resp.content


# ── PDF parsing ───────────────────────────────────────────────────────────────

def parse_pdf(pdf_bytes: bytes) -> tuple[list[dict], list[str] | None]:
    """
    Extract transporter records from the CT DEEP PDF.

    Expected columns (per CT DEEP format):
        Permit Number | Company Name | Address | City | State | Zip | Phone | Expiration Date

    Prints column names and first 3 rows as diagnostic on every run.
    Returns (records, col_names).
    """
    records = []
    col_names: list[str] | None = None

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"  PDF pages: {len(pdf.pages)}")

        for page_num, page in enumerate(pdf.pages, start=1):
            tables = page.extract_tables()
            for table in tables:
                if not table:
                    continue

                for row in table:
                    if not row or not any(row):
                        continue

                    cells = [clean_cell(c) for c in row]
                    row_text = " ".join(cells).upper()

                    # Detect header row
                    if col_names is None and (
                        "PERMIT" in row_text
                        or "LICENSE" in row_text
                        or "COMPANY" in row_text
                        or "TRANSPORTER" in row_text
                    ):
                        col_names = cells
                        continue

                    # Skip obvious footer/junk
                    if any(kw in row_text for kw in ["CT.GOV", "PAGE ", "PRINTED", "DEEP.CT"]):
                        continue

                    records.append(cells)

    # ── Diagnostic: always print columns + first 3 rows ──────────────────────
    print(f"\n--- DIAGNOSTIC ---")
    print(f"  Column names: {col_names}")
    print(f"  Total raw rows extracted: {len(records)}")
    if records:
        print(f"  First 3 rows:")
        for row in records[:3]:
            if col_names:
                row_dict = dict(zip(col_names, row))
            else:
                row_dict = {f"col_{i}": v for i, v in enumerate(row)}
            print(f"    {row_dict}")
    print(f"--- END DIAGNOSTIC ---\n")

    return records, col_names


def map_records(raw_rows: list[list[str]], col_names: list[str] | None) -> list[dict]:
    """Map raw rows to organization schema using column names or positional fallback."""
    mapped = []

    # Build column index map
    col_idx: dict[str, int] = {}
    if col_names:
        for i, name in enumerate(col_names):
            col_idx[name.lower()] = i

    def get(row: list[str], *keys: str) -> str:
        for key in keys:
            for col_key, idx in col_idx.items():
                if key.lower() in col_key:
                    if idx < len(row):
                        return row[idx]
        return ""

    for row in raw_rows:
        if not row:
            continue

        if col_names:
            permit_number = get(row, "permit", "license", "number")
            company_name = get(row, "company", "name", "business", "transporter")
            address = get(row, "address", "addr", "street")
            city = get(row, "city", "town")
            state = get(row, "state", "st") or "CT"
            zip_code = get(row, "zip", "postal")
            phone = get(row, "phone", "tel")
            expiration = get(row, "expir", "exp", "date")
        else:
            # Positional fallback matching expected CT DEEP column order:
            # Permit Number | Company Name | Address | City | State | Zip | Phone | Expiration
            permit_number = row[0] if len(row) > 0 else ""
            company_name = row[1] if len(row) > 1 else ""
            address = row[2] if len(row) > 2 else ""
            city = row[3] if len(row) > 3 else ""
            state = row[4] if len(row) > 4 else "CT"
            zip_code = row[5] if len(row) > 5 else ""
            phone = row[6] if len(row) > 6 else ""
            expiration = row[7] if len(row) > 7 else ""

        company_name = company_name.strip()
        permit_number = permit_number.strip()
        state_clean = state.strip().upper()[:2] if state.strip() else "CT"

        if not company_name:
            continue

        # ── Filter: CT records only ───────────────────────────────────────────
        is_ct_state = state_clean == "CT"
        is_ct_permit = permit_number.upper().startswith("CT")
        if not (is_ct_state or is_ct_permit):
            continue

        mapped.append({
            "name": company_name,
            "permit_number": permit_number or None,
            "address": address.strip() or None,
            "city": city.strip() or None,
            "state": state_clean,
            "zip": zip_code.strip() or None,
            "phone": clean_phone(phone),
            "license_expiry": parse_date(expiration),
        })

    return mapped


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=== WasteDirectory — CT DEEP Waste Transporter Importer ===")
    print(datetime.utcnow().isoformat())

    # ── 1. Download PDF ───────────────────────────────────────────────────────
    try:
        pdf_bytes = download_pdf(PDF_URL)
    except Exception as exc:
        print(f"\nFailed to download PDF: {exc}", file=sys.stderr)
        print(f"URL tried: {PDF_URL}")
        sys.exit(1)

    # ── 2. Parse PDF (always prints diagnostic) ───────────────────────────────
    try:
        raw_rows, col_names = parse_pdf(pdf_bytes)
    except Exception as exc:
        print(f"\nFailed to parse PDF: {exc}", file=sys.stderr)
        sys.exit(1)

    # ── 3. Map to schema and filter to CT ────────────────────────────────────
    mapped = map_records(raw_rows, col_names)
    print(f"  Records after CT filter: {len(mapped)}")

    if not mapped:
        print("\nNo CT records found — check column detection diagnostic above.")
        sys.exit(0)

    if len(mapped) > SAFE_MAX:
        print(f"\nSAFE_MAX exceeded ({len(mapped)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # ── 4. Connect to Supabase ────────────────────────────────────────────────
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print(
            "\nMissing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # ── 5. Load existing orgs for dedup ───────────────────────────────────────
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

    # ── 6. Classify records ───────────────────────────────────────────────────
    to_update: list[tuple[dict, dict]] = []
    already_existed: list[dict] = []
    to_insert: list[dict] = []
    seen_slugs: set[str] = set()
    skipped_no_name = 0

    for record in mapped:
        name = record["name"]
        if not name:
            skipped_no_name += 1
            continue

        name_key = normalize_name(name)
        existing = existing_name_map.get(name_key)

        if existing:
            current_states = existing.get("service_area_states") or []
            if "CT" not in current_states:
                to_update.append((existing, record))
            else:
                already_existed.append(existing)
            continue

        base_slug = slugify(name, record.get("city") or "")
        if not base_slug:
            skipped_no_name += 1
            continue

        slug = base_slug
        counter = 1
        while slug in existing_slug_set or slug in seen_slugs:
            slug = f"{base_slug}-{counter}"
            counter += 1
        seen_slugs.add(slug)

        to_insert.append({
            "name": name,
            "slug": slug,
            "org_type": "hauler",
            "phone": record["phone"],
            "address": record["address"],
            "city": record["city"],
            "state": record["state"],
            "zip": record["zip"],
            "license_number": record["permit_number"],
            "license_expiry": record["license_expiry"],
            "service_types": SERVICE_TYPES,
            "service_area_states": SERVICE_AREA_STATES,
            "verified": True,
            "active": True,
            "data_source": DATA_SOURCE,
        })

    print(f"\n  Name-matched (CT update needed): {len(to_update)}")
    print(f"  Name-matched (already complete): {len(already_existed)}")
    print(f"  New records to insert:           {len(to_insert)}")
    if skipped_no_name:
        print(f"  Skipped (no name):               {skipped_no_name}")

    # ── 7. Update existing orgs ───────────────────────────────────────────────
    update_errors = 0
    for existing, record in to_update:
        current_states = existing.get("service_area_states") or []
        try:
            update_payload: dict = {
                "service_area_states": list(current_states) + ["CT"],
            }
            if record.get("permit_number"):
                update_payload["license_number"] = record["permit_number"]
            if record.get("license_expiry"):
                update_payload["license_expiry"] = record["license_expiry"]
            supabase.table("organizations").update(update_payload).eq("id", existing["id"]).execute()
            print(f"  ✓ Updated {existing['slug']} — added CT to service_area_states")
        except Exception as exc:
            print(f"  ✗ Update failed for {existing['slug']}: {exc}")
            update_errors += 1

    # ── 8. Insert new records ─────────────────────────────────────────────────
    insert_errors = 0
    newly_inserted = 0

    if to_insert:
        slugs_to_check = [o["slug"] for o in to_insert]
        result = (
            supabase.table("organizations")
            .select("slug")
            .in_("slug", slugs_to_check)
            .execute()
        )
        db_slugs = {row["slug"] for row in result.data}
        new_orgs = [o for o in to_insert if o["slug"] not in db_slugs]

        if db_slugs:
            print(f"  Slug-matched to existing (skipped): {len(db_slugs)}")
        print(f"  Net new to insert after slug dedup: {len(new_orgs)}")

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

    # ── 9. Summary ────────────────────────────────────────────────────────────
    total_errors = update_errors + insert_errors
    print("\n=== Summary ===")
    print(f"  Total extracted  : {len(raw_rows)}")
    print(f"  After CT filter  : {len(mapped)}")
    print(f"  Name-matched     : {len(to_update) + len(already_existed)}")
    print(f"  Already existed  : {len(already_existed)}")
    print(f"  Newly inserted   : {newly_inserted}")
    print(f"  Errors           : {total_errors}")

    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
