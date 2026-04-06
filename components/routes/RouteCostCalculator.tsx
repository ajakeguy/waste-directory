"use client";

/**
 * components/routes/RouteCostCalculator.tsx
 *
 * Live route cost estimator with transportation + disposal sections.
 * In printMode the inputs are replaced with static text.
 * The onAssumptionsChange callback fires on any input change so parents
 * (e.g. CSV export) can capture current assumption values.
 */

import { useState, useEffect } from "react";
import type { RouteStop } from "@/types";

// ── Module-level sub-components (NOT nested) ─────────────────────────────────
// Keeping these outside the parent prevents React from unmounting/remounting
// them on every state change, which would cause inputs to lose focus.

function NumInput({
  value, onChange, onBlurClean, onFocus, prefix, suffix,
}: {
  value: string; onChange: (s: string) => void; onBlurClean: () => void;
  onFocus?: () => void; prefix?: string; suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      {prefix && <span className="text-xs text-gray-400">{prefix}</span>}
      <input
        type="number" min="0" step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlurClean}
        onFocus={(e) => { e.target.select(); onFocus?.(); }}
        className="w-full h-7 rounded border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#2D6A4F]/40"
      />
      {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
    </div>
  );
}

function Field({
  label, strValue, numValue, setStr, onBlur, printMode, prefix, suffix,
}: {
  label: string; strValue: string; numValue: number;
  setStr: (s: string) => void; onBlur: () => void;
  printMode: boolean; prefix?: string; suffix?: string;
}) {
  if (printMode) {
    return (
      <div>
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <p className="text-sm font-medium text-gray-700">{prefix}{numValue}{suffix}</p>
      </div>
    );
  }
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <NumInput value={strValue} onChange={setStr} onBlurClean={onBlur} prefix={prefix} suffix={suffix} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 px-3 py-2.5">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-base font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export type CostAssumptions = {
  serviceMinPerStop: number;
  mpg: number;
  fuelPricePerGallon: number;
  laborRatePerHour: number;
  lbsPerYard: number;
  disposalCostPerTon: number;
};

export const DEFAULTS: CostAssumptions = {
  serviceMinPerStop: 15,
  mpg: 8,
  fuelPricePerGallon: 4.5,
  laborRatePerHour: 35,
  lbsPerYard: 300,
  disposalCostPerTon: 85,
};

type Props = {
  totalMiles: number;
  stopCount: number;
  stops?: RouteStop[];
  isEstimated?: boolean;
  printMode?: boolean;
  onAssumptionsChange?: (a: CostAssumptions) => void;
};

