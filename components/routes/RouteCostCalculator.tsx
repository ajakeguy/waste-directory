"use client";

/**
 * components/routes/RouteCostCalculator.tsx
 *
 * Live route cost estimator. Accepts total miles + stop count and renders
 * a two-column breakdown of time, fuel, and labour costs.
 *
 * In printMode the inputs are replaced with static text.
 * The onAssumptionsChange callback fires whenever the user edits a field
 * so parent components (e.g. CSV export) can capture current values.
 */

import { useState } from "react";

export type CostAssumptions = {
  serviceMinPerStop: number;
  mpg: number;
  fuelPricePerGallon: number;
  laborRatePerHour: number;
};

export const DEFAULTS: CostAssumptions = {
  serviceMinPerStop: 15,
  mpg: 8,
  fuelPricePerGallon: 4.5,
  laborRatePerHour: 35,
};

type Props = {
  totalMiles: number;
  stopCount: number;
  isEstimated?: boolean;
  printMode?: boolean;
  onAssumptionsChange?: (a: CostAssumptions) => void;
};

export function RouteCostCalculator({
  totalMiles,
  stopCount,
  isEstimated = false,
  printMode = false,
  onAssumptionsChange,
}: Props) {
  const [a, setA] = useState<CostAssumptions>(DEFAULTS);

  function update(field: keyof CostAssumptions, raw: string) {
    const val = parseFloat(raw);
    if (isNaN(val) || val < 0) return;
    const next = { ...a, [field]: val };
    setA(next);
    onAssumptionsChange?.(next);
  }

  function reset() {
    setA(DEFAULTS);
    onAssumptionsChange?.(DEFAULTS);
  }

  // ── Derived calculations ────────────────────────────────────────────────────
  const AVG_SPEED_MPH = 25;
  const driveMin     = (totalMiles / AVG_SPEED_MPH) * 60;
  const serviceMin   = stopCount * a.serviceMinPerStop;
  const totalMin     = driveMin + serviceMin;
  const totalHrs     = totalMin / 60;
  const gallons      = totalMiles / a.mpg;
  const fuelCost     = gallons * a.fuelPricePerGallon;
  const laborCost    = totalHrs * a.laborRatePerHour;
  const totalCost    = fuelCost + laborCost;
  const costPerStop  = stopCount > 0 ? totalCost / stopCount : 0;

  function fmt(n: number, decimals = 2) {
    return n.toFixed(decimals);
  }

  // ── Input / static value helper ─────────────────────────────────────────────
  function Field({
    label,
    field,
    prefix,
    suffix,
  }: {
    label: string;
    field: keyof CostAssumptions;
    prefix?: string;
    suffix?: string;
  }) {
    if (printMode) {
      return (
        <div>
          <p className="text-xs text-gray-500 mb-0.5">{label}</p>
          <p className="text-sm font-medium text-gray-700">
            {prefix}{a[field]}{suffix}
          </p>
        </div>
      );
    }
    return (
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label}</label>
        <div className="flex items-center gap-1">
          {prefix && <span className="text-xs text-gray-400">{prefix}</span>}
          <input
            type="number"
            min="0"
            step="0.01"
            value={a[field]}
            onChange={(e) => update(field, e.target.value)}
            className="w-full h-7 rounded border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#2D6A4F]/40"
          />
          {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
        </div>
      </div>
    );
  }

  // ── Stat cell ────────────────────────────────────────────────────────────────
  function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
      <div className="bg-white rounded-lg border border-gray-100 px-3 py-2.5">
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <p className="text-base font-bold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-[#2D6A4F] text-white px-5 py-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Route Cost Estimator</h3>
          {isEstimated && (
            <p className="text-xs text-white/60 mt-0.5">Based on estimated distance</p>
          )}
        </div>
        {!printMode && (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-white/70 hover:text-white transition-colors underline-offset-2 hover:underline"
          >
            Reset to defaults
          </button>
        )}
      </div>

      <div className="p-5 bg-gray-50">
        {/* Assumptions grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <Field label="Service time / stop" field="serviceMinPerStop" suffix=" min" />
          <Field label="Fuel efficiency"     field="mpg"               suffix=" mpg" />
          <Field label="Fuel price"          field="fuelPricePerGallon" prefix="$" suffix=" /gal" />
          <Field label="Labour rate"         field="laborRatePerHour"   prefix="$" suffix=" /hr" />
        </div>

        {/* Results grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          <Stat label="Drive time"   value={`${fmt(driveMin, 0)} min`}   sub={`${fmt(totalMiles, 1)} mi @ ${AVG_SPEED_MPH} mph`} />
          <Stat label="Service time" value={`${fmt(serviceMin, 0)} min`} sub={`${stopCount} stops × ${a.serviceMinPerStop} min`} />
          <Stat label="Total time"   value={`${fmt(totalHrs, 1)} hrs`}   sub={`${fmt(totalMin, 0)} min`} />
          <Stat label="Fuel cost"    value={`$${fmt(fuelCost)}`}         sub={`${fmt(gallons, 1)} gal`} />
          <Stat label="Labour cost"  value={`$${fmt(laborCost)}`}        sub={`${fmt(totalHrs, 1)} hrs × $${a.laborRatePerHour}`} />
          <Stat label="Cost / stop"  value={`$${fmt(costPerStop)}`}      sub={`${stopCount} stops`} />
        </div>

        {/* Total */}
        <div className="flex items-center justify-between rounded-lg bg-[#2D6A4F]/10 border border-[#2D6A4F]/20 px-4 py-3">
          <span className="text-sm font-semibold text-[#2D6A4F]">Estimated total cost</span>
          <span className="text-2xl font-bold text-[#2D6A4F]">${fmt(totalCost)}</span>
        </div>

        <p className="text-xs text-gray-400 mt-2">
          Estimates only. Actual costs depend on traffic, idle time, vehicle type, and local labour rates.
        </p>
      </div>
    </div>
  );
}
