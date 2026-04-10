"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import { SERVICE_TYPE_LABELS, SERVICE_TYPES } from "@/types";

const STATE_OPTIONS = [
  { label: "All States", value: "" },
  { label: "Connecticut", value: "CT" },
  { label: "Maine", value: "ME" },
  { label: "Massachusetts", value: "MA" },
  { label: "New Hampshire", value: "NH" },
  { label: "New Jersey", value: "NJ" },
  { label: "New York", value: "NY" },
  { label: "Pennsylvania", value: "PA" },
  { label: "Rhode Island", value: "RI" },
  { label: "Vermont", value: "VT" },
];

export function FilterSidebar({
  defaultState,
}: {
  /** Pre-select a state (used from state landing pages). When set, the state picker is hidden. */
  defaultState?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [mobileOpen, setMobileOpen] = useState(false);

  // Support both ?states=CT,NY (multi) and legacy ?state=NY (single)
  const statesStr = defaultState
    ? defaultState
    : (searchParams.get("states") ?? searchParams.get("state") ?? "");
  const selectedStates = statesStr ? statesStr.split(",").filter(Boolean) : [];
  const services = searchParams.getAll("service");
  const verified = searchParams.get("verified") === "1";

  const updateParams = useCallback(
    (updates: Record<string, string | string[] | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        params.delete(key);
        if (Array.isArray(value)) {
          value.forEach((v) => params.append(key, v));
        } else if (value) {
          params.set(key, value);
        }
      }

      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const toggleService = (type: string) => {
    const next = services.includes(type)
      ? services.filter((s) => s !== type)
      : [...services, type];
    updateParams({ service: next });
  };

  const toggleState = (code: string) => {
    const next = selectedStates.includes(code)
      ? selectedStates.filter((s) => s !== code)
      : [...selectedStates, code];
    updateParams({ states: next.join(",") || null });
  };

  const clearAll = () => {
    router.push(pathname);
  };

  const hasFilters = (!defaultState && selectedStates.length > 0) || services.length > 0 || verified;

  const activeFilterCount =
    (!defaultState ? selectedStates.length : 0) + services.length + (verified ? 1 : 0);

  return (
    <aside className="w-full md:w-64 md:shrink-0">
      {/* Mobile toggle button */}
      <button
        onClick={() => setMobileOpen((o) => !o)}
        className="md:hidden w-full flex items-center justify-between px-4 py-2.5 bg-white rounded-xl border border-gray-200 text-sm font-medium text-gray-700 mb-2"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-gray-400" />
          Filters
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center size-5 rounded-full bg-[#2D6A4F] text-white text-xs font-semibold">
              {activeFilterCount}
            </span>
          )}
        </span>
        {mobileOpen ? (
          <ChevronUp className="size-4 text-gray-400" />
        ) : (
          <ChevronDown className="size-4 text-gray-400" />
        )}
      </button>

      <div className={`bg-white rounded-xl border border-gray-200 p-5 md:sticky md:top-24 ${mobileOpen ? "block" : "hidden md:block"}`}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">Filters</h2>
          {hasFilters && (
            <button
              onClick={clearAll}
              className="text-xs text-[#2D6A4F] hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        {/* State checkboxes — hidden when a state is pre-selected via defaultState */}
        {!defaultState && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                State
              </label>
              {selectedStates.length > 0 && (
                <button
                  onClick={() => updateParams({ states: null })}
                  className="text-xs text-[#2D6A4F] hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {STATE_OPTIONS.filter((s) => s.value !== "").map((s) => (
                <label
                  key={s.value}
                  className="flex items-center gap-2 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={selectedStates.includes(s.value)}
                    onChange={() => toggleState(s.value)}
                    className="size-4 rounded border-gray-300 accent-[#2D6A4F] cursor-pointer"
                  />
                  <span className="text-sm text-gray-700 group-hover:text-gray-900 leading-snug">
                    {s.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Service type checkboxes */}
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Service Type
          </p>
          <div className="space-y-2">
            {SERVICE_TYPES.map((type) => (
              <label
                key={type}
                className="flex items-center gap-2 cursor-pointer group"
              >
                <input
                  type="checkbox"
                  checked={services.includes(type)}
                  onChange={() => toggleService(type)}
                  className="size-4 rounded border-gray-300 accent-[#2D6A4F] cursor-pointer"
                />
                <span className="text-sm text-gray-700 group-hover:text-gray-900 leading-snug">
                  {SERVICE_TYPE_LABELS[type]}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Verified only toggle */}
        <div className="pt-4 border-t border-gray-100">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) =>
                updateParams({ verified: e.target.checked ? "1" : null })
              }
              className="size-4 rounded border-gray-300 accent-[#2D6A4F] cursor-pointer"
            />
            <span className="text-sm font-medium text-gray-700">
              Verified only
            </span>
          </label>
        </div>

        {/* Per page */}
        <div className="pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Per page
          </p>
          <div className="flex gap-1">
            {([25, 50, 100] as const).map((n) => {
              const current = parseInt(searchParams.get("per_page") ?? "25", 10);
              const active = (isNaN(current) ? 25 : current) === n;
              return (
                <button
                  key={n}
                  onClick={() =>
                    updateParams({ per_page: n !== 25 ? String(n) : null, page: null })
                  }
                  className={`flex-1 text-center text-sm px-2 py-1.5 rounded-lg transition-colors ${
                    active
                      ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
