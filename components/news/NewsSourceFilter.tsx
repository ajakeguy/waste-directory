"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { NewsSource } from "@/lib/data/news";

export function NewsSourceFilter({ sources }: { sources: NewsSource[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("source") ?? "";

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString());
    if (e.target.value) {
      params.set("source", e.target.value);
    } else {
      params.delete("source");
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <select
      value={current}
      onChange={handleChange}
      className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F] cursor-pointer"
    >
      <option value="">All sources</option>
      {sources.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
