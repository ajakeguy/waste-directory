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

const COMMODITY_KEYS = [
  "ulsd_diesel",
  "wti_crude",
  "henry_hub_gas",
  "electricity_commercial",
  "steel_scrap_hms1",
  "aluminum_lme",
  "occ_cardboard",
  "mixed_paper",
  "pet_plastic",
  "hdpe_plastic",
  "aluminum_cans",
  "glass_cullet",
  "compost",
  "rng",
] as const;

const HISTORY_POINTS = 8; // how many data points to keep per commodity

async function getPricesWithHistory(): Promise<{
  latest: CommodityPrice[];
  history: Record<string, CommodityPrice[]>;
}> {
  const supabase = await createClient();

  // Single query — fetch all rows for all keys, sorted newest first.
  // We keep up to HISTORY_POINTS rows per key in JS (no DISTINCT ON needed).
  const { data } = await supabase
    .from("commodity_prices")
    .select("commodity_key, price, unit, period_date, source")
    .in("commodity_key", COMMODITY_KEYS)
    .order("commodity_key", { ascending: true })
    .order("period_date", { ascending: false });

  if (!data) return { latest: [], history: {} };

  // Group by commodity_key, newest-first, capped at HISTORY_POINTS
  const grouped: Record<string, CommodityPrice[]> = {};
  for (const row of data as CommodityPrice[]) {
    if (!grouped[row.commodity_key]) grouped[row.commodity_key] = [];
    if (grouped[row.commodity_key].length < HISTORY_POINTS) {
      grouped[row.commodity_key].push(row);
    }
  }

  // Latest = most recent row per commodity
  const latest = Object.values(grouped).map((rows) => rows[0]);

  return { latest, history: grouped };
}

export default async function PricesPage() {
  const { latest, history } = await getPricesWithHistory();

  return <PricesDashboard latest={latest} history={history} />;
}
