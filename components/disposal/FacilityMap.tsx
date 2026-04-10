"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef } from "react";
import type { DisposalFacility } from "@/types";

declare global {
  interface Window {
    L: any;
  }
}

export function FacilityMap({ facility }: { facility: DisposalFacility }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;
    if (mapRef.current) return; // already initialized

    const addressText = [facility.address, facility.city, facility.state, facility.zip]
      .filter(Boolean)
      .join(", ");

    const initMap = (lat: number, lng: number) => {
      if (!containerRef.current || mapRef.current) return;
      const L = window.L;

      if (!document.getElementById("leaflet-css")) {
        const link  = document.createElement("link");
        link.id     = "leaflet-css";
        link.rel    = "stylesheet";
        link.href   = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      const map = L.map(containerRef.current, {
        center:      [lat, lng],
        zoom:        14,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom:     19,
      }).addTo(map);

      const marker = L.marker([lat, lng]);
      marker
        .bindPopup(
          `<div style="font-family:sans-serif;min-width:140px">` +
          `<strong style="font-size:13px">${facility.name}</strong>` +
          (addressText ? `<div style="font-size:12px;color:#6B7280;margin-top:3px">${addressText}</div>` : "") +
          `</div>`
        )
        .addTo(map);

      mapRef.current = map;
      setTimeout(() => mapRef.current?.invalidateSize(), 200);
    };

    const run = async () => {
      // 1. Use stored coordinates
      if (facility.lat != null && facility.lng != null) {
        initMap(facility.lat, facility.lng);
        return;
      }

      // 2. Geocode via ORS Pelias
      if (facility.address || facility.city) {
        const apiKey = process.env.NEXT_PUBLIC_ORS_API_KEY;
        if (!apiKey) return;

        try {
          const res  = await fetch(
            `https://api.openrouteservice.org/geocode/search?api_key=${apiKey}` +
            `&text=${encodeURIComponent(addressText)}&size=1&boundary.country=US`
          );
          const json = await res.json();
          const coords = json?.features?.[0]?.geometry?.coordinates;
          if (coords) {
            initMap(coords[1], coords[0]); // ORS returns [lng, lat]
          }
        } catch {
          // geocoding failed — don't show map
        }
      }
    };

    // Inject Leaflet CSS early
    if (!document.getElementById("leaflet-css")) {
      const link  = document.createElement("link");
      link.id     = "leaflet-css";
      link.rel    = "stylesheet";
      link.href   = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    if (window.L) {
      run();
    } else if (!document.getElementById("leaflet-js")) {
      const script    = document.createElement("script");
      script.id       = "leaflet-js";
      script.src      = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload   = () => run();
      document.head.appendChild(script);
    } else {
      const check = setInterval(() => {
        if (window.L) {
          clearInterval(check);
          run();
        }
      }, 50);
    }
  }, [facility]);

  // Don't render if there's no location data at all
  if (!facility.lat && !facility.lng && !facility.address && !facility.city) {
    return null;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-4">
      <div ref={containerRef} className="w-full h-[300px]" />
    </div>
  );
}
