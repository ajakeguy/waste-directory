"use client";

/**
 * components/routes/AddressAutocomplete.tsx
 *
 * Address input with ORS Pelias autocomplete dropdown.
 * Suggestions include coordinates — no second geocode call needed on selection.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";

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

export type GeocodeState = "idle" | "loading" | "ok" | "error";

type Props = {
  value: string;
  placeholder?: string;
  className?: string;
  geocodeState?: GeocodeState;
  geocodeError?: string | null;
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
  onChange,
  onResolved,
  onCleared,
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open,        setOpen]        = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [activeIdx,   setActiveIdx]   = useState(-1);
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);

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
      setOpen(parsed.length > 0);
      setActiveIdx(-1);
    } catch {
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Debounce input changes ────────────────────────────────────────────────────

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    onCleared(); // address changed — coordinates no longer valid

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length >= 3) {
      debounceRef.current = setTimeout(() => fetchSuggestions(v), 300);
    } else {
      setSuggestions([]);
      setOpen(false);
    }
  };

  // ── Select a suggestion ───────────────────────────────────────────────────────

  function selectSuggestion(s: Suggestion) {
    onChange(s.label);
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
    // Coordinates come directly from the autocomplete response — no second call
    onResolved(s.label, s.lat, s.lng);
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
        {/* always show grey dot when idle and empty — subtle affordance */}
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

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white rounded-lg border border-gray-200 shadow-lg overflow-hidden">
          {suggestions.length === 0 ? (
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
                    onMouseDown={(e) => e.preventDefault()} // prevent blur before click
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
