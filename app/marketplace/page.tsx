import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { MarketplaceFilters } from "@/components/marketplace/MarketplaceFilters";
import { SearchBar } from "@/components/directory/SearchBar";
import { Skeleton } from "@/components/ui/skeleton";
import type { EquipmentListing } from "@/types";

export const metadata: Metadata = {
  title: "Equipment Marketplace | WasteDirectory",
  description:
    "Buy and sell waste industry equipment — trucks, containers, compactors, balers, and more.",
};

type SearchParams = Promise<{
  category?: string;
  condition?: string;
  state?: string;
  q?: string;
  price_min?: string;
  price_max?: string;
}>;

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <Skeleton className="h-44 w-full rounded-none" />
          <div className="p-4 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function ListingResults({
  category, condition, state, q, priceMin, priceMax,
}: {
  category?: string; condition?: string; state?: string;
  q?: string; priceMin?: string; priceMax?: string;
}) {
  const supabase = await createClient();

  let query = supabase
    .from("equipment_listings")
    .select(
      "id, title, category, condition, price, price_negotiable, quantity, " +
      "location_city, location_state, photos, status, expires_at, created_at"
    )
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (category) query = query.eq("category", category);
  if (condition) query = query.eq("condition", condition);
  if (state) query = query.eq("location_state", state);
  if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  if (priceMin) query = query.gte("price", parseFloat(priceMin));
  if (priceMax) query = query.lte("price", parseFloat(priceMax));

  const { data } = await query;
  const listings = (data ?? []) as unknown as EquipmentListing[];

  if (listings.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-lg font-medium text-gray-700 mb-1">No listings found</p>
        <p className="text-sm text-gray-500">
          Try adjusting your filters or{" "}
          <Link href="/marketplace/new" className="text-[#2D6A4F] hover:underline">
            post your own listing
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        {listings.length} listing{listings.length !== 1 ? "s" : ""} found
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {listings.map((l) => (
          <ListingCard key={l.id} listing={l} />
        ))}
      </div>
    </div>
  );
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Equipment Marketplace</h1>
          <p className="text-gray-500 text-sm mt-1">
            Buy and sell waste industry equipment
          </p>
        </div>
        {user && (
          <Link
            href="/marketplace/new"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors shrink-0"
          >
            <Plus className="size-4" />
            Post Listing
          </Link>
        )}
      </div>

      {/* Search bar */}
      <div className="mb-5">
        <Suspense fallback={
          <div className="w-full h-[42px] rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />
        }>
          <SearchBar />
        </Suspense>
      </div>

      {/* Filters + results */}
      <div className="flex gap-6 items-start">
        <Suspense fallback={<div className="w-64 shrink-0" />}>
          <MarketplaceFilters />
        </Suspense>

        <div className="flex-1 min-w-0">
          <Suspense fallback={<GridSkeleton />}>
            <ListingResults
              category={params.category}
              condition={params.condition}
              state={params.state}
              q={params.q}
              priceMin={params.price_min}
              priceMax={params.price_max}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
