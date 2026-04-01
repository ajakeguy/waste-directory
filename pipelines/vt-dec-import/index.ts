/**
 * pipelines/vt-dec-import/index.ts
 *
 * Fetches Vermont DEC permitted solid waste transporters and imports
 * all VT-permitted solid waste haulers (Waste Type contains "S") into
 * organizations, regardless of the company's mailing address state.
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
  hq_state: string | null;
  service_types: string[];
  service_area_states: string[];
  license_metadata: Record<string, string>;
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

/**
 * Normalise a company name for fuzzy matching.
 * Lowercases, strips punctuation, and collapses whitespace so that
 * "Casella Waste Mgmt, Inc." and "casella waste mgmt inc" compare equal.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Fetch & parse ─────────────────────────────────────────────────────────────

type ParsedRow = {
  company: string;
  contact: string;
  town: string;
  state: string;
  phone: string;
  permitYear: string;
  wasteType: string;
};

type ContactInsert = {
  organization_id: string;
  name: string;
  contact_type: string;
  source: string;
  verified: boolean;
};

type ExistingOrg = {
  id: string;
  slug: string;
  service_area_states: string[] | null;
};

type NameMatch = {
  existingOrg: ExistingOrg;
  contactName: string | null;
  licenseMetadata: Record<string, string>;
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
    const contact = cells[2].text.trim();
    const town = cells[4].text.trim();
    const state = cells[5].text.trim().toUpperCase();
    const phone = cells[6].text.trim();
    const permitYear = cells[7].text.trim();
    const wasteType = cells[8].text.trim();

    if (!company) continue;

    results.push({ company, contact, town, state, phone, permitYear, wasteType });
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

  // 2. Filter: all records whose Waste Type contains the exact code "S"
  // (solid waste transporters — excludes hazmat-only or septic-only permits)
  // Note: we keep ALL records regardless of the company's mailing address state;
  // a VT permit means they are authorised to operate in Vermont.
  const filtered = allRows.filter((r) => {
    const codes = r.wasteType
      .split(/[\s,/]+/)
      .map((c) => c.trim().toUpperCase());
    return codes.includes("S");
  });

  console.log(
    `After filtering (waste type contains S, any HQ state): ${filtered.length} records`
  );

  if (filtered.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  // 3. Pre-check: load all existing active org names for fuzzy name matching.
  // This prevents inserting duplicate records for companies we already have
  // from manual seeding, even when their slugs differ slightly.
  const { data: existingOrgRows, error: existingOrgErr } = await supabase
    .from("organizations")
    .select("id, name, slug, service_area_states")
    .eq("active", true);

  if (existingOrgErr) {
    console.error("Failed to load existing orgs for name matching:", existingOrgErr.message);
    process.exit(1);
  }

  // Build a map from normalised name → existing org record
  const existingNameMap = new Map<string, ExistingOrg>();
  for (const org of existingOrgRows ?? []) {
    existingNameMap.set(normalizeName(org.name as string), {
      id: org.id as string,
      slug: org.slug as string,
      service_area_states: org.service_area_states as string[] | null,
    });
  }

  // 4. Build org candidates, routing name-matched rows to existing orgs
  const candidates: OrgInsert[] = [];
  const seenSlugs = new Set<string>();
  // slug → contact name (covers both new org slugs and existing org slugs)
  const slugToContact = new Map<string, string>();
  // name-matched existing orgs that need service_area_states + contact handling
  const nameMatches: NameMatch[] = [];
  const matchedOrgIds = new Set<string>(); // deduplicate multi-row matches

  for (const row of filtered) {
    const normalizedIncoming = normalizeName(row.company);
    const existingOrg = existingNameMap.get(normalizedIncoming);

    if (existingOrg) {
      // Name match: route this record's contact/service area to the existing org
      console.log(
        `  Name match → skipping insert, updating existing: ${existingOrg.slug}`
      );
      if (!matchedOrgIds.has(existingOrg.id)) {
        matchedOrgIds.add(existingOrg.id);
        // Build license_metadata for this matched record
        const matchedMeta: Record<string, string> = { vt_permit_type: "S" };
        if (row.permitYear) matchedMeta["vt_permit_number"] = row.permitYear;
        if (row.wasteType)  matchedMeta["vt_waste_type_raw"] = row.wasteType;
        nameMatches.push({ existingOrg, contactName: row.contact || null, licenseMetadata: matchedMeta });
      }
      // Always update contact with latest value for this org
      if (row.contact) slugToContact.set(existingOrg.slug, row.contact);
      continue;
    }

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

    // Store contact name keyed by slug for use after org IDs are known
    if (row.contact) slugToContact.set(slug, row.contact);

    // Build VT-specific license metadata
    const licenseMetadata: Record<string, string> = {
      vt_permit_type: "S",
    };
    if (row.permitYear) {
      licenseMetadata["vt_permit_number"] = row.permitYear;
    }
    if (row.wasteType) {
      licenseMetadata["vt_waste_type_raw"] = row.wasteType;
    }

    candidates.push({
      name: row.company,
      slug,
      org_type: "hauler",
      phone: cleanPhone(row.phone),
      city: row.town || null,
      state: row.state || "VT",
      hq_state: row.state || null,
      service_types: mapWasteTypes(row.wasteType),
      service_area_states: ["VT"],
      license_metadata: licenseMetadata,
      verified: true,
      active: true,
      data_source: DATA_SOURCE,
    });
  }

  console.log(
    `Name-matched to existing: ${nameMatches.length}  |  New candidates: ${candidates.length}`
  );

  // 5a. Update name-matched existing orgs: always refresh license_metadata,
  //     and add VT to service_area_states if not already present.
  let nameMatchUpdated = 0;
  for (const { existingOrg, licenseMetadata } of nameMatches) {
    const current = existingOrg.service_area_states ?? [];
    const updatePayload: Record<string, unknown> = {
      license_metadata: licenseMetadata,
    };
    if (!current.includes("VT")) {
      updatePayload.service_area_states = [...current, "VT"];
    }
    const { error: updateErr } = await supabase
      .from("organizations")
      .update(updatePayload)
      .eq("id", existingOrg.id);
    if (updateErr) {
      console.error(
        `  ✗ Failed to update ${existingOrg.slug}: ${updateErr.message}`
      );
    } else {
      nameMatchUpdated++;
      console.log(`  ✓ Updated ${existingOrg.slug} (license_metadata + service_area_states)`);
    }
  }

  // 5b. Slug-dedup against DB for remaining candidates
  const slugsToCheck = candidates.map((c) => c.slug);
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
  const newOrgs      = candidates.filter((c) => !existingSlugs.has(c.slug));
  const slugUpdates  = candidates.filter((c) =>  existingSlugs.has(c.slug));

  console.log(
    `Slug-matched to update  : ${slugUpdates.length}  |  New to insert: ${newOrgs.length}`
  );

  if (newOrgs.length === 0 && nameMatches.length === 0 && slugUpdates.length === 0) {
    console.log("\nAll records already exist — checking contacts only.");
  }

  // 5c. Insert new orgs in batches of 50
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

  // 5d. Update slug-matched candidates with fresh license_metadata
  let slugUpdated = 0;
  for (let i = 0; i < slugUpdates.length; i += BATCH) {
    const batch = slugUpdates.slice(i, i + BATCH);
    for (const org of batch) {
      const { error: updateErr } = await supabase
        .from("organizations")
        .update({
          license_metadata: org.license_metadata,
          service_types:    org.service_types,
        })
        .eq("slug", org.slug);
      if (updateErr) {
        console.error(`  ✗ Slug update failed for ${org.slug}: ${updateErr.message}`);
        errors++;
      } else {
        slugUpdated++;
      }
    }
    console.log(`  ✓ Slug-update batch ${Math.floor(i / BATCH) + 1}: ${batch.length} processed`);
  }

  // 6. Import contacts for all candidate orgs (new + pre-existing)
  // Fetch org IDs for every slug we processed (both existing and just-inserted)
  const allSlugsWithContacts = [...slugToContact.keys()];
  let contactsInserted = 0;
  let contactsExisted = 0;

  if (allSlugsWithContacts.length > 0) {
    const { data: orgIdRows, error: orgIdErr } = await supabase
      .from("organizations")
      .select("id, slug")
      .in("slug", allSlugsWithContacts);

    if (orgIdErr) {
      console.error("Failed to fetch org IDs for contact import:", orgIdErr.message);
    } else {
      const slugToOrgId = new Map(
        (orgIdRows ?? []).map((r: { id: string; slug: string }) => [r.slug, r.id])
      );

      // Build contact candidates
      const contactCandidates: ContactInsert[] = [];
      for (const [slug, contactName] of slugToContact) {
        const orgId = slugToOrgId.get(slug);
        if (!orgId) continue;
        contactCandidates.push({
          organization_id: orgId,
          name: contactName,
          contact_type: "primary",
          source: DATA_SOURCE,
          verified: true,
        });
      }

      // Check which contacts already exist (by org_id + name)
      if (contactCandidates.length > 0) {
        const orgIds = [...new Set(contactCandidates.map((c) => c.organization_id))];
        const { data: existingContacts } = await supabase
          .from("contacts")
          .select("organization_id, name")
          .in("organization_id", orgIds);

        const existingContactSet = new Set(
          (existingContacts ?? []).map(
            (c: { organization_id: string; name: string }) =>
              `${c.organization_id}|${c.name}`
          )
        );
        contactsExisted = existingContactSet.size;

        const newContacts = contactCandidates.filter(
          (c) => !existingContactSet.has(`${c.organization_id}|${c.name}`)
        );

        // Insert in batches of 50
        for (let i = 0; i < newContacts.length; i += BATCH) {
          const batch = newContacts.slice(i, i + BATCH);
          const { error: contactErr } = await supabase
            .from("contacts")
            .insert(batch);
          if (contactErr) {
            console.error(`  ✗ Contact batch insert failed: ${contactErr.message}`);
            errors++;
          } else {
            contactsInserted += batch.length;
          }
        }
      }

      console.log(
        `Contacts: ${contactsExisted} already existed, ${contactsInserted} newly inserted`
      );
    }
  }

  // 7. Summary
  console.log("\n=== Summary ===");
  console.log(`Total found         : ${allRows.length}`);
  console.log(`Solid waste (S)     : ${filtered.length}`);
  console.log(`Name-match updated  : ${nameMatchUpdated}`);
  console.log(`Slug-match updated  : ${slugUpdated}`);
  console.log(`Orgs inserted       : ${inserted}`);
  console.log(`Contacts inserted   : ${contactsInserted}`);
  console.log(`Errors              : ${errors}`);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
