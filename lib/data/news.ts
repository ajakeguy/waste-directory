import { createClient } from "@/lib/supabase/server";

export type NewsSource = {
  id: string;
  name: string;
  url: string | null;
  rss_url: string;
  category: string | null;
  active: boolean;
  last_fetched_at: string | null;
};

export type NewsArticle = {
  id: string;
  source_id: string;
  title: string;
  url: string;
  summary: string | null;
  published_at: string | null;
  fetched_at: string;
  image_url: string | null;
  news_sources: Pick<NewsSource, "name" | "url"> | null;
};

export type ArticleFilters = {
  sourceId?: string;
  limit?: number;
};

export async function getArticles(
  filters: ArticleFilters = {}
): Promise<NewsArticle[]> {
  const supabase = await createClient();

  let query = supabase
    .from("news_articles")
    .select("*, news_sources(name, url)")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(filters.limit ?? 50);

  if (filters.sourceId) {
    query = query.eq("source_id", filters.sourceId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching articles:", error);
    return [];
  }

  return (data ?? []) as NewsArticle[];
}

export async function getNewsSources(): Promise<NewsSource[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("news_sources")
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) return [];
  return data ?? [];
}
