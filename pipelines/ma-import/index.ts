/**
 * pipelines/ma-import/index.ts
 *
 * Scrapes Massachusetts municipal hauler permit lists.
 *
 * Massachusetts issues hauler permits at the Board of Health (town/city) level,
 * not through a statewide registry. This pipeline attempts to scrape publicly
 * available permit lists from individual city/town websites. Coverage is
 * best-effort — many municipalities keep hauler lists as PDFs, spreadsheets,
 * or require direct contact with the Board of Health.
 *
 * Sources are defined in MA_SOURCES below. Add or update URLs as better
 * sources are identified. Pages that return 404 or contain no parseable
 * hauler data are skipped with a warning.
 *
 * Run via:
 *   pnpm exec tsx pipelines/ma-import/index.ts
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { parse } from "node-html-parser";

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

const DATA_SOURCE = "ma_board_of_health_2025";
const BATCH = 50;

// ── Source definitions ────────────────────────────────────────────────────────
//
// Each source maps to a city's hauler permit list page. URLs are verified
// periodically — update if a city redesigns their website. A source that
// returns no records on a given run is logged as a warning, not an error.
//
// ADDING NEW SOURCES: add an entry to MA_SOURCES with the city name, URL,
// and defaultCity/defaultState for records parsed from that page.

type MaSource = {
  name: string;
  url: string;
  defaultCity: string;
};

const MA_SOURCES: MaSource[] = [
  {
    name: "Brookline",
    url: "https://www.brooklinema.gov/3762/Private-Waste-Haulers",
    defaultCity: "Brookline",
  },
  {
    name: "Cambridge",
    url: "https://www.cambridgema.gov/theworks/ourservices/garbagerecycling/privatehaulers",
    defaultCity: "Cambridge",
  },
  {
    name: "Somerville",
    url: "https://www.somervillema.gov/departments/public-works/solid-waste/private-haulers",
    defaultCity: "Somerville",
  },
  {
    name: "Newton",
    url: "https://www.newtonma.gov/government/public-works/trash-recycling/private-haulers",
    defaultCity: "Newton",
  },
  {
    name: "Framingham",
    url: "https://www.framinghamma.gov/424/Recycling-Solid-Waste",
    defaultCity: "Framingham",
  },
  {
    name: "Lowell",
    url: "https://www.lowellma.gov/334/Solid-Waste",
    defaultCity: "Lowell",
  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type ParsedEntry = {
  name: string;
  phone: string | null;
  address: string | null;
  city: string;
};

type OrgInsert = {
  name: string;
  slug: string;
  org_type: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string;
  hq_state: string | null;
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

/** Extract the first phone number from a string using common US formats. */
function extractPhone(text: string): string | null {
  const match = text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/);
  return match ? match[0].trim() : null;
}

/**
 * Heuristic: does this string look like a waste hauler company name?
 * Filters out navigation links, headers, and unrelated page content.
 */
function looksLikeHauler(text: string): boolean {
  if (text.length < 4 || text.length > 120) return false;

  const lower = text.toLowerCase();

  // Reject obvious non-company strings
  const rejectPatterns = [
    /^(home|contact|about|search|login|sign|click|please|note|for more|if you|the (city|town|board|department))/i,
    /^\d+$/, // just a number
    /^[^a-z]+$/i, // no letters
  ];
  if (rejectPatterns.some((p) => p.test(text))) return false;

  // Accept if contains strong hauler-related keywords
  const haulerKeywords = [
    "waste", "hauling", "hauler", "disposal", "recycling", "rubbish",
    "trash", "garbage", "sanitation", "environmental", "junk",
    "removal", "services", "carting",
  ];
  const businessKeywords = ["llc", "inc", "corp", "company", "co.", "ltd"];

  const hasHaulerWord = haulerKeywords.some((k) => lower.includes(k));
  const hasBusinessWord = businessKeywords.some((k) => lower.includes(k));

  return hasHaulerWord || hasBusinessWord;
}

// ── HTML parser ───────────────────────────────────────────────────────────────

/**
 * Attempt to parse hauler entries from an HTML page.
 *
 * Strategy (in priority order):
 * 1. Tables: treat each row as a potential entry, first cell as name
 * 2. List items (<li>): filter for items that look like hauler names
 * 3. Paragraphs/divs with inline phone numbers: treat as hauler entries
 *
 * Returns an empty array if no recognizable hauler data is found.
 */
function parseHaulers(html: string, defaultCity: string): ParsedEntry[] {
  const root = parse(html);
  const entries: ParsedEntry[] = [];
  const seenNames = new Set<string>();

  const addEntry = (name: string, phone: string | null, address: string | null) => {
    const cleanName = name.replace(/\s+/g, " ").trim();
    if (!cleanName || seenNames.has(cleanName.toLowerCase())) return;
    seenNames.add(cleanName.toLowerCase());
    entries.push({ name: cleanName, phone, address, city: defaultCity });
  };

  // 1. Tables
  const tables = root.querySelectorAll("table");
  for (const table of tables) {
    const rows = table.querySelectorAll("tr");
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length === 0) continue;

      const nameCell = cells[0].text.trim();
      if (!looksLikeHauler(nameCell)) continue;

      // Look for a phone number in any cell
      const rowText = row.text;
      const phone = extractPhone(rowText);

      // Second cell might be an address
      const address = cells.length > 1 ? cells[1].text.trim() || null : null;

      addEntry(nameCell, phone, address);
    }
  }

  // 2. List items
  const listItems = root.querySelectorAll("li");
  for (const li of listItems) {
    const text = li.text.trim();
    if (!looksLikeHauler(text)) continue;

    // The name is usually the text before a phone number or comma
    const phone = extractPhone(text);
    const namePart = phone
      ? text.substring(0, text.indexOf(phone)).replace(/[-:,\s]+$/, "").trim()
      : text;

    if (namePart.length >= 4) {
      addEntry(namePart, phone, null);
    }
  }

  // 3. Paragraphs / divs that contain a phone and look like company entries
  const blocks = root.querySelectorAll("p, div");
  for (const block of blocks) {
    // Skip elements that contain child elements (likely layout wrappers)
    if (block.querySelectorAll("p, div, table, ul").length > 0) continue;

    const text = block.text.trim();
    if (!looksLikeHauler(text)) continue;

    const phone = extractPhone(text);
    if (!phone) continue; // require a phone number to avoid false positives

    const namePart = text
      .substring(0, text.indexOf(phone))
      .replace(/[-:,\s]+$/, "")
      .trim();

    if (namePart.length >= 4) {
      addEntry(namePart, phone, null);
    }
  }

  return entries;
}

