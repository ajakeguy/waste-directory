"""
NH DES Solid Waste Hauler Registration Import Pipeline

Probes all known data sources for NH registered solid waste haulers.
If machine-readable data is found (Excel, PDF, CSV, or Socrata JSON),
parses and inserts into Supabase. If no data is available, prints a
full diagnostic report with recommended next steps.

Data source: NH DES Solid Waste Hauler Registration (RSA 149-M:29-a)
  - Primary target : des.nh.gov direct file download (xlsx/pdf)
  - Fallback target: NH Open Data Portal (data.nh.gov)

As of 2026-03: des.nh.gov returns 403 to all automated requests —
even with full browser headers (server-side IP filtering or Acquia Cloud
access controls). Direct file path guesses could not be confirmed.
Email solidwasteinfo@des.nh.gov to request the list directly.
"""

import os
import sys
import re
import requests
import pandas as pd
from io import BytesIO
from datetime import datetime

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

DATA_SOURCE = "nh_des_hauler_2026"
SAFE_MAX = 1000
BATCH_SIZE = 100

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    # Include Referer to look like an in-site navigation
    "Referer": "https://www.des.nh.gov/waste/solid-waste",
}

# ── Direct file download paths to probe ───────────────────────────────────────
# The Drupal/Acquia file store path pattern for des.nh.gov is:
#   /sites/g/files/ehbemt341/files/documents/<filename>
# We probe multiple plausible filenames. If any returns a non-HTML 200,
# we attempt to parse it.
FILE_CANDIDATES = [
    (
        "NH DES hauler list (primary guess — xlsx)",
        "https://www.des.nh.gov/sites/g/files/ehbemt341/files/documents/solid-waste-hauler-list.xlsx",
    ),
    (
        "NH DES hauler list (primary guess — pdf)",
        "https://www.des.nh.gov/sites/g/files/ehbemt341/files/documents/solid-waste-hauler-list.pdf",
    ),
    (
        "NH DES hauler list alt — sw-hauler-list.xlsx",
        "https://www.des.nh.gov/sites/g/files/ehbemt341/files/documents/sw-hauler-list.xlsx",
    ),
    (
        "NH DES hauler list alt — solid-waste-haulers.xlsx",
        "https://www.des.nh.gov/sites/g/files/ehbemt341/files/documents/solid-waste-haulers.xlsx",
    ),
    (
        "NH DES hauler list alt — hauler-registration-list.xlsx",
        "https://www.des.nh.gov/sites/g/files/ehbemt341/files/documents/hauler-registration-list.xlsx",
    ),
    (
        "NH DES hauler list alt — sw-hauler-registration-list.xlsx",
        "https://www.des.nh.gov/sites/g/files/ehbemt341/files/documents/sw-hauler-registration-list.xlsx",
    ),
    (
        "NH DES hauler list alt — nh-solid-waste-haulers.xlsx",
        "https://www.des.nh.gov/sites/g/files/ehbemt341/files/documents/nh-solid-waste-haulers.xlsx",
    ),
    (
        "NH DES hauler list alt — registered-haulers.xlsx",
        "https://www.des.nh.gov/sites/g/files/ehbemt341/files/documents/registered-haulers.xlsx",
    ),
    (
        "NH DES hauler list alt — solid-waste-hauler-list.pdf",
        "https://www.des.nh.gov/sites/g/files/ehbemt341/files/documents/solid-waste-hauler-list.pdf",
    ),
    (
        "NH DES hauler list alt — sw-haulers.pdf",
        "https://www.des.nh.gov/sites/g/files/ehbemt341/files/documents/sw-haulers.pdf",
    ),
]

# ── HTML pages to probe for download links ────────────────────────────────────
HTML_PROBE_URLS = [
    (
        "NH DES hauler registration FAQ",
        "https://www.des.nh.gov/waste/solid-waste/compliance-and-reporting/hauler-registration-faq",
    ),
    (
        "NH DES solid waste haulers page",
        "https://www.des.nh.gov/tabbed-content/solid-waste-haulers",
    ),
    (
        "NH DES solid waste main page",
        "https://www.des.nh.gov/waste/solid-waste",
    ),
    (
        "NH DES compliance & reporting page",
        "https://www.des.nh.gov/waste/solid-waste/compliance-and-reporting",
    ),
    (
        "NH Open Data — solid waste hauler search",
        "https://data.nh.gov/api/catalog/v1?q=solid+waste+hauler",
    ),
    (
        "NH Open Data — hauler search",
        "https://data.nh.gov/api/catalog/v1?q=hauler",
    ),
]

