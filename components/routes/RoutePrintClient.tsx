"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * components/routes/RoutePrintClient.tsx
 *
 * Client component for the route print page.
 * Renders the full layout, initialises a Leaflet map, captures it with
 * html2canvas, then triggers window.print() automatically.
 */

import { useEffect, useRef } from "react";
import { PrintToolbar } from "@/components/reports/PrintToolbar";
import { haversineDistance, kmToMiles } from "@/lib/route-optimizer";
import { RouteCostCalculator } from "@/components/routes/RouteCostCalculator";
import type { SavedRoute, RouteStop } from "@/types";

declare global {
  interface Window { L: any }
}

function distMi(a: RouteStop, b: RouteStop): string {
  if (!a.lat || !a.lng || !b.lat || !b.lng) return "—";
  return (haversineDistance(a.lat, a.lng, b.lat, b.lng) * 0.621371).toFixed(1) + " mi";
}

type Props = {
  route: SavedRoute;
};

export function RoutePrintClient({ route }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);

  const orderedStops: RouteStop[] = route.optimized_order
    ? route.optimized_order.map((i) => route.stops[i]).filter(Boolean)
    : route.stops;

  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  useEffect(() => {
    const geocodedStops = orderedStops.filter((s) => s.lat && s.lng);

    async function captureMapAndPrint() {
      const mapEl = mapRef.current;
      if (!mapEl) {
        window.print();
        return;
      }
      try {
        // Dynamic import keeps html2canvas out of the server bundle
        const html2canvas = (await import("html2canvas")).default;
        const canvas = await html2canvas(mapEl, {
          useCORS:    true,
          allowTaint: true,
          logging:    false,
        });
        const img         = document.createElement("img");
        img.src           = canvas.toDataURL("image/png");
        img.style.width   = "100%";
        img.style.height  = "auto";
        img.style.display = "block";
        mapEl.parentNode?.replaceChild(img, mapEl);
      } catch (err) {
        console.warn("[print] html2canvas capture failed — printing without map image:", err);
      }
      setTimeout(() => window.print(), 300);
    }

    if (!geocodedStops.length) {
      // No map data — just print after a short delay
      const t = setTimeout(() => window.print(), 800);
      return () => clearTimeout(t);
    }

    function initMap() {
      const mapEl = mapRef.current;
      if (!mapEl) return;
      const L = window.L;

      const map = L.map(mapEl, { zoomControl: false, attributionControl: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom:     19,
        crossOrigin: true,
      }).addTo(map);

      const bounds: [number, number][] = [];

      // Numbered stop markers
      geocodedStops.forEach((stop, i) => {
        L.marker([stop.lat!, stop.lng!], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:#2563eb;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4)">${i + 1}</div>`,
            iconSize:   [24, 24],
            iconAnchor: [12, 12],
          }),
        }).addTo(map);
        bounds.push([stop.lat!, stop.lng!]);
      });

      // Road geometry if available, else dashed straight-line
      if (route.road_geometry?.coordinates?.length) {
        L.geoJSON(
          { type: "Feature", geometry: { type: "LineString", coordinates: route.road_geometry.coordinates } },
          { style: { color: "#2D6A4F", weight: 3, opacity: 0.85 } }
        ).addTo(map);
      } else if (bounds.length > 1) {
        L.polyline(bounds, { color: "#2D6A4F", weight: 2, opacity: 0.6, dashArray: "6 4" }).addTo(map);
      }

      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }

      // Wait for tiles to render, then capture
      setTimeout(() => captureMapAndPrint(), 1500);
    }

    // Inject Leaflet CSS
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id    = "leaflet-css";
      link.rel   = "stylesheet";
      link.href  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    if (window.L) {
      initMap();
    } else {
      const existing = document.getElementById("leaflet-js");
      if (existing) {
        existing.addEventListener("load", initMap, { once: true });
      } else {
        const script   = document.createElement("script");
        script.id      = "leaflet-js";
        script.src     = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.onload  = initMap;
        document.head.appendChild(script);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalMi = route.total_distance_miles
    ?? (route.total_distance_km ? kmToMiles(route.total_distance_km) : null);

  return (
    <>
      <style>{`
        @media print {
          header, nav, footer, #print-toolbar { display: none !important; }
          body > * { visibility: hidden !important; }
          #print-route, #print-route * { visibility: visible !important; }
          #print-route {
            position: absolute; top: 0; left: 0; width: 100%; margin: 0; padding: 0;
          }
          #print-map-wrap { break-inside: avoid; page-break-inside: avoid; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          @page { size: A4; margin: 14mm 14mm; }
        }
      `}</style>

      <PrintToolbar />

      <div id="print-route" className="max-w-3xl mx-auto px-4 py-6 print:p-0 print:max-w-none">

        {/* Header */}
        <div className="bg-[#2D6A4F] text-white rounded-xl p-6 mb-5 print:rounded-none">
          <p className="text-xs font-bold uppercase tracking-widest text-white/60 mb-1">Route Sheet</p>
          <h1 className="text-2xl font-bold mb-2">{route.route_name}</h1>
          <div className="flex flex-wrap gap-4 text-sm text-white/80">
            <span>{orderedStops.length} stop{orderedStops.length !== 1 ? "s" : ""}</span>
            {totalMi && <span>{totalMi.toFixed(1)} mi total</span>}
            <span>Generated {today}</span>
          </div>
        </div>

        {/* Map (captured by html2canvas and replaced with <img> before print) */}
        {orderedStops.some((s) => s.lat && s.lng) && (
          <div id="print-map-wrap" className="mb-5 rounded-xl overflow-hidden border border-gray-200 print:rounded-none print:border-0">
            <div
              ref={mapRef}
              style={{ height: "380px", width: "100%", backgroundColor: "#e5e7eb" }}
            />
          </div>
        )}

        {/* Stop table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-0 print:rounded-none">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-10">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name / Address</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Dist. from prev</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {/* Start */}
              <tr className="bg-green-50">
                <td className="px-4 py-3">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-xs font-bold">S</span>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-0.5">Start — Depot / Garage</p>
                  <p className="text-gray-800">{route.start_address}</p>
                </td>
                <td className="px-4 py-3 text-right text-gray-400">—</td>
              </tr>

              {/* Stops */}
              {orderedStops.map((stop, i) => {
                const prev = i === 0 ? null : orderedStops[i - 1];
                const dist = prev ? distMi(prev, stop) : "—";
                return (
                  <tr key={stop.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold">{i + 1}</span>
                    </td>
                    <td className="px-4 py-3">
                      {stop.name && <p className="font-medium text-gray-700 mb-0.5">{stop.name}</p>}
                      <p className="text-gray-600">{stop.address}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">{dist}</td>
                  </tr>
                );
              })}

              {/* End */}
              <tr className="bg-red-50">
                <td className="px-4 py-3">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold">E</span>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-0.5">End — Disposal Facility</p>
                  <p className="text-gray-800">{route.end_address}</p>
                </td>
                <td className="px-4 py-3 text-right text-gray-400">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        {totalMi && (
          <p className="text-right text-sm text-gray-500 mt-3 pr-1">
            Total route distance:{" "}
            <strong>{totalMi.toFixed(1)} mi</strong>
            {!route.total_distance_miles && (
              <span className="text-gray-400 text-xs ml-1">(est.)</span>
            )}
          </p>
        )}

        {/* Cost calculator in print mode */}
        {totalMi && orderedStops.length > 0 && (
          <div className="mt-5">
            <RouteCostCalculator
              totalMiles={totalMi}
              stopCount={orderedStops.length}
              isEstimated={!route.total_distance_miles}
              printMode={true}
            />
          </div>
        )}

        <p className="text-xs text-gray-400 text-center mt-8 print:mt-4">
          WasteDirectory.com · Route Optimizer
        </p>
      </div>
    </>
  );
}

export default RoutePrintClient;
