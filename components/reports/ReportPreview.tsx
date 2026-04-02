/**
 * components/reports/ReportPreview.tsx
 *
 * Pure rendering component — displays the diversion report in a format
 * suitable both for on-screen preview and print/PDF export.
 * No client-side interactivity; safe to use in RSC or client contexts.
 */

import type { DiversionReport } from "@/types";
import {
  getTotalTons,
  getDivertedTons,
  getLandfillTons,
  getDiversionRate,
  getEnvironmentalImpact,
  formatNumber,
} from "@/lib/diversion-calculations";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function categoryColor(category: string, diverted: boolean): string {
  if (!diverted) return "#9CA3AF"; // gray-400 — landfill
  switch (category) {
    case "recycling": return "#2D6A4F"; // brand green
    case "organics":  return "#65A30D"; // lime-600
    case "other":     return "#6366F1"; // indigo-500
    default:          return "#2D6A4F";
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReportPreview({ report }: { report: DiversionReport }) {
  const streams      = report.material_streams ?? [];
  const totalTons    = getTotalTons(streams);
  const divertedTons = getDivertedTons(streams);
  const landfillTons = getLandfillTons(streams);
  const divRate      = getDiversionRate(streams);
  const impact       = getEnvironmentalImpact(streams);
  const today        = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  // For the bar chart — find the max value to normalise bar widths
  const maxStreamTons = streams.reduce((max, s) => {
    const t = s.unit === "lbs" ? s.quantity / 2000 : s.quantity;
    return Math.max(max, t);
  }, 0);

  const serviceLocation = [report.service_city, report.service_state, report.service_zip]
    .filter(Boolean)
    .join(", ");

  return (
    <div id="report-preview" className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-0 print:rounded-none">

      {/* ── 1. HEADER ─────────────────────────────────────────────────────────── */}
      <div className="bg-[#2D6A4F] text-white p-6 print:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-white/60 mb-1">
              Diversion Report
            </p>
            <h1 className="text-2xl font-bold mb-3">{report.report_name}</h1>
            <div className="text-sm text-white/80 space-y-0.5">
              <p className="font-semibold text-white">{report.customer_name}</p>
              <p>{report.service_address}</p>
              {serviceLocation && <p>{serviceLocation}</p>}
              <p className="mt-2 text-white/70">
                Reporting period: {fmtDate(report.period_start)} – {fmtDate(report.period_end)}
              </p>
            </div>
          </div>
          {/* Hauler info */}
          <div className="text-right shrink-0">
            {report.hauler_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={report.hauler_logo_url}
                alt={report.hauler_name}
                className="h-12 w-auto object-contain mb-2 ml-auto bg-white rounded p-1"
              />
            ) : null}
            <p className="text-sm font-semibold text-white">{report.hauler_name}</p>
          </div>
        </div>
      </div>

      <div className="p-6 print:p-8 space-y-8">

        {/* ── 2. SUMMARY STATS ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Managed", value: `${formatNumber(totalTons)} tons`,     accent: false },
            { label: "Total Diverted", value: `${formatNumber(divertedTons)} tons`, accent: true  },
            { label: "Landfill",       value: `${formatNumber(landfillTons)} tons`, accent: false },
            { label: "Diversion Rate", value: `${formatNumber(divRate, 0)}%`,       accent: true  },
          ].map(({ label, value, accent }) => (
            <div
              key={label}
              className={`rounded-lg p-4 text-center border ${
                accent
                  ? "border-[#2D6A4F]/20 bg-[#2D6A4F]/5"
                  : "border-gray-200 bg-gray-50"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
              <p className={`text-xl font-bold ${accent ? "text-[#2D6A4F]" : "text-gray-900"}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* ── 3. MATERIALS BREAKDOWN ────────────────────────────────────────────── */}
        {streams.length > 0 && (
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
              Materials Breakdown
            </h2>
            <div className="space-y-2.5">
              {streams.map((stream, i) => {
                const tons      = stream.unit === "lbs" ? stream.quantity / 2000 : stream.quantity;
                const pct       = maxStreamTons > 0 ? (tons / maxStreamTons) * 100 : 0;
                const color     = categoryColor(stream.category, stream.diverted);
                const qtyLabel  = stream.unit === "lbs"
                  ? `${stream.quantity.toLocaleString()} lbs`
                  : `${formatNumber(tons)} tons`;
                return (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className="w-36 shrink-0 truncate text-gray-700 font-medium">
                      {stream.material}
                    </div>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
                      />
                    </div>
                    <div className="w-20 text-right text-gray-600 shrink-0">{qtyLabel}</div>
                    <div className="w-16 shrink-0">
                      {stream.diverted ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#2D6A4F]/10 text-[#2D6A4F]">
                          Diverted
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                          Landfill
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 4. ENVIRONMENTAL IMPACT ───────────────────────────────────────────── */}
        {divRate > 0 && (
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
              Environmental Impact
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  icon: "🌳",
                  label: "Trees Equivalent",
                  value: formatNumber(impact.treesEquivalent, 0),
                  unit: "trees/year",
                },
                {
                  icon: "🚗",
                  label: "Miles Not Driven",
                  value: formatNumber(impact.milesDriven, 0),
                  unit: "miles",
                },
                {
                  icon: "💨",
                  label: "CO₂ Avoided",
                  value: formatNumber(impact.co2Avoided),
                  unit: "metric tons",
                },
                {
                  icon: "🏠",
                  label: "Homes Powered",
                  value: formatNumber(impact.homesEquivalent),
                  unit: "homes/year",
                },
              ].map(({ icon, label, value, unit }) => (
                <div
                  key={label}
                  className="rounded-lg border border-gray-200 bg-white p-4 text-center"
                >
                  <div className="text-2xl mb-1">{icon}</div>
                  <p className="text-xl font-bold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{unit}</p>
                  <p className="text-xs font-medium text-gray-700 mt-1">{label}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              * Equivalencies based on EPA WARM model factors.
            </p>
          </div>
        )}

        {/* ── 5. NOTES ──────────────────────────────────────────────────────────── */}
        {report.notes && (
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">Notes</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg p-4 border border-gray-200">
              {report.notes}
            </p>
          </div>
        )}

        {/* ── 6. FOOTER ─────────────────────────────────────────────────────────── */}
        <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
          <span>Report generated by WasteDirectory.com</span>
          <span>{today}</span>
        </div>

      </div>
    </div>
  );
}
