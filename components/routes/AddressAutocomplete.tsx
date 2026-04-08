"use client";

/**
 * components/routes/AddressAutocomplete.tsx
 *
 * Address input with ORS Pelias autocomplete dropdown.
 * Suggestions include coordinates — no second geocode call needed on selection.
 * When locationType is provided, saved locations are fetched and shown above
 * ORS suggestions, and a "Save this location" button appears after geocoding.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, CheckCircle2, XCircle, Circle, Bookmark } from "lucide-react";

const ORS_AUTOCOMPLETE =
  "https://api.openrouteservice.org/geocode/autocomplete";

type Suggestion = {
  label: string;       // full address string
  name: string;        // short name (street + number)
  locality: string;    // city
  region: string;      // state abbreviation
  lat: number;
  lng: number;
};

type SavedLocation = {
  id: string;
  name: string;
  address: string;
  type: "depot" | "disposal" | "both";
  lat: number | null;
  lng: number | null;
};

export type GeocodeState = "idle" | "loading" | "ok" | "error";

type Props = {
  value: string;
  placeholder?: string;
  className?: string;
  geocodeState?: GeocodeState;
  geocodeError?: string | null;
  /** When provided, saved locations of this type are shown and a save button appears */
  locationType?: "depot" | "disposal" | "both";
  onChange: (value: string) => void;
  /** Called when an address is resolved (either via suggestion click or manual blur) */
  onResolved: (address: string, lat: number, lng: number) => void;
  /** Called when the field is cleared or the address changes without resolution */
  onCleared: () => void;
};

function StatusIcon({ state, error }: { state: GeocodeState; error?: string | null }) {
  if (state === "loading") return <Loader2 className="size-4 text-gray-400 animate-spin shrink-0" />;
  if (state === "ok")      return <CheckCircle2 className="size-4 text-green-500 shrink-0" />;
  if (state === "error")   return (
    <span title={error ?? "Geocoding failed"} className="cursor-help shrink-0">
      <XCircle className="size-4 text-red-400" />
    </span>
  );
  return <Circle className="size-3.5 text-gray-300 shrink-0" />;
}

