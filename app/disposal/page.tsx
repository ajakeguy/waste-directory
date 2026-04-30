import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Phone, CheckCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getDisposalFacilitiesPaginated } from "@/lib/data/disposal";
import { createClient } from "@/lib/supabase/server";
import { Pagination } from "@/components/directory/Pagination";
import { SearchBar } from "@/components/directory/SearchBar";
import { DisposalSaveButton } from "@/components/disposal/DisposalSaveButton";
import { DisposalFilterDropdowns } from "@/components/disposal/DisposalFilterDropdowns";
import { FACILITY_TYPE_LABELS, FACILITY_TYPE_COLORS } from "@/types";
import type { FacilityType } from "@/types";

export const metadata: Metadata = {
  title: "Disposal Facilities Directory | waste.markets",
  description:
    "Find landfills, transfer stations, MRFs, composting facilities, and waste-to-energy plants across the Northeast.",
};

// Page always shows 25 results — no user-configurable page size.
const PAGE_SIZE = 25;

type SearchParams = Promise<{
  state?: string;   // single 2-letter code, e.g. "NY"
  type?: string;    // single facility type, e.g. "landfill"
  q?: string;
  page?: string;
}>;

// ── Skeleton ──────────────────────────────────────────────────────────────────

function ResultsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
          <Skeleton className="h-5 w-56 mb-2" />
          <Skeleton className="h-4 w-32 mb-4" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Results ───────────────────────────────────────────────────────────────────

async function DisposalResults({
  state,
  type,
  q,
  page,
}: {
  state?: string;
  type?: string;
  q?: string;
  page: number;
}) {
  const { data: facilities, count: total } = await getDisposalFacilitiesPaginated(
    { state, facility_type: type, active_only: true, q },
    page,
    PAGE_SIZE
  );

  // Auth + saved IDs for save buttons
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let savedIds = new Set<string>();
  if (user) {
    const { data: savedRows } = await supabase
      .from("saved_disposal_facilities")
      .select("facility_id")
      .eq("user_id", user.id);
    savedIds = new Set((savedRows ?? []).map((r) => r.facility_id));
  }

  if (!total || total === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-lg font-medium text-gray-700 mb-1">No facilities found</p>
        <p className="text-sm text-gray-500">Try adjusting your filters.</p>
      </div>
    );
  }

  const from = (page - 1) * PAGE_SIZE + 1;
  const to   = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 mb-1">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of{" "}
        {total.toLocaleString()} facilit{total !== 1 ? "ies" : "y"}
      </p>

      {facilities.map((f) => {
        const typeLabel = FACILITY_TYPE_LABELS[f.facility_type as FacilityType] ?? f.facility_type;
        const typeColor = FACILITY_TYPE_COLORS[f.facility_type as FacilityType] ?? "bg-gray-100 text-gray-700";
        return (
          <Link
            key={f.id}
            href={`/disposal/${f.slug}`}
            className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-[#2D6A4F] hover:shadow-sm transition-all"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="text-base font-semibold text-gray-900 truncate">
                    {f.name}
                  </h3>
                  {!f.active && (
                    <span className="text-xs font-medium bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
                      Closed
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 text-sm text-gray-500 mb-3">
                  <MapPin className="size-3.5 shrink-0" />
                  <span>
                    {[f.city, f.state].filter(Boolean).join(", ")}
                    {f.zip ? ` ${f.zip}` : ""}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full ${typeColor}`}>
                    {typeLabel}
                  </span>
                  {f.phone && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                      <Phone className="size-3" />
                      {f.phone}
                    </span>
                  )}
                  {f.verified && (
                    <span className="inline-flex items-center gap-1 text-xs text-[#2D6A4F]">
                      <CheckCircle className="size-3" />
                      Verified
                    </span>
                  )}
                </div>
              </div>

              {user && (
                <DisposalSaveButton
                  facilityId={f.id}
                  initialSaved={savedIds.has(f.id)}
                  size="sm"
                />
              )}
            </div>
          </Link>
        );
      })}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DisposalPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const state = params.state?.trim().toUpperCase() || undefined;
  const type  = params.type?.trim().toLowerCase()  || undefined;
  const q     = params.q || undefined;
  const page  = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Disposal Facilities Directory
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Landfills, transfer stations, MRFs, and composting facilities across the Northeast
        </p>
      </div>

      {/* Filters — search bar + state/type dropdowns */}
      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <div className="flex-1">
          <Suspense fallback={
            <div className="w-full h-10 rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />
          }>
            <SearchBar placeholder="Search facilities by name..." />
          </Suspense>
        </div>
        <DisposalFilterDropdowns
          state={state ?? ""}
          type={type ?? ""}
          q={q}
        />
      </div>

      {/* Results */}
      <Suspense fallback={<ResultsSkeleton />}>
        <DisposalResults state={state} type={type} q={q} page={page} />
      </Suspense>

      {/* Submit banner */}
      <div className="mt-6 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-gray-600">
          Missing a facility from our directory?
        </p>
        <Link
          href="/submit"
          className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-[#2D6A4F] hover:underline"
        >
          Suggest a facility →
        </Link>
      </div>
    </div>
  );
}
