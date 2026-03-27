"""
NJ DEP A-901 Commercial Solid Waste Transporter Import Pipeline

Probes all known data sources for NJ A-901 licensed solid waste transporters.
If machine-readable data is found, parses and inserts into Supabase.
If no data is available, prints a full diagnostic report with next steps.

Data source: NJ DEP A-901 licensing program
  - Primary target : NJ Open Data Portal (data.nj.gov)
  - Fallback target: NJDEP wastedecals portal / direct file download

As of 2026-03: No public machine-readable dataset exists. The NJDEP
dep.nj.gov domain is behind Imperva/Incapsula WAF and blocks all
automated requests. data.nj.gov has zero NJ-specific A-901 datasets.
An OPRA request to NJDEP is the recommended path to obtain this data.
"""

import os
import sys
import re
import requests
import pandas as pd
from io import BytesIO
from datetime import datetime
from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

DATA_SOURCE = "nj_dep_a901_2026"
SAFE_MAX = 3000
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
}

# ── Confirmed data.nj.gov Socrata dataset IDs ─────────────────────────────────
# Populate this list if NJ ever publishes an A-901 dataset on data.nj.gov.
# Format: ("dataset_id", "expected_name_hint")
SOCRATA_CANDIDATES: list[tuple[str, str]] = []

# ── Direct file URLs to try ───────────────────────────────────────────────────
# Add any specific Excel/CSV/PDF download URLs here if discovered manually.
FILE_CANDIDATES: list[tuple[str, str]] = []

# ── HTML pages to probe for download links ────────────────────────────────────
HTML_PROBE_URLS = [
    (
        "NJ Open Data — solid waste transporter search",
        "https://data.nj.gov/api/catalog/v1?q=solid+waste+transporter",
    ),
    (
        "NJ Open Data — A-901 search",
        "https://data.nj.gov/api/catalog/v1?q=a901",
    ),
    (
        "NJ Open Data — waste hauler search",
        "https://data.nj.gov/api/catalog/v1?q=waste+hauler+license",
    ),
    (
        "NJDEP wastedecals portal",
        "https://www.nj.gov/dep/enforcement/wastedecals/swt2.html",
    ),
    (
        "NJDEP A-901 program page",
        "https://dep.nj.gov/wastedecals/commercial-solid-waste-transporters/",
    ),
    (
        "NJDEP DSHW A-901 page",
        "https://dep.nj.gov/dshw/a901/",
    ),
    (
        "NJ DEP license list (legacy URL — expected 404)",
        "https://www.nj.gov/dep/dshw/hwr/liclist.htm",
    ),
]

