"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const OPTIONS = [25, 50, 100] as const;

export function PerPageSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = parseInt(searchParams.get("per_page") ?? "25", 10);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString());
    const val = e.target.value;
    if (val === "25") {
      params.delete("per_page");
    } else {
      params.set("per_page", val);
    }
    params.delete("page"); // reset to page 1 when page size changes
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <select
      value={current}
      onChange={handleChange}
      aria-label="Results per page"
      className="h-[42px] rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/25 focus:border-[#2D6A4F] cursor-pointer"
    >
      {OPTIONS.map((n) => (
        <option key={n} value={n}>
          {n} per page
        </option>
      ))}
    </select>
  );
}
