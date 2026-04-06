"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * components/routes/RouteMap.tsx
 *
 * Interactive Leaflet map loaded via CDN.
 * Shows start (green), stop (blue numbered) and end (red) markers.
 * When roadGeojson is provided, draws the actual road path.
 * Falls back to a straight-line dashed polyline if no road geometry.
 */

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import type { RouteStop } from "@/types";

type LatLng = { lat: number; lng: number };

type Props = {
  startCoords?: LatLng | null;
  endCoords?: LatLng | null;
  stops: RouteStop[];
  optimizedOrder?: number[] | null;
  /** GeoJSON road geometry from ORS Directions API */
  roadGeojson?: { coordinates: [number, number][] } | null;
  className?: string;
};

// ── Marker HTML helpers ─────────────────────────────────────────────────────────

function pinHtml(color: string, label: string) {
  return `
    <div style="
      width:28px;height:28px;border-radius:50% 50% 50% 0;
      background:${color};border:2px solid #fff;
      transform:rotate(-45deg);
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 4px rgba(0,0,0,.4);
    ">
      <span style="
        transform:rotate(45deg);
        color:#fff;font-weight:700;font-size:10px;
        font-family:sans-serif;line-height:1;
      ">${label}</span>
    </div>`;
}

// ── Component ───────────────────────────────────────────────────────────────────

export function RouteMap({
  startCoords,
  endCoords,
  stops,
  optimizedOrder,
  roadGeojson,
  className = "h-full w-full",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const layersRef    = useRef<any[]>([]);
  const [ready, setReady] = useState(false);

  // Inject Leaflet CSS once
  useEffect(() => {
    if (document.getElementById("leaflet-css")) return;
    const link = document.createElement("link");
    link.id   = "leaflet-css";
    link.rel  = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }, []);

  // Initialise map once Leaflet script is loaded
  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return;
    const L = (window as any).L;
    const map = L.map(containerRef.current, { zoomControl: true }).setView(
      [43.5, -72.5],
      8
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
      maxZoom: 18,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [ready]);

  // Re-draw markers and route whenever data changes
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const L = (window as any).L;
    const map = mapRef.current;

    // Remove previous layers
    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];

    const bounds: [number, number][] = [];

    function addMarker(coords: LatLng, html: string, popup: string) {
      const icon = L.divIcon({
        html,
        className: "",
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -28],
      });
      const m = L.marker([coords.lat, coords.lng], { icon })
        .addTo(map)
        .bindPopup(popup);
      layersRef.current.push(m);
      bounds.push([coords.lat, coords.lng]);
    }

    // Start marker
    if (startCoords) {
      addMarker(startCoords, pinHtml("#22c55e", "S"), "<strong>Start</strong>");
    }

    // Stop markers (show in optimized order if available, else original order)
    const orderedIndices = optimizedOrder ?? stops.map((_, i) => i);
    orderedIndices.forEach((idx, rank) => {
      const stop = stops[idx];
      if (!stop?.lat || !stop?.lng) return;
      addMarker(
        { lat: stop.lat, lng: stop.lng },
        pinHtml("#3B82F6", String(rank + 1)),
        `<strong>${stop.name || `Stop ${rank + 1}`}</strong><br/>${stop.address}`
      );
    });

    // End marker
    if (endCoords) {
      addMarker(endCoords, pinHtml("#EF4444", "E"), "<strong>End</strong>");
    }

    // ── Route path ──────────────────────────────────────────────────────────────
    if (roadGeojson?.coordinates?.length) {
      // Real road path from ORS Directions API — solid line
      const latlngs = roadGeojson.coordinates.map(
        ([lng, lat]) => [lat, lng] as [number, number]
      );
      const poly = L.polyline(latlngs, {
        color: "#2D6A4F",
        weight: 4,
        opacity: 0.85,
      }).addTo(map);
      layersRef.current.push(poly);
    } else if (optimizedOrder && startCoords && endCoords) {
      // Fallback: straight-line dashed polyline
      const latlngs: [number, number][] = [[startCoords.lat, startCoords.lng]];
      for (const idx of optimizedOrder) {
        const s = stops[idx];
        if (s?.lat && s?.lng) latlngs.push([s.lat, s.lng]);
      }
      latlngs.push([endCoords.lat, endCoords.lng]);
      const poly = L.polyline(latlngs, {
        color: "#2D6A4F",
        weight: 3,
        opacity: 0.7,
        dashArray: "6 4",
      }).addTo(map);
      layersRef.current.push(poly);
    }

    // Fit map to all visible points
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [ready, startCoords, endCoords, stops, optimizedOrder, roadGeojson]);

  return (
    <>
      <Script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
      />
      <div ref={containerRef} className={className} />
    </>
  );
}
