"use client";

/**
 * components/routes/RouteBuilder.tsx
 *
 * Full route-building UI with:
 * - Address autocomplete on all address fields
 * - Live geocoding as stops are added
 * - Re-optimize available whenever stops+start+end are geocoded
 * - Stale-route warning when stops change after optimization
 * - Real road routing via ORS Directions API after TSP
 * - Distances shown in miles
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Trash2, Upload, Loader2, XCircle,
  GripVertical, Download, MapPin, Save, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteMap } from "@/components/routes/RouteMap";
import { AddressAutocomplete, type GeocodeState } from "@/components/routes/AddressAutocomplete";
import { geocodeAddress } from "@/lib/geocoding";
import { optimizeRoute, kmToMiles } from "@/lib/route-optimizer";
import { fetchRoadRoute } from "@/lib/road-routing";
import type { RouteStop, SavedRoute } from "@/types";

type LatLng = { lat: number; lng: number };

function uuid() { return crypto.randomUUID(); }

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

function parseCsv(text: string): Array<{ address: string; name: string }> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const rows  = lines.map(parseCsvLine);
  const first = rows[0].map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => ["address","name","location","stop"].includes(c));
  let addrIdx = 0, nameIdx = 1;
  if (hasHeader) {
    const ai = first.findIndex((c) => ["address","location","stop"].includes(c));
    const ni = first.findIndex((c) => ["name","label"].includes(c));
    if (ai !== -1) addrIdx = ai;
    if (ni !== -1) nameIdx = ni;
  }
  return (hasHeader ? rows.slice(1) : rows)
    .filter((r) => r[addrIdx]?.trim())
    .map((r) => ({ address: r[addrIdx].trim(), name: r[nameIdx]?.trim() ?? "" }));
}

function downloadSampleCsv() {
  const csv = `address,name\n123 Main Street Burlington VT,Stop 1\n456 Pine Ave Montpelier VT,Stop 2\n`;
  const blob = new Blob([csv], { type: "text/csv" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = "route-stops-template.csv";
  a.click();
}

// ── Component ─────────────────────────────────────────────────────────────────

type StopGeoState = { status: GeocodeState; error?: string };

type Props = { userId: string; existingRoute?: SavedRoute };

export function RouteBuilder({ userId: _userId, existingRoute }: Props) {
  void _userId;
  const router = useRouter();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const dragIdx     = useRef<number | null>(null);
  const isEdit = !!existingRoute;

  // ── Route / address state ──────────────────────────────────────────────────
  const [routeName,    setRouteName]   = useState(existingRoute?.route_name    ?? "");
  const [startAddress, setStartAddress]= useState(existingRoute?.start_address ?? "");
  const [startCoords,  setStartCoords] = useState<LatLng | null>(null);
  const [startState,   setStartState]  = useState<StopGeoState>({ status: "idle" });

  const [endAddress,   setEndAddress]  = useState(existingRoute?.end_address   ?? "");
  const [endCoords,    setEndCoords]   = useState<LatLng | null>(null);
  const [endState,     setEndState]    = useState<StopGeoState>({ status: "idle" });

  const [stops,        setStops]       = useState<RouteStop[]>(existingRoute?.stops ?? []);
  const [stopStates,   setStopStates]  = useState<Record<string, StopGeoState>>(() => {
    const m: Record<string, StopGeoState> = {};
    for (const s of (existingRoute?.stops ?? [])) {
      m[s.id] = { status: s.geocoded ? "ok" : "idle" };
    }
    return m;
  });

  const [newAddr,  setNewAddr]  = useState("");
  const [newName,  setNewName]  = useState("");
  const [csvStatus,setCsvStatus]= useState<string | null>(null);

  // ── Geocode batch progress ─────────────────────────────────────────────────
  const [geocodeProgress, setGeocodeProgress] = useState<{ done: number; total: number } | null>(null);

  // ── Optimization state ─────────────────────────────────────────────────────
  const [optimizing,      setOptimizing]     = useState(false);
  const [optimizedOrder,  setOptimizedOrder] = useState<number[] | null>(existingRoute?.optimized_order ?? null);
  const [roadGeojson,     setRoadGeojson]    = useState<{ coordinates: [number, number][] } | null>(
    existingRoute?.road_geometry ?? null
  );
  const [totalDistanceMiles, setTotalDistanceMiles] = useState<number | null>(
    existingRoute?.total_distance_miles ?? null
  );
  const [roadFetching, setRoadFetching]  = useState(false);
  const [isStale,      setIsStale]       = useState(false);

  // ── Save state ─────────────────────────────────────────────────────────────
  const [saving,  setSaving]  = useState(false);
  const [savedId, setSavedId] = useState<string | null>(existingRoute?.id ?? null);
  const [error,   setError]   = useState<string | null>(null);

  // ── Helpers: mark route stale when stops change ────────────────────────────

  function markStale() {
    if (optimizedOrder) {
      setIsStale(true);
      setRoadGeojson(null);  // clear road line so map doesn't show stale route
    }
    setOptimizedOrder(null);
    setTotalDistanceMiles(null);
  }

  // ── Start address resolved (from autocomplete or manual geocode) ───────────

  function resolveStart(address: string, lat: number, lng: number) {
    setStartAddress(address);
    setStartCoords({ lat, lng });
    setStartState({ status: "ok" });
    markStale();
  }

  async function geocodeStartManual() {
    if (!startAddress.trim() || startState.status === "loading") return;
    setStartState({ status: "loading" });
    const r = await geocodeAddress(startAddress);
    if (r.ok) {
      setStartCoords({ lat: r.lat, lng: r.lng });
      setStartState({ status: "ok" });
      markStale();
    } else {
      setStartCoords(null);
      setStartState({ status: "error", error: r.error });
    }
  }

  // ── End address ────────────────────────────────────────────────────────────

  function resolveEnd(address: string, lat: number, lng: number) {
    setEndAddress(address);
    setEndCoords({ lat, lng });
    setEndState({ status: "ok" });
    markStale();
  }

  async function geocodeEndManual() {
    if (!endAddress.trim() || endState.status === "loading") return;
    setEndState({ status: "loading" });
    const r = await geocodeAddress(endAddress);
    if (r.ok) {
      setEndCoords({ lat: r.lat, lng: r.lng });
      setEndState({ status: "ok" });
      markStale();
    } else {
      setEndCoords(null);
      setEndState({ status: "error", error: r.error });
    }
  }

  // ── Single stop geocode ────────────────────────────────────────────────────

  async function geocodeStop(id: string, address: string) {
    setStopStates((prev) => ({ ...prev, [id]: { status: "loading" } }));
    const r = await geocodeAddress(address);
    if (r.ok) {
      setStops((prev) =>
        prev.map((s) => s.id === id ? { ...s, lat: r.lat, lng: r.lng, geocoded: true } : s)
      );
      setStopStates((prev) => ({ ...prev, [id]: { status: "ok" } }));
    } else {
      setStopStates((prev) => ({ ...prev, [id]: { status: "error", error: r.error } }));
    }
  }

  // ── Stop resolved via autocomplete ─────────────────────────────────────────

  function resolveStop(id: string, address: string, lat: number, lng: number) {
    setStops((prev) =>
      prev.map((s) => s.id === id ? { ...s, address, lat, lng, geocoded: true } : s)
    );
    setStopStates((prev) => ({ ...prev, [id]: { status: "ok" } }));
    markStale();
  }

  // ── Add a stop manually ────────────────────────────────────────────────────

  async function addStop() {
    if (!newAddr.trim()) return;
    const id   = uuid();
    const stop: RouteStop = {
      id, address: newAddr.trim(),
      name: newName.trim() || `Stop ${stops.length + 1}`,
      geocoded: false,
    };
    setStops((prev) => [...prev, stop]);
    setStopStates((prev) => ({ ...prev, [id]: { status: "loading" } }));
    setNewAddr(""); setNewName("");
    markStale();
    // Geocode immediately
    await geocodeStop(id, stop.address);
  }

  function removeStop(id: string) {
    setStops((prev) => prev.filter((s) => s.id !== id));
    setStopStates((prev) => { const n = { ...prev }; delete n[id]; return n; });
    markStale();
  }

  // ── CSV upload ─────────────────────────────────────────────────────────────

  function handleCsvFile(file: File) {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setError("Please upload a .csv file."); return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseCsv(e.target?.result as string);
      if (!rows.length) { setCsvStatus("No valid rows found."); return; }
      const newStops: RouteStop[] = rows.map((r, i) => ({
        id: uuid(), address: r.address,
        name: r.name || `Stop ${stops.length + i + 1}`,
        geocoded: false,
      }));
      setStops((prev) => [...prev, ...newStops]);
      setStopStates((prev) => {
        const n = { ...prev };
        newStops.forEach((s) => { n[s.id] = { status: "idle" }; });
        return n;
      });
      setCsvStatus(`${rows.length} stops loaded from CSV`);
      markStale();
    };
    reader.readAsText(file);
  }

  // ── Drag to reorder ────────────────────────────────────────────────────────

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
    markStale();
  }

  // ── Geocode All ────────────────────────────────────────────────────────────

  async function geocodeAll() {
    const toGeocode = stops.filter((s) => !s.geocoded);
    if (!toGeocode.length) return;
    setError(null);
    setGeocodeProgress({ done: 0, total: toGeocode.length });
    setStopStates((prev) => {
      const n = { ...prev };
      toGeocode.forEach((s) => { n[s.id] = { status: "loading" }; });
      return n;
    });
    let failCount = 0;
    for (let i = 0; i < toGeocode.length; i++) {
      const stop = toGeocode[i];
      const r = await geocodeAddress(stop.address);
      if (r.ok) {
        setStops((prev) =>
          prev.map((s) => s.id === stop.id ? { ...s, lat: r.lat, lng: r.lng, geocoded: true } : s)
        );
        setStopStates((prev) => ({ ...prev, [stop.id]: { status: "ok" } }));
      } else {
        failCount++;
        setStopStates((prev) => ({ ...prev, [stop.id]: { status: "error", error: r.error } }));
      }
      setGeocodeProgress({ done: i + 1, total: toGeocode.length });
      if (i < toGeocode.length - 1) await new Promise((r) => setTimeout(r, 120));
    }
    setGeocodeProgress(null);
    if (failCount > 0) {
      setError(`${failCount} stop(s) could not be geocoded. Check spelling or add city/state/zip.`);
    }
  }

  // ── Optimize + road route ──────────────────────────────────────────────────

  async function runOptimize() {
    if (!startCoords || !endCoords) {
      setError("Geocode the start and end address first."); return;
    }
    const geocodedStops = stops.filter((s) => s.geocoded && s.lat && s.lng);
    if (!geocodedStops.length) {
      setError("No geocoded stops. Add stops and wait for geocoding."); return;
    }

    setOptimizing(true);
    setIsStale(false);
    setError(null);
    setRoadGeojson(null);
    setTotalDistanceMiles(null);

    // 1. TSP optimization (runs sync in setTimeout so UI updates first)
    let fullIndices: number[] = [];
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        const coords = geocodedStops.map((s) => ({ lat: s.lat!, lng: s.lng! }));
        const { orderedIndices } = optimizeRoute(coords, startCoords, endCoords);
        fullIndices = orderedIndices.map((i) => {
          const gs = geocodedStops[i];
          return stops.findIndex((s) => s.id === gs.id);
        });
        setOptimizedOrder(fullIndices);
        resolve();
      }, 50);
    });
    setOptimizing(false);

    // 2. Fetch real road route from ORS
    setRoadFetching(true);
    const orderedCoords = fullIndices
      .map((i) => stops[i])
      .filter((s) => s?.lat && s?.lng)
      .map((s) => ({ lat: s.lat!, lng: s.lng! }));

    const road = await fetchRoadRoute(startCoords, orderedCoords, endCoords);
    if (road) {
      setRoadGeojson({ coordinates: road.coordinates });
      setTotalDistanceMiles(road.distanceMiles);
    } else {
      // Fall back to haversine estimate converted to miles
      const geocodedCoords = geocodedStops.map((s) => ({ lat: s.lat!, lng: s.lng! }));
      const { orderedIndices, totalDistanceKm } = optimizeRoute(geocodedCoords, startCoords, endCoords);
      void orderedIndices; // already set above
      setTotalDistanceMiles(kmToMiles(totalDistanceKm));
    }
    setRoadFetching(false);
  }

  // ── Save route ─────────────────────────────────────────────────────────────

  async function saveRoute() {
    if (!routeName.trim() || !startAddress.trim() || !endAddress.trim()) {
      setError("Route name, start address and end address are required."); return;
    }
    setSaving(true); setError(null);
    const payload = {
      route_name:           routeName.trim(),
      start_address:        startAddress.trim(),
      end_address:          endAddress.trim(),
      stops:                stops.map((s) => ({
        id: s.id, address: s.address, name: s.name,
        lat: s.lat, lng: s.lng, geocoded: s.geocoded,
      })),
      optimized_order:      optimizedOrder,
      total_distance_miles: totalDistanceMiles,
      road_geometry:        roadGeojson,
      status:               optimizedOrder ? "optimized" : "draft",
    };
    try {
      const url    = (isEdit || savedId) ? `/api/routes/${savedId ?? existingRoute!.id}` : "/api/routes";
      const method = (isEdit || savedId) ? "PATCH" : "POST";
      const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json   = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save route");
      const id = savedId ?? json.id;
      setSavedId(id);
      router.push(`/routes/${id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setSaving(false);
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const geocodedCount  = stops.filter((s) => s.geocoded).length;
  const ungeocodedCount= stops.filter((s) => !s.geocoded).length;
  const anyLoading     = Object.values(stopStates).some((s) => s.status === "loading") ||
                         startState.status === "loading" || endState.status === "loading";

  // Enable optimize whenever start+end are geocoded AND at least 1 geocoded stop
  const canOptimize = !!startCoords && !!endCoords && geocodedCount > 0 && !anyLoading && !optimizing && !roadFetching;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[70vh]">

      {/* ── LEFT PANEL ────────────────────────────────────────────────────── */}
      <div className="w-full lg:w-[480px] shrink-0 space-y-5">

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <XCircle className="size-4 shrink-0 mt-0.5 text-red-400" />
            <span>{error}</span>
            <button type="button" className="ml-auto text-red-300 hover:text-red-500" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* Stale warning */}
        {isStale && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500 shrink-0" />
            Stops have changed. Click <strong className="mx-0.5">Optimize Route</strong> to update the route.
          </div>
        )}

        {/* Route Info */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Route Info</h2>
          <input
            type="text"
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            placeholder="Monday Commercial Route"
            className="flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
          />
        </section>

        {/* Start Location */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Starting Location (Depot / Garage)</h2>
          <AddressAutocomplete
            value={startAddress}
            placeholder="123 Depot Road, Burlington, VT"
            geocodeState={startState.status}
            geocodeError={startState.error}
            onChange={(v) => { setStartAddress(v); setStartCoords(null); setStartState({ status: "idle" }); }}
            onResolved={resolveStart}
            onCleared={() => { setStartCoords(null); setStartState({ status: "idle" }); markStale(); }}
          />
          {startState.status === "idle" && startAddress && !startCoords && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-gray-400">No autocomplete match? </p>
              <button
                type="button"
                onClick={geocodeStartManual}
                className="text-xs text-[#2D6A4F] hover:underline"
              >
                Search this address →
              </button>
            </div>
          )}
        </section>

        {/* Stops */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Stops ({stops.length})
            {geocodedCount > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-400 normal-case">
                {geocodedCount}/{stops.length} geocoded
              </span>
            )}
          </h2>

          {/* Manual add with autocomplete */}
          <div className="flex gap-2 mb-2 items-start">
            <div className="flex-1">
              <AddressAutocomplete
                value={newAddr}
                placeholder="Stop address"
                geocodeState="idle"
                onChange={setNewAddr}
                onResolved={(addr, lat, lng) => {
                  // Directly add the stop with resolved coords
                  const id = uuid();
                  const stop: RouteStop = {
                    id, address: addr,
                    name: newName.trim() || `Stop ${stops.length + 1}`,
                    lat, lng, geocoded: true,
                  };
                  setStops((prev) => [...prev, stop]);
                  setStopStates((prev) => ({ ...prev, [id]: { status: "ok" } }));
                  setNewAddr(""); setNewName("");
                  markStale();
                }}
                onCleared={() => {}}
              />
            </div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Label (opt.)"
              className="w-28 flex h-9 rounded-md border border-gray-200 bg-white px-3 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
            />
            <Button
              type="button"
              onClick={addStop}
              size="sm"
              className="bg-[#2D6A4F] hover:bg-[#245a42] text-white shrink-0 h-9"
              title="Add stop (fallback if autocomplete didn't trigger)"
            >
              <Plus className="size-4" />
            </Button>
          </div>

          {/* CSV zone */}
          <div
            className="border-2 border-dashed border-gray-200 rounded-lg p-3 text-center cursor-pointer hover:border-[#2D6A4F]/40 hover:bg-gray-50 transition-colors mb-1"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCsvFile(f); }}
            onClick={() => csvInputRef.current?.click()}
          >
            <Upload className="size-4 text-gray-400 mx-auto mb-1" />
            <p className="text-xs text-gray-500">Drag & drop CSV or click to upload</p>
          </div>
          <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = ""; }}
          />
          <div className="flex items-center justify-between mt-1 mb-3">
            {csvStatus && <p className="text-xs text-[#2D6A4F]">{csvStatus}</p>}
            <button type="button" onClick={downloadSampleCsv}
              className="text-xs text-gray-400 hover:text-[#2D6A4F] flex items-center gap-1 ml-auto">
              <Download className="size-3" /> Download template
            </button>
          </div>

          {/* Stop list */}
          {stops.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No stops added yet</p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {stops.map((stop, idx) => {
                const ss = stopStates[stop.id] ?? { status: "idle" };
                return (
                  <div
                    key={stop.id}
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(idx)}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing transition-colors ${
                      ss.status === "error" ? "border-red-200 bg-red-50" : "border-gray-100 bg-gray-50"
                    }`}
                  >
                    <GripVertical className="size-3.5 text-gray-300 shrink-0" />
                    <span className="w-5 text-xs text-gray-400 tabular-nums shrink-0">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate text-xs">{stop.name}</p>
                      <p className="text-gray-500 truncate text-xs">{stop.address}</p>
                      {ss.status === "error" && ss.error && (
                        <p className="text-red-500 text-xs truncate">{ss.error}</p>
                      )}
                    </div>
                    {/* Status icon */}
                    {ss.status === "loading" && <Loader2 className="size-3.5 text-gray-400 animate-spin shrink-0" />}
                    {ss.status === "ok"      && <span className="size-3.5 rounded-full bg-green-500 shrink-0 flex items-center justify-center"><svg viewBox="0 0 10 10" className="w-2 h-2 fill-white"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg></span>}
                    {ss.status === "error"   && <XCircle className="size-3.5 text-red-400 shrink-0" title={ss.error} />}
                    {ss.status === "idle"    && <span className="size-2.5 rounded-full border border-gray-300 shrink-0" />}
                    <button type="button" onClick={() => removeStop(stop.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* End Location */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Disposal Facility / End Location</h2>
          <AddressAutocomplete
            value={endAddress}
            placeholder="789 Transfer Station Rd, Montpelier, VT"
            geocodeState={endState.status}
            geocodeError={endState.error}
            onChange={(v) => { setEndAddress(v); setEndCoords(null); setEndState({ status: "idle" }); }}
            onResolved={resolveEnd}
            onCleared={() => { setEndCoords(null); setEndState({ status: "idle" }); markStale(); }}
          />
          {endState.status === "idle" && endAddress && !endCoords && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-gray-400">No autocomplete match? </p>
              <button type="button" onClick={geocodeEndManual} className="text-xs text-[#2D6A4F] hover:underline">
                Search this address →
              </button>
            </div>
          )}
        </section>

        {/* Actions */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Actions</h2>

          {/* Geocode All */}
          <Button
            type="button" variant="outline"
            className="w-full justify-start gap-2"
            onClick={geocodeAll}
            disabled={!stops.length || ungeocodedCount === 0 || !!geocodeProgress}
          >
            {geocodeProgress ? (
              <><Loader2 className="size-4 animate-spin" />Geocoding {geocodeProgress.done}/{geocodeProgress.total}…</>
            ) : (
              <><MapPin className="size-4" />Geocode All Stops
                {ungeocodedCount > 0 && <span className="ml-auto text-xs text-gray-400">{ungeocodedCount} remaining</span>}
              </>
            )}
          </Button>

          {/* Optimize */}
          <Button
            type="button"
            className={`w-full justify-start gap-2 text-white ${isStale ? "bg-amber-600 hover:bg-amber-700" : "bg-[#2D6A4F] hover:bg-[#245a42]"}`}
            onClick={runOptimize}
            disabled={!canOptimize}
          >
            {(optimizing || roadFetching) ? (
              <><Loader2 className="size-4 animate-spin" />
                {optimizing ? "Optimizing stops…" : "Fetching road route…"}
              </>
            ) : (
              <><MapPin className="size-4" />
                {isStale ? "Re-optimize Route" : "Optimize Route"}
                {!canOptimize && !optimizing && !roadFetching && (
                  <span className="ml-auto text-xs text-white/60">
                    {!stops.length ? "Add stops first"
                      : !startCoords ? "Geocode start address"
                      : !endCoords   ? "Geocode end address"
                      : geocodedCount === 0 ? "Geocode stops first"
                      : anyLoading ? "Geocoding…"
                      : ""}
                  </span>
                )}
              </>
            )}
          </Button>

          {/* Distance result */}
          {totalDistanceMiles !== null && (
            <div className="rounded-lg bg-[#2D6A4F]/5 border border-[#2D6A4F]/20 px-4 py-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">
                {roadGeojson ? "Road distance" : "Est. distance (straight line)"}
              </p>
              <p className="text-2xl font-bold text-[#2D6A4F]">
                {totalDistanceMiles.toFixed(1)} mi
              </p>
            </div>
          )}

          {/* Save */}
          <Button
            type="button" variant="outline"
            className="w-full justify-start gap-2"
            onClick={saveRoute}
            disabled={saving || !routeName.trim() || !startAddress.trim() || !endAddress.trim()}
          >
            {saving ? <><Loader2 className="size-4 animate-spin" />Saving…</> : <><Save className="size-4" />Save Route</>}
          </Button>
        </section>
      </div>

      {/* ── RIGHT PANEL: Map ───────────────────────────────────────────────── */}
      <div className="flex-1 min-h-[400px] lg:min-h-0 sticky top-24 self-start">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden h-[600px] lg:h-[calc(100vh-120px)]">
          <RouteMap
            startCoords={startCoords}
            endCoords={endCoords}
            stops={stops}
            optimizedOrder={isStale ? null : optimizedOrder}
            roadGeojson={isStale ? null : roadGeojson}
            className="h-full w-full"
          />
        </div>
      </div>
    </div>
  );
}
