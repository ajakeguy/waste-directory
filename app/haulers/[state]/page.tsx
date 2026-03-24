import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FilterSidebar } from "@/components/directory/FilterSidebar";
import { OrganizationCard } from "@/components/directory/OrganizationCard";
import { getOrganizations } from "@/lib/data/organizations";
import { Skeleton } from "@/components/ui/skeleton";
import {
  STATE_SLUG_TO_CODE,
  STATE_SLUG_TO_NAME,
  VALID_STATE_SLUGS,
} from "@/types";

type Props = {
  params: Promise<{ state: string }>;
  searchParams: Promise<{ service?: string | string[]; verified?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state: stateSlug } = await params;
  const stateName = STATE_SLUG_TO_NAME[stateSlug];
  if (!stateName) return {};

  return {
    title: `${stateName} Waste Haulers | WasteDirectory`,
    description: `Find licensed waste haulers serving ${stateName}. Browse residential pickup, commercial services, roll-off containers, recycling, and more.`,
    openGraph: {
      title: `${stateName} Waste Haulers | WasteDirectory`,
      description: `The complete directory of waste haulers in ${stateName}.`,
    },
  };
}

export function generateStaticParams() {
  return VALID_STATE_SLUGS.map((state) => ({ state }));
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-xl border border-gray-200 p-5"
        >
          <Skeleton className="h-5 w-48 mb-2" />
          <Skeleton className="h-4 w-32 mb-4" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function StateResults({
  stateCode,
  services,
  verified,
}: {
  stateCode: string;
  services: string[];
  verified: boolean;
}) {
  const organizations = await getOrganizations({
    state: stateCode,
    services,
    verified,
  });

  if (organizations.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-lg font-medium text-gray-700 mb-1">
          No haulers found
        </p>
        <p className="text-sm text-gray-500">
          Try adjusting your filters or check back as we add more listings.
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

export default async function StateLandingPage({
  params,
  searchParams,
}: Props) {
  const { state: stateSlug } = await params;
  const sp = await searchParams;

  const stateCode = STATE_SLUG_TO_CODE[stateSlug];
  const stateName = STATE_SLUG_TO_NAME[stateSlug];

  if (!stateCode || !stateName) notFound();

  const services = sp.service
    ? Array.isArray(sp.service)
      ? sp.service
      : [sp.service]
    : [];

  // Fetch count for the hero (separate fast query)
  const allOrgs = await getOrganizations({ state: stateCode });
  const totalCount = allOrgs.length;

  return (
    <div>
      {/* State hero */}
      <section className="bg-[#2D6A4F] text-white py-14 px-4">
        <div className="max-w-7xl mx-auto">
          <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-2">
            Waste Hauler Directory
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">{stateName}</h1>
          <p className="text-white/80 text-lg">
            {totalCount > 0
              ? `${totalCount} hauler${totalCount !== 1 ? "s" : ""} serving ${stateName}`
              : `Browse waste haulers serving ${stateName}`}
          </p>
        </div>
      </section>

      {/* Directory with filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-6 items-start">
          <Suspense fallback={<div className="w-64 shrink-0" />}>
            <FilterSidebar defaultState={stateCode} />
          </Suspense>

          <div className="flex-1 min-w-0">
            <Suspense fallback={<ResultsSkeleton />}>
              <StateResults
                stateCode={stateCode}
                services={services}
                verified={sp.verified === "1"}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
