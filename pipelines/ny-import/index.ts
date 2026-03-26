/**
 * pipelines/ny-import/index.ts
 *
 * Imports NYC-licensed commercial waste haulers from the NYC Open Data
 * Trade Waste Haulers dataset (Business Integrity Commission licenses).
 *
 * Note: The originally specified NY DEC endpoint (data.ny.gov/resource/by9k-3j9x)
 * returns 404 — that dataset no longer exists. This pipeline uses the NYC BIC
 * dataset which covers all commercial waste haulers operating in New York City.
 * For statewide NY coverage beyond NYC, additional sources would be needed.
 *
 * Data source: https://data.cityofnewyork.us/resource/kazv-yi3p.json
 * (NYC Trade Waste Haulers — Business Integrity Commission)
 *
 * Run via:
 *   pnpm exec tsx pipelines/ny-import/index.ts
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

// ── Supabase client ───────────────────────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_URL = "https://data.cityofnewyork.us/resource/kazv-yi3p.json";
const DATA_SOURCE = "ny_dec_2025";
const PAGE_SIZE = 1000;
const BATCH = 50;

// ── Types ─────────────────────────────────────────────────────────────────────

type NycRecord = {
  account_name?: string;
  trade_name?: string;
  address?: string;
  city?: string;
  state?: string;
  postcode?: string;
  phone?: string;
  latitude?: string;
  longitude?: string;
  bic_number?: string;
  application_type?: string;
};

type OrgInsert = {
  name: string;
  slug: string;
  org_type: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  hq_state: string | null;
  lat: number | null;
  lng: number | null;
  service_types: string[];
  service_area_states: string[];
  verified: boolean;
  active: boolean;
  data_source: string;
};

type ExistingOrg = {
  id: string;
  slug: string;
  service_area_states: string[] | null;
};

type NameMatch = {
  existingOrg: ExistingOrg;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string, city: string): string {
  const combined = `${name} ${city}`;
  return combined
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPhone(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toTitle(str: string): string {
  // NYC data is all-caps; convert to Title Case for display
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchAllRecords(): Promise<NycRecord[]> {
  const all: NycRecord[] = [];
  let offset = 0;

  console.log(`Fetching from ${SOURCE_URL} (paginated, ${PAGE_SIZE}/page) …`);

  while (true) {
    const url = `${SOURCE_URL}?$limit=${PAGE_SIZE}&$offset=${offset}`;

    let page: NycRecord[];
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "WasteDirectory-DataImport/1.0" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      page = (await res.json()) as NycRecord[];
    } catch (err) {
      console.error(`  ✗ Fetch failed at offset ${offset}: ${(err as Error).message}`);
      break;
    }

    if (!Array.isArray(page) || page.length === 0) break;

    all.push(...page);
    console.log(`  → ${all.length} records fetched so far…`);

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

// ── Map ───────────────────────────────────────────────────────────────────────

function mapRecord(record: NycRecord): OrgInsert | null {
  const rawName = (record.account_name ?? "").trim();
  if (!rawName) return null;

  // Convert all-caps names to Title Case for better display
  const name = toTitle(rawName);
  const rawCity = (record.city ?? "").trim();
  const city = rawCity ? toTitle(rawCity) : null;
  const state = (record.state ?? "NY").trim().toUpperCase() || "NY";

  const slug = slugify(name, rawCity);
  if (!slug) return null;

  const lat = record.latitude ? parseFloat(record.latitude) : null;
  const lng = record.longitude ? parseFloat(record.longitude) : null;

  return {
    name,
    slug,
    org_type: "hauler",
    phone: cleanPhone(record.phone ?? ""),
    address: record.address ? toTitle(record.address.trim()) : null,
    city,
    state,
    zip: (record.postcode ?? "").trim() || null,
    hq_state: state || null,
    lat: lat !== null && !isNaN(lat) ? lat : null,
    lng: lng !== null && !isNaN(lng) ? lng : null,
    // BIC-licensed trade waste haulers are commercial by definition
    service_types: ["commercial"],
    service_area_states: ["NY"],
    verified: true,
    active: true,
    data_source: DATA_SOURCE,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== WasteDirectory — NY Import (NYC Trade Waste Haulers) ===");
  console.log(new Date().toISOString());

  // 1. Fetch all records
  const rawRecords = await fetchAllRecords();
  console.log(`\nTotal API records: ${rawRecords.length}`);

  if (rawRecords.length === 0) {
    console.log("No records fetched — exiting.");
    return;
  }

  // 2. Map to org shape, drop invalid rows
  const mapped: OrgInsert[] = [];
  for (const r of rawRecords) {
    const org = mapRecord(r);
    if (org) mapped.push(org);
  }
  console.log(`Valid mapped records: ${mapped.length}`);

  // 3. Load existing orgs for name-match dedup
  const { data: existingOrgRows, error: existingOrgErr } = await supabase
    .from("organizations")
    .select("id, name, slug, service_area_states")
    .eq("active", true);

  if (existingOrgErr) {
    console.error("Failed to load existing orgs:", existingOrgErr.message);
    process.exit(1);
  }

  const existingNameMap = new Map<string, ExistingOrg>();
  for (const org of existingOrgRows ?? []) {
    existingNameMap.set(normalizeName(org.name as string), {
      id: org.id as string,
      slug: org.slug as string,
      service_area_states: org.service_area_states as string[] | null,
    });
  }

  // 4. Build candidates with name-match pre-check
  const candidates: OrgInsert[] = [];
  const seenSlugs = new Set<string>();
  const nameMatches: NameMatch[] = [];
  const matchedOrgIds = new Set<string>();

  for (const org of mapped) {
    const normalizedIncoming = normalizeName(org.name);
    const existingOrg = existingNameMap.get(normalizedIncoming);

    if (existingOrg) {
      console.log(
        `  Name match → skipping insert, updating existing: ${existingOrg.slug}`
      );
      if (!matchedOrgIds.has(existingOrg.id)) {
        matchedOrgIds.add(existingOrg.id);
        nameMatches.push({ existingOrg });
      }
      continue;
    }

    if (seenSlugs.has(org.slug)) {
      // Duplicate slug within this batch (same name + city)
      continue;
    }
    seenSlugs.add(org.slug);
    candidates.push(org);
  }

  console.log(
    `Name-matched to existing: ${nameMatches.length}  |  New candidates: ${candidates.length}`
  );

  // 5a. Ensure NY is in service_area_states for name-matched existing orgs
  for (const { existingOrg } of nameMatches) {
    const current = existingOrg.service_area_states ?? [];
    if (!current.includes("NY")) {
      const { error } = await supabase
        .from("organizations")
        .update({ service_area_states: [...current, "NY"] })
        .eq("id", existingOrg.id);
      if (error) {
        console.error(
          `  ✗ Failed to update service_area_states for ${existingOrg.slug}: ${error.message}`
        );
      } else {
        console.log(
          `  Updated service_area_states for ${existingOrg.slug} to include NY`
        );
      }
    }
  }

  // 5b. Slug dedup against DB
  const slugsToCheck = candidates.map((c) => c.slug);
  let inserted = 0;
  let errors = 0;
  let existingSlugCount = 0;

  if (slugsToCheck.length > 0) {
    const { data: slugRows, error: slugCheckErr } = await supabase
      .from("organizations")
      .select("slug")
      .in("slug", slugsToCheck);

    if (slugCheckErr) {
      console.error("Failed to query existing slugs:", slugCheckErr.message);
      process.exit(1);
    }

    const existingSlugs = new Set(
      (slugRows ?? []).map((r: { slug: string }) => r.slug)
    );
    existingSlugCount = existingSlugs.size;

    const newOrgs = candidates.filter((c) => !existingSlugs.has(c.slug));
    console.log(
      `Slug-matched: ${existingSlugCount}  |  New to insert: ${newOrgs.length}`
    );

    // 5c. Insert in batches
    for (let i = 0; i < newOrgs.length; i += BATCH) {
      const batch = newOrgs.slice(i, i + BATCH);
      const { error: insertErr } = await supabase
        .from("organizations")
        .insert(batch);

      if (insertErr) {
        console.error(
          `  ✗ Batch ${Math.floor(i / BATCH) + 1} failed: ${insertErr.message}`
        );
        errors++;
      } else {
        inserted += batch.length;
        console.log(
          `  ✓ Batch ${Math.floor(i / BATCH) + 1}: inserted ${batch.length} records`
        );
      }
    }
  }

  // 6. No contact persons available in the NYC dataset

  // 7. Summary
  console.log("\n=== Summary ===");
  console.log(`API records     : ${rawRecords.length}`);
  console.log(`Valid mapped    : ${mapped.length}`);
  console.log(`Name-matched    : ${nameMatches.length}`);
  console.log(`Slug-matched    : ${existingSlugCount}`);
  console.log(`Orgs inserted   : ${inserted}`);
  console.log(`Errors          : ${errors}`);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
