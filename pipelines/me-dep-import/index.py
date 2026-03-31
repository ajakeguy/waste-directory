#!/usr/bin/env python3
"""
pipelines/me-dep-import/index.py

Imports Maine DEP non-hazardous waste transporters from the Maine DEP
data portal. Scans the data page for transporter-related links, then
tries known direct PDF/Excel URLs.

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
from bs4 import BeautifulSoup
import pdfplumber
from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

DATA_SOURCE = "me_dep_2026"
SERVICE_AREA_STATES = ["ME"]
SAFE_MAX = 1000
BATCH_SIZE = 50

DATA_PAGE_URL = "https://www.maine.gov/dep/maps-data/data.html"

DIRECT_URLS = [
    "https://www.maine.gov/dep/waste/transpinstall/nonhaztransporterlist.pdf",
    "https://www11.maine.gov/dep/waste/transpinstall/nonhaztransporterlist.pdf",
    "https://www.maine.gov/dep/maps-data/downloads/nonhaz-transporters.pdf",
    "https://www.maine.gov/dep/maps-data/downloads/active-nonhaz-transporters.pdf",
]

HEADERS = {"User-Agent": "WasteDirectory-DataImport/1.0 (contact@wastedirectory.com)"}

LINK_KEYWORDS = re.compile(r"transporter|non-haz|nonhaz|hauler", re.IGNORECASE)

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


# ── Step 1: Scan data page for transporter links ───────────────────────────────

def scan_data_page() -> list[str]:
    """Fetch the ME DEP data page and return all transporter-related links."""
    print(f"\nScanning {DATA_PAGE_URL} for transporter links...")
    found = []
    try:
        resp = requests.get(DATA_PAGE_URL, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup.find_all("a", href=True):
            href = tag["href"]
            text = tag.get_text(" ", strip=True)
            if LINK_KEYWORDS.search(href) or LINK_KEYWORDS.search(text):
                # Resolve relative URLs
                if href.startswith("http"):
                    full_url = href
                elif href.startswith("/"):
                    full_url = "https://www.maine.gov" + href
                else:
                    full_url = "https://www.maine.gov/dep/maps-data/" + href
                found.append(full_url)
                print(f"  Found link: {full_url}  [{text}]")
    except Exception as exc:
        print(f"  Warning: could not fetch data page: {exc}")

    if not found:
        print("  No transporter-related links found on data page.")
    return found


# ── Step 2: Try direct URLs ────────────────────────────────────────────────────

def fetch_pdf(url: str) -> bytes | None:
    """Attempt to download a PDF from the given URL. Returns bytes or None."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=60)
        if resp.status_code == 200 and len(resp.content) > 1000:
            content_type = resp.headers.get("Content-Type", "")
            if "pdf" in content_type.lower() or url.lower().endswith(".pdf"):
                print(f"  Downloaded PDF: {url} ({len(resp.content):,} bytes)")
                return resp.content
            else:
                print(f"  Skipped (not PDF, Content-Type={content_type}): {url}")
        else:
            print(f"  Not found (HTTP {resp.status_code}): {url}")
    except Exception as exc:
        print(f"  Error fetching {url}: {exc}")
    return None


def find_pdf(extra_urls: list[str]) -> tuple[str, bytes] | tuple[None, None]:
    """Try extra_urls then DIRECT_URLS; return (url, bytes) for the first PDF found."""
    candidates = list(dict.fromkeys(extra_urls + DIRECT_URLS))  # dedup, preserve order
    for url in candidates:
        data = fetch_pdf(url)
        if data:
            return url, data
    return None, None


# ── Step 3: Parse PDF ──────────────────────────────────────────────────────────

def parse_pdf(pdf_bytes: bytes) -> list[dict]:
    """
    Parse ME DEP non-haz transporter PDF.
    Prints column names and first 3 rows as diagnostic.
    Returns list of raw row dicts.
    """
    records = []
    col_names: list[str] | None = None

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"\n  PDF pages: {len(pdf.pages)}")

        for page_num, page in enumerate(pdf.pages, start=1):
            tables = page.extract_tables()
            for table in tables:
                if not table:
                    continue
                for row in table:
                    if not row or not any(row):
                        continue

                    cells = [clean_cell(c) for c in row]

                    # Detect header row
                    row_upper = " ".join(cells).upper()
                    if (
                        "COMPANY" in row_upper
                        or "NAME" in row_upper
                        or "ADDRESS" in row_upper
                        or "LICENSE" in row_upper
                        or "PERMIT" in row_upper
                    ) and col_names is None:
                        col_names = cells
                        print(f"\n  Column names detected: {col_names}")
                        continue

                    # Skip footer/junk rows
                    if any(kw in row_upper for kw in ["MAINE.GOV", "PAGE ", "PRINTED"]):
                        continue

                    records.append(cells)

    # Diagnostic: print first 3 rows
    if col_names:
        print(f"\n  First 3 rows (raw):")
        for row in records[:3]:
            row_dict = dict(zip(col_names, row)) if col_names else {"row": row}
            print(f"    {row_dict}")
    else:
        print("\n  No header row detected. First 3 raw rows:")
        for row in records[:3]:
            print(f"    {row}")

    return records, col_names