export function AddressAutocomplete({
  value,
  placeholder,
  className = "",
  geocodeState = "idle",
  geocodeError,
  locationType,
  onChange,
  onResolved,
  onCleared,
}: Props) {
  const [suggestions,    setSuggestions]    = useState<Suggestion[]>([]);
  const [open,           setOpen]           = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [activeIdx,      setActiveIdx]      = useState(-1);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  // Save-location UI (shown when geocodeState === "ok" and locationType is set)
  const [showSaveForm,   setShowSaveForm]   = useState(false);
  const [saveName,       setSaveName]       = useState("");
  const [savingLoc,      setSavingLoc]      = useState(false);
  const [locSaved,       setLocSaved]       = useState(false);
  // Track geocoded coords for saving
  const resolvedCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);

  // ── Fetch saved locations on mount ───────────────────────────────────────────

  useEffect(() => {
    if (!locationType) return;
    fetch(`/api/locations?type=${locationType}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: SavedLocation[]) => setSavedLocations(data))
      .catch(() => {/* not signed in or fetch failed — no saved locations */});
  }, [locationType]);

  // Reset save form whenever the address changes
  useEffect(() => {
    setShowSaveForm(false);
    setLocSaved(false);
    setSaveName("");
    resolvedCoordsRef.current = null;
  }, [value]);

  // ── Fetch autocomplete suggestions ───────────────────────────────────────────

  const fetchSuggestions = useCallback(async (text: string) => {
    const key = process.env.NEXT_PUBLIC_ORS_API_KEY;
    if (!key || text.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    try {
      const url =
        `${ORS_AUTOCOMPLETE}` +
        `?api_key=${encodeURIComponent(key)}` +
        `&text=${encodeURIComponent(text)}` +
        `&boundary.country=US` +
        `&size=5`;
      const res = await fetch(url);
      if (!res.ok) { setSuggestions([]); setOpen(false); return; }

      const json = await res.json() as {
        features?: Array<{
          geometry: { coordinates: [number, number] };
          properties: {
            label?: string;
            name?: string;
            locality?: string;
            region?: string;
          };
        }>;
      };

      const parsed: Suggestion[] = (json.features ?? []).map((f) => ({
        label:    f.properties.label    ?? f.properties.name ?? "",
        name:     f.properties.name     ?? "",
        locality: f.properties.locality ?? "",
        region:   f.properties.region   ?? "",
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      })).filter((s) => s.label);

      setSuggestions(parsed);
      setOpen(parsed.length > 0 || savedLocations.length > 0);
      setActiveIdx(-1);
    } catch {
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, [savedLocations.length]);

  // ── Debounce input changes ────────────────────────────────────────────────────

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    onCleared();

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length >= 3) {
      debounceRef.current = setTimeout(() => fetchSuggestions(v), 300);
    } else {
      setSuggestions([]);
      setOpen(savedLocations.length > 0 && v.trim().length === 0 ? false : false);
    }
  };

  // ── Select a suggestion ───────────────────────────────────────────────────────

  function selectSuggestion(s: Suggestion) {
    onChange(s.label);
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
    resolvedCoordsRef.current = { lat: s.lat, lng: s.lng };
    onResolved(s.label, s.lat, s.lng);
  }

  function selectSavedLocation(loc: SavedLocation) {
    onChange(loc.address);
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
    if (loc.lat != null && loc.lng != null) {
      resolvedCoordsRef.current = { lat: loc.lat, lng: loc.lng };
      onResolved(loc.address, loc.lat, loc.lng);
    } else {
      onCleared();
    }
  }

  async function saveLocation() {
    if (!saveName.trim() || !locationType) return;
    const coords = resolvedCoordsRef.current;
    setSavingLoc(true);
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:    saveName.trim(),
          address: value,
          type:    locationType,
          lat:     coords?.lat ?? null,
          lng:     coords?.lng ?? null,
        }),
      });
      if (res.ok) {
        const newLoc = await res.json() as SavedLocation;
        setSavedLocations((prev) => [newLoc, ...prev]);
        setLocSaved(true);
        setShowSaveForm(false);
        setSaveName("");
      }
    } finally {
      setSavingLoc(false);
    }
  }

  async function deleteSavedLocation(id: string) {
    await fetch(`/api/locations/${id}`, { method: "DELETE" });
    setSavedLocations((prev) => prev.filter((l) => l.id !== id));
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  // ── Close on outside click ────────────────────────────────────────────────────

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ── Derived display state ─────────────────────────────────────────────────────

  const showStatus = geocodeState !== "idle" || loading;
  const effectiveState: GeocodeState = loading ? "loading" : geocodeState;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className={`flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F] ${showStatus ? "pr-9" : ""} ${className}`}
        />
        {showStatus && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <StatusIcon state={effectiveState} error={geocodeError} />
          </div>
        )}
        {!showStatus && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Circle className="size-3 text-gray-200" />
          </div>
        )}
      </div>

      {/* Error message */}
      {geocodeState === "error" && geocodeError && (
        <p className="text-xs text-red-500 mt-1">{geocodeError}</p>
      )}

      {/* Save location button — appears after successful geocode */}
      {locationType && geocodeState === "ok" && !locSaved && (
        <div className="mt-1">
          {!showSaveForm ? (
            <button
              type="button"
              onClick={() => setShowSaveForm(true)}
              className="flex items-center gap-1 text-xs text-[#2D6A4F] hover:underline"
            >
              <Bookmark className="size-3" />
              Save this location
            </button>
          ) : (
            <div className="flex items-center gap-1.5 mt-1">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveLocation()}
                placeholder="Location name (e.g. Main Depot)"
                className="flex-1 h-7 rounded border border-gray-200 bg-white px-2 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#2D6A4F]/40"
                autoFocus
              />
              <button
                type="button"
                onClick={saveLocation}
                disabled={savingLoc || !saveName.trim()}
                className="px-2 h-7 rounded bg-[#2D6A4F] text-white text-xs font-medium disabled:opacity-50"
              >
                {savingLoc ? "…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setShowSaveForm(false)}
                className="px-2 h-7 rounded border border-gray-200 text-xs text-gray-500 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {locationType && geocodeState === "ok" && locSaved && (
        <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
          <Bookmark className="size-3" /> Saved!
        </p>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white rounded-lg border border-gray-200 shadow-lg overflow-hidden">
          {/* Saved locations section */}
          {savedLocations.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Saved Locations
              </p>
              <ul>
                {savedLocations.map((loc) => (
                  <li key={loc.id} className="flex items-center group border-b border-gray-50 last:border-0">
                    <button
                      type="button"
                      className="flex-1 text-left px-3 py-2 text-sm hover:bg-[#2D6A4F]/5 transition-colors"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSavedLocation(loc)}
                    >
                      <p className="font-medium text-[#2D6A4F] truncate">{loc.name}</p>
                      <p className="text-xs text-gray-500 truncate">{loc.address}</p>
                    </button>
                    <button
                      type="button"
                      title="Remove saved location"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => deleteSavedLocation(loc.id)}
                      className="px-2 py-2 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              {suggestions.length > 0 && (
                <p className="px-3 pt-2 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide border-t border-gray-100">
                  Suggestions
                </p>
              )}
            </>
          )}

          {/* ORS suggestions */}
          {suggestions.length === 0 && savedLocations.length === 0 ? (
            <p className="text-sm text-gray-400 px-3 py-2">No addresses found</p>
          ) : (
            <ul>
              {suggestions.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={`w-full text-left px-3 py-2.5 text-sm hover:bg-[#2D6A4F]/5 transition-colors border-b border-gray-50 last:border-0 ${
                      i === activeIdx ? "bg-[#2D6A4F]/8" : ""
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectSuggestion(s)}
                  >
                    <p className="font-medium text-gray-900 truncate">{s.name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {[s.locality, s.region].filter(Boolean).join(", ")}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
