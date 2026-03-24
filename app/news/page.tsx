import { Suspense } from "react";
import type { Metadata } from "next";
import { Newspaper } from "lucide-react";
import { getArticles, getNewsSources } from "@/lib/data/news";
import { ArticleCard } from "@/components/news/ArticleCard";
import { NewsSourceFilter } from "@/components/news/NewsSourceFilter";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Industry News | WasteDirectory",
  description:
    "Stay current with waste and recycling industry news aggregated from leading trade publications.",
};

type SearchParams = Promise<{ source?: string }>;

function ArticlesSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

async function ArticleGrid({ sourceId }: { sourceId?: string }) {
  const articles = await getArticles({ sourceId, limit: 60 });

  if (articles.length === 0) {
    return (
      <div className="text-center py-24">
        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <Newspaper className="size-6 text-gray-400" />
        </div>
        <p className="text-lg font-medium text-gray-700 mb-1">No articles yet</p>
        <p className="text-sm text-gray-500">
          The news aggregator runs every 6 hours. Check back soon, or trigger a
          manual run from GitHub Actions.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} />
      ))}
    </div>
  );
}

export default async function NewsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { source: sourceId } = await searchParams;

  // Load sources for the filter dropdown (fast, small query)
  const sources = await getNewsSources();

  return (
    <div>
      {/* Hero */}
      <section className="bg-[#2D6A4F] text-white py-14 px-4">
        <div className="max-w-5xl mx-auto">
          <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-2">
            WasteDirectory
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Industry News</h1>
          <p className="text-white/80">
            Latest waste and recycling news from leading trade publications
          </p>
        </div>
      </section>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <p className="text-sm text-gray-500">
            Aggregated from {sources.length} publication
            {sources.length !== 1 ? "s" : ""}
          </p>
          {sources.length > 0 && (
            <Suspense fallback={<div className="h-9 w-36 rounded-lg bg-gray-100 animate-pulse" />}>
              <NewsSourceFilter sources={sources} />
            </Suspense>
          )}
        </div>

        {/* Articles */}
        <Suspense fallback={<ArticlesSkeleton />}>
          <ArticleGrid sourceId={sourceId} />
        </Suspense>
      </div>
    </div>
  );
}
