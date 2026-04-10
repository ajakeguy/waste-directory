"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Truck,
  Droplets,
  Flame,
  Zap,
  Wrench,
  Package,
  Newspaper,
  Recycle,
  Container,
  Leaf,
  Wind,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  CheckCircle,
} from "lucide-react";
import type { CommodityPrice } from "@/app/prices/page";

// ---------------------------------------------------------------------------
// Commodity config
// ---------------------------------------------------------------------------

type CommodityConfig = {
  key: string;
  label: string;
  icon: React.ElementType;
  whyItMatters: string;
  source: string;
  isManual: boolean;
};

const INPUT_COSTS: CommodityConfig[] = [
  {
    key: "ulsd_diesel",
    label: "ULSD Diesel",
    icon: Truck,
    whyItMatters:
      "Fuel is typically 25-35% of a collection company's operating costs. ULSD prices directly affect route profitability and contract pricing.",
    source: "EIA — Updated Weekly",
    isManual: false,
  },
  {
    key: "wti_crude",
    label: "WTI Crude Oil",
    icon: Droplets,
    whyItMatters:
      "Crude oil is the upstream driver of diesel prices. Rising crude signals fuel cost increases 2-4 weeks ahead, giving operators time to adjust.",
    source: "EIA — Updated Daily",
    isManual: false,
  },
  {
    key: "henry_hub_gas",
    label: "Henry Hub Natural Gas",
    icon: Flame,
    whyItMatters:
      "Natural gas powers transfer station equipment, processing facilities, and WTE plants. Also the price benchmark for RNG offtake contracts.",
    source: "EIA — Updated Daily",
    isManual: false,
  },
  {
    key: "electricity_commercial",
    label: "Electricity (Commercial)",
    icon: Zap,
    whyItMatters:
      "MRFs, transfer stations, and composting facilities are significant electricity consumers. Rising rates compress facility operating margins.",
    source: "EIA — Updated Monthly",
    isManual: false,
  },
  {
    key: "steel_scrap_hms1",
    label: "Steel Scrap (HMS #1)",
    icon: Wrench,
    whyItMatters:
      "Steel scrap prices affect equipment repair and replacement costs. Also a leading indicator of ferrous recycling revenues.",
    source: "FRED — Updated Monthly",
    isManual: false,
  },
];

