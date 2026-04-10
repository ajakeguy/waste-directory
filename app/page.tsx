import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Truck, Building2, Wrench, ShoppingBag } from "lucide-react";
import { getArticles } from "@/lib/data/news";
import { ArticleCard } from "@/components/news/ArticleCard";

export const metadata: Metadata = {
  title: "waste.markets — The Waste Industry Intelligence Platform",
  description:
    "Hauler directories, disposal facility maps, route optimization, and diversion reporting — built for waste industry professionals across the Northeast.",
};

const states = [
  { name: "Connecticut",    slug: "connecticut",    abbr: "CT" },
  { name: "Maine",          slug: "maine",           abbr: "ME" },
  { name: "Massachusetts",  slug: "massachusetts",   abbr: "MA" },
  { name: "New Hampshire",  slug: "new-hampshire",   abbr: "NH" },
  { name: "New Jersey",     slug: "new-jersey",      abbr: "NJ" },
  { name: "New York",       slug: "new-york",        abbr: "NY" },
  { name: "Pennsylvania",   slug: "pennsylvania",    abbr: "PA" },
  { name: "Rhode Island",   slug: "rhode-island",    abbr: "RI" },
  { name: "Vermont",        slug: "vermont",         abbr: "VT" },
];

const features = [
  {
    icon: Truck,
    title: "Hauler Directory",
    description:
      "11,000+ licensed waste haulers across 9 Northeast states. Search by state, service type, and material.",
    href: "/directory",
    cta: "Browse Haulers",
  },
  {
    icon: Building2,
    title: "Disposal Facilities",
    description:
      "3,100+ active landfills, transfer stations, MRFs, composting sites, and more — with interactive maps and geo-search.",
    href: "/disposal",
    cta: "Browse Facilities",
  },
  {
    icon: Wrench,
    title: "Industry Tools",
    description:
      "Route optimization for waste collection runs, diversion reports for compliance, and cost calculators.",
    href: "/tools",
    cta: "Open Tools",
  },
  {
    icon: ShoppingBag,
    title: "Marketplace",
    description:
      "Buy, sell, and rent waste industry equipment, vehicles, and materials.",
    href: "/marketplace",
    cta: "Browse Listings",
  },
];

export default async function HomePage() {
  const latestArticles = await getArticles({ limit: 3 });

  return (
    <div className="flex flex-col">
      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="bg-[#2D6A4F] text-white py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-4">
            The Waste Industry Intelligence Platform
          </h1>
          <p className="text-lg sm:text-xl text-white/80 mb-10">
            Hauler directories, disposal facility maps, route optimization, and
            diversion reporting — built for waste industry professionals.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/directory"
              className="inline-flex h-12 items-center gap-2 px-7 rounded-lg bg-white text-[#2D6A4F] font-semibold text-sm hover:bg-gray-100 transition-colors whitespace-nowrap"
            >
              <Truck className="size-4" />
              Find Haulers →
            </Link>
            <Link
              href="/disposal"
              className="inline-flex h-12 items-center gap-2 px-7 rounded-lg border border-white/40 text-white font-semibold text-sm hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <MapPin className="size-4" />
              Browse Disposal Facilities →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats strip ─────────────────────────────────────────────────────── */}
      <section className="bg-[#1e4d39] text-white py-5 px-4">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-12 text-center">
          <div>
            <span className="text-2xl font-bold">11,000+</span>
            <span className="text-white/70 text-sm ml-2">Haulers</span>
          </div>
          <div className="hidden sm:block w-px h-8 bg-white/20" />
          <div>
            <span className="text-2xl font-bold">3,100+</span>
            <span className="text-white/70 text-sm ml-2">Disposal Facilities</span>
          </div>
          <div className="hidden sm:block w-px h-8 bg-white/20" />
          <div>
            <span className="text-2xl font-bold">9</span>
            <span className="text-white/70 text-sm ml-2">States Covered</span>
          </div>
        </div>
      </section>

      {/* ── Feature cards ───────────────────────────────────────────────────── */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
            What&rsquo;s on waste.markets
          </h2>
          <p className="text-gray-500 text-center mb-10 text-sm">
            Everything waste industry professionals need, in one place.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <Link
                  key={f.href}
                  href={f.href}
                  className="group bg-white rounded-xl border border-gray-200 p-6 flex flex-col hover:border-[#2D6A4F] hover:shadow-md transition-all"
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-[#2D6A4F]/10 group-hover:bg-[#2D6A4F]/20 transition-colors">
                    <Icon className="size-6 text-[#2D6A4F]" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-2">
                    {f.title}
                  </h3>
                  <p className="text-sm text-gray-500 flex-1 leading-relaxed">
                    {f.description}
                  </p>
                  <span className="mt-4 text-sm font-medium text-[#2D6A4F] group-hover:underline">
                    {f.cta} →
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Browse Haulers by State ──────────────────────────────────────────── */}
      <section className="py-16 px-4 bg-white border-t border-gray-100">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
            Browse Haulers by State
          </h2>
          <p className="text-gray-500 text-center mb-10 text-sm">
            Find licensed waste haulers serving Connecticut, Maine, Massachusetts,
            New Hampshire, New Jersey, New York, Pennsylvania, Rhode Island, and Vermont.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-5">
            {states.map((state) => (
              <Link
                key={state.slug}
                href={`/haulers/${state.slug}`}
                className="group bg-gray-50 rounded-xl border border-gray-200 p-5 flex flex-col items-center text-center transition-all hover:border-[#2D6A4F] hover:shadow-md hover:bg-white"
              >
                <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-[#2D6A4F]/10 group-hover:bg-[#2D6A4F]/20 transition-colors">
                  <MapPin className="size-5 text-[#2D6A4F]" />
                </div>
                <span className="text-xs font-bold tracking-widest uppercase text-[#94A3B8] mb-1">
                  {state.abbr}
                </span>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  {state.name}
                </h3>
                <span className="text-xs font-medium text-[#2D6A4F] group-hover:underline">
                  View haulers →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Latest News ─────────────────────────────────────────────────────── */}
      {latestArticles.length > 0 && (
        <section className="py-16 px-4 bg-gray-50 border-t border-gray-100">
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
    </div>
  );
}
