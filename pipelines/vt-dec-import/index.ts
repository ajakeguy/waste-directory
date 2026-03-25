/**
 * pipelines/vt-dec-import/index.ts
 *
 * Fetches Vermont DEC permitted solid waste transporters and imports
 * Vermont-based haulers (Waste Type contains "S") into organizations.
 *
 * Run via:
 *   pnpm exec tsx pipelines/vt-dec-import/index.ts
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { parse } from "node-html-parser";

// ── Supabase client (service role — bypasses RLS for writes) ─────────────────

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

const SOURCE_URL =
  "https://anrweb.vermont.gov/DEC/_DEC/SolidWasteTransporters.aspx";

const DATA_SOURCE = "vt_dec_permit_2025";

// ── Types ─────────────────────────────────────────────────────────────────────

type OrgInsert = {
  name: string;
  slug: string;
  org_type: string;
  phone: string | null;
  city: string | null;
  state: string;
  service_types: string[];
  service_area_states: string[];
  verified: boolean;
  active: boolean;
  data_source: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a name+city into a URL-safe slug. */
function slugify(name: string, city: string): string {
  const combined = `${name} ${city}`;
  return combined
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")   // strip non-alphanumeric (keep spaces/hyphens)
    .trim()
    .replace(/[\s]+/g, "-")          // spaces → hyphens
    .replace(/-+/g, "-")             // collapse consecutive hyphens
    .replace(/^-|-$/g, "");          // trim leading/trailing hyphens
}

/**
 * Map VT DEC waste type codes to our service_types values.
 * The field may contain multiple codes separated by spaces, commas, or slashes.
 *
 * S  = Solid Waste   → residential, commercial
 * M  = Medical       → medical
 * H  = Hazardous     → hazmat
 * FS = Food Scraps   → composting
 */
function mapWasteTypes(raw: string): string[] {
  const types = new Set<string>();
  // Split on whitespace, commas, slashes — then check each token
  const codes = raw
    .split(/[\s,/]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  for (const code of codes) {
    if (code === "S") {
      types.add("residential");
      types.add("commercial");
    }
    if (code === "M") types.add("medical");
    if (code === "H") types.add("hazmat");
    if (code === "FS") types.add("composting");
  }

  return Array.from(types);
}

/** Normalise a phone number string, returning null if empty. */
function cleanPhone(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── Fetch & parse ─────────────────────────────────────────────────────────────

type ParsedRow = {
  company: string;
  town: string;
  state: string;
  phone: string;
  wasteType: string;
};

async function fetchAndParse(): Promise<ParsedRow[]> {
  console.log(`Fetching ${SOURCE_URL} …`);

  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "WasteDirectory-DataImport/1.0" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const root = parse(html);

  // The page contains a single results table; locate all data rows
  // (skip the header row — th elements or first tr)
  const rows = root.querySelectorAll("table tr");

  console.log(`  → ${rows.length} table rows found (including header)`);

  const results: ParsedRow[] = [];

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    // Expected columns: ID(0), Company(1), Contact(2), Address(3),
    //                   Town(4), State(5), Phone(6), PermitYear(7),
    //                   WasteType(8), BearResistant(9), ServiceArea(10)
    if (cells.length < 9) continue; // skip header / malformed rows

    const company = cells[1].text.trim();
    const town = cells[4].text.trim();
    const state = cells[5].text.trim().toUpperCase();
    const phone = cells[6].text.trim();
    const wasteType = cells[8].text.trim();

    if (!company) continue;

    results.push({ company, town, state, phone, wasteType });
  }

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== WasteDirectory — VT DEC Permit Importer ===");
  console.log(new Date().toISOString());

  // 1. Fetch and parse the HTML table
  let allRows: ParsedRow[];
  try {
    allRows = await fetchAndParse();
  } catch (err) {
    console.error("Failed to fetch/parse VT DEC page:", (err as Error).message);
    process.exit(1);
  }

  console.log(`\nTotal rows parsed: ${allRows.length}`);

  // 2. Filter: VT-based transporters whose Waste Type contains "S"
  const filtered = allRows.filter((r) => {
    if (r.state !== "VT") return false;
    // Check that one of the tokenised codes is exactly "S"
    const codes = r.wasteType
      .split(/[\s,/]+/)
      .map((c) => c.trim().toUpperCase());
    return codes.includes("S");
  });

  console.log(
    `After filtering (state=VT, waste type contains S): ${filtered.length} records`
  );

  if (filtered.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  // 3. Build org objects and generate slugs
  const candidates: OrgInsert[] = [];
  const seenSlugs = new Set<string>();

  for (const row of filtered) {
    const slug = slugify(row.company, row.town);

    if (!slug) {
      console.warn(`  ⚠ Could not generate slug for "${row.company}" — skipping`);
      continue;
    }

    // Deduplicate within this batch (same company + city appearing twice)
    if (seenSlugs.has(slug)) {
      console.warn(`  ⚠ Duplicate slug "${slug}" within batch — skipping second occurrence`);
      continue;
    }
    seenSlugs.add(slug);

    candidates.push({
      name: row.company,
      slug,
      org_type: "hauler",
      phone: cleanPhone(row.phone),
      city: row.town || null,
      state: "VT",
      service_types: mapWasteTypes(row.wasteType),
      service_area_states: ["VT"],
      verified: true,
      active: true,
      data_source: DATA_SOURCE,
    });
  }

  console.log(`Candidates after slug dedup: ${candidates.length}`);

  // 4. Check which slugs already exist in the DB
  const slugsToCheck = candidates.map((c) => c.slug);
  const { data: existingRows, error: checkErr } = await supabase
    .from("organizations")
    .select("slug")
    .in("slug", slugsToCheck);

  if (checkErr) {
    console.error("Failed to query existing slugs:", checkErr.message);
    process.exit(1);
  }

  const existingSlugs = new Set(
    (existingRows ?? []).map((r: { slug: string }) => r.slug)
  );

  const newOrgs = candidates.filter((c) => !existingSlugs.has(c.slug));

  console.log(
    `Already in DB: ${existingSlugs.size}  |  New to insert: ${newOrgs.length}`
  );

  if (newOrgs.length === 0) {
    console.log("\nAll records already exist — nothing to insert.");
    console.log("\n=== Summary ===");
    console.log(`Total found    : ${allRows.length}`);
    console.log(`VT solid waste : ${filtered.length}`);
    console.log(`Already existed: ${existingSlugs.size}`);
    console.log(`Newly inserted : 0`);
    console.log(`Errors         : 0`);
    return;
  }

  // 5. Insert in batches of 50
  const BATCH = 50;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < newOrgs.length; i += BATCH) {
    const batch = newOrgs.slice(i, i + BATCH);
    const { error: insertErr } = await supabase
      .from("organizations")
      .insert(batch);

    if (insertErr) {
      console.error(
        `  ✗ Batch ${Math.floor(i / BATCH) + 1} insert failed: ${insertErr.message}`
      );
      errors++;
    } else {
      inserted += batch.length;
      console.log(
        `  ✓ Batch ${Math.floor(i / BATCH) + 1}: inserted ${batch.length} records`
      );
    }
  }

  // 6. Summary
  console.log("\n=== Summary ===");
  console.log(`Total found    : ${allRows.length}`);
  console.log(`VT solid waste : ${filtered.length}`);
  console.log(`Already existed: ${existingSlugs.size}`);
  console.log(`Newly inserted : ${inserted}`);
  console.log(`Errors         : ${errors}`);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