def map_records(raw_rows: list[list[str]], col_names: list[str] | None) -> list[dict]:
    """
    Map raw PDF rows to organization schema.
    Handles both known-column and positional layouts.
    """
    mapped = []

    # Build column index map (case-insensitive)
    col_idx: dict[str, int] = {}
    if col_names:
        for i, name in enumerate(col_names):
            col_idx[name.lower()] = i

    def get(row, *keys) -> str:
        """Try multiple key variants, fall back to positional."""
        for key in keys:
            for col_key, idx in col_idx.items():
                if key.lower() in col_key:
                    if idx < len(row):
                        return row[idx]
        return ""

    for row in raw_rows:
        if not row:
            continue

        # Try to extract fields
        if col_names:
            name = get(row, "company", "name", "business")
            address = get(row, "address", "addr", "street")
            city = get(row, "city", "town")
            state = get(row, "state", "st") or "ME"
            zip_code = get(row, "zip", "postal")
            phone = get(row, "phone", "tel")
            license_num = get(row, "permit", "license", "cert", "number", "id")
        else:
            # Positional fallback — adjust indices based on observed PDF layout
            name = row[0] if len(row) > 0 else ""
            address = row[1] if len(row) > 1 else ""
            city = row[2] if len(row) > 2 else ""
            state = row[3] if len(row) > 3 else "ME"
            zip_code = row[4] if len(row) > 4 else ""
            phone = row[5] if len(row) > 5 else ""
            license_num = row[6] if len(row) > 6 else ""

        name = name.strip()
        if not name:
            continue

        mapped.append({
            "name": name,
            "address": address.strip() or None,
            "city": city.strip() or None,
            "state": (state.strip().upper() or "ME")[:2],
            "zip": zip_code.strip() or None,
            "phone": clean_phone(phone),
            "license_number": license_num.strip() or None,
        })

    return mapped


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=== WasteDirectory — Maine DEP Non-Haz Transporter Importer ===")
    print(datetime.utcnow().isoformat())

    # ── 1. Scan data page ─────────────────────────────────────────────────────
    extra_urls = scan_data_page()

    # ── 2. Find and download PDF ──────────────────────────────────────────────
    print(f"\nTrying {len(DIRECT_URLS)} known direct URLs + {len(extra_urls)} page links...")
    pdf_url, pdf_bytes = find_pdf(extra_urls)

    if not pdf_bytes:
        print("\n=== DIAGNOSTIC: No PDF found ===")
        print("Tried the following URLs:")
        for url in list(dict.fromkeys(extra_urls + DIRECT_URLS)):
            print(f"  {url}")
        print("\nAction needed:")
        print("  1. Visit https://www.maine.gov/dep/maps-data/data.html manually")
        print("  2. Find the non-hazardous transporter list download link")
        print("  3. Update DIRECT_URLS in this script with the correct URL")
        sys.exit(0)

    print(f"\nUsing PDF from: {pdf_url}")

    # ── 3. Parse PDF ──────────────────────────────────────────────────────────
    try:
        raw_rows, col_names = parse_pdf(pdf_bytes)
    except Exception as exc:
        print(f"\nFailed to parse PDF: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"\n  Total raw rows extracted: {len(raw_rows)}")

    mapped = map_records(raw_rows, col_names)
    print(f"  Records mapped to schema: {len(mapped)}")

    if not mapped:
        print("\nNo records mapped — check PDF column detection above.")
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
            if "ME" not in current_states:
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
            "license_number": record["license_number"],
            "service_types": ["commercial", "residential"],
            "service_area_states": SERVICE_AREA_STATES,
            "verified": True,
            "active": True,
            "data_source": DATA_SOURCE,
        })

    print(f"\n  Name-matched (ME update needed): {len(to_update)}")
    print(f"  Name-matched (already complete): {len(already_existed)}")
    print(f"  New records to insert:           {len(to_insert)}")
    if skipped_no_name:
        print(f"  Skipped (no name):               {skipped_no_name}")

    # ── 7. Update existing orgs ───────────────────────────────────────────────
    update_errors = 0
    for existing, record in to_update:
        current_states = existing.get("service_area_states") or []
        try:
            supabase.table("organizations").update({
                "service_area_states": list(current_states) + ["ME"],
            }).eq("id", existing["id"]).execute()
            print(f"  ✓ Updated {existing['slug']} — added ME to service_area_states")
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
    print(f"  Mapped to schema : {len(mapped)}")
    print(f"  Name-matched     : {len(to_update) + len(already_existed)}")
    print(f"  Already existed  : {len(already_existed)}")
    print(f"  Newly inserted   : {newly_inserted}")
    print(f"  Errors           : {total_errors}")

    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
