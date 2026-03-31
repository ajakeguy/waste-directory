#!/usr/bin/env python3
"""
pipelines/pa-dep-import/index.py

Imports Pennsylvania DEP Waste Transportation Safety Program (WTSP) haulers
from the PA DEP SSRS data reporting portal.

Strategy:
  1. Try CSV export URL first (fastest, smallest payload)
  2. Fall back to Excel (EXCELOPENXML) format
  3. If both fail, print HTTP status + headers and exit cleanly (exit 0)
     so the GitHub Actions run is marked as a warning, not a failure

Confirmed column names from live data:
  WASTE_HAULER_ID, LICENSE_ID, CLIENT_ID, WASTE_HAULER_NAME,
  LICENSE_STATUS, STATUS (effective date), EXPIRATION, CITY, STATE, ZIP
  (No ADDRESS column in this report)

Usage:
    python pipelines/pa-dep-import/index.py

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import sys
import os
import io
import re
import math
from datetime import datetime

# ── Auto-install dependencies if missing ──────────────────────────────────────

try:
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

try:
    import pandas as pd
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas", "openpyxl", "-q"])
    import pandas as pd

try:
    from supabase import create_client, Client
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "supabase", "-q"])
    from supabase import create_client, Client

# ── Constants ─────────────────────────────────────────────────────────────────

CSV_URL   = (
    "http://cedatareporting.pa.gov/Reportserver/Pages/ReportViewer.aspx"
    "?/Public/DEP/WM/SSRS/Waste_Trans_Safety_Auths&rs:Format=CSV"
)
EXCEL_URL = (
    "http://cedatareporting.pa.gov/Reportserver/Pages/ReportViewer.aspx"
    "?/Public/DEP/WM/SSRS/Waste_Trans_Safety_Auths&rs:Format=EXCELOPENXML"
)

DATA_SOURCE = "pa_dep_wtsp_2026"
SAFE_MAX    = 7000
BATCH_SIZE  = 50

# Active status values (case-insensitive upper match)
ACTIVE_STATUSES = {"ACTIVE", "A", "CURRENT"}

HTTP_HEADERS = {
    "User-Agent": "WasteDirectory-DataImport/1.0",
    "Accept":     "*/*",
}

# ── Column alias map ──────────────────────────────────────────────────────────
# Maps our internal key -> ordered list of possible raw column names.
# The confirmed live column names are listed first so they match before
# any generic fallbacks.

COLUMN_ALIASES: dict[str, list[str]] = {
    # Primary: WASTE_HAULER_ID; fallbacks for future schema changes
    "wh_number":    ["waste_hauler_id", "waste hauler id", "wh number",
                     "whnumber", "wh #", "authorization number",
                     "auth number", "permit number", "hauler number"],
    # Primary: LICENSE_ID (separate from WASTE_HAULER_ID)
    "license_id":   ["license_id", "license id", "licenseid"],
    # Primary: CLIENT_ID
    "client_id":    ["client_id", "client id", "clientid"],
    # Primary: WASTE_HAULER_NAME
    "company_name": ["waste_hauler_name", "waste hauler name",
                     "company name", "companyname", "business name",
                     "company", "name", "applicant name"],
    # Primary: LICENSE_STATUS — must come before bare "status" which is
    # actually the effective/issue date in this report
    "status":       ["license_status", "license status",
                     "authorization status", "auth status",
                     "auth_status", "authorization_status"],
    # Primary: EXPIRATION (expiry date)
    "expiration":   ["expiration", "expiration date", "exp date",
                     "expiry date", "exp_date", "expire date", "expires"],
    # No ADDRESS column in this report — aliases kept for forward-compat
    "address":      ["address", "street address", "address1",
                     "mailing address", "street", "addr"],
    "city":         ["city", "municipality"],
    "state":        ["state", "st", "state code"],
    "zip":          ["zip", "zip code", "zipcode", "postal code", "zip_code"],
    "phone":        ["phone", "phone number", "telephone", "tel"],
}


def find_col(df_cols: list[str], key: str) -> str | None:
    """Return the actual DataFrame column name matching our alias key, or None."""
    aliases = COLUMN_ALIASES.get(key, [key])
    lower_map = {c.lower().strip(): c for c in df_cols}
    for alias in aliases:
        if alias.lower() in lower_map:
            return lower_map[alias.lower()]
    return None


def get_val(row_dict: dict, df_cols: list[str], key: str):
    """Get raw value from row using alias lookup."""
    col = find_col(df_cols, key)
    return row_dict.get(col) if col else None


# ── Data helpers ──────────────────────────────────────────────────────────────

def s(value) -> str | None:
    """Return stripped string, or None for null/NaN/empty values."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    v = str(value).strip()
    return v if v and v.lower() not in ("nan", "none", "n/a", "na", "") else None


