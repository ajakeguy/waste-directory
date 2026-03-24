/**
 * pipelines/news-fetch/index.ts
 *
 * Fetches RSS feeds from active news_sources and inserts new articles
 * into news_articles. Run via:
 *   pnpm exec tsx pipelines/news-fetch/index.ts
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL  (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";

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

// ── XML parser config ─────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Some feeds wrap CDATA; this surfaces the text value
  cdataPropName: "__cdata",
  trimValues: true,
});

// ── Types ─────────────────────────────────────────────────────────────────────

type NewsSource = {
  id: string;
  name: string;
  rss_url: string;
};

type ArticleInsert = {
  source_id: string;
  title: string;
  url: string;
  summary: string | null;
  published_at: string | null;
  image_url: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Safely extract text from a field that may be a string, CDATA object, or nested object. */
function extractText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.__cdata) return String(v.__cdata).trim();
    if (v["#text"]) return String(v["#text"]).trim();
  }
  return String(value).trim();
}

/** Strip HTML tags from summary text. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse a date string safely, returning ISO string or null. */
function parseDate(value: unknown): string | null {
  if (!value) return null;
  const str = extractText(value);
  if (!str) return null;
  try {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/** Extract the best image URL from an RSS item. */
function extractImage(item: Record<string, unknown>): string | null {
  // media:content
  const mediaContent = item["media:content"] as Record<string, unknown> | undefined;
  if (mediaContent?.["@_url"]) return String(mediaContent["@_url"]);

  // enclosure
  const enclosure = item["enclosure"] as Record<string, unknown> | undefined;
  if (enclosure?.["@_url"] && String(enclosure["@_type"] ?? "").startsWith("image/")) {
    return String(enclosure["@_url"]);
  }

  // media:thumbnail
  const mediaThumbnail = item["media:thumbnail"] as Record<string, unknown> | undefined;
  if (mediaThumbnail?.["@_url"]) return String(mediaThumbnail["@_url"]);

  return null;
}

/** Normalise items from both RSS 2.0 and Atom feeds into a common shape. */
function extractItems(parsed: Record<string, unknown>): Record<string, unknown>[] {
  // RSS 2.0
  const rssChannel = (parsed["rss"] as Record<string, unknown> | undefined)?.["channel"] as
    | Record<string, unknown>
    | undefined;
  if (rssChannel?.["item"]) {
    const items = rssChannel["item"];
    return Array.isArray(items)
      ? (items as Record<string, unknown>[])
      : [items as Record<string, unknown>];
  }

  // Atom
  const feed = parsed["feed"] as Record<string, unknown> | undefined;
  if (feed?.["entry"]) {
    const entries = feed["entry"];
    return Array.isArray(entries)
      ? (entries as Record<string, unknown>[])
      : [entries as Record<string, unknown>];
  }

  return [];
}

/** Extract the URL from an Atom <link> element (may be object or string). */
function extractLink(item: Record<string, unknown>): string {
  const link = item["link"];
  if (!link) return "";
  if (typeof link === "string") return link.trim();
  if (Array.isArray(link)) {
    // Atom: pick rel="alternate" or first
    const alt = (link as Record<string, unknown>[]).find(
      (l) => l["@_rel"] === "alternate" || !l["@_rel"]
    );
    return alt ? String(alt["@_href"] ?? "").trim() : "";
  }
  if (typeof link === "object") {
    const l = link as Record<string, unknown>;
    return String(l["@_href"] ?? l["#text"] ?? "").trim();
  }
  return String(link).trim();
}

// ── Core fetch logic ──────────────────────────────────────────────────────────

async function fetchSource(source: NewsSource): Promise<{
  fetched: number;
  inserted: number;
  errors: number;
}> {
  let fetched = 0;
  let inserted = 0;
  let errors = 0;

  console.log(`\n[${source.name}] Fetching ${source.rss_url}`);

  let xml: string;
  try {
    const res = await fetch(source.rss_url, {
      headers: { "User-Agent": "WasteDirectory-NewsBot/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    console.error(`  ✗ Fetch failed: ${(err as Error).message}`);
    return { fetched: 0, inserted: 0, errors: 1 };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = xmlParser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    console.error(`  ✗ XML parse failed: ${(err as Error).message}`);
    return { fetched: 0, inserted: 0, errors: 1 };
  }

  const items = extractItems(parsed);
  fetched = items.length;
  console.log(`  → ${fetched} items in feed`);

  if (fetched === 0) {
    console.warn("  ⚠ No items found — feed structure may differ");
    return { fetched: 0, inserted: 0, errors: 0 };
  }

  // Build article objects and collect URLs to check for duplicates
  const articles: ArticleInsert[] = [];
  for (const item of items) {

    const title = extractText(item["title"]);
    const url = extractLink(item);
    if (!title || !url) continue;

    const rawSummary =
      extractText(item["description"]) ||
      extractText(item["summary"]) ||
      extractText(item["content"]);

    articles.push({
      source_id: source.id,
      title,
      url,
      summary: rawSummary ? stripHtml(rawSummary).substring(0, 600) : null,
      published_at: parseDate(item["pubDate"] ?? item["published"] ?? item["updated"]),
      image_url: extractImage(item),
    });
  }

  if (articles.length === 0) {
    console.log("  → No valid articles to insert");
    return { fetched, inserted: 0, errors };
  }

  // Deduplicate against existing URLs in one query
  const urls = articles.map((a) => a.url);
  const { data: existing } = await supabase
    .from("news_articles")
    .select("url")
    .in("url", urls);

  const existingUrls = new Set((existing ?? []).map((r: { url: string }) => r.url));
  const newArticles = articles.filter((a) => !existingUrls.has(a.url));

  console.log(
    `  → ${existingUrls.size} already in DB, ${newArticles.length} new to insert`
  );

  if (newArticles.length === 0) {
    return { fetched, inserted: 0, errors };
  }

  // Insert in batches of 50
  const BATCH = 50;
  for (let i = 0; i < newArticles.length; i += BATCH) {
    const batch = newArticles.slice(i, i + BATCH);
    const { error } = await supabase.from("news_articles").insert(batch);
    if (error) {
      console.error(`  ✗ Insert batch failed: ${error.message}`);
      errors++;
    } else {
      inserted += batch.length;
    }
  }

  // Update last_fetched_at on the source
  await supabase
    .from("news_sources")
    .update({ last_fetched_at: new Date().toISOString() })
    .eq("id", source.id);

  console.log(`  ✓ Inserted ${inserted} new articles`);
  return { fetched, inserted, errors };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== WasteDirectory News Aggregator ===");
  console.log(new Date().toISOString());

  const { data: sources, error: sourcesError } = await supabase
    .from("news_sources")
    .select("id, name, rss_url")
    .eq("active", true);

  if (sourcesError) {
    console.error("Failed to load news sources:", sourcesError.message);
    process.exit(1);
  }

  if (!sources || sources.length === 0) {
    console.log("No active news sources found.");
    return;
  }

  console.log(`\nProcessing ${sources.length} active sources…`);

  let totalFetched = 0;
  let totalInserted = 0;
  let totalErrors = 0;

  for (const source of sources) {
    const result = await fetchSource(source as NewsSource);
    totalFetched += result.fetched;
    totalInserted += result.inserted;
    totalErrors += result.errors;
  }

  console.log("\n=== Summary ===");
  console.log(`Sources processed : ${sources.length}`);
  console.log(`Articles fetched  : ${totalFetched}`);
  console.log(`Articles inserted : ${totalInserted}`);
  console.log(`Errors            : ${totalErrors}`);

  if (totalErrors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
