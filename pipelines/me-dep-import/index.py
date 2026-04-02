#!/usr/bin/env python3
"""
pipelines/me-dep-import/index.py

Imports Maine DEP non-hazardous waste transporters from the Maine DEP
data portal PDF.

Parsing strategy: locate the STATE + PHONE pattern via re.search(), then
split everything before that anchor on 2+ spaces to get name / address /
city. This is more reliable than a full left-to-right regex because the
left side has variable-length fields separated by inconsistent spacing,
while the right side (state, phone, categories, expiry) is always
structured.

Multi-line records: lines with no phone match are treated as company-name
continuations and appended to the previous record.

PDF source:
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

import pdfplumber
import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

# Set to True to print parsed records and exit WITHOUT touching the database.
# Flip to False once parsing is confirmed correct.
DIAGNOSTIC_ONLY = False

DATA_SOURCE      = "me_dep_2026"
SERVICE_AREA_STATES = ["ME"]
SAFE_MAX         = 1000
BATCH_SIZE       = 50

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

# ME DEP waste category code → service_types mapping
# A = Special/C&D Waste (roll-off, industrial)
# B = Municipal Solid Waste (residential, commercial)
# C = Septage & Holding Tank Waste (residential, septage)
CATEGORY_SERVICE_MAP: dict[str, list[str]] = {
    "A": ["roll_off", "industrial"],
    "B": ["residential", "commercial"],
    "C": ["residential", "septage"],
}

CATEGORY_DESCRIPTIONS: dict[str, str] = {
    "A": "Special/C&D Waste",
    "B": "Municipal Solid Waste",
    "C": "Septage & Holding Tank Waste",
}

# Lines to unconditionally skip (headers, footers, legend lines)
SKIP_PATTERNS = re.compile(
    r"maine\.gov|page \d|printed|report date|non-haz|active transporter|"
    r"department of environmental|^\s*-+\s*$|"
    r"category [a-c] is|category [a-c]:|company name|city or town|telephone",
    re.IGNORECASE,
)

# Anchor pattern: matches the structured right side of a data line.
# Used with re.search() so leading spaces / variable name widths don't matter.
# Groups:
#   1 = state code  (ME, NH, MA, etc.)
#   2 = area code   (3 digits)
#   3 = phone rest  (NNN-NNNN or similar)
#   4 = category codes (space-separated A / B / C, may be empty)
#   5 = expiry date  (M/D/YYYY or MM/DD/YYYY)
PHONE_ANCHOR_RE = re.compile(
    r"(ME|NH|MA|NY|NJ|CT|VT|NC|IN|PA|NJ)\s+"
    r"\((\d{3})\)\s*([\d-]+)\s+"
    r"([A-C](?:\s+[A-C])*|)\s+"
    r"(\d{1,2}/\d{1,2}/\d{4})"
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


def parse_expiry(raw: str) -> str | None:
    """Convert M/D/YYYY or MM/DD/YYYY to YYYY-MM-DD."""
    try:
        return datetime.strptime(raw.strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def parse_categories(raw: str) -> list[str]:
    """Extract unique sorted category codes (A, B, C) from a raw field."""
    return sorted(set(re.findall(r"\b([A-C])\b", raw.upper())))


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


# ── Step 1: Scan data page ─────────────────────────────────────────────────────

def scan_data_page() -> list[str]:
    """Fetch the ME DEP data page and return transporter-related PDF links."""
    print(f"\nScanning {DATA_PAGE_URL} for transporter links...")
    found: list[str] = []
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


# ── Step 3: Extract text ───────────────────────────────────────────────────────

def extract_all_lines(pdf_bytes: bytes) -> tuple[list[str], str]:
    """
    Extract text from all pages using layout=True to preserve column spacing.
    Returns (all_lines, page1_full_text).
    """
    all_lines: list[str] = []
    page1_text: str = ""

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"\n  PDF pages: {len(pdf.pages)}")

        for page_num, page in enumerate(pdf.pages, start=1):
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


# ── Step 4: Parse records using phone-pattern anchor ──────────────────────────

def split_name_address(text: str) -> tuple[str, str, str]:
    """
    Given a string that merges company name + address (+ optionally city)
    with only single spaces, split at the first address-start boundary.

    Recognised address starters:
      • Numeric:  '147 PINKHAM...', '12 MEDOMAK...'
      • PO BOX:   'PO BOX 321', 'P.O. BOX 45', 'P O BOX 7'

    The split point is found with re.search() so leading company-name
    words are untouched.  The remainder is itself split on 2+ spaces to
    separate address from city.

    Returns (name, address, city) — address/city may be empty strings.
    """
    addr_match = re.search(
        r"(?<=\S)\s+(P\.?\s*O\.?\s+BOX\s+\d+|\d+\s+\S)",
        text,
        re.IGNORECASE,
    )
    if addr_match:
        name = text[: addr_match.start()].strip()
        rest = text[addr_match.start() :].strip()
        rest_parts = [p.strip() for p in re.split(r"\s{2,}", rest) if p.strip()]
        address = rest_parts[0] if rest_parts else rest
        city    = rest_parts[1] if len(rest_parts) > 1 else ""
        return name, address, city

    return text.strip(), "", ""


def parse_line(line: str) -> dict | None:
    """
    Parse a single data line by locating the structured right-side anchor
    (state + phone + categories + expiry) and splitting everything before
    it on 2+ spaces to get name / address / city.

    Two common problem cases handled:
      • len(parts) == 2: parts[0] has name+address merged with single
        spaces; parts[1] is the city (e.g. '...INC 147 PINKHAM BROOK RD'
        then double-space then 'DURHAM').  Apply split_name_address() to
        parts[0] and use the cleaner city from parts[1].
      • len(parts) == 1: entire left side is unseparated.  Apply
        split_name_address() which may recover address and city from rest.

    Returns None if the line has no phone pattern (continuation line).
    """
    m = PHONE_ANCHOR_RE.search(line)
    if not m:
        return None

    # Everything to the left of the anchor is name + address + city
    before = line[: m.start()].strip()
    parts  = re.split(r"\s{2,}", before)
    parts  = [p.strip() for p in parts if p.strip()]

    if len(parts) >= 3:
        name    = parts[0]
        address = parts[1]
        city    = parts[2]
    elif len(parts) == 2:
        # parts[0] may have name+address merged; parts[1] is city.
        # Try to split parts[0] on an address boundary first.
        split_name, split_addr, _ = split_name_address(parts[0])
        if split_addr:
            name    = split_name
            address = split_addr
            city    = parts[1]
        else:
            # No address boundary found — treat as name + city
            name    = parts[0]
            address = parts[1]
            city    = ""
    elif len(parts) == 1:
        # No double-space separator at all — try address-boundary split
        name, address, city = split_name_address(parts[0])
    else:
        return None  # nothing useful before the anchor

    state      = m.group(1)
    phone      = f"({m.group(2)}) {m.group(3)}"
    cat_raw    = m.group(4).strip()
    expiry_raw = m.group(5)

    expiry    = parse_expiry(expiry_raw)
    cat_codes = parse_categories(cat_raw)

    license_metadata: dict[str, str] = {}
    if cat_codes:
        license_metadata["me_waste_category"] = " ".join(cat_codes)
        descriptions = [
            CATEGORY_DESCRIPTIONS[c] for c in cat_codes if c in CATEGORY_DESCRIPTIONS
        ]
        if descriptions:
            license_metadata["me_category_descriptions"] = ", ".join(descriptions)
    if expiry:
        license_metadata["me_license_expiry"] = expiry

    return {
        "name":             name,
        "address":          address or None,
        "city":             city or None,
        "state":            state,
        "phone":            phone,
        "zip":              None,
        "license_number":   None,
        "license_expiry":   expiry,
        "service_types":    categories_to_service_types(cat_codes),
        "license_metadata": license_metadata,
    }


def parse_records(all_lines: list[str]) -> list[dict]:
    """
    Walk all extracted PDF lines, building records via parse_line().
    Lines that return None are treated as company-name continuations
    and appended to the previous record's name.
    """
    parsed:            list[dict] = []
    pending:           dict | None = None
    matched_count      = 0
    continuation_count = 0
    skipped_count      = 0

    for line in all_lines:
        stripped = line.strip()

        if not stripped:
            continue
        if SKIP_PATTERNS.search(stripped):
            skipped_count += 1
            continue

        result = parse_line(line)

        if result:
            # Flush previous pending record
            if pending is not None:
                parsed.append(pending)
            pending = result
            matched_count += 1
        else:
            # No phone anchor — continuation of previous record's name
            if pending is not None and len(stripped) >= 2:
                pending["name"] = pending["name"] + " " + stripped
                continuation_count += 1
            else:
                skipped_count += 1

    # Flush the last record
    if pending is not None:
        parsed.append(pending)

    print(f"\n  Phone-anchor matches : {matched_count}")
    print(f"  Continuation lines   : {continuation_count}")
    print(f"  Skipped lines        : {skipped_count}")
    print(f"  Total records parsed : {len(parsed)}")

    return parsed


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=== WasteDirectory — Maine DEP Non-Haz Transporter Importer ===")
    print(datetime.utcnow().isoformat())

    # ── 1. Scan data page (supplementary link discovery) ──────────────────────
    extra_urls = scan_data_page()

    # ── 2. Find and download PDF ──────────────────────────────────────────────
    print(f"\nTrying direct URLs first, then {len(extra_urls)} page links...")
    pdf_url, pdf_bytes = find_pdf(extra_urls)

    if not pdf_bytes:
        print("\n=== No PDF found ===")
        print("Tried the following URLs:")
        for url in list(dict.fromkeys(DIRECT_URLS + extra_urls)):
            print(f"  {url}")
        print("\nAction needed:")
        print("  1. Visit https://www.maine.gov/dep/maps-data/data.html manually")
        print("  2. Find the non-hazardous transporter list download link")
        print("  3. Update DIRECT_URLS in this script with the correct URL")
        sys.exit(0)

    print(f"\nUsing PDF from: {pdf_url}")

    # ── 3. Extract all text lines from the PDF ────────────────────────────────
    try:
        all_lines, page1_text = extract_all_lines(pdf_bytes)
    except Exception as exc:
        print(f"\nFailed to extract text from PDF: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"  Total lines extracted: {len(all_lines)}")

    # ── 4. Parse records with right-anchored regex ────────────────────────────
    mapped = parse_records(all_lines)

    if not mapped:
        print("\nNo records parsed — check PDF structure.")
        print("\nFirst 30 lines of page 1 (for debugging):")
        for i, line in enumerate(page1_text.split("\n")[:30], start=1):
            print(f"  {i:4d} | {repr(line)}")
        sys.exit(0)

    # ── 5. Print first 10 parsed records as verification ─────────────────────
    print(f"\n{'='*72}")
    print("FIRST 10 PARSED RECORDS — verify before inserting")
    print(f"{'='*72}")
    header = f"{'Name':<38} {'City':<18} {'St'} {'Phone':<15} {'Cat':<8} Expiry"
    print(header)
    print("-" * 72)
    for rec in mapped[:10]:
        cats = rec["license_metadata"].get("me_waste_category", "")
        print(
            f"{rec['name'][:38]:<38} "
            f"{(rec['city'] or '')[:18]:<18} "
            f"{rec['state']}  "
            f"{(rec['phone'] or ''):<15} "
            f"{cats:<8} "
            f"{rec['license_expiry'] or ''}"
        )
    print(f"{'='*72}\n")

    # ── DIAGNOSTIC MODE: exit before any database operations ──────────────────
    if DIAGNOSTIC_ONLY:
        print("DIAGNOSTIC_ONLY = True — exiting before DB operations.")
        print("Review the parsed records above, then set DIAGNOSTIC_ONLY = False.")
        sys.exit(0)

    if len(mapped) > SAFE_MAX:
        print(f"\nSAFE_MAX exceeded ({len(mapped)} > {SAFE_MAX}). Aborting.")
        sys.exit(1)

    # ── 6. Connect to Supabase ────────────────────────────────────────────────
    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print(
            "\nMissing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # ── 7. Wipe any previously imported ME DEP records (clean slate) ──────────
    # This ensures stale or misaligned records from earlier runs are removed
    # before the freshly parsed data is inserted.
    print("\nDeleting previously imported ME DEP records ...")
    try:
        del_result = (
            supabase.table("organizations")
            .delete()
            .eq("data_source", DATA_SOURCE)
            .execute()
        )
        deleted_count = len(del_result.data) if del_result.data else 0
        print(f"  Deleted {deleted_count} existing ME DEP records")
    except Exception as exc:
        print(f"  Warning: could not delete existing records: {exc}")

    # ── 8. Load existing orgs for dedup ───────────────────────────────────────
    print("\nLoading existing organizations for dedup...")
    existing_name_map: dict[str, dict] = {}
    existing_slug_set: set[str] = set()
    page_size = 1000
    db_offset = 0

    while True:
        result = (
            supabase.table("organizations")
            .select("id, name, slug, service_area_states")
            .range(db_offset, db_offset + page_size - 1)
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
        db_offset += page_size

    print(f"  Loaded {len(existing_name_map)} existing organizations")

    # ── 9. Classify records ───────────────────────────────────────────────────
    to_update:           list[tuple[dict, dict]] = []  # (existing_org, record) — name-matched
    slug_matched_updates: list[tuple[str, dict]] = []  # (slug, record) — slug-only match
    to_insert:           list[dict] = []
    seen_slugs:          set[str]   = set()
    skipped_no_name = 0

    for record in mapped:
        name = record["name"]
        if not name or len(name) < 2:
            skipped_no_name += 1
            continue

        name_key = normalize_name(name)
        existing = existing_name_map.get(name_key)

        if existing:
            # Name match → always update metadata
            to_update.append((existing, record))
            continue

        base_slug = slugify(name, record.get("city") or "")
        if not base_slug:
            skipped_no_name += 1
            continue

        # Slug match (name didn't match) → update metadata, don't create duplicate
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
            "name":                name,
            "slug":                slug,
            "org_type":            "hauler",
            "phone":               record["phone"],
            "address":             record["address"],
            "city":                record["city"],
            "state":               record["state"],
            "zip":                 record["zip"],
            "license_number":      record["license_number"],
            "license_expiry":      record["license_expiry"],
            "service_types":       record["service_types"],
            "license_metadata":    record["license_metadata"],
            "service_area_states": SERVICE_AREA_STATES,
            "verified":            True,
            "active":              True,
            "data_source":         DATA_SOURCE,
        })

    print(f"\n  Name-matched (will update):      {len(to_update)}")
    print(f"  Slug-matched (will update):      {len(slug_matched_updates)}")
    print(f"  New records to insert:           {len(to_insert)}")
    if skipped_no_name:
        print(f"  Skipped (no name):               {skipped_no_name}")

    # ── 10. Update name-matched existing orgs ─────────────────────────────────
    update_errors = 0
    for existing, record in to_update:
        current_states = existing.get("service_area_states") or []
        update_payload: dict = {
            "service_types":    record["service_types"],
            "license_metadata": record["license_metadata"],
            "license_expiry":   record["license_expiry"],
        }
        if "ME" not in current_states:
            update_payload["service_area_states"] = list(current_states) + ["ME"]
        try:
            supabase.table("organizations").update(update_payload).eq("id", existing["id"]).execute()
        except Exception as exc:
            print(f"  ✗ Update failed for {existing['slug']}: {exc}")
            update_errors += 1

    if to_update:
        print(f"  ✓ Updated {len(to_update) - update_errors} name-matched records")

    # ── 10b. Update slug-matched orgs ─────────────────────────────────────────
    slug_update_errors = 0
    slug_updated = 0
    for slug, record in slug_matched_updates:
        try:
            supabase.table("organizations").update({
                "service_types":    record["service_types"],
                "license_metadata": record["license_metadata"],
                "license_expiry":   record["license_expiry"],
            }).eq("slug", slug).execute()
            slug_updated += 1
        except Exception as exc:
            print(f"  ✗ Slug update failed for {slug}: {exc}")
            slug_update_errors += 1

    if slug_matched_updates:
        print(f"  ✓ Updated {slug_updated} slug-matched records")

    # ── 11. Insert new records ─────────────────────────────────────────────────
    insert_errors  = 0
    newly_inserted = 0

    if to_insert:
        # Final slug safety check against DB
        slugs_to_check = [o["slug"] for o in to_insert]
        check_result = (
            supabase.table("organizations")
            .select("slug")
            .in_("slug", slugs_to_check)
            .execute()
        )
        db_slugs = {row["slug"] for row in check_result.data}
        new_orgs = [o for o in to_insert if o["slug"] not in db_slugs]

        if db_slugs:
            print(f"  Slug-matched to existing (skipped): {len(db_slugs)}")
        print(f"  Net new to insert after slug dedup: {len(new_orgs)}")

        for i in range(0, len(new_orgs), BATCH_SIZE):
            batch     = new_orgs[i : i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            try:
                supabase.table("organizations").insert(batch).execute()
                newly_inserted += len(batch)
                print(f"  ✓ Batch {batch_num}: inserted {len(batch)} records")
            except Exception as exc:
                print(f"  ✗ Batch {batch_num} failed: {exc}")
                insert_errors += 1

    # ── 12. Summary ───────────────────────────────────────────────────────────
    total_errors = update_errors + slug_update_errors + insert_errors
    print("\n=== Summary ===")
    print(f"  Total records parsed : {len(mapped)}")
    print(f"  Name-matched/updated : {len(to_update) - update_errors}")
    print(f"  Slug-matched/updated : {slug_updated}")
    print(f"  Newly inserted       : {newly_inserted}")
    print(f"  Errors               : {total_errors}")

    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