def clean_phone(raw) -> str | None:
    v = s(raw)
    if not v:
        return None
    digits = re.sub(r"\D", "", v)
    if len(digits) == 10:
        return f"{digits[0:3]}-{digits[3:6]}-{digits[6:10]}"
    if len(digits) == 11 and digits[0] == "1":
        return f"{digits[1:4]}-{digits[4:7]}-{digits[7:11]}"
    return v or None


def iso_date(raw) -> str | None:
    """Return YYYY-MM-DD, handling pandas Timestamps, MM/DD/YYYY, ISO strings."""
    if raw is None:
        return None
    if hasattr(raw, "strftime"):
        return raw.strftime("%Y-%m-%d")
    v = s(raw)
    if not v:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(v.split("T")[0].split(" ")[0], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return v[:10] if len(v) >= 10 else None


def slugify(name: str, city: str) -> str:
    combined = f"{name} {city}".lower()
    combined = re.sub(r"[^a-z0-9]+", "-", combined)
    return combined.strip("-")


# ── Fetch functions ───────────────────────────────────────────────────────────

def _parse_df(raw_bytes: bytes | str, is_excel: bool) -> pd.DataFrame | None:
    """
    Attempt to parse raw content as a structured DataFrame.
    SSRS exports sometimes prepend metadata rows, so try skipping 0–4 rows.
    Returns the first successfully parsed DataFrame with >= 4 columns, or None.
    """
    for skip in range(5):
        try:
            if is_excel:
                df = pd.read_excel(io.BytesIO(raw_bytes), skiprows=skip, dtype=str,
                                   engine="openpyxl")
            else:
                text = (raw_bytes if isinstance(raw_bytes, str)
                        else raw_bytes.decode("utf-8-sig", errors="replace"))
                df = pd.read_csv(io.StringIO(text), skiprows=skip, dtype=str)

            real_cols = [c for c in df.columns if not str(c).startswith("Unnamed")]
            if len(real_cols) >= 4 and len(df) > 0:
                df = df.dropna(how="all")
                if len(df) > 0:
                    return df
        except Exception:
            continue
    return None


def fetch_csv() -> pd.DataFrame | None:
    print(f"\n  [CSV] {CSV_URL}")
    try:
        resp = requests.get(CSV_URL, headers=HTTP_HEADERS, timeout=90, allow_redirects=True)
    except requests.RequestException as exc:
        print(f"  [CSV] Network error: {exc}")
        return None

    print(f"  [CSV] HTTP {resp.status_code}  "
          f"Content-Type: {resp.headers.get('Content-Type', '?')}")
    if resp.status_code != 200:
        print(f"  [CSV] Response headers: {dict(resp.headers)}")
        print(f"  [CSV] Body (first 500 chars):\n{resp.text[:500]}")
        return None

    df = _parse_df(resp.text, is_excel=False)
    if df is None:
        print(f"  [CSV] Could not parse into DataFrame")
        print(f"  [CSV] Content (first 1000 chars):\n{resp.text[:1000]}")
        return None

    print(f"  [CSV] ✓ Parsed: {len(df)} rows, columns: {list(df.columns)}")
    return df


def fetch_excel() -> pd.DataFrame | None:
    print(f"\n  [Excel] {EXCEL_URL}")
    try:
        resp = requests.get(EXCEL_URL, headers=HTTP_HEADERS, timeout=90, allow_redirects=True)
    except requests.RequestException as exc:
        print(f"  [Excel] Network error: {exc}")
        return None

    ct = resp.headers.get("Content-Type", "")
    print(f"  [Excel] HTTP {resp.status_code}  Content-Type: {ct}")
    if resp.status_code != 200:
        print(f"  [Excel] Response headers: {dict(resp.headers)}")
        print(f"  [Excel] Body (first 500 chars):\n{resp.text[:500]}")
        return None

    if "text/html" in ct.lower() and len(resp.content) < 50_000:
        print(f"  [Excel] Received HTML (error page), not Excel data")
        print(f"  [Excel] Body (first 500 chars):\n{resp.text[:500]}")
        return None

    df = _parse_df(resp.content, is_excel=True)
    if df is None:
        print(f"  [Excel] Could not parse into DataFrame")
        print(f"  [Excel] Content-Length: {len(resp.content)} bytes")
        return None

    print(f"  [Excel] ✓ Parsed: {len(df)} rows, columns: {list(df.columns)}")
    return df


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=== WasteDirectory — PA DEP WTSP Importer ===")
    print(datetime.utcnow().isoformat())

    supabase_url     = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    # ── 1. Fetch — CSV first, Excel fallback ──────────────────────────────────
    print("\nFetching PA DEP WTSP report ...")
    df = fetch_csv()
    if df is None:
        print("\nCSV unavailable — trying Excel format ...")
        df = fetch_excel()

    if df is None:
        print(
            "\n⚠  Both CSV and Excel formats returned no usable data.\n"
            "   Possible reasons:\n"
            "     • The PA DEP server requires VPN or internal access\n"
            "     • The report URL or rs:Format parameter has changed\n"
            "     • Temporary server outage\n"
            "   No data was modified. Exiting cleanly.",
            file=sys.stderr,
        )
        sys.exit(0)

    total_fetched = len(df)
    df_cols = list(df.columns)
    print(f"\nTotal rows in report : {total_fetched}")
    print(f"All columns          : {df_cols}")

    # Show first record for column-mapping confirmation
    if total_fetched > 0:
        print("\nSample record (first row):")
        for k, v in df.iloc[0].to_dict().items():
            print(f"  {k!r}: {v!r}")

    # ── 2. Inspect and filter by LICENSE_STATUS ───────────────────────────────
    status_col = find_col(df_cols, "status")

    if status_col:
        unique_statuses = df[status_col].fillna("(null)").unique().tolist()
        print(f"\nUnique {status_col!r} values: {unique_statuses}")

        before = len(df)
        df = df[df[status_col].fillna("").str.upper().isin(ACTIVE_STATUSES)]
        print(f"After active filter  : {len(df)} records (was {before}, "
              f"active values matched: {ACTIVE_STATUSES})")
    else:
        print(f"\nWARNING: No status column found among: {df_cols}")
        print("Proceeding without status filter — all records included")

    if len(df) == 0:
        print("No active records found after filtering. Exiting cleanly.")
        sys.exit(0)

    # ── 3. Deduplicate by WASTE_HAULER_ID (keep last = latest record) ─────────
    wh_col = find_col(df_cols, "wh_number")
    if wh_col:
        before = len(df)
        df = df.drop_duplicates(subset=[wh_col], keep="last")
        print(f"After {wh_col!r} dedup : {len(df)} unique (was {before})")
    else:
        print(f"WARNING: No WH Number column found. Available: {df_cols}")

    # ── 4. Map to organizations schema ────────────────────────────────────────
    print("\nMapping to organization schema ...")
    to_insert:    list[dict] = []
    seen_slugs:   set[str]   = set()
    skipped_name = 0
    skipped_slug = 0

    for _, row in df.iterrows():
        row_dict = row.to_dict()

        name = s(get_val(row_dict, df_cols, "company_name")) or ""
        if not name:
            skipped_name += 1
            continue

        city = s(get_val(row_dict, df_cols, "city")) or ""
        slug = slugify(name, city)
        if not slug:
            skipped_slug += 1
            continue

        # Disambiguate within-batch slug collisions with a numeric suffix
        base_slug, counter = slug, 1
        while slug in seen_slugs:
            slug = f"{base_slug}-{counter}"
            counter += 1
        seen_slugs.add(slug)

        raw_state = s(get_val(row_dict, df_cols, "state")) or "PA"
        state     = raw_state[:2].upper() if len(raw_state) >= 2 else raw_state.upper()

        # Build license_metadata with PA-specific IDs
        license_metadata: dict[str, str] = {}
        wh_id     = s(get_val(row_dict, df_cols, "wh_number"))
        license_id = s(get_val(row_dict, df_cols, "license_id"))
        client_id  = s(get_val(row_dict, df_cols, "client_id"))
        if wh_id:
            license_metadata["pa_wh_id"] = wh_id
        if license_id:
            license_metadata["pa_license_id"] = license_id
        if client_id:
            license_metadata["pa_client_id"] = client_id

        # Note: no ADDRESS column in the PA DEP WTSP report; omit the key
        to_insert.append({
            "name":                name,
            "slug":                slug,
            "org_type":            "hauler",
            "city":                city or None,
            "state":               state,
            "zip":                 s(get_val(row_dict, df_cols, "zip")),
            "phone":               clean_phone(get_val(row_dict, df_cols, "phone")),
            "license_number":      wh_id,
            "license_expiry":      iso_date(get_val(row_dict, df_cols, "expiration")),
            "license_metadata":    license_metadata,
            "service_types":       ["residential", "commercial"],
            "service_area_states": ["PA"],
            "verified":            True,
            "active":              True,
            "data_source":         DATA_SOURCE,
        })

    print(f"Records mapped         : {len(to_insert)}")
    if skipped_name: print(f"Skipped (no name)      : {skipped_name}")
    if skipped_slug: print(f"Skipped (no slug)      : {skipped_slug}")

    if not to_insert:
        print("Nothing to process after mapping. Exiting.")
        sys.exit(0)

    # Preview
    print("\nFirst 5 records to insert:")
    for rec in to_insert[:5]:
        print(f"  {rec['name']!r:45s}  city={rec['city']!r:20s}  "
              f"state={rec['state']}  license={rec['license_number']!r}  "
              f"expiry={rec['license_expiry']!r}  metadata={rec['license_metadata']!r}")

    # ── 5. Connect to Supabase ────────────────────────────────────────────────
    supabase: Client = create_client(supabase_url, service_role_key)

    # ── 6. Load all existing slugs from DB ───────────────────────────────────
    print("\nLoading existing slugs from DB ...")
    existing_slugs: set[str] = set()
    db_offset = 0
    while True:
        result = (
            supabase.table("organizations")
            .select("slug")
            .range(db_offset, db_offset + 999)
            .execute()
        )
        for row in result.data:
            if row.get("slug"):
                existing_slugs.add(row["slug"])
        if len(result.data) < 1000:
            break
        db_offset += 1000

    print(f"Existing slugs in DB   : {len(existing_slugs)}")

    new_records = [r for r in to_insert if r["slug"] not in existing_slugs]
    skipped_db  = len(to_insert) - len(new_records)
    print(f"Already in DB          : {skipped_db}")
    print(f"Net new to insert      : {len(new_records)}")

    # ── 7. Safety check ───────────────────────────────────────────────────────
    if len(new_records) > SAFE_MAX:
        print(
            f"\nERROR: {len(new_records)} new records exceeds SAFE_MAX ({SAFE_MAX:,}). "
            f"Aborting to prevent runaway insert. Review data manually.",
            file=sys.stderr,
        )
        sys.exit(1)

    # ── 8. Batch insert ───────────────────────────────────────────────────────
    inserted = 0
    errors   = 0

    if not new_records:
        print("\nAll records already in DB — nothing to insert.")
    else:
        print(f"\nInserting {len(new_records)} records in batches of {BATCH_SIZE} ...")
        for i in range(0, len(new_records), BATCH_SIZE):
            batch     = new_records[i : i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            try:
                supabase.table("organizations").insert(batch).execute()
                inserted += len(batch)
                print(f"  ✓ Batch {batch_num}: inserted {len(batch)} records")
            except Exception as exc:
                print(f"  ✗ Batch {batch_num} failed: {exc}")
                print(f"  ✗ Batch error detail: {exc!r}")
                print(f"  ✗ First record in failed batch: {batch[0] if batch else 'unknown'}")
                errors += 1

    # ── 9. Summary ────────────────────────────────────────────────────────────
    print("\n=== Summary ===")
    print(f"  Total in report      : {total_fetched}")
    print(f"  After active filter  : {len(df)}")
    print(f"  Mapped to schema     : {len(to_insert)}")
    print(f"  Already in DB        : {skipped_db}")
    print(f"  Inserted             : {inserted}")
    print(f"  Errors               : {errors}")

    if inserted == 0 and errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