// ── Fetch a single source ─────────────────────────────────────────────────────

async function fetchSource(source: MaSource): Promise<ParsedEntry[]> {
  console.log(`\n[${source.name}] Fetching ${source.url}`);

  let html: string;
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "WasteDirectory-DataImport/1.0" },
      signal: AbortSignal.timeout(20_000),
    });

    if (res.status === 404) {
      console.warn(`  ⚠ 404 Not Found — URL may need updating`);
      return [];
    }
    if (!res.ok) {
      console.warn(`  ⚠ HTTP ${res.status} — skipping`);
      return [];
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("pdf")) {
      console.warn(`  ⚠ URL serves a PDF — cannot parse automatically`);
      return [];
    }

    html = await res.text();
  } catch (err) {
    console.warn(`  ⚠ Fetch error: ${(err as Error).message} — skipping`);
    return [];
  }

  const entries = parseHaulers(html, source.defaultCity);

  if (entries.length === 0) {
    console.warn(
      `  ⚠ No hauler entries parsed — page may store data in a PDF, ` +
      `spreadsheet, or require Board of Health contact`
    );
  } else {
    console.log(`  → ${entries.length} entries parsed`);
  }

  return entries;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== WasteDirectory — MA Municipal Hauler Import ===");
  console.log(new Date().toISOString());
  console.log(`Sources: ${MA_SOURCES.map((s) => s.name).join(", ")}`);

  // 1. Fetch from all sources
  const allEntries: ParsedEntry[] = [];
  for (const source of MA_SOURCES) {
    const entries = await fetchSource(source);
    allEntries.push(...entries);
  }

  console.log(`\nTotal entries parsed across all sources: ${allEntries.length}`);

  if (allEntries.length === 0) {
    console.log(
      "\nNo hauler data parsed from any source.\n" +
      "MA municipalities typically maintain hauler lists as PDFs or internal\n" +
      "databases not exposed via public HTML. Manual data entry or direct\n" +
      "Board of Health contact may be required."
    );
    console.log("\n=== Summary ===");
    console.log(`Sources tried   : ${MA_SOURCES.length}`);
    console.log(`Entries parsed  : 0`);
    console.log(`Orgs inserted   : 0`);
    return;
  }

  // 2. Load existing orgs for name-match dedup
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

  // 3. Build candidates
  const candidates: OrgInsert[] = [];
  const seenSlugs = new Set<string>();
  const nameMatches: NameMatch[] = [];
  const matchedOrgIds = new Set<string>();

  for (const entry of allEntries) {
    const normalizedIncoming = normalizeName(entry.name);
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

    const slug = slugify(entry.name, entry.city);
    if (!slug) continue;

    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    candidates.push({
      name: entry.name,
      slug,
      org_type: "hauler",
      phone: cleanPhone(entry.phone ?? ""),
      address: entry.address,
      city: entry.city || null,
      state: "MA",
      hq_state: "MA",
      service_types: [],
      service_area_states: ["MA"],
      verified: false, // HTML-scraped data is less reliable; require manual verification
      active: true,
      data_source: DATA_SOURCE,
    });
  }

  console.log(
    `Name-matched to existing: ${nameMatches.length}  |  New candidates: ${candidates.length}`
  );

  // 4. Ensure MA in service_area_states for name-matched orgs
  for (const { existingOrg } of nameMatches) {
    const current = existingOrg.service_area_states ?? [];
    if (!current.includes("MA")) {
      const { error } = await supabase
        .from("organizations")
        .update({ service_area_states: [...current, "MA"] })
        .eq("id", existingOrg.id);
      if (error) {
        console.error(
          `  ✗ Failed to update service_area_states for ${existingOrg.slug}: ${error.message}`
        );
      } else {
        console.log(
          `  Updated service_area_states for ${existingOrg.slug} to include MA`
        );
      }
    }
  }

  // 5. Slug dedup against DB
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

  // 6. Summary
  console.log("\n=== Summary ===");
  console.log(`Sources tried   : ${MA_SOURCES.length}`);
  console.log(`Entries parsed  : ${allEntries.length}`);
  console.log(`Name-matched    : ${nameMatches.length}`);
  console.log(`Slug-matched    : ${existingSlugCount}`);
  console.log(`Orgs inserted   : ${inserted}`);
  console.log(`Errors          : ${errors}`);
  if (inserted === 0 && allEntries.length === 0) {
    console.log(
      "\nTip: If sources consistently return 0 entries, update MA_SOURCES\n" +
      "with direct links to permit list PDFs or spreadsheets converted to\n" +
      "HTML, or add new city sources as they become available."
    );
  }

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
