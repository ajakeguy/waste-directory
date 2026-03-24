import { ExternalLink } from "lucide-react";
import type { NewsArticle } from "@/lib/data/news";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function ArticleCard({ article }: { article: NewsArticle }) {
  const sourceName = article.news_sources?.name ?? "Unknown source";
  const date = formatDate(article.published_at);

  return (
    <article className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3 hover:border-[#2D6A4F]/40 hover:shadow-sm transition-all">
      {/* Meta row */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="font-medium text-[#2D6A4F]">{sourceName}</span>
        {date && (
          <>
            <span>·</span>
            <time dateTime={article.published_at ?? ""}>{date}</time>
          </>
        )}
      </div>

      {/* Headline */}
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-start justify-between gap-2"
      >
        <h3 className="font-semibold text-gray-900 leading-snug group-hover:text-[#2D6A4F] transition-colors line-clamp-3">
          {article.title}
        </h3>
        <ExternalLink className="size-3.5 text-gray-300 group-hover:text-[#2D6A4F] transition-colors mt-0.5 shrink-0" />
      </a>

      {/* Summary */}
      {article.summary && (
        <p className="text-sm text-gray-500 leading-relaxed line-clamp-3">
          {article.summary}
        </p>
      )}
    </article>
  );
}
