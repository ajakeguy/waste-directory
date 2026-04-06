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
  // String state for inputs — prevents clearing/retyping issues
  const [serviceTimeStr, setServiceTimeStr] = useState("15");
  const [mpgStr,         setMpgStr]         = useState("8");
  const [fuelPriceStr,   setFuelPriceStr]   = useState("4.50");
  const [laborRateStr,   setLaborRateStr]   = useState("35");

  // Parse for calculations — guard against empty/invalid
  const serviceTime = Math.max(0,   parseFloat(serviceTimeStr) || 0);
  const mpg         = Math.max(0.1, parseFloat(mpgStr)         || 0.1);
  const fuelPrice   = Math.max(0,   parseFloat(fuelPriceStr)   || 0);
  const laborRate   = Math.max(0,   parseFloat(laborRateStr)   || 0);

  function fireCallback() {
    onAssumptionsChange?.({
      serviceMinPerStop:   Math.max(0,   parseFloat(serviceTimeStr) || 0),
      mpg:                 Math.max(0.1, parseFloat(mpgStr)         || 0.1),
      fuelPricePerGallon:  Math.max(0,   parseFloat(fuelPriceStr)   || 0),
      laborRatePerHour:    Math.max(0,   parseFloat(laborRateStr)   || 0),
    });
  }

  function blurClean(
    val: string,
    setter: (s: string) => void,
    min = 0,
    fallback = "0"
  ) {
    const v = parseFloat(val);
    if (!isNaN(v) && v >= min) {
      setter(String(v));
    } else {
      setter(fallback);
    }
    fireCallback();
  }

  function reset() {
    setServiceTimeStr("15");
    setMpgStr("8");
    setFuelPriceStr("4.50");
    setLaborRateStr("35");
    onAssumptionsChange?.(DEFAULTS);
  }

  // ── Derived calculations ────────────────────────────────────────────────────
  const AVG_SPEED_MPH = 25;
  const driveMin    = (totalMiles / AVG_SPEED_MPH) * 60;
  const serviceMin  = stopCount * serviceTime;
  const totalMin    = driveMin + serviceMin;
  const totalHrs    = totalMin / 60;
  const gallons     = totalMiles / mpg;
  const fuelCost    = gallons * fuelPrice;
  const laborCost   = totalHrs * laborRate;
  const totalCost   = fuelCost + laborCost;
  const costPerStop = stopCount > 0 ? totalCost / stopCount : 0;

  function fmt(n: number, decimals = 2) {
    return n.toFixed(decimals);
  }

  // ── Number input ─────────────────────────────────────────────────────────────
  function NumInput({
    value,
    onChange,
    onBlurClean,
    prefix,
    suffix,
  }: {
    value: string;
    onChange: (s: string) => void;
    onBlurClean: () => void;
    prefix?: string;
    suffix?: string;
  }) {
    return (
      <div className="flex items-center gap-1">
        {prefix && <span className="text-xs text-gray-400">{prefix}</span>}
        <input
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlurClean}
          className="w-full h-7 rounded border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#2D6A4F]/40"
        />
        {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
      </div>
    );
  }

  // ── Assumption field (input or static) ────────────────────────────────────────
  function Field({
    label,
    strValue,
    numValue,
    setStr,
    onBlur,
    prefix,
    suffix,
  }: {
    label: string;
    strValue: string;
    numValue: number;
    setStr: (s: string) => void;
    onBlur: () => void;
    prefix?: string;
    suffix?: string;
  }) {
    if (printMode) {
      return (
        <div>
          <p className="text-xs text-gray-500 mb-0.5">{label}</p>
          <p className="text-sm font-medium text-gray-700">
            {prefix}{numValue}{suffix}
          </p>
        </div>
      );
    }
    return (
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label}</label>
        <NumInput
          value={strValue}
          onChange={setStr}
          onBlurClean={onBlur}
          prefix={prefix}
          suffix={suffix}
        />
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
        {/* Straight-line estimate warning */}
        {isEstimated && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 mb-4 flex items-start gap-1.5">
            <span className="shrink-0">⚠</span>
            <span>
              Distance is a straight-line estimate — road distance unavailable.
              Cost estimates may be lower than actual.
            </span>
          </div>
        )}

        {/* Assumptions grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <Field
            label="Service time / stop"
            strValue={serviceTimeStr}
            numValue={serviceTime}
            setStr={setServiceTimeStr}
            onBlur={() => blurClean(serviceTimeStr, setServiceTimeStr, 0, "0")}
            suffix=" min"
          />
          <Field
            label="Fuel efficiency"
            strValue={mpgStr}
            numValue={mpg}
            setStr={setMpgStr}
            onBlur={() => blurClean(mpgStr, setMpgStr, 0.1, "0.1")}
            suffix=" mpg"
          />
          <Field
            label="Fuel price"
            strValue={fuelPriceStr}
            numValue={fuelPrice}
            setStr={setFuelPriceStr}
            onBlur={() => blurClean(fuelPriceStr, setFuelPriceStr, 0, "0")}
            prefix="$"
            suffix=" /gal"
          />
          <Field
            label="Labour rate"
            strValue={laborRateStr}
            numValue={laborRate}
            setStr={setLaborRateStr}
            onBlur={() => blurClean(laborRateStr, setLaborRateStr, 0, "0")}
            prefix="$"
            suffix=" /hr"
          />
        </div>

        {/* Results grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          <Stat label="Drive time"   value={`${fmt(driveMin, 0)} min`}   sub={`${fmt(totalMiles, 1)} mi @ ${AVG_SPEED_MPH} mph`} />
          <Stat label="Service time" value={`${fmt(serviceMin, 0)} min`} sub={`${stopCount} stops × ${serviceTime} min`} />
          <Stat label="Total time"   value={`${fmt(totalHrs, 1)} hrs`}   sub={`${fmt(totalMin, 0)} min`} />
          <Stat label="Fuel cost"    value={`$${fmt(fuelCost)}`}         sub={`${fmt(gallons, 1)} gal`} />
          <Stat label="Labour cost"  value={`$${fmt(laborCost)}`}        sub={`${fmt(totalHrs, 1)} hrs × $${laborRate}`} />
          <Stat label="Cost / stop"  value={`$${fmt(costPerStop)}`}      sub={`${stopCount} stops`} />
        </div>

        {/* Total */}
        <div className="flex items-center justify-between rounded-lg bg-[#2D6A4F]/10 border border-[#2D6A4F]/20 px-4 py-3">
          <span className="text-sm font-semibold text-[#2D6A4F]">Estimated total cost</span>
          <span className="text-2xl font-bold text-[#2D6A4F]">${fmt(totalCost)}</span>
        </div>

        <p className="text-xs text-gray-400 mt-2">
          Estimates only. Does not include insurance, maintenance, or permit costs.
          Actual costs vary based on traffic, idle time, vehicle type, and local rates.
        </p>
      </div>
    </div>
  );
}
