/**
 * lib/diversion-calculations.ts
 *
 * Environmental benefit calculations for diversion reports.
 * Based on EPA WARM model equivalency factors.
 */

import type { MaterialStream } from "@/types";

// ── Normalise to tons ──────────────────────────────────────────────────────────

function toTons(stream: MaterialStream): number {
  return stream.unit === "lbs" ? stream.quantity / 2000 : stream.quantity;
}

// ── Core tonnage helpers ───────────────────────────────────────────────────────

/** Total weight of all streams combined, in tons. */
export function getTotalTons(streams: MaterialStream[]): number {
  return streams.reduce((sum, s) => sum + toTons(s), 0);
}

/** Total weight of diverted (non-landfill) streams, in tons. */
export function getDivertedTons(streams: MaterialStream[]): number {
  return streams
    .filter((s) => s.diverted)
    .reduce((sum, s) => sum + toTons(s), 0);
}

/** Total weight of landfill streams, in tons. */
export function getLandfillTons(streams: MaterialStream[]): number {
  return streams
    .filter((s) => !s.diverted)
    .reduce((sum, s) => sum + toTons(s), 0);
}

/**
 * Diversion rate as a percentage (0–100).
 * Returns 0 when total managed is 0.
 */
export function getDiversionRate(streams: MaterialStream[]): number {
  const total = getTotalTons(streams);
  if (total === 0) return 0;
  return (getDivertedTons(streams) / total) * 100;
}

// ── Environmental impact ───────────────────────────────────────────────────────

export type EnvironmentalImpact = {
  co2Avoided: number        // metric tons of CO₂ avoided
  treesEquivalent: number   // number of trees absorbing equivalent CO₂ for one year
  milesDriven: number       // car miles equivalent
  homesEquivalent: number   // US homes powered for one year
}

/**
 * Calculate environmental equivalencies for all *diverted* material streams.
 *
 * Factors (EPA WARM model):
 *   CO₂ avoided      = diverted_tons × 2.94  (metric tons CO₂ per short ton diverted)
 *   Trees equivalent = co2_lbs / 48          (one tree sequesters ~48 lbs CO₂/year)
 *   Miles not driven = co2_lbs / 0.89        (avg car emits 0.89 lbs CO₂/mile)
 *   Homes powered    = diverted_tons × 0.52 MWh/ton ÷ 10.715 MWh/home/year
 */
export function getEnvironmentalImpact(streams: MaterialStream[]): EnvironmentalImpact {
  const divertedTons = getDivertedTons(streams);

  const co2Avoided     = divertedTons * 2.94                       // metric tons
  const co2AvoidedLbs  = co2Avoided * 2204.62                      // convert to lbs
  const treesEquivalent = co2AvoidedLbs / 48
  const milesDriven    = co2AvoidedLbs / 0.89
  const homesEquivalent = (divertedTons * 0.52 * 1000) / 10715     // MWh → kWh ÷ kWh/home

  return {
    co2Avoided:      Math.round(co2Avoided * 100) / 100,
    treesEquivalent: Math.round(treesEquivalent),
    milesDriven:     Math.round(milesDriven),
    homesEquivalent: Math.round(homesEquivalent * 10) / 10,
  }
}

/** Format a number with commas for display. */
export function formatNumber(n: number, decimals = 1): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