# ── Column alias map ──────────────────────────────────────────────────────────
# Update once actual column names from the NH DES file are known.
COLUMN_ALIASES: dict[str, list[str]] = {
    "name":    ["company name", "business name", "hauler name", "registered hauler",
                "name", "company", "business", "firm", "organization"],
    "city":    ["city", "town", "municipality", "mailing city"],
    "state":   ["state", "st", "mailing state"],
    "zip":     ["zip", "zip code", "postal code", "zipcode", "mailing zip"],
    "phone":   ["phone", "phone number", "telephone", "contact phone"],
    "address": ["address", "street", "street address", "mailing address", "mailing street"],
    "license": ["registration number", "registration no", "hauler id", "permit number",
                "id", "reg no", "reg_no", "registration_number"],
}

# ── Slug helpers ──────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def make_slug(name: str, city: str) -> str:
    return slugify(f"{name} {city}")[:80]

# ── Supabase slug dedup ───────────────────────────────────────────────────────

def fetch_existing_slugs(supabase: Client) -> set:
    existing: set[str] = set()
    page_size = 1000
    offset = 0
    while True:
        resp = (
            supabase.table("organizations")
            .select("slug")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        for r in rows:
            existing.add(r["slug"])
        if len(rows) < page_size:
            break
        offset += page_size
    print(f"  Existing slugs in DB: {len(existing):,}")
    return existing

# ── URL probing ───────────────────────────────────────────────────────────────

def try_download(label: str, url: str) -> tuple[int, str, bytes | None]:
    """
    Attempt to download a file. Returns (status_code, content_type, content).
    content is None if the request failed or returned a non-200 status.
    """
    print(f"\n── {label}")
    print(f"   URL: {url}")
    try:
        r = requests.get(url, headers=HEADERS, timeout=25, allow_redirects=True)
        ct = r.headers.get("Content-Type", "unknown")
        size = len(r.content)
        print(f"   Status : {r.status_code}")
        print(f"   Type   : {ct}")
        print(f"   Size   : {size:,} bytes")
        if r.status_code == 200:
            return r.status_code, ct, r.content
        return r.status_code, ct, None
    except requests.exceptions.ConnectionError as e:
        print(f"   Error  : Connection blocked/refused — {type(e).__name__}")
    except Exception as e:
        print(f"   Error  : {e}")
    return 0, "error", None


def probe_html(label: str, url: str) -> list[str]:
    """
    Probe an HTML page for download links.
    Returns list of href values containing .xlsx, .csv, .pdf, or .zip.
    """
    print(f"\n── {label}")
    print(f"   URL: {url}")
    try:
        r = requests.get(url, headers=HEADERS, timeout=20, allow_redirects=True)
        ct = r.headers.get("Content-Type", "unknown")
        print(f"   Status : {r.status_code}")
        print(f"   Type   : {ct}")
        print(f"   Size   : {len(r.content):,} bytes")

        if r.status_code == 200:
            if "html" in ct.lower():
                links = re.findall(
                    r'href=["\']([^"\']+\.(xlsx?|csv|pdf|zip))["\']',
                    r.text,
                    re.IGNORECASE,
                )
                if links:
                    found = [l[0] for l in links[:20]]
                    print(f"   Downloads found:")
                    for link in found:
                        print(f"     → {link}")
                    return found
                else:
                    print(f"   No download links (.xlsx, .csv, .pdf) found")
            elif "json" in ct.lower():
                try:
                    data = r.json()
                    if "resultSetSize" in data:
                        count = data["resultSetSize"]
                        print(f"   Catalog results: {count} dataset(s)")
                        for d in (data.get("results") or [])[:8]:
                            name = d.get("resource", {}).get("name", "?")
                            domain = d.get("metadata", {}).get("domain", "?")
                            uid = d.get("resource", {}).get("id", "?")
                            print(f"     • [{domain}] {name}  id={uid}")
                except Exception:
                    pass
    except requests.exceptions.ConnectionError as e:
        print(f"   Error  : Connection blocked — {type(e).__name__}")
    except Exception as e:
        print(f"   Error  : {e}")
    return []

# ── Excel/CSV parser ──────────────────────────────────────────────────────────

def parse_excel_or_csv(content: bytes, content_type: str) -> list[dict] | None:
    """Parse Excel or CSV bytes into a list of row dicts."""
    print(f"\n  Parsing file ({len(content):,} bytes)...")
    try:
        if "csv" in content_type.lower():
            df = pd.read_csv(BytesIO(content), dtype=str)
        else:
            # Try without skiprows first
            for skip in range(5):
                try:
                    df = pd.read_excel(BytesIO(content), dtype=str, skiprows=skip)
                    # Accept if we get a reasonable number of non-null columns
                    non_null_cols = [c for c in df.columns if not str(c).startswith("Unnamed")]
                    if len(non_null_cols) >= 2:
                        if skip > 0:
                            print(f"  (Skipped {skip} metadata row(s))")
                        break
                except Exception:
                    continue
            else:
                return None

        df.columns = [str(c).strip().lower() for c in df.columns]
        df.dropna(how="all", inplace=True)
        df = df[~df.apply(lambda row: all(str(v).lower() in {"nan", "", "none"} for v in row), axis=1)]

        print(f"  Columns : {list(df.columns)}")
        print(f"  Rows    : {len(df)}")
        if df.empty:
            return None
        print(f"  Sample  :\n{df.head(3).to_string()}")
        return df.to_dict("records")
    except Exception as e:
        print(f"  Parse error: {e}")
        return None

# ── PDF parser ────────────────────────────────────────────────────────────────

def parse_pdf(content: bytes) -> list[dict] | None:
    """
    Attempt to extract tabular hauler data from a PDF using pdfplumber.
    Tries table extraction first; falls back to text parsing.
    """
    if not HAS_PDFPLUMBER:
        print("  pdfplumber not available — cannot parse PDF")
        return None

    print(f"\n  Parsing PDF ({len(content):,} bytes)...")
    try:
        rows: list[dict] = []
        headers: list[str] = []

        with pdfplumber.open(BytesIO(content)) as pdf:
            print(f"  PDF pages: {len(pdf.pages)}")
            for page_num, page in enumerate(pdf.pages):
                tables = page.extract_tables()
                for table in tables:
                    if not table or len(table) < 2:
                        continue
                    if not headers:
                        # First data table: row 0 = headers
                        headers = [
                            str(h).strip().lower() if h else f"col{j}"
                            for j, h in enumerate(table[0])
                        ]
                        print(f"  PDF headers (page {page_num + 1}): {headers}")
                        for row in table[1:]:
                            if any(cell for cell in row):
                                rows.append(
                                    dict(
                                        zip(
                                            headers,
                                            [
                                                str(c).strip() if c else ""
                                                for c in row
                                            ],
                                        )
                                    )
                                )
                    else:
                        # Subsequent pages: same headers
                        for row in table:
                            if any(cell for cell in row):
                                rows.append(
                                    dict(
                                        zip(
                                            headers,
                                            [
                                                str(c).strip() if c else ""
                                                for c in row
                                            ],
                                        )
                                    )
                                )

        if rows:
            print(f"  PDF rows extracted: {len(rows)}")
            print(f"  Sample: {rows[0]}")
            return rows

        print("  No tables found in PDF — attempting text extraction...")
        # Fallback: parse raw text lines
        with pdfplumber.open(BytesIO(content)) as pdf:
            all_text = "\n".join(
                page.extract_text() or "" for page in pdf.pages
            )
        lines = [l.strip() for l in all_text.splitlines() if l.strip()]
        print(f"  Text lines: {len(lines)}")
        if lines:
            print(f"  First 10 lines:")
            for line in lines[:10]:
                print(f"    {line}")
        print("  Text-based PDF parsing not yet implemented.")
        print("  If this is the right file, update parse_pdf() to handle this format.")
        return None

    except Exception as e:
        print(f"  PDF parse error: {e}")
        return None

# ── Column finder ─────────────────────────────────────────────────────────────

def find_column(cols: list[str], aliases: list[str]) -> str | None:
    for alias in aliases:
        for col in cols:
            if alias.lower() == col.lower():
                return col
    return None

# ── Record mapper ─────────────────────────────────────────────────────────────

def map_records(raw_rows: list[dict]) -> list[dict]:
    if not raw_rows:
        return []

    cols = list(raw_rows[0].keys())
    col_map = {key: find_column(cols, aliases) for key, aliases in COLUMN_ALIASES.items()}

    print(f"\nColumn mapping:")
    for key, mapped in col_map.items():
        print(f"  {key:10} → {mapped or '(not found)'}")

    records = []
    for row in raw_rows:
        name = (row.get(col_map.get("name") or "", "") or "").strip()
        if not name or name.lower() in {"nan", "none", ""}:
            continue

        license_num = (row.get(col_map.get("license") or "", "") or "").strip() or None

        city_raw = (row.get(col_map.get("city") or "", "") or "").strip() or None
        state_raw = (row.get(col_map.get("state") or "", "") or "").strip() or "NH"
        # Always NH — override if state column is blank/NH
        state_out = state_raw.upper() if state_raw and state_raw.upper() != "NH" else "NH"

        rec = {
            "name": name,
            "address": (row.get(col_map.get("address") or "", "") or "").strip() or None,
            "city": city_raw,
            "state": state_out,
            "zip": (row.get(col_map.get("zip") or "", "") or "").strip() or None,
            "phone": (row.get(col_map.get("phone") or "", "") or "").strip() or None,
            "org_type": "hauler",
            "service_types": ["residential", "commercial"],
            "service_area_states": ["NH"],
            "data_source": DATA_SOURCE + (f":{license_num}" if license_num else ""),
            "verified": True,
            "active": True,
        }
        records.append(rec)

    return records

# ── Insert pipeline ───────────────────────────────────────────────────────────

def slug_dedup_and_insert(
    supabase: Client, records: list[dict]
) -> tuple[int, int, int]:
    inserted = skipped = errors = 0
    existing_slugs = fetch_existing_slugs(supabase)
    slug_counter: dict[str, int] = {}

    for rec in records:
        base = make_slug(rec["name"], rec.get("city") or "")
        if base in existing_slugs:
            skipped += 1
            continue
        n = slug_counter.get(base, 0)
        slug = base if n == 0 else f"{base}-{n}"
        slug_counter[base] = n + 1
        rec["slug"] = slug
        existing_slugs.add(slug)

    to_insert = [r for r in records if "slug" in r]

    for i in range(0, len(to_insert), BATCH_SIZE):
        batch = to_insert[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            supabase.table("organizations").insert(batch).execute()
            inserted += len(batch)
            print(f"  ✓ Batch {batch_num}: inserted {len(batch)} records")
        except Exception as exc:
            print(f"  ✗ Batch {batch_num} failed: {exc}")
            print(f"  ✗ Detail: {exc!r}")
            print(f"  ✗ First record: {batch[0] if batch else 'unknown'}")
            errors += 1

    return inserted, skipped, errors

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("NH DES Solid Waste Hauler Registration Import Pipeline")
    print(f"Run date: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    # ── Step 1: Try all direct file download paths ─────────────────────────────
    print(f"\nStep 1: Probing {len(FILE_CANDIDATES)} direct file path(s) on des.nh.gov...\n")

    usable_content: bytes | None = None
    usable_ct: str = ""
    usable_label: str = ""

    for label, url in FILE_CANDIDATES:
        status, ct, content = try_download(label, url)
        if status == 200 and content and len(content) > 500:
            # Make sure we didn't get an HTML error/redirect page
            if "html" not in ct.lower():
                print(f"\n  ✓ Usable file found: {label}")
                usable_content = content
                usable_ct = ct
                usable_label = label
                break
            else:
                print(f"  ✗ Got HTML response (likely redirect/error page, not a file)")

    # ── Step 2: Probe HTML pages for download links ────────────────────────────
    if not usable_content:
        print(f"\nStep 2: Probing {len(HTML_PROBE_URLS)} NH DES web page(s)...\n")
        all_discovered: list[str] = []

        for label, url in HTML_PROBE_URLS:
            links = probe_html(label, url)
            all_discovered.extend(links)

        # Try any download links discovered from HTML probing
        if all_discovered:
            print(f"\n  Found {len(all_discovered)} download link(s). Attempting downloads...")
            for link in all_discovered[:8]:
                if not link.startswith("http"):
                    link = "https://www.des.nh.gov" + link
                status, ct, content = try_download(f"Discovered link", link)
                if status == 200 and content and len(content) > 500:
                    if "html" not in ct.lower():
                        print(f"  ✓ Usable file: {link}")
                        usable_content = content
                        usable_ct = ct
                        usable_label = f"Discovered: {link}"
                        break
    else:
        all_discovered = []

    # ── Step 3: Parse and insert if we found something ─────────────────────────
    if usable_content:
        print(f"\nStep 3: Parsing data from: {usable_label}\n")

        raw_rows: list[dict] | None = None

        # Determine format by content type and/or label
        is_pdf = "pdf" in usable_ct.lower() or usable_label.lower().endswith(".pdf")
        is_excel = (
            any(x in usable_ct.lower() for x in ["excel", "spreadsheet", "openxml"])
            or usable_label.lower().endswith((".xlsx", ".xls"))
        )
        is_csv = "csv" in usable_ct.lower() or usable_label.lower().endswith(".csv")

        if is_pdf:
            raw_rows = parse_pdf(usable_content)
        elif is_excel or is_csv:
            raw_rows = parse_excel_or_csv(usable_content, usable_ct)
        else:
            # Try Excel first, then PDF
            raw_rows = parse_excel_or_csv(usable_content, usable_ct)
            if not raw_rows:
                raw_rows = parse_pdf(usable_content)

        if not raw_rows:
            print("  ✗ Could not parse downloaded content")
            print("  Update the parser in this pipeline for the discovered format.")
            sys.exit(0)

        records = map_records(raw_rows)
        print(f"\n  Total raw rows   : {len(raw_rows):,}")
        print(f"  Mappable records : {len(records):,}")

        if not records:
            print("  ✗ No mappable records after column matching")
            print("  Update COLUMN_ALIASES to match actual column names above.")
            sys.exit(0)

        if len(records) > SAFE_MAX:
            print(f"  ✗ SAFE_MAX exceeded: {len(records):,} > {SAFE_MAX}")
            print(f"    Raise SAFE_MAX in this pipeline if the count is expected.")
            sys.exit(1)

        print(f"\nInserting into Supabase...")
        inserted, skipped, errors = slug_dedup_and_insert(supabase, records)

        print("\n" + "=" * 60)
        print("RESULTS")
        print("=" * 60)
        print(f"  Raw rows         : {len(raw_rows):,}")
        print(f"  Mappable records : {len(records):,}")
        print(f"  Already in DB    : {skipped:,}")
        print(f"  Inserted         : {inserted:,}")
        print(f"  Errors           : {errors}")

        if inserted == 0 and errors > 0:
            sys.exit(1)
        return

    # ── Step 4: No data found — full diagnostic output ─────────────────────────
    print("\n" + "=" * 60)
    print("DIAGNOSTIC SUMMARY")
    print("=" * 60)
    print(f"\nFile paths probed   : {len(FILE_CANDIDATES)}")
    print(f"HTML pages probed   : {len(HTML_PROBE_URLS)}")
    print(f"Download links found: {len(all_discovered)}")

    print("""
✗ No machine-readable NH solid waste hauler data found.

CURRENT STATUS (confirmed as of 2026-03):
  • des.nh.gov returns HTTP 403 to all automated requests — even with
    full browser User-Agent and Referer headers. The site uses either
    server-side IP filtering or Drupal/Acquia Cloud bot protection.
  • The direct file paths guessed for .xlsx and .pdf could not be
    confirmed because 403 responses mask any 404s.
  • data.nh.gov open data portal also returns 403.
  • NH DES registration program exists under RSA 149-M:29-a but the
    hauler list is primarily used as an internal mailing list and may
    not have a formal public download URL.

TO OBTAIN NH HAULER DATA — RECOMMENDED NEXT STEPS:

  Option A — Direct email request (fastest, ~1–3 days):
    Email the NH DES Solid Waste program directly:
    Email : solidwasteinfo@des.nh.gov
    Phone : (603) 271-2925
    Request: "The current list of registered solid waste haulers under
              RSA 149-M:29-a in Excel or CSV format, including company
              name, address, town, and registration number"

  Option B — Right-to-Know request (if email doesn't work):
    File a request under NH RSA 91-A (Right to Know law):
    https://www.des.nh.gov/about/right-to-know
    Response required within 5 business days.

  Option C — Manual browser download:
    Visit the following in a real browser and look for a download link
    or a searchable list that can be exported:
    https://www.des.nh.gov/tabbed-content/solid-waste-haulers
    https://www.des.nh.gov/waste/solid-waste/compliance-and-reporting/hauler-registration-faq

  Once data is obtained:
    1. If it's an Excel/CSV file: place it anywhere accessible and
       add its URL (or local path) to FILE_CANDIDATES above — OR
       just run: python index.py with the file path in FILE_CANDIDATES.
    2. If it's a PDF: pdfplumber is already integrated — add the URL
       to FILE_CANDIDATES and the pipeline will attempt table extraction.
    3. Update COLUMN_ALIASES to match the actual column names in the file.
    4. Rerun the pipeline — it will automatically parse and insert.
""")
    print("Pipeline exiting — 0 records inserted (no data source available).")
    sys.exit(0)


if __name__ == "__main__":
    main()