const OUTPUT_REVENUES: CommodityConfig[] = [
  {
    key: "occ_cardboard",
    label: "OCC / Cardboard",
    icon: Package,
    whyItMatters:
      "Old Corrugated Cardboard is the highest-volume recyclable at most MRFs. OCC prices often determine whether a recycling program is profitable or requires subsidy.",
    source: "RecyclingMarkets.net (SMP) — Updated Monthly",
    isManual: true,
  },
  {
    key: "mixed_paper",
    label: "Mixed Paper",
    icon: Newspaper,
    whyItMatters:
      "Mixed paper is the second largest fiber stream. Market collapses (like China's 2018 National Sword) can turn this from revenue to a disposal cost overnight.",
    source: "RecyclingMarkets.net (SMP) — Updated Monthly",
    isManual: true,
  },
  {
    key: "pet_plastic",
    label: "PET Plastic (#1)",
    icon: Recycle,
    whyItMatters:
      "PET (soda/water bottles) is the highest-value plastic stream. Prices track virgin resin costs and are highly sensitive to oil prices.",
    source: "RecyclingMarkets.net (SMP) — Updated Monthly",
    isManual: true,
  },
  {
    key: "hdpe_plastic",
    label: "HDPE Plastic (#2)",
    icon: Container,
    whyItMatters:
      "HDPE (milk jugs, detergent bottles) is the most stable plastic grade. Natural HDPE commands a premium over color HDPE.",
    source: "RecyclingMarkets.net (SMP) — Updated Monthly",
    isManual: true,
  },
  {
    key: "aluminum_cans",
    label: "Aluminum Cans (baled)",
    icon: Container,
    whyItMatters:
      "Aluminum is the most valuable MRF commodity by weight. Aluminum prices are set by the LME and directly tied to global industrial demand.",
    source: "RecyclingMarkets.net (SMP) — Updated Monthly",
    isManual: true,
  },
  {
    key: "glass_cullet",
    label: "Glass Cullet",
    icon: Droplets,
    whyItMatters:
      "Glass is heavy, low-value, and often a net cost. Markets vary dramatically by region — some areas pay for quality cullet, others charge a processing fee.",
    source: "NERC Survey — Updated Quarterly",
    isManual: true,
  },
  {
    key: "compost",
    label: "Compost / Soil Amendment",
    icon: Leaf,
    whyItMatters:
      "Finished compost and soil amendment prices depend heavily on local market depth. Tipping fees at organics facilities can offset processing costs.",
    source: "Regional — Updated Manually",
    isManual: true,
  },
  {
    key: "rng",
    label: "RNG (Renewable Natural Gas)",
    icon: Wind,
    whyItMatters:
      "Landfill gas-to-RNG projects generate revenue from gas sales plus federal RIN credits ($1-3/MMBtu equivalent). RNG pricing typically tracks Henry Hub + a premium.",
    source: "OTC / Contract — Reference Only",
    isManual: true,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(price: number, unit: string): string {
  if (price === 0) return "—";
  if (unit === "cents/kWh" || unit === "¢/kWh") {
    return price.toFixed(2);
  }
  if (unit === "$/gallon") return price.toFixed(3);
  if (unit === "$/barrel" || unit === "$/MMBtu") return price.toFixed(2);
  if (unit === "$/lb" || unit === "cents/lb" || unit === "¢/lb") return price.toFixed(3);
  if (price > 100) return price.toFixed(0);
  return price.toFixed(2);
}

function formatUnit(unit: string): string {
  return unit.replace("cents/", "¢/");
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso + "T12:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Price contribution modal
// ---------------------------------------------------------------------------

const REGIONS = ["Northeast", "Mid-Atlantic", "Southeast", "Midwest", "National"];

const COMMODITY_UNITS: Record<string, string> = {
  occ_cardboard: "$/ton",
  mixed_paper:   "$/ton",
  pet_plastic:   "$/lb",
  hdpe_plastic:  "$/lb",
  aluminum_cans: "cents/lb",
  glass_cullet:  "$/ton",
  compost:       "$/ton",
  rng:           "$/MMBtu",
};

function ContributeModal({
  commodityKey,
  commodityLabel,
  onClose,
}: {
  commodityKey: string;
  commodityLabel: string;
  onClose: () => void;
}) {
  const unit = COMMODITY_UNITS[commodityKey] ?? "$/ton";
  const [price,  setPrice]  = useState("");
  const [region, setRegion] = useState("Northeast");
  const [source, setSource] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setError("Please enter a valid price greater than 0.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/prices/contribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commodity_key:      commodityKey,
          price:              priceNum,
          unit,
          region,
          source_description: source || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? "Something went wrong.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 z-10">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X className="size-5" />
        </button>

        <h2 className="text-base font-semibold text-gray-900 mb-0.5">Submit a Price</h2>
        <p className="text-sm text-gray-500 mb-4">
          {commodityLabel} — {unit}
        </p>

        {submitted ? (
          <div className="text-center py-4">
            <CheckCircle className="size-10 text-[#2D6A4F] mx-auto mb-3" />
            <p className="font-medium text-gray-900 mb-1">Thank you!</p>
            <p className="text-sm text-gray-500 mb-4">
              Your price submission has been recorded. We&apos;ll use community data to update this card.
            </p>
            <button onClick={onClose} className="text-sm text-[#2D6A4F] hover:underline">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Current Price ({unit}) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
                placeholder="e.g. 85.00"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Region</label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F] bg-white"
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Source <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. Broker quote, SMP report..."
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="h-9 px-5 text-sm bg-[#2D6A4F] text-white rounded-lg hover:bg-[#245a42] transition-colors disabled:opacity-60 flex items-center gap-1.5"
              >
                {submitting ? (
                  <><Loader2 className="size-3.5 animate-spin" />Submitting…</>
                ) : (
                  "Submit"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Price card
// ---------------------------------------------------------------------------

function PriceCard({
  config,
  current,
  previous,
  tint,
}: {
  config: CommodityConfig;
  current?: CommodityPrice;
  previous?: CommodityPrice;
  tint: "red" | "green";
}) {
  const [expanded, setExpanded] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);

  const Icon = config.icon;
  const hasPrice = current && current.price > 0;

  // Change calculation
  let change: number | null = null;
  let changePct: number | null = null;
  if (hasPrice && previous && previous.price > 0) {
    change = current!.price - previous.price;
    changePct = (change / previous.price) * 100;
  }

  const bgTint   = tint === "red"   ? "bg-red-50/40"   : "bg-green-50/40";
  const borderTint = tint === "red" ? "border-red-100"  : "border-green-100";
  const iconBg   = tint === "red"   ? "bg-red-100 text-red-500" : "bg-green-100 text-green-600";

  return (
    <>
      {contributeOpen && (
        <ContributeModal
          commodityKey={config.key}
          commodityLabel={config.label}
          onClose={() => setContributeOpen(false)}
        />
      )}

      <div className={`rounded-xl border ${borderTint} ${bgTint} p-5 flex flex-col`}>
        {/* Top row: icon + label */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
              <Icon className="size-4" />
            </div>
            <p className="text-sm font-semibold text-gray-900 leading-snug">
              {config.label}
            </p>
          </div>
        </div>

        {/* Price */}
        <div className="mb-2">
          {hasPrice ? (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-2xl font-bold text-gray-900">
                {formatPrice(current!.price, current!.unit)}
              </span>
              <span className="text-sm text-gray-500">
                {formatUnit(current!.unit)}
              </span>
              {change !== null && changePct !== null && (
                <span
                  className={`text-xs font-medium flex items-center gap-0.5 ${
                    change > 0
                      ? "text-red-500"
                      : change < 0
                      ? "text-green-600"
                      : "text-gray-400"
                  }`}
                >
                  {change > 0 ? (
                    <TrendingUp className="size-3" />
                  ) : change < 0 ? (
                    <TrendingDown className="size-3" />
                  ) : (
                    <Minus className="size-3" />
                  )}
                  {change > 0 ? "+" : ""}
                  {formatPrice(Math.abs(change), current!.unit)} (
                  {changePct > 0 ? "+" : ""}
                  {changePct.toFixed(1)}%)
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-gray-300">—</span>
              {config.isManual && (
                <button
                  onClick={() => setContributeOpen(true)}
                  className="text-xs text-[#2D6A4F] font-medium hover:underline inline-flex items-center gap-0.5"
                >
                  Submit a price →
                </button>
              )}
            </div>
          )}
        </div>

        {/* "Why it matters" expandable */}
        <div className="flex-1 mb-3">
          <button
            onClick={() => setExpanded((o) => !o)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Why it matters
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
          {expanded && (
            <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
              {config.whyItMatters}
            </p>
          )}
        </div>

        {/* Footer: source + date */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-black/5">
          <p className="text-[11px] text-gray-400 leading-snug">
            {config.source}
          </p>
          {current && current.price > 0 && (
            <p className="text-[11px] text-gray-400 shrink-0">
              {formatDate(current.period_date)}
            </p>
          )}
          {config.isManual && hasPrice && (
            <button
              onClick={() => setContributeOpen(true)}
              className="text-[11px] text-[#2D6A4F] hover:underline shrink-0"
            >
              Update
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

type Props = {
  latest:   CommodityPrice[];
  previous: CommodityPrice[];
};

export function PricesDashboard({ latest, previous }: Props) {
  const byKey = Object.fromEntries(latest.map((p) => [p.commodity_key, p]));
  const prevByKey = Object.fromEntries(previous.map((p) => [p.commodity_key, p]));

  // Most recent update across all live commodities
  const lastUpdated = latest
    .filter((p) => p.source !== "Manual" && p.price > 0)
    .sort((a, b) => b.period_date.localeCompare(a.period_date))[0]?.period_date;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
          Waste Industry Market Prices
        </h1>
        <p className="text-gray-500 text-sm leading-relaxed max-w-2xl">
          Key input costs and output revenues for waste operators — updated daily, weekly, and monthly
          from public data sources.
        </p>
        {lastUpdated && (
          <p className="text-xs text-gray-400 mt-2">
            Last updated: {formatDate(lastUpdated)}
          </p>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* INPUT COSTS */}
        <section>
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="size-2 rounded-full bg-red-400 shrink-0" />
              <h2 className="text-base font-semibold text-gray-900">Input Costs</h2>
            </div>
            <p className="text-sm text-gray-500 ml-4">What you pay to operate</p>
          </div>
          <div className="space-y-3">
            {INPUT_COSTS.map((cfg) => (
              <PriceCard
                key={cfg.key}
                config={cfg}
                current={byKey[cfg.key]}
                previous={prevByKey[cfg.key]}
                tint="red"
              />
            ))}
          </div>
        </section>

        {/* OUTPUT REVENUES */}
        <section>
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="size-2 rounded-full bg-green-500 shrink-0" />
              <h2 className="text-base font-semibold text-gray-900">Output Revenues</h2>
            </div>
            <p className="text-sm text-gray-500 ml-4">What you earn from materials</p>
          </div>
          <div className="space-y-3">
            {OUTPUT_REVENUES.map((cfg) => (
              <PriceCard
                key={cfg.key}
                config={cfg}
                current={byKey[cfg.key]}
                previous={prevByKey[cfg.key]}
                tint="green"
              />
            ))}
          </div>
        </section>
      </div>

      {/* Methodology footer */}
      <div className="mt-10 rounded-xl border border-dashed border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">About this data</h3>
        <div className="text-xs text-gray-500 space-y-1.5 leading-relaxed">
          <p>
            <strong>EIA prices</strong> (diesel, crude, natural gas, electricity) are fetched automatically
            from the{" "}
            <a
              href="https://www.eia.gov/opendata/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2D6A4F] hover:underline inline-flex items-center gap-0.5"
            >
              EIA Open Data API <ExternalLink className="size-2.5" />
            </a>
            {" "}and updated on weekdays.
          </p>
          <p>
            <strong>FRED prices</strong> (steel scrap, aluminum) are fetched from the{" "}
            <a
              href="https://fred.stlouisfed.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2D6A4F] hover:underline inline-flex items-center gap-0.5"
            >
              St. Louis Fed FRED database <ExternalLink className="size-2.5" />
            </a>
            {" "}and updated monthly.
          </p>
          <p>
            <strong>Recyclable commodity prices</strong> (OCC, paper, plastics, aluminum cans, glass,
            compost, RNG) are sourced from{" "}
            <a
              href="https://www.recyclingmarkets.net/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2D6A4F] hover:underline inline-flex items-center gap-0.5"
            >
              RecyclingMarkets.net <ExternalLink className="size-2.5" />
            </a>
            {" "}and NERC surveys. These require manual entry or community submission.{" "}
            <button className="text-[#2D6A4F] hover:underline">
              Submit a price update
            </button>
            {" "}to contribute data.
          </p>
        </div>
      </div>
    </div>
  );
}
