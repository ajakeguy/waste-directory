"use client";

/**
 * components/routes/RouteViewClient.tsx
 *
 * Client component for the route view page.
 * Handles: copy-to-clipboard, CSV export, delete, and the Leaflet map.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Copy, Check, Download, Printer, Pencil, Trash2, MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteMap } from "@/components/routes/RouteMap";
import { haversineDistance } from "@/lib/route-optimizer";
import type { SavedRoute, RouteStop } from "@/types";

type LatLng = { lat: number; lng: number };

function parseStartEnd(route: SavedRoute): { startCoords: LatLng | null; endCoords: LatLng | null } {
  // Heuristic: try to derive coords from first/last geocoded stop as fallback.
  // In practice they come from the stored stops list (start/end aren't stored as coords separately).
  // Use first/last geocoded stop as bounds hint.
  const geocoded = route.stops.filter((s) => s.geocoded && s.lat && s.lng);
  if (geocoded.length === 0) return { startCoords: null, endCoords: null };
  return {
    startCoords: { lat: geocoded[0].lat!, lng: geocoded[0].lng! },
    endCoords:   { lat: geocoded[geocoded.length - 1].lat!, lng: geocoded[geocoded.length - 1].lng! },
  };
}

function distanceBetween(a: RouteStop, b: RouteStop): number | null {
  if (!a.lat || !a.lng || !b.lat || !b.lng) return null;
  return haversineDistance(a.lat, a.lng, b.lat, b.lng);
}

type Props = { route: SavedRoute };

export function RouteViewClient({ route }: Props) {
  const router = useRouter();
  const [copiedId,  setCopiedId]  = useState<string | null>(null);
  const [deleting,  setDeleting]  = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const orderedStops: RouteStop[] =
    route.optimized_order
      ? route.optimized_order.map((i) => route.stops[i]).filter(Boolean)
      : route.stops;

  const { startCoords, endCoords } = parseStartEnd(route);

  // ── Copy address to clipboard ─────────────────────────────────────────────────

  async function copyAddress(id: string, address: string) {
    await navigator.clipboard.writeText(address);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  // ── Export CSV ────────────────────────────────────────────────────────────────

  function exportCsv() {
    const rows = [
      ["Stop #", "Name", "Address", "Distance from Previous (km)"],
      ["0", "Start", route.start_address, "-"],
    ];

    let prevStop: RouteStop | null = null;
    orderedStops.forEach((stop, i) => {
      let dist = "-";
      if (prevStop) {
        const d = distanceBetween(prevStop, stop);
        if (d !== null) dist = d.toFixed(2);
      }
      rows.push([String(i + 1), stop.name ?? `Stop ${i + 1}`, stop.address, dist]);
      prevStop = stop;
    });

    // End
    const lastStop = orderedStops[orderedStops.length - 1];
    let lastDist = "-";
    if (lastStop?.lat && lastStop?.lng) {
      const fakeEnd: RouteStop = {
        id: "end", address: route.end_address,
        geocoded: false, // coords not stored separately
      };
      const d = distanceBetween(lastStop, fakeEnd);
      if (d !== null) lastDist = d.toFixed(2);
    }
    rows.push([String(orderedStops.length + 1), "End", route.end_address, lastDist]);

    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${route.route_name.replace(/\s+/g, "-")}.csv`;
    a.click();
  }

  // ── Delete route ──────────────────────────────────────────────────────────────

  async function deleteRoute() {
    setDeleting(true);
    await fetch(`/api/routes/${route.id}`, { method: "DELETE" });
    router.push("/routes");
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{route.route_name}</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {orderedStops.length} stop{orderedStops.length !== 1 ? "s" : ""}
              {route.total_distance_km
                ? ` · ${route.total_distance_km.toFixed(1)} km total`
                : ""}
            </p>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              route.status === "optimized"
                ? "bg-[#2D6A4F]/10 text-[#2D6A4F]"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {route.status === "optimized" ? "Optimized" : "Draft"}
          </span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* Stop list */}
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
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800 truncate">{stop.name || `Stop ${i + 1}`}</p>
                        {dist !== null && (
                          <span className="text-xs text-gray-400 shrink-0">{dist.toFixed(1)} km</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{stop.address}</p>
                    </div>
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

          {/* Map */}
          <div className="rounded-xl border border-gray-200 overflow-hidden h-96">
            <RouteMap
              startCoords={startCoords}
              endCoords={endCoords}
              stops={route.stops}
              optimizedOrder={route.optimized_order ?? undefined}
              className="h-full w-full"
            />
          </div>
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
        <div className="w-full lg:w-52 shrink-0 space-y-2 lg:sticky lg:top-24 self-start">
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

          <div className="pt-2 border-t border-gray-100">
            {showConfirm ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 text-center">Delete this route?</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowConfirm(false)}
                  >
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

          {/* Stats */}
          {route.total_distance_km && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mt-4 text-center">
              <p className="text-xs text-gray-500 mb-0.5">Total Distance</p>
              <p className="text-2xl font-bold text-[#2D6A4F]">
                {route.total_distance_km.toFixed(1)}
              </p>
              <p className="text-xs text-gray-400">km</p>
            </div>
          )}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Stops</p>
            <p className="text-2xl font-bold text-gray-900">{orderedStops.length}</p>
          </div>

          {/* Missing geocode warning */}
          {route.stops.some((s) => !s.geocoded) && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              <MapPin className="size-3 inline mr-1" />
              {route.stops.filter((s) => !s.geocoded).length} stop(s) not geocoded — map may be incomplete.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
