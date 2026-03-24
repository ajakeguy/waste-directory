import { Suspense } from "react";
import type { Metadata } from "next";
import { FilterSidebar } from "@/components/directory/FilterSidebar";
import { OrganizationCard } from "@/components/directory/OrganizationCard";
import { getOrganizations } from "@/lib/data/organizations";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Waste Hauler Directory | WasteDirectory",
  description:
    "Find licensed waste haulers across Vermont, New York, and Massachusetts. Filter by state, service type, verified status, and more.",
};

type SearchParams = Promise<{
  state?: string;
  service?: string | string[];
  verified?: string;
  q?: string;
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
}: {
  state?: string;
  services: string[];
  verified: boolean;
  q?: string;
}) {
  const organizations = await getOrganizations({ state, services, verified, q });

  if (organizations.length === 0) {
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

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 mb-1">
        {organizations.length} hauler{organizations.length !== 1 ? "s" : ""}{" "}
        found
      </p>
      {organizations.map((org) => (
        <OrganizationCard key={org.id} org={org} />
      ))}
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Waste Hauler Directory
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Browse licensed waste haulers across Vermont, New York, and
          Massachusetts
        </p>
      </div>

      <div className="flex gap-6 items-start">
        {/* Filter sidebar — needs Suspense because it uses useSearchParams */}
        <Suspense fallback={<div className="w-64 shrink-0" />}>
          <FilterSidebar />
        </Suspense>

        {/* Results */}
        <div className="flex-1 min-w-0">
          <Suspense fallback={<ResultsSkeleton />}>
            <DirectoryResults
              state={params.state}
              services={services}
              verified={params.verified === "1"}
              q={params.q}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
