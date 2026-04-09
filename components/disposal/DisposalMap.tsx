"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    L: any;
  }
}

export type MapFacility = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  facility_type: string;
  lat: number;
  lng: number;
  phone: string | null;
};

const MAP_COLORS: Record<string, string> = {
  landfill:            "#6B7280",
  transfer_station:    "#3B82F6",
  mrf:                 "#8B5CF6",
  composting:          "#22C55E",
  anaerobic_digestion: "#14B8A6",
  waste_to_energy:     "#F97316",
  recycling_center:    "#A855F7",
  hazardous_waste:     "#EF4444",
  cd_facility:         "#EAB308",
};

const TYPE_LABELS: Record<string, string> = {
  landfill:            "Landfill",
  transfer_station:    "Transfer Station",
  mrf:                 "MRF / Recycling Center",
  composting:          "Composting",
  anaerobic_digestion: "Anaerobic Digestion",
  waste_to_energy:     "Waste-to-Energy",
  recycling_center:    "Recycling Center",
  hazardous_waste:     "Hazardous Waste",
  cd_facility:         "C&D Facility",
};

export function DisposalMap({ facilities }: { facilities: MapFacility[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const markersRef   = useRef<any[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    const updateMarkers = () => {
      const L   = window.L;
      const map = mapRef.current;
      if (!L || !map) return;

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      facilities.forEach((f) => {
        const color      = MAP_COLORS[f.facility_type] ?? "#6B7280";
        const typeLabel  = TYPE_LABELS[f.facility_type] ?? f.facility_type;
        const location   = [f.city, f.state].filter(Boolean).join(", ");

        const marker = L.circleMarker([f.lat, f.lng], {
          radius:      7,
          fillColor:   color,
          color:       "#fff",
          weight:      1.5,
          opacity:     1,
          fillOpacity: 0.85,
        });

        marker.bindPopup(
          `<div style="min-width:180px;font-family:sans-serif">` +
          `<strong style="font-size:13px;display:block;margin-bottom:3px">${f.name}</strong>` +
          `<div style="font-size:12px;color:#6B7280;margin-bottom:4px">${location}</div>` +
          `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;` +
          `font-weight:500;background:${color}22;color:${color};border:1px solid ${color}44">${typeLabel}</span>` +
          (f.phone ? `<div style="font-size:12px;margin-top:5px;color:#374151">${f.phone}</div>` : "") +
          `<div style="margin-top:7px"><a href="/disposal/${f.slug}" ` +
          `style="font-size:12px;color:#2D6A4F;font-weight:600;text-decoration:none">View details →</a></div>` +
          `</div>`
        );

        marker.addTo(map);
        markersRef.current.push(marker);
      });
    };

    const initMap = () => {
      if (!containerRef.current) return;

      // Map already mounted — just refresh markers
      if (mapRef.current) {
        updateMarkers();
        return;
      }

      const L = window.L;

      if (!document.getElementById("leaflet-css")) {
        const link  = document.createElement("link");
        link.id     = "leaflet-css";
        link.rel    = "stylesheet";
        link.href   = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      const map = L.map(containerRef.current, {
        center:      [42.5, -73.5],
        zoom:        6,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      setTimeout(() => {
        mapRef.current?.invalidateSize();
        updateMarkers();
      }, 200);
    };

    // Inject CSS early
    if (!document.getElementById("leaflet-css")) {
      const link  = document.createElement("link");
      link.id     = "leaflet-css";
      link.rel    = "stylesheet";
      link.href   = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    if (window.L) {
      initMap();
    } else if (!document.getElementById("leaflet-js")) {
      const script    = document.createElement("script");
      script.id       = "leaflet-js";
      script.src      = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload   = () => initMap();
      document.head.appendChild(script);
    } else {
      // Script tag exists but not loaded yet — wait
      const check = setInterval(() => {
        if (window.L) {
          clearInterval(check);
          initMap();
        }
      }, 50);
    }
  }, [facilities]);

  // Collect facility types present in this result set for the legend
  const presentTypes = Array.from(new Set(facilities.map((f) => f.facility_type)));

  return (
    <div className="mb-6">
      {/* Map */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div
          ref={containerRef}
          className="w-full h-[250px] md:h-[450px]"
        />
      </div>

      {/* Legend */}
      {presentTypes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {presentTypes.map((t) => (
            <div key={t} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span
                className="inline-block size-3 rounded-full shrink-0"
                style={{ backgroundColor: MAP_COLORS[t] ?? "#6B7280" }}
              />
              {TYPE_LABELS[t] ?? t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
