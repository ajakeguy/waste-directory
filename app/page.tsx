import Link from "next/link";
import { MapPin, Search } from "lucide-react";
import { getArticles } from "@/lib/data/news";
import { ArticleCard } from "@/components/news/ArticleCard";

const states = [
  {
    name: "Maine",
    slug: "maine",
    abbr: "ME",
    description: "Serving the Pine Tree State",
  },
  {
    name: "Massachusetts",
    slug: "massachusetts",
    abbr: "MA",
    description: "Serving the Bay State",
  },
  {
    name: "New Jersey",
    slug: "new-jersey",
    abbr: "NJ",
    description: "Serving the Garden State",
  },
  {
    name: "New York",
    slug: "new-york",
    abbr: "NY",
    description: "Serving the Empire State",
  },
  {
    name: "Pennsylvania",
    slug: "pennsylvania",
    abbr: "PA",
    description: "Serving the Keystone State",
  },
  {
    name: "Vermont",
    slug: "vermont",
    abbr: "VT",
    description: "Serving the Green Mountain State",
  },
];

export default async function HomePage() {
  const latestArticles = await getArticles({ limit: 3 });
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="bg-[#2D6A4F] text-white py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-4">
            Find Waste Haulers Across the Northeast
          </h1>
          <p className="text-lg sm:text-xl text-white/80 mb-10">
            The definitive directory for waste industry professionals
          </p>

          {/* Search bar */}
          <form action="/directory" method="get" className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 max-w-xl mx-auto">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 size-4" />
              <input
                type="text"
                name="q"
                placeholder="Search by city, county, or company name…"
                className="w-full h-12 pl-10 pr-4 rounded-lg text-gray-900 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-white/50 text-sm"
              />
            </div>
            <button
              type="submit"
              className="h-12 px-6 rounded-lg bg-white text-[#2D6A4F] font-semibold text-sm hover:bg-gray-100 transition-colors whitespace-nowrap"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      {/* State cards */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
            Browse by State
          </h2>
          <p className="text-gray-500 text-center mb-10">
            Find licensed waste haulers serving Maine, Massachusetts, New Jersey, New York, Pennsylvania, and Vermont
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {states.map((state) => (
              <Link
                key={state.slug}
                href={`/haulers/${state.slug}`}
                className="group bg-white rounded-xl border border-gray-200 p-6 flex flex-col items-center text-center hover:border-[#2D6A4F] hover:shadow-md transition-all"
              >
                <div className="w-14 h-14 rounded-full bg-[#2D6A4F]/10 flex items-center justify-center mb-4 group-hover:bg-[#2D6A4F]/20 transition-colors">
                  <MapPin className="size-6 text-[#2D6A4F]" />
                </div>
                <span className="text-xs font-bold tracking-widest uppercase text-[#94A3B8] mb-1">
                  {state.abbr}
                </span>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {state.name}
                </h3>
                <p className="text-sm text-gray-500">{state.description}</p>
                <span className="mt-4 text-sm font-medium text-[#2D6A4F] group-hover:underline">
                  View haulers →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Latest News */}
      {latestArticles.length > 0 && (
        <section className="py-16 px-4 bg-white border-t border-gray-100">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Latest News</h2>
                <p className="text-gray-500 text-sm mt-1">
                  Industry updates from leading trade publications
                </p>
              </div>
              <Link
                href="/news"
                className="text-sm font-medium text-[#2D6A4F] hover:underline whitespace-nowrap"
              >
                View all news →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {latestArticles.map((article) => (
                <ArticleCard key={article.id} article={article} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA strip */}
      <section className="py-12 px-4 bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Are you a waste hauler?
          </h2>
          <p className="text-gray-500 mb-6 text-sm">
            Get your business listed in the directory and reach customers across the Northeast.
          </p>
          <Link
            href="/directory"
            className="inline-flex h-10 items-center px-6 rounded-lg bg-[#2D6A4F] text-white text-sm font-semibold hover:bg-[#245a42] transition-colors"
          >
            Browse the full directory
          </Link>
        </div>
      </section>
    </div>
  );
}
