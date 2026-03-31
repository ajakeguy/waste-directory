#!/usr/bin/env python3
"""
pipelines/ct-deep-import/index.py

Imports Connecticut DEEP solid waste transporter records from the official
CT DEEP waste transporter list PDF. Tries multiple known URLs in order,
prints full diagnostics for each, and skips column-definition PDFs.

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

# Tried in order — first URL that returns a data PDF (not column-definition PDF) wins
PDF_URLS = [
    "https://portal.ct.gov/-/media/deep/waste_management_and_disposal/transporters/deep-waste-transporter-list.pdf",
    "https://portal.ct.gov/-/media/DEEP/waste_management_and_disposal/transporters/SWTransporterList.pdf",
    "https://portal.ct.gov/-/media/DEEP/waste_management_and_disposal/transporters/MSWtransporters.pdf",
]

HEADERS = {"User-Agent": "WasteDirectory-DataImport/1.0 (contact@wastedirectory.com)"}

# If any of these appear in the first row, it's a column-definitions PDF, not data
COLUMN_DEF_MARKERS = ["column heading", "meaning of the information", "column definition"]

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

def try_download_pdf(url: str) -> bytes | None:
    """Try to download a PDF. Returns bytes on success, None on failure."""
    print(f"\nTrying: {url}")
    try:
        resp = requests.get(url, headers=HEADERS, timeout=60)
        if resp.status_code == 200 and len(resp.content) > 1000:
            content_type = resp.headers.get("Content-Type", "")
            if "pdf" in content_type.lower() or url.lower().endswith(".pdf"):
                print(f"  Downloaded {len(resp.content):,} bytes")
                return resp.content
            else:
                print(f"  Skipped (not PDF, Content-Type={content_type})")
        else:
            print(f"  HTTP {resp.status_code} — skipping")
    except Exception as exc:
        print(f"  Error: {exc}")
    return None


# ── PDF inspection ────────────────────────────────────────────────────────────

def inspect_pdf(pdf_bytes: bytes, url: str) -> tuple[list[list[str]], list[str] | None, bool]:
    """
    Open a PDF and print full diagnostics:
      - First 1000 chars of raw text from page 1
      - Number of tables found
      - Column names and first 3 rows (if tables found)

    Returns (records, col_names, is_data_pdf).
    is_data_pdf=False if the PDF looks like a column-definitions document.
    """
    print(f"\n--- DIAGNOSTIC: {url} ---")

    records: list[list[str]] = []
    col_names: list[str] | None = None

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"  Pages: {len(pdf.pages)}")

        # Always print first 1000 chars of raw text from page 1
        page1_text = pdf.pages[0].extract_text() or ""
        print(f"\n  Raw text (first 1000 chars):\n  {repr(page1_text[:1000])}\n")

        # Count and inspect tables across all pages
        total_tables = 0
        for page_num, page in enumerate(pdf.pages, start=1):
            tables = page.extract_tables()
            total_tables += len(tables)

            for table in tables:
                if not table:
                    continue
                for row in table:
                    if not row or not any(row):
                        continue

                    cells = [clean_cell(c) for c in row]
                    row_text = " ".join(cells)

                    # Detect header row
                    row_upper = row_text.upper()
                    if col_names is None and (
                        "PERMIT" in row_upper
                        or "LICENSE" in row_upper
                        or "COMPANY" in row_upper
                        or "TRANSPORTER" in row_upper
                        or "NAME" in row_upper
                    ):
                        col_names = cells
                        continue

                    # Skip obvious footer/junk
                    if any(kw in row_upper for kw in ["CT.GOV", "PAGE ", "PRINTED", "DEEP.CT"]):
                        continue

                    records.append(cells)

        print(f"  Tables found: {total_tables}")
        print(f"  Column names: {col_names}")
        print(f"  Total data rows: {len(records)}")

        if records:
            print(f"  First 3 rows:")
            for row in records[:3]:
                if col_names:
                    row_dict = dict(zip(col_names, row))
                else:
                    row_dict = {f"col_{i}": v for i, v in enumerate(row)}
                print(f"    {row_dict}")

    # Check if this looks like a column-definition PDF (not actual data)
    first_row_text = ""
    if records:
        first_row_text = " ".join(records[0]).lower()
    elif col_names:
        first_row_text = " ".join(col_names).lower()
    elif page1_text:
        first_row_text = page1_text[:500].lower()

    is_col_def = any(marker in first_row_text for marker in COLUMN_DEF_MARKERS)
    if is_col_def:
        print(f"\n  *** This PDF appears to be a column-definitions document — skipping ***")

    print(f"--- END DIAGNOSTIC ---")
    return records, col_names, not is_col_def


# ── Find usable PDF ───────────────────────────────────────────────────────────

def find_data_pdf() -> tuple[str, list[list[str]], list[str] | None] | tuple[None, None, None]:
    """
    Try each URL in PDF_URLS. For each successful download, run diagnostics.
    Return the first URL that yields an actual data PDF (not column definitions).
    """
    for url in PDF_URLS:
        pdf_bytes = try_download_pdf(url)
        if not pdf_bytes:
            continue

        records, col_names, is_data = inspect_pdf(pdf_bytes, url)
        if is_data and records:
            print(f"\nUsing data PDF from: {url}")
            return url, records, col_names

    return None, None, None


# ── Map records to schema ──────────────────────────────────────────────────────

def map_records(raw_rows: list[list[str]], col_names: list[str] | None) -> list[dict]:
    """Map raw rows to organization schema using column names or positional fallback."""
    mapped = []

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
            # Positional fallback: Permit | Company | Address | City | State | Zip | Phone | Expiry
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

        # Filter: CT records only
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

    # ── 1. Find a usable data PDF (tries all URLs, prints diagnostic for each) ─
    pdf_url, raw_rows, col_names = find_data_pdf()

    if pdf_url is None:
        print("\n=== No usable data PDF found ===")
        print("Tried:")
        for url in PDF_URLS:
            print(f"  {url}")
        print("\nAction needed: find the correct CT DEEP solid waste transporter PDF URL")
        print("and add it to PDF_URLS at the top of this script.")
        sys.exit(0)

    # ── 2. Map to schema and filter to CT ─────────────────────────────────────
    mapped = map_records(raw_rows, col_names)
    print(f"\n  Records after CT filter: {len(mapped)}")

    if not mapped:
        print("\nNo CT records found — check column detection in diagnostic above.")
        sys.exit(0)

    if len(mapped) > SAFE_MAX:
        print(f"\nSAFE_MAX exceeded ({len(mapped)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # ── 3. Connect to Supabase ─────────────────────────────────────────────────
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print(
            "\nMissing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # ── 4. Load existing orgs for dedup ───────────────────────────────────────
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

    # ── 6. Update existing orgs ───────────────────────────────────────────────
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

    # ── 7. Insert new records ─────────────────────────────────────────────────
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

    # ── 8. Summary ────────────────────────────────────────────────────────────
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
