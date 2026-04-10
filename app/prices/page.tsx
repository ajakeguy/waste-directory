import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PricesDashboard } from "@/components/prices/PricesDashboard";

export const metadata: Metadata = {
  title: "Market Prices | waste.markets",
  description:
    "Live commodity prices for waste industry operators — diesel, natural gas, OCC, plastics, aluminum, and more. Updated daily from EIA and FRED.",
};

// Revalidate every hour so prices stay fresh without a full dynamic page
export const revalidate = 3600;

export type CommodityPrice = {
  commodity_key: string;
  price: number;
  unit: string;
  period_date: string;
  source: string;
};

async function getPrices(): Promise<CommodityPrice[]> {
  const supabase = await createClient();

  // For each commodity_key, get the most recent row.
  // We use a subquery-equivalent: fetch the most recent 2 rows per key,
  // then the client picks [0]. Supabase doesn't have DISTINCT ON, so we
  // fetch with order by key+date and deduplicate in JS.
  const KEYS = [
    "ulsd_diesel",
    "wti_crude",
    "henry_hub_gas",
    "electricity_commercial",
    "steel_scrap_hms1",
    "occ_cardboard",
    "mixed_paper",
    "pet_plastic",
    "hdpe_plastic",
    "aluminum_cans",
    "glass_cullet",
    "compost",
    "rng",
    "aluminum_lme",
  ];

  const { data } = await supabase
    .from("commodity_prices")
    .select("commodity_key, price, unit, period_date, source")
    .in("commodity_key", KEYS)
    .order("period_date", { ascending: false });

  if (!data) return [];

  // Deduplicate: keep the most recent row per commodity_key
  const seen = new Set<string>();
  const latest: CommodityPrice[] = [];
  for (const row of data) {
    if (!seen.has(row.commodity_key)) {
      seen.add(row.commodity_key);
      latest.push(row as CommodityPrice);
    }
  }

  // Also fetch previous period for each key (for change indicators)
  // We'll include up to 2 rows per key and let the client calculate change
  const prev: CommodityPrice[] = [];
  for (const row of data) {
    if (prev.filter((r) => r.commodity_key === row.commodity_key).length === 0
        && latest.find((l) => l.commodity_key === row.commodity_key && l.period_date !== row.period_date)) {
      prev.push(row as CommodityPrice);
    }
  }

  return latest;
}

async function getPreviousPrices(latest: CommodityPrice[]): Promise<CommodityPrice[]> {
  if (latest.length === 0) return [];
  const supabase = await createClient();

  const prev: CommodityPrice[] = [];
  for (const item of latest) {
    const { data } = await supabase
      .from("commodity_prices")
      .select("commodity_key, price, unit, period_date, source")
      .eq("commodity_key", item.commodity_key)
      .lt("period_date", item.period_date)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) prev.push(data as CommodityPrice);
  }
  return prev;
}

export default async function PricesPage() {
  const latest = await getPrices();
  const previous = await getPreviousPrices(latest);

  return (
    <PricesDashboard latest={latest} previous={previous} />
  );
}
