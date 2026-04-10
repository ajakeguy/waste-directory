"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, X, MapPin } from "lucide-react";
import { FACILITY_TYPE_LABELS } from "@/types";

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

type GeoFilter = {
  address: string;
  lat: number;
  lng: number;
  radiusMiles: number;
};

type FacilityWithDist = MapFacility & { distance: number };

const RADIUS_OPTIONS = [10, 25, 50, 100] as const;

const MAP_COLORS: Record<string, string> = {
  landfill:            "#6B7280",
  transfer_station:    "#3B82F6",
  mrf:                 "#8B5CF6",
  composting:          "#22C55E",
  anaerobic_digestion: "#14B8A6",
  waste_to_energy:     "#F97316",
  hazardous_waste:     "#EF4444",
  cd_facility:         "#EAB308",
};

// Use shared labels — cast to Record<string, string> since facility_type from DB is string
const TYPE_LABELS = FACILITY_TYPE_LABELS as Record<string, string>;

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function DisposalMap({ facilities }: { facilities: MapFacility[] }) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<any>(null);
  const markersRef      = useRef<any[]>([]);
  const radiusCircleRef = useRef<any>(null);

  const [addrInput,   setAddrInput]   = useState("");
  const [radiusMiles, setRadiusMiles] = useState<number>(25);
  const [geoFilter,   setGeoFilter]   = useState<GeoFilter | null>(null);
  const [geocoding,   setGeocoding]   = useState(false);
  const [geoError,    setGeoError]    = useState("");

  // Ref so updateMarkers always reads the latest geoFilter
  const geoFilterRef = useRef<GeoFilter | null>(null);
  geoFilterRef.current = geoFilter;

  // Derived: facilities within radius, sorted by distance
  const geoResults: FacilityWithDist[] | null = geoFilter
    ? facilities
        .map((f) => ({
          ...f,
          distance: haversine(geoFilter.lat, geoFilter.lng, f.lat, f.lng),
        }))
        .filter((f) => f.distance <= geoFilter.radiusMiles)
        .sort((a, b) => a.distance - b.distance)
    : null;

  // ── Marker / circle rendering ───────────────────────────────────────────────

  const updateMarkers = () => {
    const L   = window.L;
    const map = mapRef.current;
    if (!L || !map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (radiusCircleRef.current) {
      radiusCircleRef.current.remove();
      radiusCircleRef.current = null;
    }

    const geo    = geoFilterRef.current;
    const toShow = geo
      ? facilities.filter(
          (f) => haversine(geo.lat, geo.lng, f.lat, f.lng) <= geo.radiusMiles
        )
      : facilities;

    toShow.forEach((f) => {
      const color     = MAP_COLORS[f.facility_type] ?? "#6B7280";
      const typeLabel = TYPE_LABELS[f.facility_type]  ?? f.facility_type;
      const location  = [f.city, f.state].filter(Boolean).join(", ");

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
        (f.phone
          ? `<div style="font-size:12px;margin-top:5px;color:#374151">${f.phone}</div>`
          : "") +
        `<div style="margin-top:7px"><a href="/disposal/${f.slug}" ` +
        `style="font-size:12px;color:#2D6A4F;font-weight:600;text-decoration:none">View details →</a></div>` +
        `</div>`
      );

      marker.addTo(map);
      markersRef.current.push(marker);
    });

    if (geo) {
      const radiusMeters = geo.radiusMiles * 1609.34;
      radiusCircleRef.current = L.circle([geo.lat, geo.lng], {
        radius:      radiusMeters,
        color:       "#2D6A4F",
        fillColor:   "#2D6A4F",
        fillOpacity: 0.07,
        weight:      1.5,
        dashArray:   "6 4",
      }).addTo(map);

      map.fitBounds(radiusCircleRef.current.getBounds(), { padding: [20, 20] });
    }
  };

  // ── Leaflet init + marker refresh ────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    const initMap = () => {
      if (!containerRef.current) return;

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
        maxZoom:     19,
      }).addTo(map);

      mapRef.current = map;

      setTimeout(() => {
        mapRef.current?.invalidateSize();
        updateMarkers();
      }, 200);
    };

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
      const check = setInterval(() => {
        if (window.L) {
          clearInterval(check);
          initMap();
        }
      }, 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilities, geoFilter]);

  // ── Geo search ───────────────────────────────────────────────────────────────

  const handleGeoSearch = async () => {
    if (!addrInput.trim()) return;
    setGeocoding(true);
    setGeoError("");

    try {
      const res  = await fetch(
        `/api/ors/geocode?text=${encodeURIComponent(addrInput)}`
      );
      const json = await res.json();
      const coords = json?.features?.[0]?.geometry?.coordinates;

      if (!coords) {
        setGeoError("Address not found. Try a more specific address.");
        return;
      }

      setGeoFilter({
        address:     addrInput.trim(),
        lat:         coords[1],
        lng:         coords[0],
        radiusMiles: radiusMiles,
      });
    } catch {
      setGeoError("Geocoding failed. Please try again.");
    } finally {
      setGeocoding(false);
    }
  };

  const handleClear = () => {
    setGeoFilter(null);
    setGeoError("");
  };

  const presentTypes = Array.from(new Set(facilities.map((f) => f.facility_type)));

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="mb-6">
      {/* Geo-filter bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={addrInput}
            onChange={(e) => setAddrInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleGeoSearch(); }}
            placeholder="Enter address to search nearby…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/25 focus:border-[#2D6A4F] placeholder:text-gray-400"
          />
        </div>

        <select
          value={radiusMiles}
          onChange={(e) => setRadiusMiles(Number(e.target.value))}
          className="h-[38px] rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/25 focus:border-[#2D6A4F] cursor-pointer"
        >
          {RADIUS_OPTIONS.map((r) => (
            <option key={r} value={r}>Within {r} mi</option>
          ))}
        </select>

        <button
          onClick={handleGeoSearch}
          disabled={geocoding || !addrInput.trim()}
          className="inline-flex items-center gap-1.5 h-[38px] px-4 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          <Search className="size-3.5" />
          {geocoding ? "Searching…" : "Search"}
        </button>

        {geoFilter && (
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1 h-[38px] px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            <X className="size-3.5" />
            Clear
          </button>
        )}
      </div>

      {geoError && (
        <p className="text-sm text-red-600 mb-2">{geoError}</p>
      )}

      {geoFilter && geoResults && (
        <p className="text-sm text-[#2D6A4F] font-medium mb-2">
          {geoResults.length} facilit{geoResults.length !== 1 ? "ies" : "y"} within{" "}
          {geoFilter.radiusMiles} miles of &ldquo;{geoFilter.address}&rdquo;
        </p>
      )}

      {/* Map */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div ref={containerRef} className="w-full h-[250px] md:h-[450px]" />
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

      {/* Geo-filtered facility list */}
      {geoFilter && geoResults && geoResults.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Nearby facilities — sorted by distance
          </h3>
          <div className="space-y-2">
            {geoResults.map((f) => {
              const color     = MAP_COLORS[f.facility_type] ?? "#6B7280";
              const typeLabel = TYPE_LABELS[f.facility_type]  ?? f.facility_type;
              return (
                <Link
                  key={f.id}
                  href={`/disposal/${f.slug}`}
                  className="flex items-center justify-between gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-[#2D6A4F]/40 hover:shadow-sm transition-all"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{f.name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {[f.city, f.state].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-3">
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{ background: `${color}22`, color }}
                    >
                      {typeLabel}
                    </span>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {f.distance.toFixed(1)} mi
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {geoFilter && geoResults && geoResults.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-500">
          No facilities with known coordinates within {geoFilter.radiusMiles} miles.
        </div>
      )}
    </div>
  );
}
