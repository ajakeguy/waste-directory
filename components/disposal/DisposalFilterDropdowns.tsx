"use client";

import { useRouter } from "next/navigation";
import { FACILITY_TYPE_LABELS, FACILITY_TYPES } from "@/types";
import type { FacilityType } from "@/types";

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

const SELECT_CLS =
  "h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/25 focus:border-[#2D6A4F] " +
  "cursor-pointer min-w-0";

export function DisposalFilterDropdowns({
  state,
  type,
  q,
}: {
  state: string;
  type: string;
  q?: string;
}) {
  const router = useRouter();

  function navigate(newState: string, newType: string) {
    const params = new URLSearchParams();
    if (newState) params.set("state", newState);
    if (newType)  params.set("type",  newType);
    if (q)        params.set("q",     q);
    params.set("page", "1");
    const qs = params.toString();
    router.push(`/disposal${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <select
        value={state}
        onChange={(e) => navigate(e.target.value, type)}
        aria-label="Filter by state"
        className={SELECT_CLS}
      >
        <option value="">All States</option>
        {STATE_OPTIONS.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        value={type}
        onChange={(e) => navigate(state, e.target.value)}
        aria-label="Filter by facility type"
        className={SELECT_CLS}
      >
        <option value="">All Facility Types</option>
        {FACILITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {FACILITY_TYPE_LABELS[t as FacilityType] ?? t}
          </option>
        ))}
      </select>
    </div>
  );
}
