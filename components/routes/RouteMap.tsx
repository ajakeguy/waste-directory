'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef } from 'react'
import type { RouteStop } from '@/types'

declare global {
  interface Window { L: any }
}

interface RouteMapProps {
  stops?: RouteStop[]
  startCoords?: { lat: number; lng: number } | null
  endCoords?: { lat: number; lng: number } | null
  roadGeojson?: { coordinates: [number, number][] } | null
  /** Map height in pixels (default 500) */
  height?: number
}

export default function RouteMap({
  stops = [],
  startCoords,
  endCoords,
  roadGeojson,
  height = 500,
}: RouteMapProps) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<any>(null)
  const markersRef    = useRef<any[]>([])
  const polylineRef   = useRef<any>(null)

  // ── Initialise Leaflet once on mount ──────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!containerRef.current) return
    if (mapRef.current) return

    const initMap = () => {
      if (!containerRef.current || mapRef.current) return
      const L = window.L

      // Load CSS if not already present
      if (!document.getElementById('leaflet-css')) {
        const link  = document.createElement('link')
        link.id     = 'leaflet-css'
        link.rel    = 'stylesheet'
        link.href   = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)
      }

      const map = L.map(containerRef.current, {
        center:      [43.5, -72.5],
        zoom:        8,
        zoomControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      mapRef.current = map

      setTimeout(() => {
        if (mapRef.current) mapRef.current.invalidateSize()
      }, 200)
    }

    // Ensure CSS is injected before JS loads
    if (!document.getElementById('leaflet-css')) {
      const link  = document.createElement('link')
      link.id     = 'leaflet-css'
      link.rel    = 'stylesheet'
      link.href   = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }

    if (window.L) {
      initMap()
    } else {
      const existingScript = document.getElementById('leaflet-js')
      if (existingScript) {
        existingScript.addEventListener('load', initMap)
      } else {
        const script    = document.createElement('script')
        script.id       = 'leaflet-js'
        script.src      = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
        script.onload   = initMap
        document.head.appendChild(script)
      }
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, []) // empty array — run once on mount only

  // ── Update markers/route whenever props change ────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.L) return
    const L = window.L

    // Clear existing markers and polyline
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    if (polylineRef.current) {
      polylineRef.current.remove()
      polylineRef.current = null
    }

    const bounds: [number, number][] = []

    // Start marker (green circle)
    if (startCoords) {
      const m = L.circleMarker(
        [startCoords.lat, startCoords.lng],
        { color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1, radius: 10 }
      ).addTo(map).bindPopup('<strong>Start</strong>')
      markersRef.current.push(m)
      bounds.push([startCoords.lat, startCoords.lng])
    }

    // Stop markers (blue numbered div icons)
    stops.filter((s) => s.lat && s.lng).forEach((stop, i) => {
      const m = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:#2563eb;color:white;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)">${i + 1}</div>`,
          iconSize:   [26, 26],
          iconAnchor: [13, 13],
        }),
      }).addTo(map).bindPopup(`<strong>${stop.name || `Stop ${i + 1}`}</strong><br/>${stop.address}`)
      markersRef.current.push(m)
      bounds.push([stop.lat!, stop.lng!])
    })

    // End marker (red circle)
    if (endCoords) {
      const m = L.circleMarker(
        [endCoords.lat, endCoords.lng],
        { color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1, radius: 10 }
      ).addTo(map).bindPopup('<strong>End / Disposal</strong>')
      markersRef.current.push(m)
      bounds.push([endCoords.lat, endCoords.lng])
    }

    // Route line
    if (roadGeojson?.coordinates?.length) {
      // Real road path from ORS — GeoJSON format [lng, lat] → L.geoJSON handles it natively
      polylineRef.current = L.geoJSON(
        { type: 'Feature', geometry: { type: 'LineString', coordinates: roadGeojson.coordinates } },
        { style: { color: '#2D6A4F', weight: 4, opacity: 0.8 } }
      ).addTo(map)
    } else if (bounds.length > 1) {
      // Dashed straight-line fallback
      polylineRef.current = L.polyline(bounds, {
        color: '#2D6A4F', weight: 3, opacity: 0.6, dashArray: '8, 8',
      }).addTo(map)
    }

    // Fit map to all visible points
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40] })
    }
  }, [stops, startCoords, endCoords, roadGeojson])

  return (
    <div
      ref={containerRef}
      style={{
        height:          `${height}px`,
        width:           '100%',
        minHeight:       '300px',
        backgroundColor: '#e5e7eb',
      }}
    />
  )
}
