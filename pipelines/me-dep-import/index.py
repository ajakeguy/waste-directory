#!/usr/bin/env python3
"""
pipelines/me-dep-import/index.py

Imports Maine DEP non-hazardous waste transporters from the Maine DEP
data portal. The PDF uses a fixed-width text layout (not tables).

PDF source (confirmed):
    https://www.maine.gov/dep/ftp/reports/nactive.pdf

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import io
import os
import re
import sys
from datetime import datetime

import pandas as pd
import pdfplumber
import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

DATA_SOURCE = "me_dep_2026"
SERVICE_AREA_STATES = ["ME"]
SAFE_MAX = 1000
BATCH_SIZE = 50

DATA_PAGE_URL = "https://www.maine.gov/dep/maps-data/data.html"

# Confirmed working URL listed first
DIRECT_URLS = [
    "https://www.maine.gov/dep/ftp/reports/nactive.pdf",
    "https://www.maine.gov/dep/waste/transpinstall/nonhaztransporterlist.pdf",
    "https://www11.maine.gov/dep/waste/transpinstall/nonhaztransporterlist.pdf",
    "https://www.maine.gov/dep/maps-data/downloads/nonhaz-transporters.pdf",
    "https://www.maine.gov/dep/maps-data/downloads/active-nonhaz-transporters.pdf",
]

HEADERS = {"User-Agent": "WasteDirectory-DataImport/1.0 (contact@wastedirectory.com)"}

LINK_KEYWORDS = re.compile(r"transporter|non-haz|nonhaz|hauler", re.IGNORECASE)

# Words that indicate a line is the header row
HEADER_WORDS = re.compile(
    r"\b(license|permit|company|facility|name|address|city|state|zip|phone)\b",
    re.IGNORECASE,
)

# ME DEP waste category code → service_types mapping
# A = Commercial/Industrial (roll-off / C&D, industrial)
# B = Municipal Solid Waste (residential, commercial)
# C = Septage (residential, septage)
# If multiple categories, union all mapped types
CATEGORY_SERVICE_MAP: dict[str, list[str]] = {
    "A": ["roll_off", "industrial"],
    "B": ["residential", "commercial"],
    "C": ["residential", "septage"],
}

# Lines to unconditionally skip
SKIP_PATTERNS = re.compile(
    r"maine\.gov|page \d|printed|report date|non-haz|active transporter|"
    r"department of environmental|^\s*-+\s*$",
    re.IGNORECASE,
)

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


def detect_column_offsets(header_line: str) -> list[int]:
    """Return the character position where each column header token starts."""
    offsets: list[int] = []
    in_word = False
    for i, ch in enumerate(header_line):
        if ch != " " and not in_word:
            offsets.append(i)
            in_word = True
        elif ch == " ":
            in_word = False
    return offsets


def split_fixed_width(line: str, offsets: list[int]) -> list[str]:
    """Slice a line into fields at the given character offsets."""
    fields = []
    for i, start in enumerate(offsets):
        end = offsets[i + 1] if i + 1 < len(offsets) else len(line)
        fields.append(line[start:end].strip())
    return fields


# ── Step 1: Scan data page ─────────────────────────────────────────────────────

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


# ── Step 2: Download PDF ───────────────────────────────────────────────────────

def fetch_pdf(url: str) -> bytes | None:
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
    candidates = list(dict.fromkeys(DIRECT_URLS + extra_urls))
    for url in candidates:
        data = fetch_pdf(url)
        if data:
            return url, data
    return None, None


# ── Step 3: Extract text and diagnose ─────────────────────────────────────────

def extract_all_text(pdf_bytes: bytes) -> tuple[list[str], str]:
    """
    Extract text from all pages using layout=True to preserve fixed-width spacing.
    Returns (all_lines, page1_full_text).
    """
    all_lines: list[str] = []
    page1_text: str = ""

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"\n  PDF pages: {len(pdf.pages)}")

        for page_num, page in enumerate(pdf.pages, start=1):
            # layout=True preserves horizontal spacing for fixed-width text
            try:
                text = page.extract_text(layout=True)
            except TypeError:
                # Older pdfplumber versions don't support layout= kwarg
                text = page.extract_text()

            if not text:
                print(f"  Page {page_num}: no text extracted")
                continue

            if page_num == 1:
                page1_text = text

            for line in text.split("\n"):
                all_lines.append(line.rstrip())

    return all_lines, page1_text


# ── Step 4: Parse fixed-width lines ───────────────────────────────────────────

def parse_lines(
    all_lines: list[str],
) -> tuple[list[list[str]], list[str] | None, list[int] | None]:
    """
    Three-strategy parser for fixed-width text:
      A) Split on 2+ consecutive spaces
      B) pandas read_fwf() with auto-detected widths
      C) Positional slice at detected column offsets

    Returns (records, col_names, col_offsets).
    """
    col_names: list[str] | None = None
    col_offsets: list[int] | None = None
    header_line: str = ""
    data_lines: list[str] = []

    # ── Pass 1: separate header from data lines ───────────────────────────────
    for line in all_lines:
        if not line.strip():
            continue
        if SKIP_PATTERNS.search(line.strip()):
            continue

        if col_names is None and HEADER_WORDS.search(line):
            # Looks like the header row
            header_line = line
            parts = re.split(r"  +", line.strip())
            parts = [p.strip() for p in parts if p.strip()]
            if len(parts) >= 2:
                col_names = parts
                col_offsets = detect_column_offsets(line)
                print(f"\n  Header line : {repr(line)}")
                print(f"  Col names   : {col_names}")
                print(f"  Col offsets : {col_offsets}")
            continue

        data_lines.append(line)

    # ── Diagnostic: first 10 data lines with line numbers ─────────────────────
    print(f"\n--- DIAGNOSTIC ---")
    print(f"  Total data lines after header filter: {len(data_lines)}")
    print(f"  First 10 raw lines (with line numbers):")
    for i, line in enumerate(data_lines[:10]):
        print(f"    [{i:02d}] {repr(line)}")
    print(f"--- END DIAGNOSTIC ---\n")

    # ── Strategy A: split on 2+ spaces ────────────────────────────────────────
    records_a: list[list[str]] = []
    for line in data_lines:
        parts = re.split(r"  +", line.strip())
        parts = [p.strip() for p in parts if p.strip()]
        if len(parts) >= 2:
            records_a.append(parts)

    if records_a:
        print(f"  Strategy A (2-space split): {len(records_a)} rows parsed")
        print(f"  Strategy A first 3 rows:")
        for row in records_a[:3]:
            print(f"    {row}")
        return records_a, col_names, col_offsets

    print(f"  Strategy A yielded 0 rows — trying Strategy B (pandas read_fwf)")

    # ── Strategy B: pandas read_fwf auto-detect ───────────────────────────────
    try:
        text_block = "\n".join(data_lines)
        df = pd.read_fwf(
            io.StringIO(text_block),
            header=None,
            dtype=str,
        )
        df = df.dropna(how="all")
        records_b = [
            [str(v).strip() for v in row if str(v).strip() and str(v) != "nan"]
            for _, row in df.iterrows()
        ]
        records_b = [r for r in records_b if len(r) >= 1]
        if records_b:
            print(f"  Strategy B (pandas fwf): {len(records_b)} rows parsed")
            print(f"  Strategy B first 3 rows:")
            for row in records_b[:3]:
                print(f"    {row}")
            return records_b, col_names, col_offsets
    except Exception as exc:
        print(f"  Strategy B failed: {exc}")

    print(f"  Strategy B yielded 0 rows — trying Strategy C (column offsets)")

    # ── Strategy C: slice at detected column offsets ──────────────────────────
    records_c: list[list[str]] = []
    if col_offsets and len(col_offsets) >= 2:
        for line in data_lines:
            fields = split_fixed_width(line, col_offsets)
            fields = [f.strip() for f in fields if f.strip()]
            if len(fields) >= 1:
                records_c.append(fields)
        if records_c:
            print(f"  Strategy C (col offsets): {len(records_c)} rows parsed")
            print(f"  Strategy C first 3 rows:")
            for row in records_c[:3]:
                print(f"    {row}")
            return records_c, col_names, col_offsets

    # ── Last resort: import name-only from any non-blank line ─────────────────
    print(f"  All strategies yielded 0 usable rows.")
    print(f"  Falling back to name-only import from non-blank lines.")
    records_fallback: list[list[str]] = []
    for line in data_lines:
        stripped = line.strip()
        if stripped and len(stripped) >= 3:
            records_fallback.append([stripped])
    print(f"  Name-only fallback: {len(records_fallback)} lines")
    return records_fallback, col_names, col_offsets


# ── Step 5: Map parsed rows to schema ─────────────────────────────────────────

def map_records(
    raw_rows: list[list[str]],
    col_names: list[str] | None,
) -> list[dict]:
    """
    Map parsed rows to the organization schema.
    Uses column-name lookup when headers were detected, else positional.

    Expected ME DEP column order (typical):
        License#  Company/Name  Address  City  ST  Zip  Phone
    """
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

    def parse_categories(raw: str) -> list[str]:
        """Extract uppercase category codes (A, B, C) from a raw field value."""
        return [c for c in re.findall(r"\b([A-C])\b", raw.upper())]

    def categories_to_service_types(codes: list[str]) -> list[str]:
        """Map ME waste category codes to service_types, deduplicating."""
        result: list[str] = []
        seen: set[str] = set()
        for code in codes:
            for stype in CATEGORY_SERVICE_MAP.get(code, []):
                if stype not in seen:
                    result.append(stype)
                    seen.add(stype)
        return result if result else ["residential", "commercial"]

    for row in raw_rows:
        if not row:
            continue

        if col_names and len(row) >= 2:
            license_num = get(row, "license", "permit", "cert", "number", "id")
            name        = get(row, "company", "facility", "name", "business")
            address     = get(row, "address", "addr", "street")
            city        = get(row, "city", "town")
            state       = get(row, "state", "st") or "ME"
            zip_code    = get(row, "zip", "postal")
            phone       = get(row, "phone", "tel")
            category    = get(row, "category", "type", "class", "cat")
        elif len(row) >= 2:
            # Positional: License#  Name  Address  City  ST  Zip  Phone  [Category]
            license_num = row[0]
            name        = row[1]
            address     = row[2] if len(row) > 2 else ""
            city        = row[3] if len(row) > 3 else ""
            state       = row[4] if len(row) > 4 else "ME"
            zip_code    = row[5] if len(row) > 5 else ""
            phone       = row[6] if len(row) > 6 else ""
            category    = row[7] if len(row) > 7 else ""
        else:
            # Name-only fallback (Strategy C last resort)
            license_num = ""
            name        = row[0]
            address     = ""
            city        = ""
            state       = "ME"
            zip_code    = ""
            phone       = ""
            category    = ""

        name = name.strip()
        if not name or len(name) < 2:
            continue

        # Skip lines that are obviously not company names
        if re.match(r"^\d+$", name):
            continue

        # Parse waste category codes and map to service types
        cat_codes = parse_categories(category)
        service_types = categories_to_service_types(cat_codes)

        # Build license_metadata with ME-specific fields
        license_metadata: dict[str, str] = {}
        if cat_codes:
            license_metadata["me_waste_category"] = ",".join(sorted(cat_codes))

        mapped.append({
            "name": name,
            "address": address.strip() or None,
            "city": city.strip() or None,
            "state": (state.strip().upper() or "ME")[:2],
            "zip": zip_code.strip() or None,
            "phone": clean_phone(phone),
            "license_number": license_num.strip() or None,
            "service_types": service_types,
            "license_metadata": license_metadata,
        })

    return mapped


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=== WasteDirectory — Maine DEP Non-Haz Transporter Importer ===")
    print(datetime.utcnow().isoformat())

    # ── 1. Scan data page (supplementary) ─────────────────────────────────────
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

    # ── 3. Extract text (layout=True preserves fixed-width spacing) ───────────
    try:
        all_lines, page1_text = extract_all_text(pdf_bytes)
    except Exception as exc:
        print(f"\nFailed to extract text from PDF: {exc}", file=sys.stderr)
        sys.exit(1)

    # Always print full page 1 raw text so we can see the exact format
    print(f"\n{'='*60}")
    print(f"FULL PAGE 1 RAW TEXT ({len(page1_text)} chars):")
    print(f"{'='*60}")
    print(page1_text)
    print(f"{'='*60}\n")

    # ── 4. Parse fixed-width lines ────────────────────────────────────────────
    raw_rows, col_names, col_offsets = parse_lines(all_lines)
    print(f"\n  Total rows after parsing: {len(raw_rows)}")

    # ── 5. Map to schema ──────────────────────────────────────────────────────
    mapped = map_records(raw_rows, col_names)
    print(f"  Records mapped to schema: {len(mapped)}")

    if not mapped:
        print("\nNo records mapped — review the PAGE 1 RAW TEXT and DIAGNOSTIC output above.")
        sys.exit(0)

    if len(mapped) > SAFE_MAX:
        print(f"\nSAFE_MAX exceeded ({len(mapped)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # ── 6. Connect to Supabase ────────────────────────────────────────────────
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print(
            "\nMissing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # ── 7. Load existing orgs for dedup ───────────────────────────────────────
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

    # ── 8. Classify records ───────────────────────────────────────────────────
    to_update:          list[tuple[dict, dict]] = []  # (existing_org, record) — name-matched
    slug_matched_updates: list[tuple[str, dict]] = []  # (slug, record) — slug-matched only
    to_insert:          list[dict] = []
    seen_slugs:         set[str]   = set()
    skipped_no_name = 0

    for record in mapped:
        name = record["name"]
        if not name:
            skipped_no_name += 1
            continue

        name_key = normalize_name(name)
        existing = existing_name_map.get(name_key)

        if existing:
            # Always update to refresh service_types and license_metadata
            to_update.append((existing, record))
            continue

        base_slug = slugify(name, record.get("city") or "")
        if not base_slug:
            skipped_no_name += 1
            continue

        # If the natural slug is already in DB (but name didn't match), update it
        # rather than creating a duplicate with a -N suffix.
        if base_slug in existing_slug_set:
            slug_matched_updates.append((base_slug, record))
            continue

        # New record — ensure slug is unique within this batch
        slug = base_slug
        counter = 1
        while slug in seen_slugs:
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
            "service_types": record["service_types"],
            "license_metadata": record["license_metadata"],
            "service_area_states": SERVICE_AREA_STATES,
            "verified": True,
            "active": True,
            "data_source": DATA_SOURCE,
        })

    print(f"\n  Name-matched (will update):      {len(to_update)}")
    print(f"  Slug-matched (will update):      {len(slug_matched_updates)}")
    print(f"  New records to insert:           {len(to_insert)}")
    if skipped_no_name:
        print(f"  Skipped (no name):               {skipped_no_name}")

    # ── 9. Update existing orgs ───────────────────────────────────────────────
    update_errors = 0
    for existing, record in to_update:
        current_states = existing.get("service_area_states") or []
        update_payload: dict = {
            "service_types": record["service_types"],
            "license_metadata": record["license_metadata"],
        }
        if "ME" not in current_states:
            update_payload["service_area_states"] = list(current_states) + ["ME"]
        try:
            supabase.table("organizations").update(update_payload).eq("id", existing["id"]).execute()
            print(f"  ✓ Updated {existing['slug']} — service_types={record['service_types']}")
        except Exception as exc:
            print(f"  ✗ Update failed for {existing['slug']}: {exc}")
            update_errors += 1

    # ── 9b. Update slug-matched existing orgs (name didn't match, slug did) ─────
    slug_update_errors = 0
    slug_updated = 0

    for slug, record in slug_matched_updates:
        try:
            supabase.table("organizations").update({
                "service_types":    record["service_types"],
                "license_metadata": record["license_metadata"],
            }).eq("slug", slug).execute()
            slug_updated += 1
            print(f"  ✓ Slug-updated {slug} — service_types={record['service_types']}")
        except Exception as exc:
            print(f"  ✗ Slug update failed for {slug}: {exc}")
            slug_update_errors += 1

    # ── 10. Insert new records ────────────────────────────────────────────────
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

    # ── 11. Summary ───────────────────────────────────────────────────────────
    total_errors = update_errors + slug_update_errors + insert_errors
    print("\n=== Summary ===")
    print(f"  Total lines parsed   : {len(raw_rows)}")
    print(f"  Mapped to schema     : {len(mapped)}")
    print(f"  Name-matched/updated : {len(to_update)}")
    print(f"  Slug-matched/updated : {slug_updated}")
    print(f"  Newly inserted       : {newly_inserted}")
    print(f"  Errors               : {total_errors}")

    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