export function RouteCostCalculator({
  totalMiles,
  stopCount,
  stops = [],
  isEstimated = false,
  printMode = false,
  onAssumptionsChange,
}: Props) {
  // Transportation assumptions — string state so inputs edit cleanly
  const [serviceTimeStr, setServiceTimeStr] = useState(String(DEFAULTS.serviceMinPerStop));
  const [mpgStr,         setMpgStr]         = useState(String(DEFAULTS.mpg));
  const [fuelPriceStr,   setFuelPriceStr]   = useState(DEFAULTS.fuelPricePerGallon.toFixed(2));
  const [laborRateStr,   setLaborRateStr]   = useState(String(DEFAULTS.laborRatePerHour));
  // Disposal assumptions
  const [lbsPerYardStr,     setLbsPerYardStr]     = useState(String(DEFAULTS.lbsPerYard));
  const [disposalPerTonStr, setDisposalPerTonStr] = useState(String(DEFAULTS.disposalCostPerTon));
  const [savedPrefs,        setSavedPrefs]        = useState<CostAssumptions | null>(null);
  const [savingPrefs,       setSavingPrefs]       = useState(false);
  const [prefsSaved,        setPrefsSaved]        = useState(false);

  // Fetch user's saved preferences on mount
  useEffect(() => {
    if (printMode) return;
    fetch("/api/route-preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((prefs: CostAssumptions | null) => {
        if (!prefs) return;
        setSavedPrefs(prefs);
        setServiceTimeStr(String(prefs.serviceMinPerStop));
        setMpgStr(String(prefs.mpg));
        setFuelPriceStr(prefs.fuelPricePerGallon.toFixed(2));
        setLaborRateStr(String(prefs.laborRatePerHour));
        setLbsPerYardStr(String(prefs.lbsPerYard));
        setDisposalPerTonStr(String(prefs.disposalCostPerTon));
      })
      .catch(() => {/* not signed in — use defaults */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parsed values for calculations
  const serviceTime      = Math.max(0,   parseFloat(serviceTimeStr)    || 0);
  const mpg              = Math.max(0.1, parseFloat(mpgStr)            || 0.1);
  const fuelPrice        = Math.max(0,   parseFloat(fuelPriceStr)      || 0);
  const laborRate        = Math.max(0,   parseFloat(laborRateStr)      || 0);
  const lbsPerYard       = Math.max(0,   parseFloat(lbsPerYardStr)     || 0);
  const disposalPerTon   = Math.max(0,   parseFloat(disposalPerTonStr) || 0);

  function fireCallback() {
    onAssumptionsChange?.({
      serviceMinPerStop:   Math.max(0,   parseFloat(serviceTimeStr)    || 0),
      mpg:                 Math.max(0.1, parseFloat(mpgStr)            || 0.1),
      fuelPricePerGallon:  Math.max(0,   parseFloat(fuelPriceStr)      || 0),
      laborRatePerHour:    Math.max(0,   parseFloat(laborRateStr)      || 0),
      lbsPerYard:          Math.max(0,   parseFloat(lbsPerYardStr)     || 0),
      disposalCostPerTon:  Math.max(0,   parseFloat(disposalPerTonStr) || 0),
    });
  }

  function blurClean(val: string, setter: (s: string) => void, min = 0, fallback = "0") {
    const v = parseFloat(val);
    setter(!isNaN(v) && v >= min ? String(v) : fallback);
    fireCallback();
  }

  function reset() {
    const base = savedPrefs ?? DEFAULTS;
    setServiceTimeStr(String(base.serviceMinPerStop));
    setMpgStr(String(base.mpg));
    setFuelPriceStr(base.fuelPricePerGallon.toFixed(2));
    setLaborRateStr(String(base.laborRatePerHour));
    setLbsPerYardStr(String(base.lbsPerYard));
    setDisposalPerTonStr(String(base.disposalCostPerTon));
    onAssumptionsChange?.(base);
  }

  async function saveAsDefaults() {
    setSavingPrefs(true);
    try {
      const prefs: CostAssumptions = {
        serviceMinPerStop:  serviceTime,
        mpg,
        fuelPricePerGallon: fuelPrice,
        laborRatePerHour:   laborRate,
        lbsPerYard,
        disposalCostPerTon: disposalPerTon,
      };
      const res = await fetch("/api/route-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (res.ok) {
        setSavedPrefs(prefs);
        setPrefsSaved(true);
        setTimeout(() => setPrefsSaved(false), 2500);
      }
    } finally {
      setSavingPrefs(false);
    }
  }

  // ── Transportation calculations ─────────────────────────────────────────────
  const AVG_SPEED_MPH = 25;
  const driveMin    = (totalMiles / AVG_SPEED_MPH) * 60;
  const serviceMin  = stopCount * serviceTime;
  const totalMin    = driveMin + serviceMin;
  const totalHrs    = totalMin / 60;
  const gallons     = totalMiles / mpg;
  const fuelCost    = gallons * fuelPrice;
  const laborCost   = totalHrs * laborRate;
  const transportCost = fuelCost + laborCost;
  const costPerStop = stopCount > 0 ? transportCost / stopCount : 0;

  // ── Disposal calculations ───────────────────────────────────────────────────
  const totalYards    = stops.reduce((sum, s) => sum + (s.yards ?? 0), 0);
  const stopsWithYards = stops.filter((s) => s.yards !== undefined && s.yards > 0).length;
  const hasYards      = stopsWithYards > 0;
  const totalTons     = (totalYards * lbsPerYard) / 2000;
  const disposalCost  = totalTons * disposalPerTon;
  const grandTotal    = transportCost + (hasYards ? disposalCost : 0);

  function fmt(n: number, decimals = 2) { return n.toFixed(decimals); }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-[#2D6A4F] text-white px-5 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Route Cost Estimator</h3>
        {!printMode && (
          <div className="flex items-center gap-3">
            {prefsSaved && (
              <span className="text-xs text-green-300">Saved!</span>
            )}
            <button
              type="button" onClick={saveAsDefaults} disabled={savingPrefs}
              className="text-xs text-white/70 hover:text-white transition-colors underline-offset-2 hover:underline disabled:opacity-50"
            >
              {savingPrefs ? "Saving…" : "Save as my defaults"}
            </button>
            <button
              type="button" onClick={reset}
              className="text-xs text-white/70 hover:text-white transition-colors underline-offset-2 hover:underline"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      <div className="p-5 bg-gray-50 space-y-5">
        {/* Straight-line estimate warning */}
        {isEstimated && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 flex items-start gap-1.5">
            <span className="shrink-0">⚠</span>
            <span>
              Distance is a straight-line estimate — road distance unavailable.
              Cost estimates may be lower than actual.
            </span>
          </div>
        )}

        {/* ── Transportation ───────────────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Transportation</p>

          {/* Assumptions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Field label="Service time / stop" strValue={serviceTimeStr} numValue={serviceTime}
              setStr={setServiceTimeStr} onBlur={() => blurClean(serviceTimeStr, setServiceTimeStr, 0, "0")} printMode={printMode} suffix=" min" />
            <Field label="Fuel efficiency" strValue={mpgStr} numValue={mpg}
              setStr={setMpgStr} onBlur={() => blurClean(mpgStr, setMpgStr, 0.1, "0.1")} printMode={printMode} suffix=" mpg" />
            <Field label="Fuel price" strValue={fuelPriceStr} numValue={fuelPrice}
              setStr={setFuelPriceStr} onBlur={() => blurClean(fuelPriceStr, setFuelPriceStr, 0, "0")} printMode={printMode} prefix="$" suffix=" /gal" />
            <Field label="Labour rate" strValue={laborRateStr} numValue={laborRate}
              setStr={setLaborRateStr} onBlur={() => blurClean(laborRateStr, setLaborRateStr, 0, "0")} printMode={printMode} prefix="$" suffix=" /hr" />
          </div>

          {/* Results */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Drive time"   value={`${fmt(driveMin, 0)} min`}   sub={`${fmt(totalMiles, 1)} mi @ ${AVG_SPEED_MPH} mph`} />
            <Stat label="Service time" value={`${fmt(serviceMin, 0)} min`} sub={`${stopCount} stops × ${serviceTime} min`} />
            <Stat label="Total time"   value={`${fmt(totalHrs, 1)} hrs`}   sub={`${fmt(totalMin, 0)} min`} />
            <Stat label="Fuel cost"    value={`$${fmt(fuelCost)}`}         sub={`${fmt(gallons, 1)} gal`} />
            <Stat label="Labour cost"  value={`$${fmt(laborCost)}`}        sub={`${fmt(totalHrs, 1)} hrs × $${laborRate}`} />
            <Stat label="Cost / stop"  value={`$${fmt(costPerStop)}`}      sub={`${stopCount} stops`} />
          </div>
        </div>

        {/* ── Disposal ─────────────────────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Disposal</p>

          {hasYards ? (
            <>
              {/* Total yards summary */}
              <div className="bg-white rounded-lg border border-gray-100 px-3 py-2.5 mb-4">
                <p className="text-xs text-gray-500 mb-0.5">Total cubic yards collected</p>
                <p className="text-base font-bold text-gray-900">{fmt(totalYards, 1)} yd³</p>
                <p className="text-xs text-gray-400">{stopsWithYards} of {stopCount} stops have yards entered</p>
              </div>

              {/* Disposal assumptions */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Field label="Est. density" strValue={lbsPerYardStr} numValue={lbsPerYard}
                  setStr={setLbsPerYardStr} onBlur={() => blurClean(lbsPerYardStr, setLbsPerYardStr, 0, "0")} printMode={printMode} suffix=" lbs/yd³" />
                <Field label="Disposal cost" strValue={disposalPerTonStr} numValue={disposalPerTon}
                  setStr={setDisposalPerTonStr} onBlur={() => blurClean(disposalPerTonStr, setDisposalPerTonStr, 0, "0")} printMode={printMode} prefix="$" suffix=" /ton" />
              </div>

              {/* Disposal results */}
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Total weight" value={`${fmt(totalTons, 1)} tons`}
                  sub={`${fmt(totalYards, 1)} yd³ × ${lbsPerYard} lbs ÷ 2000`} />
                <Stat label="Disposal cost" value={`$${fmt(disposalCost)}`}
                  sub={`${fmt(totalTons, 1)} tons × $${disposalPerTon}/ton`} />
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 italic">
              Add cubic yards to stops to estimate disposal costs.
            </p>
          )}
        </div>

        {/* ── Grand Total ──────────────────────────────────────────────────── */}
        <div className="rounded-lg bg-[#2D6A4F]/10 border border-[#2D6A4F]/20 px-4 py-3 space-y-1.5">
          {hasYards && (
            <>
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>Transportation cost</span>
                <span className="font-medium">${fmt(transportCost)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>Disposal cost</span>
                <span className="font-medium">${fmt(disposalCost)}</span>
              </div>
              <div className="border-t border-[#2D6A4F]/20 pt-1.5" />
            </>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[#2D6A4F]">
              {hasYards ? "Total route cost" : "Estimated total cost"}
            </span>
            <span className="text-2xl font-bold text-[#2D6A4F]">${fmt(grandTotal)}</span>
          </div>
        </div>

        <p className="text-xs text-gray-400">
          Estimates only. Does not include insurance, maintenance, or permit costs.
          Actual costs vary based on traffic, idle time, vehicle type, and local rates.
        </p>
      </div>
    </div>
  );
}
