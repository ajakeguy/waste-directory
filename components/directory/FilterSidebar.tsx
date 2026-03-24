"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { SERVICE_TYPE_LABELS, SERVICE_TYPES } from "@/types";

const STATE_OPTIONS = [
  { label: "All States", value: "" },
  { label: "Vermont", value: "VT" },
  { label: "New York", value: "NY" },
  { label: "Massachusetts", value: "MA" },
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

  const state = defaultState ?? searchParams.get("state") ?? "";
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

  const clearAll = () => {
    if (defaultState) {
      // Keep the state locked; only clear service/verified filters
      router.push(pathname);
    } else {
      router.push(pathname);
    }
  };

  const hasFilters = (!defaultState && state) || services.length > 0 || verified;

  return (
    <aside className="w-64 shrink-0">
      <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-6">
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

        {/* State selector — hidden when a state is pre-selected */}
        {!defaultState && (
          <div className="mb-6">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              State
            </label>
            <select
              value={state}
              onChange={(e) =>
                updateParams({ state: e.target.value || null })
              }
              className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F] cursor-pointer"
            >
              {STATE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
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
      </div>
    </aside>
  );
}
