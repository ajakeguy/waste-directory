"use client";

/**
 * components/routes/RouteViewClient.tsx
 *
 * Client component for the route view page.
 * Two-column layout: sticky left sidebar (header, actions, map, cost estimator)
 * and scrollable right column (stop list).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Copy, Check, Download, Printer, Pencil, Trash2, MapPin, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
const RouteMap = dynamic(() => import("@/components/routes/RouteMap"), {
  ssr: false,
  loading: () => (
    <div style={{ height: "400px" }} className="bg-gray-100 animate-pulse flex items-center justify-center">
      <p className="text-gray-400 text-sm">Loading map…</p>
    </div>
  ),
});
import { haversineDistance, kmToMiles } from "@/lib/route-optimizer";
import { fetchRoadDistanceMatrix } from "@/lib/road-routing";
import { RouteCostCalculator, DEFAULTS, type CostAssumptions } from "@/components/routes/RouteCostCalculator";
import type { SavedRoute, RouteStop } from "@/types";

type LatLng = { lat: number; lng: number };

function parseStartEnd(route: SavedRoute): { startCoords: LatLng | null; endCoords: LatLng | null } {
  const geocoded = route.stops.filter((s) => s.geocoded && s.lat && s.lng);
  if (geocoded.length === 0) return { startCoords: null, endCoords: null };
  return {
    startCoords: { lat: geocoded[0].lat!, lng: geocoded[0].lng! },
    endCoords:   { lat: geocoded[geocoded.length - 1].lat!, lng: geocoded[geocoded.length - 1].lng! },
  };
}

function distanceBetween(a: RouteStop, b: RouteStop): number | null {
  if (!a.lat || !a.lng || !b.lat || !b.lng) return null;
  return kmToMiles(haversineDistance(a.lat, a.lng, b.lat, b.lng));
}

type Props = { route: SavedRoute };

export function RouteViewClient({ route }: Props) {
  const router = useRouter();
  const [copiedId,    setCopiedId]    = useState<string | null>(null);
  const [deleting,    setDeleting]    = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [assumptions, setAssumptions] = useState<CostAssumptions>(DEFAULTS);

  // Real road distance fetched on load (replaces stale straight-line saved value)
  const [realRoadMiles,    setRealRoadMiles]    = useState<number | null>(null);
  const [fetchingRoad,     setFetchingRoad]     = useState(false);
  const [roadFetchFailed,  setRoadFetchFailed]  = useState(false);

  // Mutable copy of stops so inline yards edits update the UI immediately
  const initialStops: RouteStop[] = route.optimized_order
    ? route.optimized_order.map((i) => route.stops[i]).filter(Boolean)
    : route.stops;
  const [orderedStops, setOrderedStops] = useState<RouteStop[]>(initialStops);

  const { startCoords, endCoords } = parseStartEnd(route);

  // ── Auto-fetch real road distance on mount ────────────────────────────────────
  // The saved total_distance_miles may have been stored as haversine (straight-line).
  // Silently refresh it via the Matrix API on page load.

  useEffect(() => {
    const geocoded = orderedStops.filter((s) => s.geocoded && s.lat && s.lng);
    if (!startCoords || !endCoords || geocoded.length === 0) return;

    setFetchingRoad(true);
    const stopCoords = geocoded.map((s) => ({ lat: s.lat!, lng: s.lng! }));

    fetchRoadDistanceMatrix(startCoords, stopCoords, endCoords)
      .then((miles) => {
        if (miles !== null) {
          setRealRoadMiles(miles);
        } else {
          setRoadFetchFailed(true);
        }
      })
      .catch(() => setRoadFetchFailed(true))
      .finally(() => setFetchingRoad(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Best available distance for cost estimator: fresh road > saved value
  const savedMiles = route.total_distance_miles
    ?? (route.total_distance_km ? kmToMiles(route.total_distance_km) : null);
  const displayMiles = realRoadMiles ?? savedMiles;
  const isEstimated = realRoadMiles === null && !route.total_distance_miles;

  // ── Inline yards editing with auto-save ───────────────────────────────────────

  function updateStopYards(id: string, yards: number | undefined) {
    setOrderedStops((prev) => prev.map((s) => s.id === id ? { ...s, yards } : s));
  }

  async function saveYardsOnBlur() {
    await fetch(`/api/routes/${route.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stops: orderedStops }),
    });
  }

  // ── Copy address to clipboard ─────────────────────────────────────────────────

  async function copyAddress(id: string, address: string) {
    await navigator.clipboard.writeText(address);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  // ── Export CSV ────────────────────────────────────────────────────────────────

  function exportCsv() {
    const rows: string[][] = [
      ["Stop #", "Name", "Address", "Distance from Previous (mi)", "Yards (yd³)"],
      ["0", "Start", route.start_address, "-", "-"],
    ];

    let prevStop: RouteStop | null = null;
    orderedStops.forEach((stop, i) => {
      let dist = "-";
      if (prevStop) {
        const d = distanceBetween(prevStop, stop);
        if (d !== null) dist = d.toFixed(2);
      }
      rows.push([
        String(i + 1),
        stop.name ?? `Stop ${i + 1}`,
        stop.address,
        dist,
        stop.yards !== undefined ? String(stop.yards) : "-",
      ]);
      prevStop = stop;
    });

    const lastStop = orderedStops[orderedStops.length - 1];
    let lastDist = "-";
    if (lastStop?.lat && lastStop?.lng) {
      const fakeEnd: RouteStop = { id: "end", address: route.end_address, geocoded: false };
      const d = distanceBetween(lastStop, fakeEnd);
      if (d !== null) lastDist = d.toFixed(2);
    }
    rows.push([String(orderedStops.length + 1), "End", route.end_address, lastDist, "-"]);

    const totalMi = displayMiles;
    if (totalMi !== null && orderedStops.length > 0) {
      const AVG_SPEED_MPH = 25;
      const a = assumptions;
      const driveMin    = (totalMi / AVG_SPEED_MPH) * 60;
      const serviceMin  = orderedStops.length * a.serviceMinPerStop;
      const totalMin    = driveMin + serviceMin;
      const totalHrs    = totalMin / 60;
      const gallons     = totalMi / a.mpg;
      const fuelCost    = gallons * a.fuelPricePerGallon;
      const laborCost   = totalHrs * a.laborRatePerHour;
      const transportCost = fuelCost + laborCost;

      const totalYards   = orderedStops.reduce((s, st) => s + (st.yards ?? 0), 0);
      const hasYards     = orderedStops.some((st) => st.yards !== undefined && st.yards > 0);
      const totalTons    = (totalYards * (a.lbsPerYard ?? 300)) / 2000;
      const disposalCost = totalTons * (a.disposalCostPerTon ?? 85);
      const grandTotal   = transportCost + (hasYards ? disposalCost : 0);

      rows.push(
        [],
        ["--- Cost Analysis ---"],
        ["Assumption", "Value"],
        ["Service time per stop (min)", String(a.serviceMinPerStop)],
        ["Fuel efficiency (mpg)", String(a.mpg)],
        ["Fuel price ($/gal)", String(a.fuelPricePerGallon)],
        ["Labour rate ($/hr)", String(a.laborRatePerHour)],
        [],
        ["Metric", "Value"],
        ["Total distance (mi)", totalMi.toFixed(1)],
        ["Drive time (min)", driveMin.toFixed(0)],
        ["Service time (min)", serviceMin.toFixed(0)],
        ["Total time (hrs)", totalHrs.toFixed(1)],
        ["Fuel cost ($)", fuelCost.toFixed(2)],
        ["Labour cost ($)", laborCost.toFixed(2)],
        ["Transportation cost ($)", transportCost.toFixed(2)],
        ["Cost per stop ($)", (transportCost / orderedStops.length).toFixed(2)],
      );

      if (hasYards) {
        rows.push(
          [],
          ["--- Disposal Analysis ---"],
          ["Total cubic yards (yd³)", totalYards.toFixed(1)],
          ["Est. density (lbs/yd³)", String(a.lbsPerYard ?? 300)],
          ["Total estimated weight (tons)", totalTons.toFixed(2)],
          ["Disposal cost per ton ($/ton)", String(a.disposalCostPerTon ?? 85)],
          ["Disposal cost ($)", disposalCost.toFixed(2)],
          [],
          ["TOTAL ROUTE COST ($)", grandTotal.toFixed(2)],
        );
      }
    }

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    el.download = `${route.route_name.replace(/\s+/g, "-")}.csv`;
    el.click();
  }

  // ── Delete route ──────────────────────────────────────────────────────────────

  async function deleteRoute() {
    setDeleting(true);
    await fetch(`/api/routes/${route.id}`, { method: "DELETE" });
    router.push("/routes");
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const stopCount = orderedStops.length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ── LEFT — sticky sidebar (header + actions + map + cost estimator) ── */}
        <div className="w-full lg:w-2/5 lg:sticky lg:top-6 flex flex-col gap-4">

          {/* Route header */}
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900 leading-tight">{route.route_name}</h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <p className="text-sm text-gray-500">
                    {stopCount} stop{stopCount !== 1 ? "s" : ""}
                    {displayMiles !== null && (
                      <>
                        {" · "}
                        {fetchingRoad ? (
                          <span className="inline-flex items-center gap-1 text-gray-400">
                            <RefreshCw className="size-3 animate-spin" />
                            Fetching road distance…
                          </span>
                        ) : (
                          <span className={realRoadMiles !== null ? "text-[#2D6A4F] font-medium" : ""}>
                            {displayMiles.toFixed(1)} mi
                            {realRoadMiles !== null && <span className="text-gray-400 font-normal"> road</span>}
                            {roadFetchFailed && savedMiles !== null && <span className="text-gray-400 font-normal"> (est.)</span>}
                          </span>
                        )}
                      </>
                    )}
                  </p>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      route.status === "optimized"
                        ? "bg-[#2D6A4F]/10 text-[#2D6A4F]"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {route.status === "optimized" ? "Optimized" : "Draft"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            <Link href={`/routes/${route.id}/edit`} className="block">
              <Button variant="outline" className="w-full gap-2">
                <Pencil className="size-4" /> Edit Route
              </Button>
            </Link>

            <button
              onClick={() => window.open(`/routes/${route.id}/print`, "_blank")}
              className="w-full flex items-center gap-2 h-9 px-4 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Printer className="size-4" /> Print / PDF
            </button>

            <button
              onClick={exportCsv}
              className="w-full flex items-center gap-2 h-9 px-4 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Download className="size-4" /> Export CSV
            </button>

            <div className="pt-1">
              {showConfirm ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 text-center">Delete this route?</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => setShowConfirm(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 bg-rose-600 hover:bg-rose-700 text-white"
                      onClick={deleteRoute}
                      disabled={deleting}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowConfirm(true)}
                  className="w-full flex items-center gap-2 h-9 px-4 rounded-lg text-sm text-rose-500 hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="size-4" /> Delete Route
                </button>
              )}
            </div>
          </div>

          {/* Missing geocode warning */}
          {route.stops.some((s) => !s.geocoded) && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              <MapPin className="size-3 inline mr-1" />
              {route.stops.filter((s) => !s.geocoded).length} stop(s) not geocoded — map may be incomplete.
            </div>
          )}

          {/* Map */}
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <RouteMap
              startCoords={startCoords}
              endCoords={endCoords}
              stops={orderedStops}
              roadGeojson={route.road_geometry ?? null}
              height={400}
            />
          </div>

          {/* Cost estimator */}
          {displayMiles !== null && stopCount > 0 && (
            <RouteCostCalculator
              totalMiles={displayMiles}
              stopCount={stopCount}
              stops={orderedStops}
              isEstimated={isEstimated}
              onAssumptionsChange={setAssumptions}
            />
          )}
        </div>

        {/* ── RIGHT — scrollable stop list ──────────────────────────────────── */}
        <div className="w-full lg:w-3/5 min-w-0">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                {route.optimized_order ? "Optimized Stop Order" : "Stop List"}
              </h2>
            </div>

            <div className="divide-y divide-gray-100">
              {/* Start */}
              <div className="flex items-center gap-3 px-5 py-3">
                <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-green-700">S</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Start</p>
                  <p className="text-sm text-gray-800 truncate">{route.start_address}</p>
                </div>
                <button
                  onClick={() => copyAddress("start", route.start_address)}
                  className="shrink-0 text-gray-300 hover:text-[#2D6A4F] transition-colors"
                  title="Copy address"
                >
                  {copiedId === "start" ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                </button>
              </div>

              {/* Stops */}
              {orderedStops.map((stop, i) => {
                const prev = i === 0 ? null : orderedStops[i - 1];
                const dist = prev ? distanceBetween(prev, stop) : null;
                return (
                  <div key={stop.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-blue-700">{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-800 truncate">{stop.name || `Stop ${i + 1}`}</p>
                        {dist !== null && (
                          <span className="text-xs text-gray-400 shrink-0">{dist.toFixed(1)} mi</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{stop.address}</p>
                    </div>
                    {/* Inline yards input — auto-saves on blur */}
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      placeholder="yd³"
                      value={stop.yards ?? ""}
                      onChange={(e) => updateStopYards(
                        stop.id,
                        e.target.value === "" ? undefined : parseFloat(e.target.value)
                      )}
                      onBlur={saveYardsOnBlur}
                      className="w-16 h-7 text-sm border border-gray-200 rounded px-1 py-0.5 text-gray-600 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#2D6A4F]/40 shrink-0"
                    />
                    <button
                      onClick={() => copyAddress(stop.id, stop.address)}
                      className="shrink-0 text-gray-300 hover:text-[#2D6A4F] transition-colors"
                      title="Copy address"
                    >
                      {copiedId === stop.id ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                    </button>
                  </div>
                );
              })}

              {/* End */}
              <div className="flex items-center gap-3 px-5 py-3">
                <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-red-700">E</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">End — Disposal Facility</p>
                  <p className="text-sm text-gray-800 truncate">{route.end_address}</p>
                </div>
                <button
                  onClick={() => copyAddress("end", route.end_address)}
                  className="shrink-0 text-gray-300 hover:text-[#2D6A4F] transition-colors"
                  title="Copy address"
                >
                  {copiedId === "end" ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
