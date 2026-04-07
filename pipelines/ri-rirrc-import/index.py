#!/usr/bin/env python3
"""
pipelines/ri-rirrc-import/index.py

Imports Rhode Island waste haulers from two RIRRC PDFs:

  PDF 2 (primary — 2024):
    https://rirrc.org/sites/default/files/Waste%20and%20Recycling%20Hauler%20List%2010242024.pdf
    Columns: Hauler | Address | Contact Name | Phone Number | Email

  PDF 1 (service-type supplement — 2021):
    https://rirrc.org/sites/default/files/2023-05/Waste%20and%20Recycling%20Haulers%20List%20(PP)%2020211103.pdf
    Columns: COMPANY | ADDRESS | PHONE | CONTACT | MATERIAL HAULED | EMAIL OR WEBSITE

Strategy:
  1. Parse PDF 2 (2024) for company, address, contact, phone, email.
  2. Parse PDF 1 (2021) for company name + materials hauled.
  3. Merge: look up each PDF-2 hauler in the PDF-1 name index (fuzzy
     normalised match) to attach material/service-type data.
  4. Insert merged records into Supabase.

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

# ── Constants ─────────────────────────────────────────────────────────────────

DATA_SOURCE = "ri_rirrc_2024"
SAFE_MAX    = 200
BATCH_SIZE  = 50

PDF2_URL = (
    "https://rirrc.org/sites/default/files/"
    "Waste%20and%20Recycling%20Hauler%20List%2010242024.pdf"
)
PDF1_URL = (
    "https://rirrc.org/sites/default/files/2023-05/"
    "Waste%20and%20Recycling%20Haulers%20List%20(PP)%2020211103.pdf"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; WasteDirectory-DataImport/1.0; "
        "+https://wastedirectory.com)"
    ),
}

# ── Service type mapping ───────────────────────────────────────────────────────

MATERIAL_SERVICE_MAP: list[tuple[str, list[str]]] = [
    (r"solid\s+waste",             ["residential", "commercial"]),
    (r"c\s*&\s*d|construction",    ["roll_off"]),
    (r"food\s+waste|organics",     ["composting"]),
    (r"yard\s+waste",              ["composting"]),
    (r"recycl",                    ["recycling"]),
    (r"scrap\s+metal",             ["recycling"]),
    (r"document\s+shred",          ["recycling"]),
]


def materials_to_service_types(raw: str) -> list[str]:
    """Map a raw 'materials hauled' string to service_types, deduplicating."""
    seen: set[str] = set()
    result: list[str] = []
    for pattern, stypes in MATERIAL_SERVICE_MAP:
        if re.search(pattern, raw, re.IGNORECASE):
            for st in stypes:
                if st not in seen:
                    result.append(st)
                    seen.add(st)
    return result if result else ["residential", "commercial"]


# ── Helpers ───────────────────────────────────────────────────────────────────

def normalize_name(name: str) -> str:
    """Lowercase, strip punctuation/extra spaces — used for fuzzy matching."""
    name = name.lower()
    name = re.sub(r"[^a-z0-9 ]", "", name)
    return re.sub(r"\s+", " ", name).strip()


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
    digits = re.sub(r"[^\d]", "", raw)
    return digits[:5] if len(digits) >= 5 else (digits or None)


def parse_address(raw: str | None) -> tuple[str | None, str | None, str | None, str | None]:
    """
    Split a freeform address string into (street, city, state, zip).
    Handles formats like:
      "123 Main St, Providence, RI 02903"
      "P.O. Box 100\\nCranston RI 02910"
    """
    if not raw:
        return None, None, None, None

    text = re.sub(r"\s*\n\s*", ", ", raw.strip())

    # Extract ZIP
    zip_m = re.search(r"\b(\d{5})(?:-\d{4})?\b", text)
    zip_code = zip_m.group(1) if zip_m else None

    # Extract state (2-letter before ZIP)
    state_m = re.search(r"\b([A-Z]{2})\s+(?:\d{5})", text)
    state = state_m.group(1) if state_m else None

    # Split on commas to get street / city
    parts = [p.strip() for p in text.split(",")]
    street = parts[0] if parts else None

    # City: second part, strip trailing state/zip
    city = None
    if len(parts) >= 2:
        candidate = parts[1].strip()
        # Remove trailing "RI 02903" or similar
        candidate = re.sub(r"\s*\b[A-Z]{2}\s+\d{5}.*$", "", candidate).strip()
        city = candidate or None

    return street, city, state, zip_code


# ── PDF download ───────────────────────────────────────────────────────────────

def download_pdf(url: str, label: str) -> bytes | None:
    print(f"\n  Downloading {label}...")
    print(f"  URL: {url}")
    try:
        resp = requests.get(url, headers=HEADERS, timeout=60)
        if resp.status_code == 200 and len(resp.content) > 1000:
            print(f"  OK — {len(resp.content):,} bytes")
            return resp.content
        print(f"  Failed — HTTP {resp.status_code}")
        return None
    except Exception as exc:
        print(f"  Error: {exc}")
        return None


# ── PDF 2 parser (2024 — primary source) ──────────────────────────────────────

def parse_pdf2(pdf_bytes: bytes) -> list[dict]:
    """
    Parse the 2024 RIRRC hauler list.
    Tries pdfplumber table extraction first; falls back to line-by-line parsing.
    Expected columns: Hauler | Address | Contact Name | Phone Number | Email
    """
    records: list[dict] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"\n  PDF 2 pages: {len(pdf.pages)}")

        # ── Attempt 1: table extraction ───────────────────────────────────────
        all_rows: list[list] = []
        headers: list[str] = []

        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                if not table:
                    continue
                if not headers and len(table) > 1:
                    # First row = headers
                    headers = [str(c or "").strip().lower() for c in table[0]]
                    print(f"  PDF 2 table headers: {headers}")
                    all_rows.extend(table[1:])
                else:
                    all_rows.extend(table)

        if headers and all_rows:
            print(f"  PDF 2 table rows: {len(all_rows)}")

            # Map column indices
            def col(aliases: list[str]) -> int | None:
                for a in aliases:
                    for i, h in enumerate(headers):
                        if a in h:
                            return i
                return None

            c_name    = col(["hauler", "company", "name"])
            c_addr    = col(["address"])
            c_contact = col(["contact"])
            c_phone   = col(["phone", "telephone"])
            c_email   = col(["email"])

            for row in all_rows:
                def get(idx: int | None) -> str | None:
                    if idx is None or idx >= len(row):
                        return None
                    return str_or_none(str(row[idx]) if row[idx] else None)

                name = get(c_name)
                if not name:
                    continue

                addr_raw = get(c_addr)
                street, city, state, zip_code = parse_address(addr_raw)
                state = state or "RI"

                records.append({
                    "name":         name,
                    "address":      street,
                    "city":         city,
                    "state":        state,
                    "zip":          zip_code,
                    "phone":        clean_phone(get(c_phone)),
                    "contact_name": get(c_contact),
                    "email":        get(c_email),
                })
            return records

        # ── Attempt 2: text line parsing ──────────────────────────────────────
        print("  No tables found in PDF 2 — falling back to text parsing")
        all_lines: list[str] = []
        for page in pdf.pages:
            text = page.extract_text() or ""
            all_lines.extend(text.splitlines())

    print(f"  PDF 2 text lines: {len(all_lines)}")

    # Heuristic: lines that look like company entries start with a capital letter
    # and are followed by address/phone lines. We group into blocks.
    # A phone number line is a strong anchor.
    PHONE_RE = re.compile(r"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}")
    EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[a-z]{2,}", re.IGNORECASE)

    # Group lines into records: new record starts when we see a mostly-alpha
    # line that is NOT an address continuation.
    ADDR_INDICATORS = re.compile(r"\b(st|ave|rd|blvd|dr|ln|way|box|po |p\.o\.)\b", re.I)

    blocks: list[list[str]] = []
    current: list[str] = []

    for line in all_lines:
        stripped = line.strip()
        if not stripped:
            continue
        # Skip pure header lines
        if re.match(r"^(hauler|address|contact|phone|email)\s*$", stripped, re.I):
            continue

        is_addr = ADDR_INDICATORS.search(stripped) or re.match(r"^\d+\s", stripped)
        is_phone = PHONE_RE.search(stripped)
        is_email = EMAIL_RE.search(stripped)

        # Start a new block on alpha-only lines that don't look like addr/phone/email
        if (not is_addr and not is_phone and not is_email
                and re.match(r"^[A-Z]", stripped)
                and current):
            blocks.append(current)
            current = [stripped]
        else:
            current.append(stripped)

    if current:
        blocks.append(current)

    print(f"  PDF 2 text blocks: {len(blocks)}")

    for block in blocks:
        if not block:
            continue
        name = block[0]
        rest = " ".join(block[1:])

        phone_m = PHONE_RE.search(rest)
        phone   = clean_phone(phone_m.group(0)) if phone_m else None

        email_m = EMAIL_RE.search(rest)
        email   = email_m.group(0) if email_m else None

        # Address: first line of rest that contains a number or PO Box
        addr_raw = next(
            (ln for ln in block[1:] if re.match(r"^\d+|^[Pp]\.?\s*[Oo]\.?\s*[Bb]ox", ln)),
            None,
        )
        street, city, state, zip_code = parse_address(addr_raw)
        state = state or "RI"

        records.append({
            "name":         name,
            "address":      street,
            "city":         city,
            "state":        state,
            "zip":          zip_code,
            "phone":        phone,
            "contact_name": None,
            "email":        email,
        })

    return records


# ── PDF 1 parser (2021 — materials supplement) ────────────────────────────────

def parse_pdf1_materials(pdf_bytes: bytes) -> dict[str, str]:
    """
    Parse the 2021 RIRRC list for company name → materials hauled.
    Returns a normalised-name → raw-materials string map.
    """
    name_to_materials: dict[str, str] = {}

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"\n  PDF 1 pages: {len(pdf.pages)}")

        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                if not table:
                    continue
                headers = [str(c or "").strip().lower() for c in (table[0] or [])]
                mat_col = next(
                    (i for i, h in enumerate(headers) if "material" in h or "hauled" in h),
                    None,
                )
                name_col = next(
                    (i for i, h in enumerate(headers) if "company" in h or "hauler" in h),
                    0,
                )
                if mat_col is None:
                    continue

                for row in table[1:]:
                    if not row:
                        continue
                    raw_name = str_or_none(str(row[name_col]) if name_col < len(row) else None)
                    raw_mat  = str_or_none(str(row[mat_col])  if mat_col  < len(row) else None)
                    if raw_name and raw_mat:
                        key = normalize_name(raw_name)
                        name_to_materials[key] = raw_mat

    # Fallback: text extraction
    if not name_to_materials:
        print("  PDF 1 table extraction empty — trying text")
        MAT_LINE_RE = re.compile(
            r"(?:solid\s+waste|c\s*&\s*d|recycl|food\s+waste|yard\s+waste|"
            r"scrap\s+metal|document\s+shred|organics)",
            re.IGNORECASE,
        )
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                lines = text.splitlines()
                for i, line in enumerate(lines):
                    stripped = line.strip()
                    if MAT_LINE_RE.search(stripped) and i > 0:
                        # Company name is probably the previous non-blank line
                        prev = next(
                            (lines[j].strip() for j in range(i - 1, -1, -1) if lines[j].strip()),
                            None,
                        )
                        if prev:
                            key = normalize_name(prev)
                            name_to_materials[key] = stripped

    print(f"  PDF 1 material entries: {len(name_to_materials)}")
    return name_to_materials


# ── Merge ─────────────────────────────────────────────────────────────────────

def merge_records(pdf2_records: list[dict], pdf1_materials: dict[str, str]) -> list[dict]:
    """
    For each PDF-2 record, look up materials from PDF-1 by normalised name match.
    Returns the final list ready for Supabase insertion (minus slug).
    """
    merged: list[dict] = []
    matched = 0

    for rec in pdf2_records:
        key = normalize_name(rec["name"])
        raw_materials = pdf1_materials.get(key)

        # Partial match: try if the PDF-2 name is a prefix/suffix of a PDF-1 key
        if not raw_materials:
            for pdf1_key, mat in pdf1_materials.items():
                if key in pdf1_key or pdf1_key in key:
                    raw_materials = mat
                    break

        if raw_materials:
            matched += 1
        service_types = materials_to_service_types(raw_materials or "")

        license_metadata: dict[str, str] = {}
        if rec.get("contact_name"):
            license_metadata["ri_contact_name"] = rec["contact_name"]
        if rec.get("email"):
            license_metadata["ri_contact_email"] = rec["email"]
        if raw_materials:
            license_metadata["ri_materials_hauled"] = raw_materials

        merged.append({
            "name":                rec["name"].title(),
            "address":             rec.get("address"),
            "city":                rec.get("city"),
            "state":               rec.get("state") or "RI",
            "zip":                 rec.get("zip"),
            "phone":               rec.get("phone"),
            "org_type":            "hauler",
            "service_types":       service_types,
            "service_area_states": ["RI"],
            "license_metadata":    license_metadata,
            "data_source":         DATA_SOURCE,
            "verified":            True,
            "active":              True,
        })

    print(f"\n  PDF-1 material matches: {matched} / {len(pdf2_records)}")
    return merged


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("RI RIRRC Waste Hauler Importer")
    print(f"Run date: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    # ── Download PDFs ─────────────────────────────────────────────────────────
    pdf2_bytes = download_pdf(PDF2_URL, "PDF 2 (2024 — primary)")
    pdf1_bytes = download_pdf(PDF1_URL, "PDF 1 (2021 — materials supplement)")

    if not pdf2_bytes:
        print("\n[ERR] Could not download primary PDF (2024). Aborting.", file=sys.stderr)
        sys.exit(1)

    # ── Parse ─────────────────────────────────────────────────────────────────
    print("\n  Parsing PDF 2 (primary)...")
    pdf2_records = parse_pdf2(pdf2_bytes)
    print(f"  PDF 2 records parsed: {len(pdf2_records)}")

    pdf1_materials: dict[str, str] = {}
    if pdf1_bytes:
        print("\n  Parsing PDF 1 (materials supplement)...")
        pdf1_materials = parse_pdf1_materials(pdf1_bytes)

    # ── Merge ─────────────────────────────────────────────────────────────────
    print("\n  Merging records...")
    records = merge_records(pdf2_records, pdf1_materials)

    # Filter blank names
    records = [r for r in records if r["name"] and len(r["name"]) >= 2]
    print(f"  Records after filtering: {len(records)}")

    if len(records) > SAFE_MAX:
        print(f"\n[ERR] SAFE_MAX exceeded ({len(records)} > {SAFE_MAX}). Aborting.")
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

    # ── Classify ──────────────────────────────────────────────────────────────
    to_insert:    list[dict]     = []
    already_in:   int            = 0
    slug_counter: dict[str, int] = {}

    for rec in records:
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
        rec["slug"] = slug
        to_insert.append(rec)

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
    print(f"  PDF 2 records parsed: {len(pdf2_records)}")
    print(f"  Records processed:    {len(records)}")
    print(f"  Already in DB:        {already_in}")
    print(f"  Inserted:             {inserted}")
    print(f"  Errors:               {errors}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
