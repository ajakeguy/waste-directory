import { Suspense } from "react";
import type { Metadata } from "next";
import { FilterSidebar } from "@/components/directory/FilterSidebar";
import { OrganizationCard } from "@/components/directory/OrganizationCard";
import { SearchBar } from "@/components/directory/SearchBar";
import { Pagination } from "@/components/directory/Pagination";
import { getOrganizationsPaginated } from "@/lib/data/organizations";
import { getSavedOrgIds } from "@/lib/data/saved-items";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Waste Hauler Directory | WasteDirectory",
  description:
    "Find licensed waste haulers across the Northeast. Filter by state, service type, verified status, and more.",
};

const VALID_PAGE_SIZES = [25, 50, 100] as const;
type PageSize = (typeof VALID_PAGE_SIZES)[number];

function parsePageSize(raw: string | undefined): PageSize {
  const n = parseInt(raw ?? "25", 10);
  return (VALID_PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : 25;
}

type SearchParams = Promise<{
  state?: string;
  service?: string | string[];
  verified?: string;
  q?: string;
  page?: string;
  per_page?: string;
}>;

function ResultsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-xl border border-gray-200 p-5"
        >
          <Skeleton className="h-5 w-48 mb-2" />
          <Skeleton className="h-4 w-32 mb-4" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function DirectoryResults({
  state,
  services,
  verified,
  q,
  userId,
  page,
  pageSize,
}: {
  state?: string;
  services: string[];
  verified: boolean;
  q?: string;
  userId: string | null;
  page: number;
  pageSize: PageSize;
}) {
  const [{ data: organizations, count: total }, savedOrgIds] = await Promise.all([
    getOrganizationsPaginated({ state, services, verified, q }, page, pageSize),
    userId ? getSavedOrgIds(userId) : Promise.resolve(new Set<string>()),
  ]);

  if (total === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-lg font-medium text-gray-700 mb-1">
          No haulers found
        </p>
        <p className="text-sm text-gray-500">
          Try adjusting your filters or broadening your search.
        </p>
      </div>
    );
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 mb-1">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of{" "}
        {total.toLocaleString()} hauler{total !== 1 ? "s" : ""}
      </p>
      {organizations.map((org) => (
        <OrganizationCard
          key={org.id}
          org={org}
          savedOrgIds={savedOrgIds}
          userId={userId}
        />
      ))}
      <Suspense fallback={null}>
        <Pagination page={page} pageSize={pageSize} total={total} />
      </Suspense>
    </div>
  );
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const services = params.service
    ? Array.isArray(params.service)
      ? params.service
      : [params.service]
    : [];

  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(params.per_page);

  // Get current user for saved-state display
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Waste Hauler Directory
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Browse licensed waste haulers across the Northeast
        </p>
      </div>

      {/* Search bar — wrapped in Suspense because it calls useSearchParams */}
      <div className="mb-5">
        <Suspense fallback={
          <div className="w-full h-[42px] rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />
        }>
          <SearchBar />
        </Suspense>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:items-start">
        <Suspense fallback={<div className="hidden md:block md:w-64 md:shrink-0" />}>
          <FilterSidebar />
        </Suspense>

        <div className="flex-1 min-w-0">
          <Suspense fallback={<ResultsSkeleton />}>
            <DirectoryResults
              state={params.state}
              services={services}
              verified={params.verified === "1"}
              q={params.q}
              userId={user?.id ?? null}
              page={page}
              pageSize={pageSize}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