# ── Column alias map (update once actual column names are known) ───────────────
COLUMN_ALIASES: dict[str, list[str]] = {
    "name":    ["company name", "business name", "hauler name", "transporter name",
                "name", "company", "business", "firm name"],
    "city":    ["city", "town", "municipality"],
    "state":   ["state", "st"],
    "zip":     ["zip", "zip code", "postal code", "zipcode", "zip_code"],
    "phone":   ["phone", "phone number", "telephone", "contact phone", "phone_number"],
    "address": ["address", "street", "street address", "mailing address", "street_address"],
    "license": ["registration number", "license number", "a-901 number", "permit number",
                "registration_number", "license_no", "registration_no", "a901"],
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

def probe_url(label: str, url: str) -> dict:
    """Probe a URL and report status, content type, size, and any download links."""
    print(f"\n── {label}")
    print(f"   URL: {url}")
    result: dict = {
        "label": label,
        "url": url,
        "status": None,
        "content_type": None,
        "size": 0,
        "download_links": [],
        "json_datasets": [],
        "content": None,
    }
    try:
        r = requests.get(url, headers=HEADERS, timeout=20, allow_redirects=True)
        ct = r.headers.get("Content-Type", "unknown")
        result.update({"status": r.status_code, "content_type": ct, "size": len(r.content)})

        print(f"   Status : {r.status_code}")
        print(f"   Type   : {ct}")
        print(f"   Size   : {len(r.content):,} bytes")

        if r.status_code == 200:
            # HTML: look for download links
            if "html" in ct.lower():
                links = re.findall(
                    r'href=["\']([^"\']+\.(xlsx?|csv|pdf|zip))["\']',
                    r.text,
                    re.IGNORECASE,
                )
                if links:
                    result["download_links"] = [l[0] for l in links[:20]]
                    print(f"   Downloads found:")
                    for link in result["download_links"]:
                        print(f"     → {link}")
                else:
                    print(f"   No download links (.xlsx, .csv, .pdf) found in page")

            # JSON: check Socrata catalog or raw data
            elif "json" in ct.lower():
                try:
                    data = r.json()
                    # Socrata catalog response
                    if "resultSetSize" in data:
                        count = data["resultSetSize"]
                        print(f"   Catalog results: {count} dataset(s)")
                        for d in (data.get("results") or [])[:8]:
                            name = d.get("resource", {}).get("name", "?")
                            domain = d.get("metadata", {}).get("domain", "?")
                            uid = d.get("resource", {}).get("id", "?")
                            upd = d.get("resource", {}).get("updatedAt", "?")
                            result["json_datasets"].append(
                                {"id": uid, "domain": domain, "name": name}
                            )
                            print(f"     • [{domain}] {name}  id={uid}  updated={upd}")
                    # Raw JSON array (Socrata resource endpoint)
                    elif isinstance(data, list):
                        print(f"   JSON array: {len(data)} row(s)")
                        if data:
                            print(f"   Columns: {list(data[0].keys())}")
                        result["content"] = r.content
                except Exception:
                    pass

            # Binary file (Excel, CSV, etc.)
            elif any(
                x in ct.lower()
                for x in ["excel", "spreadsheet", "csv", "octet-stream", "openxml"]
            ):
                print(f"   ✓ Binary file — may be parseable")
                result["content"] = r.content

    except requests.exceptions.ConnectionError as e:
        print(f"   Error  : Connection blocked/refused — {type(e).__name__}")
    except Exception as e:
        print(f"   Error  : {e}")

    return result


def probe_socrata(dataset_id: str) -> dict | None:
    """Probe a specific data.nj.gov Socrata dataset."""
    url = f"https://data.nj.gov/resource/{dataset_id}.json?$limit=5"
    print(f"\n── Socrata probe: {dataset_id}")
    print(f"   URL: {url}")
    try:
        r = requests.get(url, timeout=15)
        ct = r.headers.get("Content-Type", "unknown")
        print(f"   Status : {r.status_code}")
        print(f"   Type   : {ct}")
        if r.status_code == 200:
            rows = r.json()
            print(f"   Rows   : {len(rows)}")
            if rows:
                print(f"   Columns: {list(rows[0].keys())}")
                return {"id": dataset_id, "rows": rows}
        elif r.status_code == 404:
            print(f"   Result : Dataset not found (404)")
        else:
            print(f"   Result : HTTP {r.status_code}")
    except Exception as e:
        print(f"   Error  : {e}")
    return None

# ── Excel/CSV parser ──────────────────────────────────────────────────────────

def parse_excel_or_csv(content: bytes, content_type: str) -> list[dict] | None:
    try:
        if "csv" in content_type.lower():
            df = pd.read_csv(BytesIO(content), dtype=str)
        else:
            df = pd.read_excel(BytesIO(content), dtype=str)
        df.columns = [str(c).strip().lower() for c in df.columns]
        df.dropna(how="all", inplace=True)
        print(f"  Columns : {list(df.columns)}")
        print(f"  Rows    : {len(df)}")
        if df.empty:
            return None
        print(f"  Sample  :\n{df.head(3).to_string()}")
        return df.to_dict("records")
    except Exception as e:
        print(f"  Parse error: {e}")
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

        rec = {
            "name": name,
            "address": (row.get(col_map.get("address") or "", "") or "").strip() or None,
            "city": (row.get(col_map.get("city") or "", "") or "").strip() or None,
            "state": "NJ",
            "zip": (row.get(col_map.get("zip") or "", "") or "").strip() or None,
            "phone": (row.get(col_map.get("phone") or "", "") or "").strip() or None,
            "org_type": "hauler",
            "service_types": ["commercial", "residential"],
            "service_area_states": ["NJ"],
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
    print("NJ DEP A-901 Solid Waste Transporter Import Pipeline")
    print(f"Run date: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    # ── Step 1: Probe confirmed Socrata dataset IDs ────────────────────────────
    if SOCRATA_CANDIDATES:
        print(f"\nStep 1: Probing {len(SOCRATA_CANDIDATES)} known Socrata dataset ID(s)...\n")
        for ds_id, hint in SOCRATA_CANDIDATES:
            print(f"  Probing: {ds_id} ({hint})")
            result = probe_socrata(ds_id)
            if result and result.get("rows"):
                print(f"  ✓ Live dataset found — fetching full data...")
                # Full paginated fetch
                all_rows = []
                limit = 50000
                offset = 0
                while True:
                    url = (
                        f"https://data.nj.gov/resource/{ds_id}.json"
                        f"?$limit={limit}&$offset={offset}"
                    )
                    r = requests.get(url, timeout=60)
                    chunk = r.json()
                    if not chunk:
                        break
                    all_rows.extend(chunk)
                    if len(chunk) < limit:
                        break
                    offset += limit

                print(f"  Total rows fetched: {len(all_rows):,}")
                if len(all_rows) > SAFE_MAX:
                    print(f"  ✗ SAFE_MAX exceeded: {len(all_rows):,} > {SAFE_MAX}")
                    sys.exit(1)

                records = map_records(all_rows)
                print(f"  Mapped records: {len(records):,}")
                inserted, skipped, errors = slug_dedup_and_insert(supabase, records)

                print("\n" + "=" * 60)
                print("RESULTS")
                print("=" * 60)
                print(f"  Raw rows         : {len(all_rows):,}")
                print(f"  Mapped records   : {len(records):,}")
                print(f"  Already in DB    : {skipped:,}")
                print(f"  Inserted         : {inserted:,}")
                print(f"  Errors           : {errors}")
                if inserted == 0 and errors > 0:
                    sys.exit(1)
                return
    else:
        print("\nStep 1: No confirmed Socrata dataset IDs on record.")

    # ── Step 2: Try direct file download URLs ─────────────────────────────────
    if FILE_CANDIDATES:
        print(f"\nStep 2: Trying {len(FILE_CANDIDATES)} direct file download URL(s)...\n")
        for label, url in FILE_CANDIDATES:
            r = probe_url(label, url)
            if r["status"] == 200 and r.get("content") and len(r["content"]) > 500:
                ct = r.get("content_type", "")
                if "html" not in ct.lower():
                    print(f"\n  ✓ Usable file found: {label}")
                    raw_rows = parse_excel_or_csv(r["content"], ct)
                    if raw_rows:
                        records = map_records(raw_rows)
                        if not records:
                            print("  ✗ No mappable records after column matching")
                        else:
                            if len(records) > SAFE_MAX:
                                print(f"  ✗ SAFE_MAX exceeded: {len(records):,} > {SAFE_MAX}")
                                sys.exit(1)
                            inserted, skipped, errors = slug_dedup_and_insert(
                                supabase, records
                            )
                            print(f"\n  Inserted={inserted}  Skipped={skipped}  Errors={errors}")
                            if inserted == 0 and errors > 0:
                                sys.exit(1)
                            return
    else:
        print("\nStep 2: No direct file download URLs configured.")

    # ── Step 3: Probe HTML pages for new download links ───────────────────────
    print("\nStep 3: Probing NJ DEP and NJ Open Data pages...\n")
    all_probe_results = []
    discovered_links = []

    for label, url in HTML_PROBE_URLS:
        result = probe_url(label, url)
        all_probe_results.append(result)
        discovered_links.extend(result.get("download_links", []))
        # Check if an NJ-domain dataset appeared in a catalog result
        for ds in result.get("json_datasets", []):
            if "nj.gov" in ds.get("domain", "").lower() or "nj" in ds.get("domain", "").lower():
                print(f"\n  ✓ NJ dataset found in catalog: {ds['name']} (id={ds['id']})")
                print(f"    Add '{ds['id']}' to SOCRATA_CANDIDATES and rerun.")

    # Try any discovered download links
    if discovered_links:
        print(f"\n  Attempting {len(discovered_links)} discovered download link(s)...")
        for link in discovered_links[:5]:
            if not link.startswith("http"):
                link = "https://www.nj.gov" + link
            r = probe_url(f"Discovered link", link)
            if r["status"] == 200 and r.get("content") and len(r["content"]) > 500:
                ct = r.get("content_type", "")
                if "html" not in ct.lower():
                    raw_rows = parse_excel_or_csv(r["content"], ct)
                    if raw_rows:
                        records = map_records(raw_rows)
                        if records:
                            if len(records) > SAFE_MAX:
                                print(
                                    f"  ✗ SAFE_MAX exceeded: {len(records):,} > {SAFE_MAX}"
                                )
                                sys.exit(1)
                            inserted, skipped, errors = slug_dedup_and_insert(
                                supabase, records
                            )
                            print(
                                f"\n  Inserted={inserted}  Skipped={skipped}  Errors={errors}"
                            )
                            if inserted == 0 and errors > 0:
                                sys.exit(1)
                            return

    # ── Step 4: No data found — print full diagnostic ─────────────────────────
    print("\n" + "=" * 60)
    print("DIAGNOSTIC SUMMARY")
    print("=" * 60)

    usable = [r for r in all_probe_results if r["status"] == 200 and r["size"] > 500]
    print(f"\nURLs probed     : {len(all_probe_results)}")
    print(f"HTTP 200 (live) : {len(usable)}")
    print(f"Download links  : {len(discovered_links)}")

    print("""
✗ No machine-readable NJ A-901 data found at any probed URL.

CURRENT STATUS (confirmed as of 2026-03):
  • NJDEP wastedecals portal (dep.nj.gov) is behind Imperva/Incapsula WAF
    and returns error pages to all automated requests — even with full
    browser headers. Human browser access required.
  • NJ Open Data Portal (data.nj.gov) has ZERO published datasets for
    A-901 transporters, solid waste haulers, or any related NJ permits.
    Catalog searches for "a901", "solid waste transporter", "waste hauler"
    all return 0 NJ-domain results.
  • The legacy URL nj.gov/dep/dshw/hwr/liclist.htm returns 404 (dead link).

TO OBTAIN NJ A-901 DATA — RECOMMENDED NEXT STEPS:

  Option A — OPRA Request (most reliable path):
    File an Open Public Records Act request with NJDEP requesting a
    complete list of current A-901 licensed solid waste transporters
    (company name, address, registration number) in Excel or CSV format.

    Online OPRA portal : https://www.nj.gov/dep/opra/
    Direct email       : dep.dshw@dep.nj.gov
    Phone              : (609) 984-6985 (Bureau of Solid Waste Planning)
    Response deadline  : 7 business days under NJ law

  Option B — Manual browser inspection of wastedecals portal:
    Visit https://www.nj.gov/dep/enforcement/wastedecals/swt2.html
    in a real browser. Open DevTools → Network tab → look for XHR/fetch
    calls to a backend API when the transporter list loads. Copy that
    API URL into FILE_CANDIDATES in this pipeline.

  Option C — Monitor NJ Open Data Portal:
    NJ sometimes publishes new datasets after public requests.
    Watch: https://data.nj.gov/browse?q=solid+waste+transporter
    If a dataset appears, copy its 4x4 ID into SOCRATA_CANDIDATES above.

  Once data is obtained:
    • Add Socrata dataset IDs to SOCRATA_CANDIDATES, OR
    • Add direct file URL to FILE_CANDIDATES
    The pipeline will automatically parse and insert on next run.
""")
    print("Pipeline exiting — 0 records inserted (no data source available).")
    sys.exit(0)


if __name__ == "__main__":
    main()
