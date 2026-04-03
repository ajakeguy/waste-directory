"use client";

/**
 * components/routes/RouteBuilder.tsx
 *
 * Main client component for building and optimizing a route.
 * Left panel: inputs, stop list, CSV upload.
 * Right panel: live Leaflet map.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Trash2, Upload, Loader2, CheckCircle2,
  GripVertical, Download, MapPin, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RouteMap } from "@/components/routes/RouteMap";
import { geocodeAddress, geocodeAddresses } from "@/lib/geocoding";
import { optimizeRoute } from "@/lib/route-optimizer";
import type { RouteStop, SavedRoute } from "@/types";

type LatLng = { lat: number; lng: number };

function uuid() {
  return crypto.randomUUID();
}

// ── CSV parser (no external library) ─────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { parts.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function parseCsv(text: string): Array<{ address: string; name: string }> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const rows = lines.map(parseCsvLine);
  const first = rows[0].map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => ["address", "name", "location", "stop"].includes(c));

  let addrIdx = 0;
  let nameIdx = 1;
  if (hasHeader) {
    const ai = first.findIndex((c) => ["address", "location", "stop"].includes(c));
    const ni = first.findIndex((c) => ["name", "label"].includes(c));
    if (ai !== -1) addrIdx = ai;
    if (ni !== -1) nameIdx = ni;
  }

  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows
    .filter((r) => r[addrIdx]?.trim())
    .map((r) => ({ address: r[addrIdx].trim(), name: r[nameIdx]?.trim() ?? "" }));
}

function downloadSampleCsv() {
  const csv = `address,name\n123 Main Street Burlington VT,Stop 1\n456 Pine Ave Montpelier VT,Stop 2\n`;
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "route-stops-template.csv";
  a.click();
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = { userId: string; existingRoute?: SavedRoute };

export function RouteBuilder({ userId: _userId, existingRoute }: Props) {
  void _userId;
  const router = useRouter();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const dragIdx     = useRef<number | null>(null);
  const isEdit = !!existingRoute;

  // ── Form state (pre-populated in edit mode)
  const [routeName,    setRouteName]    = useState(existingRoute?.route_name    ?? "");
  const [startAddress, setStartAddress] = useState(existingRoute?.start_address ?? "");
  const [startCoords,  setStartCoords]  = useState<LatLng | null>(null);
  const [startGeocoding, setStartGeocoding] = useState(false);
  const [endAddress,   setEndAddress]   = useState(existingRoute?.end_address   ?? "");
  const [endCoords,    setEndCoords]    = useState<LatLng | null>(null);
  const [endGeocoding, setEndGeocoding] = useState(false);
  const [stops,        setStops]        = useState<RouteStop[]>(existingRoute?.stops ?? []);
  const [newAddr,      setNewAddr]      = useState("");
  const [newName,      setNewName]      = useState("");

  // ── Progress / results
  const [geocodeProgress, setGeocodeProgress] = useState<{ done: number; total: number } | null>(null);
  const [optimizing,      setOptimizing]      = useState(false);
  const [optimizedOrder,  setOptimizedOrder]  = useState<number[] | null>(existingRoute?.optimized_order ?? null);
  const [totalDistanceKm, setTotalDistanceKm] = useState<number | null>(existingRoute?.total_distance_km ?? null);
  const [saving,    setSaving]    = useState(false);
  const [savedId,   setSavedId]   = useState<string | null>(existingRoute?.id ?? null);
  const [error,     setError]     = useState<string | null>(null);
  const [csvStatus, setCsvStatus] = useState<string | null>(null);

  // ── Geocode single address on blur ────────────────────────────────────────────

  async function geocodeStart() {
    if (!startAddress.trim() || startCoords) return;
    setStartGeocoding(true);
    const r = await geocodeAddress(startAddress);
    setStartGeocoding(false);
    if (r) setStartCoords(r);
    else setError("Could not geocode start address. Check the address and try again.");
  }

  async function geocodeEnd() {
    if (!endAddress.trim() || endCoords) return;
    setEndGeocoding(true);
    const r = await geocodeAddress(endAddress);
    setEndGeocoding(false);
    if (r) setEndCoords(r);
    else setError("Could not geocode end address. Check the address and try again.");
  }

  // ── Add a stop manually ───────────────────────────────────────────────────────

  function addStop() {
    if (!newAddr.trim()) return;
    const stop: RouteStop = {
      id:       uuid(),
      address:  newAddr.trim(),
      name:     newName.trim() || `Stop ${stops.length + 1}`,
      geocoded: false,
    };
    setStops((prev) => [...prev, stop]);
    setNewAddr("");
    setNewName("");
    // Clear any previous optimized result when stops change
    setOptimizedOrder(null);
    setTotalDistanceKm(null);
  }

  function removeStop(id: string) {
    setStops((prev) => prev.filter((s) => s.id !== id));
    setOptimizedOrder(null);
    setTotalDistanceKm(null);
  }

  // ── CSV upload ────────────────────────────────────────────────────────────────

  function handleCsvFile(file: File) {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setError("Please upload a .csv file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setCsvStatus("No valid rows found in the CSV file.");
        return;
      }
      const newStops: RouteStop[] = rows.map((r, i) => ({
        id:       uuid(),
        address:  r.address,
        name:     r.name || `Stop ${stops.length + i + 1}`,
        geocoded: false,
      }));
      setStops((prev) => [...prev, ...newStops]);
      setCsvStatus(`${rows.length} stops loaded from CSV`);
      setOptimizedOrder(null);
      setTotalDistanceKm(null);
    };
    reader.readAsText(file);
  }

  // ── Drag to reorder ───────────────────────────────────────────────────────────

  function onDragStart(idx: number) { dragIdx.current = idx; }

  function onDrop(targetIdx: number) {
    const from = dragIdx.current;
    if (from === null || from === targetIdx) return;
    setStops((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(targetIdx, 0, item);
      return next;
    });
    dragIdx.current = null;
    setOptimizedOrder(null);
    setTotalDistanceKm(null);
  }

  // ── Geocode all un-geocoded stops ─────────────────────────────────────────────

  async function geocodeAll() {
    const ungeocoded = stops.filter((s) => !s.geocoded);
    if (ungeocoded.length === 0) return;
    setGeocodeProgress({ done: 0, total: ungeocoded.length });
    setError(null);

    const addresses = ungeocoded.map((s) => s.address);
    const results = await geocodeAddresses(addresses, (done, total) =>
      setGeocodeProgress({ done, total })
    );

    setStops((prev) =>
      prev.map((stop) => {
        const idx = ungeocoded.findIndex((u) => u.id === stop.id);
        if (idx === -1) return stop;
        const r = results[idx];
        if (!r) return { ...stop, geocoded: false };
        return { ...stop, lat: r.lat, lng: r.lng, geocoded: true };
      })
    );
    setGeocodeProgress(null);
    setOptimizedOrder(null);
    setTotalDistanceKm(null);
  }

  // ── Optimize route ────────────────────────────────────────────────────────────

  async function runOptimize() {
    if (!startCoords || !endCoords) {
      setError("Geocode the start and end address first.");
      return;
    }
    const geocodedStops = stops.filter((s) => s.geocoded && s.lat && s.lng);
    if (geocodedStops.length === 0) {
      setError("No geocoded stops to optimize. Run 'Geocode All Stops' first.");
      return;
    }
    if (geocodedStops.length < stops.length) {
      setError(
        `${stops.length - geocodedStops.length} stop(s) could not be geocoded and will be skipped.`
      );
    }

    setOptimizing(true);
    setError(null);

    // Run in a setTimeout so the UI can update first
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        const coords = geocodedStops.map((s) => ({ lat: s.lat!, lng: s.lng! }));
        const { orderedIndices, totalDistanceKm } = optimizeRoute(
          coords,
          startCoords,
          endCoords
        );
        // Map back to indices in the full stops array
        const fullIndices = orderedIndices.map((i) => {
          const geocodedStop = geocodedStops[i];
          return stops.findIndex((s) => s.id === geocodedStop.id);
        });
        setOptimizedOrder(fullIndices);
        setTotalDistanceKm(totalDistanceKm);
        resolve();
      }, 50);
    });

    setOptimizing(false);
  }

  // ── Save route ────────────────────────────────────────────────────────────────

  async function saveRoute() {
    if (!routeName.trim() || !startAddress.trim() || !endAddress.trim()) {
      setError("Route name, start address and end address are required.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      route_name:        routeName.trim(),
      start_address:     startAddress.trim(),
      end_address:       endAddress.trim(),
      stops:             stops.map((s) => ({
        id:       s.id,
        address:  s.address,
        name:     s.name,
        lat:      s.lat,
        lng:      s.lng,
        geocoded: s.geocoded,
      })),
      optimized_order:   optimizedOrder,
      total_distance_km: totalDistanceKm,
      status:            optimizedOrder ? "optimized" : "draft",
    };

    try {
      const url    = (isEdit || savedId) ? `/api/routes/${savedId ?? existingRoute!.id}` : "/api/routes";
      const method = (isEdit || savedId) ? "PATCH" : "POST";
      const res    = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save route");
      const id = savedId ?? json.id;
      setSavedId(id);
      router.push(`/routes/${id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setSaving(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────────

  const allGeocoded =
    stops.length > 0 &&
    stops.every((s) => s.geocoded) &&
    !!startCoords &&
    !!endCoords;

  const canOptimize = allGeocoded;
  const ungeocodedCount = stops.filter((s) => !s.geocoded).length;

  // For the map: show start/end geocoded coords even before optimization
  const mapStartCoords = startCoords;
  const mapEndCoords   = endCoords;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[70vh]">

      {/* ── LEFT PANEL ──────────────────────────────────────────────────────── */}
      <div className="w-full lg:w-[480px] shrink-0 space-y-6">

        {/* Error banner */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Section 1: Route Info */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Route Info
          </h2>
          <Input
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            placeholder="Monday Commercial Route"
          />
        </section>

        {/* Section 2: Start Location */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Starting Location (Depot / Garage)
          </h2>
          <div className="relative">
            <Input
              value={startAddress}
              onChange={(e) => { setStartAddress(e.target.value); setStartCoords(null); }}
              onBlur={geocodeStart}
              placeholder="123 Depot Road, Burlington, VT"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {startGeocoding ? (
                <Loader2 className="size-4 text-gray-400 animate-spin" />
              ) : startCoords ? (
                <CheckCircle2 className="size-4 text-green-500" />
              ) : null}
            </div>
          </div>
          {!startCoords && startAddress && !startGeocoding && (
            <p className="text-xs text-gray-400 mt-1">Tab out to geocode</p>
          )}
        </section>

        {/* Section 3: Stops */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Stops ({stops.length})
          </h2>

          {/* Manual add */}
          <div className="flex gap-2 mb-2">
            <Input
              value={newAddr}
              onChange={(e) => setNewAddr(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStop(); } }}
              placeholder="Stop address"
              className="flex-1"
            />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Label (opt.)"
              className="w-32"
            />
            <Button type="button" onClick={addStop} size="sm" className="bg-[#2D6A4F] hover:bg-[#245a42] text-white shrink-0">
              <Plus className="size-4" />
            </Button>
          </div>

          {/* CSV zone */}
          <div
            className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-[#2D6A4F]/40 hover:bg-gray-50 transition-colors mb-1"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleCsvFile(file);
            }}
            onClick={() => csvInputRef.current?.click()}
          >
            <Upload className="size-4 text-gray-400 mx-auto mb-1" />
            <p className="text-xs text-gray-500">Drag & drop a CSV or click to upload</p>
          </div>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = ""; }}
          />
          <div className="flex items-center justify-between mt-1 mb-3">
            {csvStatus && <p className="text-xs text-[#2D6A4F]">{csvStatus}</p>}
            <button
              type="button"
              onClick={downloadSampleCsv}
              className="text-xs text-gray-400 hover:text-[#2D6A4F] flex items-center gap-1 ml-auto"
            >
              <Download className="size-3" />
              Download template
            </button>
          </div>

          {/* Stop list */}
          {stops.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No stops added yet</p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {stops.map((stop, idx) => (
                <div
                  key={stop.id}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(idx)}
                  className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="size-3.5 text-gray-300 shrink-0" />
                  <span className="w-5 text-xs text-gray-400 tabular-nums shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate text-xs">{stop.name}</p>
                    <p className="text-gray-500 truncate text-xs">{stop.address}</p>
                  </div>
                  {stop.geocoded ? (
                    <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
                  ) : (
                    <MapPin className="size-3.5 text-gray-300 shrink-0" />
                  )}
                  <button
                    type="button"
                    onClick={() => removeStop(stop.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 4: End Location */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Disposal Facility / End Location
          </h2>
          <div className="relative">
            <Input
              value={endAddress}
              onChange={(e) => { setEndAddress(e.target.value); setEndCoords(null); }}
              onBlur={geocodeEnd}
              placeholder="789 Transfer Station Rd, Montpelier, VT"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {endGeocoding ? (
                <Loader2 className="size-4 text-gray-400 animate-spin" />
              ) : endCoords ? (
                <CheckCircle2 className="size-4 text-green-500" />
              ) : null}
            </div>
          </div>
        </section>

        {/* Section 5: Actions */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Actions
          </h2>

          {/* Geocode All */}
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={geocodeAll}
            disabled={stops.length === 0 || ungeocodedCount === 0 || !!geocodeProgress}
          >
            {geocodeProgress ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Geocoding {geocodeProgress.done}/{geocodeProgress.total}…
              </>
            ) : (
              <>
                <MapPin className="size-4" />
                Geocode All Stops
                {ungeocodedCount > 0 && (
                  <span className="ml-auto text-xs text-gray-400">{ungeocodedCount} remaining</span>
                )}
              </>
            )}
          </Button>

          {/* Optimize */}
          <Button
            type="button"
            className="w-full justify-start gap-2 bg-[#2D6A4F] hover:bg-[#245a42] text-white"
            onClick={runOptimize}
            disabled={!canOptimize || optimizing}
          >
            {optimizing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Optimizing…
              </>
            ) : (
              <>
                <MapPin className="size-4" />
                Optimize Route
                {!canOptimize && (
                  <span className="ml-auto text-xs text-white/60">
                    {stops.length === 0
                      ? "Add stops first"
                      : !startCoords || !endCoords
                      ? "Geocode start & end"
                      : "Geocode all stops"}
                  </span>
                )}
              </>
            )}
          </Button>

          {/* Distance result */}
          {totalDistanceKm !== null && (
            <div className="rounded-lg bg-[#2D6A4F]/5 border border-[#2D6A4F]/20 px-4 py-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Optimized distance</p>
              <p className="text-2xl font-bold text-[#2D6A4F]">
                {totalDistanceKm.toFixed(1)} km
              </p>
            </div>
          )}

          {/* Save */}
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={saveRoute}
            disabled={saving || !routeName.trim() || !startAddress.trim() || !endAddress.trim()}
          >
            {saving ? (
              <><Loader2 className="size-4 animate-spin" />Saving…</>
            ) : (
              <><Save className="size-4" />Save Route</>
            )}
          </Button>
        </section>
      </div>

      {/* ── RIGHT PANEL: Map ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-[400px] lg:min-h-0 sticky top-24 self-start">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden h-[600px] lg:h-[calc(100vh-120px)]">
          <RouteMap
            startCoords={mapStartCoords}
            endCoords={mapEndCoords}
            stops={stops}
            optimizedOrder={optimizedOrder}
            className="h-full w-full"
          />
        </div>
      </div>
    </div>
  );
}
