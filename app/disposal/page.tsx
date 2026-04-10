import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Phone, CheckCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDisposalFacilitiesPaginated,
  getDisposalFacilitiesForMap,
} from "@/lib/data/disposal";
import { createClient } from "@/lib/supabase/server";
import { Pagination } from "@/components/directory/Pagination";
import { SearchBar } from "@/components/directory/SearchBar";
import { DisposalSaveButton } from "@/components/disposal/DisposalSaveButton";
import { DisposalMap } from "@/components/disposal/DisposalMap";
import type { MapFacility } from "@/components/disposal/DisposalMap";
import {
  FACILITY_TYPE_LABELS,
  FACILITY_TYPE_COLORS,
  FACILITY_TYPES,
} from "@/types";
import type { FacilityType } from "@/types";

export const metadata: Metadata = {
  title: "Disposal Facilities Directory | WasteDirectory",
  description:
    "Find landfills, transfer stations, MRFs, composting facilities, and waste-to-energy plants across the Northeast.",
};

const VALID_PAGE_SIZES = [25, 50, 100] as const;
type PageSize = (typeof VALID_PAGE_SIZES)[number];

function parsePageSize(raw: string | undefined): PageSize {
  const n = parseInt(raw ?? "25", 10);
  return (VALID_PAGE_SIZES as readonly number[]).includes(n)
    ? (n as PageSize)
    : 25;
}

type SearchParams = Promise<{
  state?: string;   // legacy single 2-letter code (backward compat, e.g. from state landing pages)
  states?: string;  // comma-separated 2-letter codes e.g. "MA,CT,NY"
  type?: string;    // legacy single-type (backward compat)
  types?: string;   // comma-separated facility types e.g. "landfill,mrf"
  active?: string;
  q?: string;
  page?: string;
  per_page?: string;
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
  states,
  facility_types,
  active_only,
  q,
  page,
  pageSize,
}: {
  states: string[];
  facility_types: string[];
  active_only: boolean;
  q?: string;
  page: number;
  pageSize: PageSize;
}) {
  const { data: facilities, count: total } = await getDisposalFacilitiesPaginated(
    { states, facility_types: facility_types.length > 0 ? facility_types : undefined, active_only, q },
    page,
    pageSize
  );

  // Check auth + saved IDs for save buttons
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

  if (total === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-lg font-medium text-gray-700 mb-1">No facilities found</p>
        <p className="text-sm text-gray-500">Try adjusting your filters.</p>
      </div>
    );
  }

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

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

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}

// ── Filter sidebar ────────────────────────────────────────────────────────────

