"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_CONDITION_LABELS,
} from "@/types";

const CONDITIONS = ["new", "used", "refurbished"] as const;

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export function MarketplaceFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const category = searchParams.get("category") ?? "";
  const condition = searchParams.get("condition") ?? "";
  const state = searchParams.get("state") ?? "";
  const priceMin = searchParams.get("price_min") ?? "";
  const priceMax = searchParams.get("price_max") ?? "";

  const update = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(updates)) {
        if (val) params.set(key, val);
        else params.delete(key);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const hasFilters = category || condition || state || priceMin || priceMax;

  return (
    <aside className="w-64 shrink-0">
      <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-24">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">Filters</h2>
          {hasFilters && (
            <button
              onClick={() => router.push(pathname)}
              className="text-xs text-[#2D6A4F] hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Category */}
        <div className="mb-5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => update({ category: e.target.value || null })}
            className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F] cursor-pointer"
          >
            <option value="">All Categories</option>
            {EQUIPMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EQUIPMENT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        {/* Condition */}
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Condition
          </p>
          <div className="space-y-2">
            {CONDITIONS.map((c) => (
              <label key={c} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="condition"
                  checked={condition === c}
                  onChange={() => update({ condition: condition === c ? null : c })}
                  className="size-4 accent-[#2D6A4F] cursor-pointer"
                />
                <span className="text-sm text-gray-700">
                  {EQUIPMENT_CONDITION_LABELS[c]}
                </span>
              </label>
            ))}
            {condition && (
              <button
                onClick={() => update({ condition: null })}
                className="text-xs text-gray-400 hover:text-[#2D6A4F]"
              >
                Clear condition
              </button>
            )}
          </div>
        </div>

        {/* State */}
        <div className="mb-5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            State
          </label>
          <select
            value={state}
            onChange={(e) => update({ state: e.target.value || null })}
            className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F] cursor-pointer"
          >
            <option value="">All States</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Price range */}
        <div className="pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Price Range
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Min"
              value={priceMin}
              min={0}
              onChange={(e) => update({ price_min: e.target.value || null })}
              className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
            />
            <span className="text-gray-400 shrink-0">–</span>
            <input
              type="number"
              placeholder="Max"
              value={priceMax}
              min={0}
              onChange={(e) => update({ price_max: e.target.value || null })}
              className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
