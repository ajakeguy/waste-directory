#!/usr/bin/env python3
"""
pipelines/me-dep-import/index.py

Imports Maine DEP non-hazardous waste transporters from the Maine DEP
data portal. Scans the data page for transporter-related links, then
tries known direct PDF URLs. Parses fixed-width text layout (not tables).

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

# Confirmed working URL first (resolved from relative path ../ftp/reports/nactive.pdf)
DIRECT_URLS = [
    "https://www.maine.gov/dep/ftp/reports/nactive.pdf",
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
    """Try DIRECT_URLS first (confirmed URL is first), then extra_urls from page scan."""
    candidates = list(dict.fromkeys(DIRECT_URLS + extra_urls))  # dedup, direct URLs first
    for url in candidates:
        data = fetch_pdf(url)
        if data:
            return url, data
    return None, None


# ── Step 3: Parse fixed-width text PDF ────────────────────────────────────────

def detect_column_offsets(header_line: str) -> list[int]:
    """
    Detect column start positions from a header line.
    Finds where each word/token begins (after leading whitespace).
    """
    offsets = []
    in_word = False
    for i, ch in enumerate(header_line):
        if ch != " " and not in_word:
            offsets.append(i)
            in_word = True
        elif ch == " ":
            in_word = False
    return offsets


def split_fixed_width(line: str, offsets: list[int]) -> list[str]:
    """Split a line into fields at the given column offsets."""
    fields = []
    for i, start in enumerate(offsets):
        end = offsets[i + 1] if i + 1 < len(offsets) else len(line)
        fields.append(line[start:end].strip())
    return fields


def parse_pdf(pdf_bytes: bytes) -> tuple[list[list[str]], list[str] | None]:
    """
    Parse ME DEP non-haz transporter PDF using fixed-width text extraction.

    The PDF uses fixed-width columns, not HTML-style tables.
    Strategy:
      1. Extract raw text from each page
      2. Split by newlines
      3. Skip header/blank/footer lines
      4. Split each data line on 2+ consecutive spaces (fixed-width delimiter)
      5. Fallback: use detected column offsets from header row

    Prints first 5 raw lines and detected columns as diagnostic.
    """
    all_lines: list[str] = []
    col_names: list[str] | None = None
    col_offsets: list[int] | None = None

    SKIP_PATTERNS = re.compile(
        r"maine\.gov|page \d|printed|report date|non-haz|active transporter|"
        r"^\s*$|^-+$|department of environmental",
        re.IGNORECASE,
    )
    HEADER_PATTERNS = re.compile(
        r"license|permit|company|facility|name|address|city|state|zip|phone",
        re.IGNORECASE,
    )

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"\n  PDF pages: {len(pdf.pages)}")

        for page_num, page in enumerate(pdf.pages, start=1):
            text = page.extract_text()
            if not text:
                print(f"  Page {page_num}: no text extracted")
                continue

            lines = text.split("\n")
            for line in lines:
                stripped = line.rstrip()
                if not stripped.strip():
                    continue
                if SKIP_PATTERNS.search(stripped.strip()):
                    continue

                # Detect header row
                if col_names is None and HEADER_PATTERNS.search(stripped):
                    # Split header on 2+ spaces to get column names
                    parts = re.split(r"  +", stripped.strip())
                    if len(parts) >= 2:
                        col_names = [p.strip() for p in parts if p.strip()]
                        col_offsets = detect_column_offsets(stripped)
                        print(f"\n  Header line: {repr(stripped)}")
                        print(f"  Column names detected: {col_names}")
                        print(f"  Column offsets: {col_offsets}")
                        continue

                all_lines.append(stripped)

    # ── Diagnostic: print first 5 raw lines ──────────────────────────────────
    print(f"\n--- DIAGNOSTIC ---")
    print(f"  Total lines collected: {len(all_lines)}")
    print(f"  First 5 raw lines:")
    for i, line in enumerate(all_lines[:5]):
        print(f"    [{i}] {repr(line)}")

    if col_names:
        print(f"\n  Attempting split on 2+ spaces (first 3 lines):")
        for line in all_lines[:3]:
            parts = re.split(r"  +", line.strip())
            print(f"    {parts}")

    print(f"--- END DIAGNOSTIC ---\n")

    # ── Parse data lines into field lists ────────────────────────────────────
    records: list[list[str]] = []
    for line in all_lines:
        if not line.strip():
            continue

        # Primary: split on 2+ spaces
        parts = re.split(r"  +", line.strip())
        parts = [p.strip() for p in parts if p.strip()]

        if len(parts) >= 2:
            records.append(parts)
            continue

        # Fallback: use detected column offsets if available
        if col_offsets and len(col_offsets) >= 2:
            fields = split_fixed_width(line, col_offsets)
            fields = [f.strip() for f in fields if f.strip()]
            if len(fields) >= 2:
                records.append(fields)

    return records, col_names


def map_records(raw_rows: list[list[str]], col_names: list[str] | None) -> list[dict]:
    """
    Map raw parsed rows to organization schema.
    Uses column names for field lookup when available, else positional.

    Expected ME DEP fixed-width layout (typical):
        License#  Company Name  Address  City  State  Zip  Phone
    """
    mapped = []

    # Build column index map (case-insensitive partial match)
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
        if not row or len(row) < 2:
            continue

        if col_names:
            license_num = get(row, "license", "permit", "cert", "number", "id")
            name = get(row, "company", "facility", "name", "business")
            address = get(row, "address", "addr", "street")
            city = get(row, "city", "town")
            state = get(row, "state", "st") or "ME"
            zip_code = get(row, "zip", "postal")
            phone = get(row, "phone", "tel")
        else:
            # Positional fallback: License# Company Address City State Zip Phone
            license_num = row[0] if len(row) > 0 else ""
            name = row[1] if len(row) > 1 else ""
            address = row[2] if len(row) > 2 else ""
            city = row[3] if len(row) > 3 else ""
            state = row[4] if len(row) > 4 else "ME"
            zip_code = row[5] if len(row) > 5 else ""
            phone = row[6] if len(row) > 6 else ""

        name = name.strip()
        if not name:
            continue

        # Skip rows that look like continued text or junk
        if len(name) < 2 or re.match(r"^\d+$", name):
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

    # ── 1. Scan data page (supplementary — confirmed URL is in DIRECT_URLS) ──
    extra_urls = scan_data_page()

    # ── 2. Find and download PDF ──────────────────────────────────────────────
    print(f"\nTrying direct URLs first, then {len(extra_urls)} page links...")
    pdf_url, pdf_bytes = find_pdf(extra_urls)

    if not pdf_bytes:
        print("\n=== DIAGNOSTIC: No PDF found ===")
        print("Tried the following URLs:")
        for url in list(dict.fromkeys(DIRECT_URLS + extra_urls)):
            print(f"  {url}")
        print("\nAction needed:")
        print("  1. Visit https://www.maine.gov/dep/maps-data/data.html manually")
        print("  2. Find the non-hazardous transporter list download link")
        print("  3. Update DIRECT_URLS in this script with the correct URL")
        sys.exit(0)

    print(f"\nUsing PDF from: {pdf_url}")

    # ── 3. Parse PDF (fixed-width text) ───────────────────────────────────────
    try:
        raw_rows, col_names = parse_pdf(pdf_bytes)
    except Exception as exc:
        print(f"\nFailed to parse PDF: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"  Total data rows parsed: {len(raw_rows)}")

    mapped = map_records(raw_rows, col_names)
    print(f"  Records mapped to schema: {len(mapped)}")

    if not mapped:
        print("\nNo records mapped — check the diagnostic output above for the actual line format.")
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
    print(f"  Total lines parsed   : {len(raw_rows)}")
    print(f"  Mapped to schema     : {len(mapped)}")
    print(f"  Name-matched         : {len(to_update) + len(already_existed)}")
    print(f"  Already existed      : {len(already_existed)}")
    print(f"  Newly inserted       : {newly_inserted}")
    print(f"  Errors               : {total_errors}")

    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
