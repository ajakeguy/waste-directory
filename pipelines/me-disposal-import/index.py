#!/usr/bin/env python3
"""
pipelines/me-disposal-import/index.py

Imports Maine DEP disposal facility records into the disposal_facilities table.

Sources (downloaded fresh at runtime from Maine DEP public servers):
  1. Transfer Stations  -> swactivelict.pdf  (~250 records, 7 pages)
  2. Landfills          -> swactiveliclf.pdf (~35  records, 2 pages)
  3. Processors         -> swactivelicp.pdf  (~130 records, 4 pages)

Column boundaries verified from PDF header word x-coordinates:
  Transfer Stations: location <155, licensee 155-349, address 349-583,
                     phone 583-664, dep 664+
  Landfills:         location <113, licensee 113-349, address 349-585,
                     phone 585-688, dep 688+
  Processors:        parsed via extract_text() + right-to-left regex
                     (columns overflow for long licensee names)

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
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; WasteDirectory/1.0)",
    "Referer": "https://www.maine.gov/dep/maps-data/data.html",
}

SAFE_MAX   = 500
BATCH_SIZE = 50

URL_TS   = "https://www.maine.gov/dep/maps-data/documents/swactivelict.pdf"
URL_LF   = "https://www.maine.gov/dep/ftp/reports/swactiveliclf.pdf"
URL_PROC = "https://www.maine.gov/dep/ftp/reports/swactivelicp.pdf"

# Transfer-station column x-ranges (from PDF header positions)
TS_COLS = {
    "location": (0,   155),
    "licensee": (155, 349),
    "address":  (349, 583),
    "phone":    (583, 664),
    "dep":      (664, 999),
}

# Landfill column x-ranges
LF_COLS = {
    "location": (0,   113),
    "licensee": (113, 349),
    "address":  (349, 585),
    "phone":    (585, 688),
    "dep":      (688, 999),
}

# ---------------------------------------------------------------------------
# Regex helpers
# ---------------------------------------------------------------------------

PHONE_FMT_RE = re.compile(r"\((\d{3})\)\s*(\d{3})-(\d{4})")
PHONE_RAW_RE = re.compile(r"(?<!\d)(\d{10})(?!\d)")
DEP_RE       = re.compile(r"(S-\d{6}-[A-Z]{2}[\w\s-]+)", re.IGNORECASE)
ME_ZIP_RE    = re.compile(r"\bME\s+(\d{4,5})\s*$", re.IGNORECASE)
COMMA_ZIP_RE = re.compile(r",\s*([A-Z]{2})\s+(\d{4,5})\s*$", re.IGNORECASE)

SKIP_LINE_RE = re.compile(
    r"^(Maine\s+Dep|ACTIVE/|Location|LOCATION|Licensee|Address|"
    r"Telephone|DEP\s+Number|DEP\s+NUMBER|Page\s+\d|\d+/\d+/\d{4})\b",
    re.IGNORECASE,
)

_UPPER_KEEP = {
    "LLC", "INC", "LTD", "DBA", "USA", "PO", "RD", "RD,",
    "ST", "AVE", "DR", "HWY", "RT", "STE", "TWP", "CORP",
    "CO", "NE", "NW", "SE", "SW", "DECD", "JR", "SR",
}


def title_case(s: str) -> str | None:
    if not s or not s.strip():
        return None
    words = s.strip().title().split()
    out = []
    for w in words:
        core = w.upper().rstrip(".,")
        out.append(core if core in _UPPER_KEEP else w)
    return " ".join(out)


def clean_phone_fmt(raw: str) -> str | None:
    """Parse (NNN) NNN-NNNN formatted phone."""
    m = PHONE_FMT_RE.search(raw)
    if m:
        return f"({m.group(1)}) {m.group(2)}-{m.group(3)}"
    return None


def clean_phone_raw(raw: str) -> str | None:
    """Parse raw 10-digit phone (landfill format)."""
    m = PHONE_RAW_RE.search(raw)
    if m:
        d = m.group(1)
        return f"({d[:3]}) {d[3:6]}-{d[6:]}"
    return None


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", "-", text.strip())
    return text[:100]


def make_slug(name: str, city: str = "") -> str:
    return slugify(f"{name} {city}".strip())


# ---------------------------------------------------------------------------
# PDF fetch
# ---------------------------------------------------------------------------

def fetch_pdf(url: str, label: str) -> bytes | None:
    print(f"  Fetching {label} ...")
    try:
        r = requests.get(url, headers=HTTP_HEADERS, timeout=30)
        if r.status_code != 200:
            print(f"  [ERR] HTTP {r.status_code}")
            return None
        print(f"  OK ({len(r.content):,} bytes)")
        return r.content
    except Exception as exc:
        print(f"  [ERR] {exc}")
        return None


# ---------------------------------------------------------------------------
# Column-based word extraction (Transfer Stations + Landfills)
# ---------------------------------------------------------------------------

def extract_col_rows(page, col_ranges: dict) -> list[dict[str, str]]:
    """
    Group words on a page by row (y-coord) and column (x-range).
    Returns list of {col_name: joined_text} dicts for rows that have a DEP#.
    """
    words = page.extract_words(x_tolerance=3, y_tolerance=3)
    rows: dict[float, dict] = {}
    for w in words:
        y = round(w["top"], 0)
        rows.setdefault(y, {col: [] for col in col_ranges})
        for col, (x0, x1) in col_ranges.items():
            if x0 <= w["x0"] < x1:
                rows[y][col].append(w["text"])
    result = []
    for _y, buckets in sorted(rows.items()):
        t = {k: " ".join(v) for k, v in buckets.items()}
        dep_text = t.get("dep", "") + " " + t.get("phone", "")
        if DEP_RE.search(dep_text):
            result.append(t)
    return result


# ---------------------------------------------------------------------------
# Transfer Stations parser
# ---------------------------------------------------------------------------

def parse_ts_row(t: dict[str, str]) -> dict | None:
    licensee = t.get("licensee", "").strip()
    addr_raw = t.get("address", "").strip()
    phone_raw = t.get("phone", "").strip()
    dep_raw  = t.get("dep", "").strip()
    location = t.get("location", "").strip()

    # DEP number
    permit = None
    for txt in (dep_raw, dep_raw + " " + phone_raw):
        m = DEP_RE.search(txt)
        if m:
            permit = m.group(1).strip()
            break
    if not permit:
        return None

    # Phone (formatted)
    phone = clean_phone_fmt(phone_raw) or clean_phone_fmt(addr_raw)

    # Address: "STREET, CITY, ME ZIP"
    city = None
    zip_code = None
    street = addr_raw
    cm = COMMA_ZIP_RE.search(addr_raw)
    if cm:
        zip_code = cm.group(2).zfill(5)
        before = addr_raw[: cm.start()].strip().rstrip(",")
        if "," in before:
            parts = before.rsplit(",", 1)
            city   = title_case(parts[1].strip())
            street = parts[0].strip()
        else:
            street = before

    # Name from licensee column; fall back to location
    name = title_case(licensee) or title_case(location) or "Unknown"

    return {
        "name":          name,
        "facility_type": "transfer_station",
        "address":       title_case(street) if street else None,
        "city":          city or title_case(location),
        "state":         "ME",
        "zip":           zip_code,
        "phone":         phone,
        "permit_number": permit,
        "permit_status": "active",
        "service_area_states": ["ME"],
        "data_source":   "me_dep_transfer_2025",
        "accepts_msw":   True,
        "verified":      True,
        "active":        True,
    }


def import_transfer_stations(pdf_bytes: bytes) -> list[dict]:
    records: list[dict] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"  Pages: {len(pdf.pages)}")
        for page_num, page in enumerate(pdf.pages, 1):
            rows = extract_col_rows(page, TS_COLS)
            page_recs = [r for row in rows if (r := parse_ts_row(row))]
            records.extend(page_recs)
            print(f"  Page {page_num}: {len(page_recs)} records")
    return records


# ---------------------------------------------------------------------------
# Landfills parser
# ---------------------------------------------------------------------------

def parse_lf_address(addr_raw: str, location: str) -> tuple[str | None, str | None, str | None]:
    """
    Landfill addresses are space-delimited: 'STREET CITY ME ZIP'
    Returns (street, city, zip_code).
    """
    m = ME_ZIP_RE.search(addr_raw)
    if m:
        zip_code = m.group(1).zfill(5)
        before   = addr_raw[: m.start()].strip()
        # street = everything before the city; we can't reliably separate street
        # from city in space-delimited format, so use location as city
        return title_case(before), title_case(location), zip_code
    return title_case(addr_raw) if addr_raw else None, title_case(location), None


def parse_lf_row(t: dict[str, str]) -> dict | None:
    licensee = t.get("licensee", "").strip()
    addr_raw = t.get("address", "").strip()
    phone_raw = t.get("phone", "").strip()
    dep_raw  = t.get("dep", "").strip()
    location = t.get("location", "").strip()

    # DEP number
    permit = None
    for txt in (dep_raw, dep_raw + " " + phone_raw):
        m = DEP_RE.search(txt)
        if m:
            permit = m.group(1).strip()
            break
    if not permit:
        return None

    # Phone (raw 10-digit format in landfill PDFs)
    phone = clean_phone_raw(phone_raw) or clean_phone_raw(addr_raw)

    # Address
    street, city, zip_code = parse_lf_address(addr_raw, location)

    # Name
    name = title_case(licensee) or title_case(location) or "Unknown"

    return {
        "name":          name,
        "facility_type": "landfill",
        "address":       street,
        "city":          city,
        "state":         "ME",
        "zip":           zip_code,
        "phone":         phone,
        "permit_number": permit,
        "permit_status": "active",
        "service_area_states": ["ME"],
        "data_source":   "me_dep_landfill_2025",
        "accepts_msw":   True,
        "verified":      True,
        "active":        True,
    }


def import_landfills(pdf_bytes: bytes) -> list[dict]:
    records: list[dict] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"  Pages: {len(pdf.pages)}")
        for page_num, page in enumerate(pdf.pages, 1):
            rows = extract_col_rows(page, LF_COLS)
            page_recs = [r for row in rows if (r := parse_lf_row(row))]
            records.extend(page_recs)
            print(f"  Page {page_num}: {len(page_recs)} records")
    return records


# ---------------------------------------------------------------------------
# Processors parser  (text + right-to-left regex)
# ---------------------------------------------------------------------------
# NOTE: These are Maine DEP "licensed processors" — a broad category covering
# C&D processors, recyclers, mulch producers, and some composting operations.
# We use facility_type='recycling_center' as the best available type.

def parse_proc_line(line: str) -> dict | None:
    line = line.strip()
    if not line or SKIP_LINE_RE.match(line):
        return None

    # 1. DEP# from end
    dep_m = DEP_RE.search(line)
    if not dep_m:
        return None
    permit = dep_m.group(1).strip()
    rest   = line[: dep_m.start()].strip()

    # 2. Phone before DEP#
    phone_m = PHONE_FMT_RE.search(rest)
    phone   = None
    if phone_m:
        phone = f"({phone_m.group(1)}) {phone_m.group(2)}-{phone_m.group(3)}"
        rest  = rest[: phone_m.start()].strip()

    # 3. Address ends with ", STATE ZIP"
    cm = COMMA_ZIP_RE.search(rest)
    if not cm:
        return None
    zip_code = cm.group(2).zfill(5)
    before   = rest[: cm.start()].strip().rstrip(",")

    # 4. City = last token before ", STATE ZIP"
    city   = None
    street = before
    if "," in before:
        parts  = before.rsplit(",", 1)
        city   = title_case(parts[1].strip())
        street = parts[0].strip()

    # 5. Split street into "LOCATION LICENSEE STREET"
    #    Address starts at first digit or PO BOX token
    addr_start = re.search(
        r"(?:^|\s)(\d{1,5}\s+\w|\bP\.?\s*O\.?\s*BOX\b|\bPO\s+BOX\b)",
        street,
        re.IGNORECASE,
    )
    if addr_start:
        loc_lic = street[: addr_start.start()].strip()
        addr    = street[addr_start.start():].strip()
    else:
        loc_lic = street
        addr    = None

    # 6. Name = everything after first word (the municipality/location)
    words = loc_lic.split()
    if not words:
        return None
    # Handle multi-word town designations ending in TWP, PLT, etc.
    skip = 1
    if len(words) >= 2 and re.fullmatch(r"[A-Z0-9]{1,4}", words[1]):
        skip = 2
    name_words = words[skip:]
    name = title_case(" ".join(name_words)) if name_words else title_case(words[0])

    if not name:
        return None

    return {
        "name":          name,
        "facility_type": "recycling_center",
        "address":       title_case(addr) if addr else None,
        "city":          city,
        "state":         "ME",
        "zip":           zip_code,
        "phone":         phone,
        "permit_number": permit,
        "permit_status": "active",
        "service_area_states": ["ME"],
        "data_source":   "me_dep_processor_2025",
        "accepts_recycling": True,
        "verified":      True,
        "active":        True,
    }


def import_processors(pdf_bytes: bytes) -> list[dict]:
    records: list[dict] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"  Pages: {len(pdf.pages)}")
        for page_num, page in enumerate(pdf.pages, 1):
            text       = page.extract_text() or ""
            page_recs  = []
            for line in text.split("\n"):
                rec = parse_proc_line(line)
                if rec:
                    page_recs.append(rec)
            records.extend(page_recs)
            print(f"  Page {page_num}: {len(page_recs)} records")
    return records


# ---------------------------------------------------------------------------
# Slug dedup + batch insert
# ---------------------------------------------------------------------------

def batch_insert(
    supabase: Client,
    records: list[dict],
    existing_slugs: set[str],
    slug_counter: dict[str, int],
    label: str,
) -> tuple[int, int, int]:
    to_insert: list[dict] = []
    skipped = 0

    for rec in records:
        base_slug = make_slug(rec.get("name", ""), rec.get("city") or "")
        if not base_slug:
            continue
        if base_slug in existing_slugs:
            skipped += 1
            continue
        n    = slug_counter.get(base_slug, 0)
        slug = base_slug if n == 0 else f"{base_slug}-{n}"
        while slug in existing_slugs:
            n   += 1
            slug = f"{base_slug}-{n}"
        slug_counter[base_slug] = n + 1
        existing_slugs.add(slug)
        row = dict(rec)
        row["slug"] = slug
        to_insert.append(row)

    print(f"  [{label}] already in DB: {skipped}  to insert: {len(to_insert)}")

    inserted = 0
    errors   = 0
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch     = to_insert[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            supabase.table("disposal_facilities").insert(batch).execute()
            inserted += len(batch)
            print(f"  [OK] Batch {batch_num}: inserted {len(batch)}")
        except Exception as exc:
            print(f"  [ERR] Batch {batch_num}: {exc}")
            errors += 1

    return skipped, inserted, errors


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("Maine DEP Disposal Facilities Importer")
    print(f"Run date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("[ERR] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    supabase: Client = create_client(supabase_url, service_role_key)

    # Load existing slugs to dedup
    print("\nLoading existing slugs ...")
    existing_slugs: set[str] = set()
    page_size = 1000
    offset    = 0
    while True:
        resp = (
            supabase.table("disposal_facilities")
            .select("slug")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = resp.data or []
        for r in batch:
            existing_slugs.add(r["slug"])
        if len(batch) < page_size:
            break
        offset += page_size
    print(f"Existing facilities in DB: {len(existing_slugs)}")

    slug_counter: dict[str, int] = {}
    summary: list[tuple] = []
    total_inserted = 0
    total_errors   = 0

    # -- Transfer Stations ----------------------------------------------------
    print("\n--- Transfer Stations ---")
    ts_bytes = fetch_pdf(URL_TS, "swactivelict.pdf")
    if ts_bytes:
        ts_records = import_transfer_stations(ts_bytes)
        print(f"  Total parsed: {len(ts_records)}")
        if len(ts_records) > SAFE_MAX:
            print(f"  [ERR] SAFE_MAX exceeded ({len(ts_records)} > {SAFE_MAX}). Skipping.")
            summary.append(("Transfer Stations", len(ts_records), 0, 0, 1))
        else:
            sk, ins, err = batch_insert(supabase, ts_records, existing_slugs, slug_counter, "TS")
            summary.append(("Transfer Stations", len(ts_records), sk, ins, err))
            total_inserted += ins
            total_errors   += err
    else:
        summary.append(("Transfer Stations", 0, 0, 0, 1))

    # -- Landfills ------------------------------------------------------------
    print("\n--- Landfills ---")
    lf_bytes = fetch_pdf(URL_LF, "swactiveliclf.pdf")
    if lf_bytes:
        lf_records = import_landfills(lf_bytes)
        print(f"  Total parsed: {len(lf_records)}")
        if len(lf_records) > SAFE_MAX:
            print(f"  [ERR] SAFE_MAX exceeded. Skipping.")
            summary.append(("Landfills", len(lf_records), 0, 0, 1))
        else:
            sk, ins, err = batch_insert(supabase, lf_records, existing_slugs, slug_counter, "LF")
            summary.append(("Landfills", len(lf_records), sk, ins, err))
            total_inserted += ins
            total_errors   += err
    else:
        summary.append(("Landfills", 0, 0, 0, 1))

    # -- Processors -----------------------------------------------------------
    print("\n--- Processors ---")
    proc_bytes = fetch_pdf(URL_PROC, "swactivelicp.pdf")
    if proc_bytes:
        proc_records = import_processors(proc_bytes)
        print(f"  Total parsed: {len(proc_records)}")
        if len(proc_records) > SAFE_MAX:
            print(f"  [ERR] SAFE_MAX exceeded. Skipping.")
            summary.append(("Processors", len(proc_records), 0, 0, 1))
        else:
            sk, ins, err = batch_insert(supabase, proc_records, existing_slugs, slug_counter, "PROC")
            summary.append(("Processors", len(proc_records), sk, ins, err))
            total_inserted += ins
            total_errors   += err
    else:
        summary.append(("Processors", 0, 0, 0, 1))

    # -- Summary --------------------------------------------------------------
    print()
    print("=" * 60)
    print("COMBINED SUMMARY")
    print("=" * 60)
    for label, parsed, skipped, inserted, errors in summary:
        print(
            f"  {label:<22} -- parsed: {parsed:>4}  "
            f"skipped: {skipped:>4}  inserted: {inserted:>4}  errors: {errors}"
        )
    print(f"\n  Total inserted: {total_inserted}")
    print(f"  Total errors:   {total_errors}")

    if total_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