function FilterSidebar({
  selectedStates,
  selectedTypes,
  activeOnly,
  q,
  perPage,
}: {
  selectedStates: string[];
  selectedTypes: string[];
  activeOnly: boolean;
  q?: string;
  perPage: PageSize;
}) {
  function buildUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      states:   selectedStates.length > 0 ? selectedStates.join(",") : undefined,
      types:    selectedTypes.length > 0 ? selectedTypes.join(",") : undefined,
      active:   activeOnly ? "1" : "0",
      q,
      per_page: perPage !== 25 ? String(perPage) : undefined,
      page:     "1",
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (!v) continue;
      if (k === "active" && v === "1") continue; // active=1 is default, omit
      params.set(k, v);
    }
    const qs = params.toString();
    return `/disposal${qs ? `?${qs}` : ""}`;
  }

  return (
    <aside className="md:w-56 md:shrink-0 space-y-6">
      {/* State — multi-select toggle */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            State
          </h3>
          {selectedStates.length > 0 && (
            <Link
              href={buildUrl({ states: undefined })}
              className="text-xs text-[#2D6A4F] hover:underline"
            >
              Clear
            </Link>
          )}
        </div>
        <div className="space-y-1">
          {STATE_OPTIONS.map((s) => {
            const isSelected = selectedStates.includes(s.code);
            const nextStates = isSelected
              ? selectedStates.filter((c) => c !== s.code)
              : [...selectedStates, s.code];
            return (
              <Link
                key={s.code}
                href={buildUrl({ states: nextStates.length > 0 ? nextStates.join(",") : undefined })}
                className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg transition-colors ${
                  isSelected
                    ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <span
                  className={`size-4 shrink-0 rounded border flex items-center justify-center text-[10px] font-bold ${
                    isSelected
                      ? "bg-[#2D6A4F] border-[#2D6A4F] text-white"
                      : "border-gray-300"
                  }`}
                >
                  {isSelected ? "✓" : ""}
                </span>
                {s.name}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Facility type — multi-select checkboxes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Facility Type
          </h3>
          {selectedTypes.length > 0 && (
            <Link
              href={buildUrl({ types: undefined })}
              className="text-xs text-[#2D6A4F] hover:underline"
            >
              Clear
            </Link>
          )}
        </div>
        <div className="space-y-1">
          {/* "All Types" — clears selection */}
          <Link
            href={buildUrl({ types: undefined })}
            className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg transition-colors ${
              selectedTypes.length === 0
                ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span
              className={`size-4 shrink-0 rounded border flex items-center justify-center text-[10px] font-bold ${
                selectedTypes.length === 0
                  ? "bg-[#2D6A4F] border-[#2D6A4F] text-white"
                  : "border-gray-300"
              }`}
            >
              {selectedTypes.length === 0 ? "✓" : ""}
            </span>
            All Types
          </Link>
          {FACILITY_TYPES.map((t) => {
            const isSelected = selectedTypes.includes(t);
            const nextTypes = isSelected
              ? selectedTypes.filter((x) => x !== t)
              : [...selectedTypes, t];
            return (
              <Link
                key={t}
                href={buildUrl({ types: nextTypes.length > 0 ? nextTypes.join(",") : undefined })}
                className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg transition-colors ${
                  isSelected
                    ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <span
                  className={`size-4 shrink-0 rounded border flex items-center justify-center text-[10px] font-bold ${
                    isSelected
                      ? "bg-[#2D6A4F] border-[#2D6A4F] text-white"
                      : "border-gray-300"
                  }`}
                >
                  {isSelected ? "✓" : ""}
                </span>
                {FACILITY_TYPE_LABELS[t]}
              </Link>
            );
          })}
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

      {/* Per-page */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Per page
        </h3>
        <div className="flex gap-1">
          {VALID_PAGE_SIZES.map((n) => (
            <Link
              key={n}
              href={buildUrl({ per_page: n !== 25 ? String(n) : undefined, page: "1" })}
              className={`flex-1 text-center text-sm px-2 py-1.5 rounded-lg transition-colors ${
                perPage === n
                  ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {n}
            </Link>
          ))}
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

  // Multi-state: ?states=NJ,NY  (preferred)
  // Single-state: ?state=NJ     (legacy backward compat — e.g. from state landing page links)
  const selectedStates = (params.states ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const legacy_state = (!params.states && params.state)
    ? params.state.trim().toUpperCase()
    : undefined;
  const effectiveStates = selectedStates.length > 0
    ? selectedStates
    : legacy_state ? [legacy_state] : [];

  // Multi-type: ?types=landfill,mrf  (preferred)
  // Single-type: ?type=landfill      (legacy backward compat)
  const selectedTypes = (params.types ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const legacy_type = (!params.types && params.type) ? params.type : undefined;
  const effectiveTypes = selectedTypes.length > 0
    ? selectedTypes
    : legacy_type ? [legacy_type] : [];

  const active_only = params.active !== "0";
  const q           = params.q || undefined;
  const page        = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const pageSize    = parsePageSize(params.per_page);

  const filters = {
    states: effectiveStates,
    facility_types: effectiveTypes.length > 0 ? effectiveTypes : undefined,
    active_only,
    q,
  };

  // Fetch facilities for map (server-side, passed as props to client component)
  const mapFacilities = await getDisposalFacilitiesForMap(filters);

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
          <SearchBar placeholder="Search facilities by name..." />
        </Suspense>
      </div>

      {/* Map */}
      {mapFacilities.length > 0 && (
        <DisposalMap facilities={mapFacilities as MapFacility[]} />
      )}

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:items-start">
        <FilterSidebar
          selectedStates={effectiveStates}
          selectedTypes={effectiveTypes}
          activeOnly={active_only}
          q={q}
          perPage={pageSize}
        />

        <div className="flex-1 min-w-0">
          <Suspense fallback={<ResultsSkeleton />}>
            <DisposalResults
              states={effectiveStates}
              facility_types={effectiveTypes}
              active_only={active_only}
              q={q}
              page={page}
              pageSize={pageSize}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
