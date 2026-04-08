import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Phone, CheckCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getDisposalFacilitiesPaginated } from "@/lib/data/disposal";
import { Pagination } from "@/components/directory/Pagination";
import { SearchBar } from "@/components/directory/SearchBar";
import {
  FACILITY_TYPE_LABELS,
  FACILITY_TYPE_COLORS,
  FACILITY_TYPES,
  STATE_SLUG_TO_CODE,
  STATE_SLUG_TO_NAME,
} from "@/types";
import type { FacilityType } from "@/types";

export const metadata: Metadata = {
  title: "Disposal Facilities Directory | WasteDirectory",
  description:
    "Find landfills, transfer stations, MRFs, composting facilities, and waste-to-energy plants across the Northeast.",
};

const PAGE_SIZE = 25;

type SearchParams = Promise<{
  state?: string;
  type?: string;
  active?: string;
  q?: string;
  page?: string;
}>;

// ── Sidebar options ───────────────────────────────────────────────────────────

const STATE_OPTIONS = [
  { code: "CT", name: "Connecticut" },
  { code: "ME", name: "Maine" },
  { code: "MA", name: "Massachusetts" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NY", name: "New York" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "VT", name: "Vermont" },
];

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
  facility_type,
  active_only,
  q,
  page,
}: {
  state?: string;
  facility_type?: string;
  active_only: boolean;
  q?: string;
  page: number;
}) {
  const { data: facilities, count: total } = await getDisposalFacilitiesPaginated(
    { state, facility_type, active_only, q },
    page,
    PAGE_SIZE
  );

  if (total === 0) {
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
            </div>
          </Link>
        );
      })}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  );
}

// ── Filter sidebar ────────────────────────────────────────────────────────────

function FilterSidebar({
  selectedState,
  selectedType,
  activeOnly,
  q,
}: {
  selectedState?: string;
  selectedType?: string;
  activeOnly: boolean;
  q?: string;
}) {
  function buildUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = {
      state:  selectedState,
      type:   selectedType,
      active: activeOnly ? "1" : "0",
      q,
      page:   "1",
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "1") params.set(k, v);          // omit defaults
      else if (v === "1" && k === "active") {/* skip — active=1 is default */}
    }
    const qs = params.toString();
    return `/disposal${qs ? `?${qs}` : ""}`;
  }

  return (
    <aside className="md:w-56 md:shrink-0 space-y-6">
      {/* State */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          State
        </h3>
        <div className="space-y-1">
          <Link
            href={buildUrl({ state: undefined })}
            className={`block text-sm px-2 py-1.5 rounded-lg transition-colors ${
              !selectedState
                ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            All States
          </Link>
          {STATE_OPTIONS.map((s) => (
            <Link
              key={s.code}
              href={buildUrl({ state: s.code })}
              className={`block text-sm px-2 py-1.5 rounded-lg transition-colors ${
                selectedState === s.code
                  ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {s.name}
            </Link>
          ))}
        </div>
      </div>

      {/* Facility type */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Facility Type
        </h3>
        <div className="space-y-1">
          <Link
            href={buildUrl({ type: undefined })}
            className={`block text-sm px-2 py-1.5 rounded-lg transition-colors ${
              !selectedType
                ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            All Types
          </Link>
          {FACILITY_TYPES.map((t) => (
            <Link
              key={t}
              href={buildUrl({ type: t })}
              className={`block text-sm px-2 py-1.5 rounded-lg transition-colors ${
                selectedType === t
                  ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {FACILITY_TYPE_LABELS[t]}
            </Link>
          ))}
        </div>
      </div>

      {/* Active only toggle */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Status
        </h3>
        <div className="space-y-1">
          <Link
            href={buildUrl({ active: "1" })}
            className={`block text-sm px-2 py-1.5 rounded-lg transition-colors ${
              activeOnly
                ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Active only
          </Link>
          <Link
            href={buildUrl({ active: "0" })}
            className={`block text-sm px-2 py-1.5 rounded-lg transition-colors ${
              !activeOnly
                ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Include closed
          </Link>
        </div>
      </div>
    </aside>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DisposalPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const state         = params.state?.toUpperCase() || undefined;
  const facility_type = params.type || undefined;
  const active_only   = params.active !== "0";
  const q             = params.q || undefined;
  const page          = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Disposal Facilities Directory
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Landfills, transfer stations, MRFs, and composting facilities across the Northeast
        </p>
      </div>

      <div className="mb-5">
        <Suspense fallback={
          <div className="w-full h-[42px] rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />
        }>
          <SearchBar />
        </Suspense>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:items-start">
        <FilterSidebar
          selectedState={state}
          selectedType={facility_type}
          activeOnly={active_only}
          q={q}
        />

        <div className="flex-1 min-w-0">
          <Suspense fallback={<ResultsSkeleton />}>
            <DisposalResults
              state={state}
              facility_type={facility_type}
              active_only={active_only}
              q={q}
              page={page}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
