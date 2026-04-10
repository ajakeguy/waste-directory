"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ChevronDown, X, CheckCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Service type definitions
// ---------------------------------------------------------------------------

const SERVICE_TYPES: { value: string; label: string }[] = [
  { value: "residential_pickup",    label: "Residential Pickup" },
  { value: "commercial_pickup",     label: "Commercial Pickup" },
  { value: "roll_off_dumpster",     label: "Roll-Off Dumpster" },
  { value: "front_load_container",  label: "Front-Load Container" },
  { value: "organics_composting",   label: "Organics / Composting" },
  { value: "ewaste",                label: "E-Waste / Electronics" },
  { value: "hazardous_waste",       label: "Hazardous Waste" },
  { value: "recycling",             label: "Recycling" },
  { value: "document_shredding",    label: "Document Shredding" },
  { value: "bulk_item_removal",     label: "Bulk Item Removal" },
  { value: "junk_removal",          label: "Junk Removal" },
  { value: "construction_debris",   label: "Construction Debris" },
  { value: "industrial_waste",      label: "Industrial Waste" },
];

// ---------------------------------------------------------------------------
// Static municipality suggestions per state (top ~20 each)
// ---------------------------------------------------------------------------

const MUNICIPALITIES: Record<string, string[]> = {
  CT: [
    "Bridgeport", "Hartford", "New Haven", "Stamford", "Waterbury",
    "Norwalk", "Danbury", "New Britain", "West Haven", "Meriden",
    "Bristol", "Milford", "Middletown", "Shelton", "Torrington",
    "Norwich", "Naugatuck", "Trumbull", "Greenwich", "Stratford",
  ],
  ME: [
    "Portland", "Lewiston", "Bangor", "South Portland", "Auburn",
    "Biddeford", "Sanford", "Saco", "Augusta", "Westbrook",
    "Waterville", "Brewer", "Presque Isle", "Bath", "Caribou",
    "Ellsworth", "Old Town", "Rockland", "Belfast", "Gardiner",
  ],
  MA: [
    "Boston", "Worcester", "Springfield", "Lowell", "Cambridge",
    "New Bedford", "Brockton", "Quincy", "Lynn", "Fall River",
    "Newton", "Somerville", "Framingham", "Lawrence", "Haverhill",
    "Waltham", "Malden", "Brookline", "Plymouth", "Medford",
  ],
  NH: [
    "Manchester", "Nashua", "Concord", "Derry", "Dover",
    "Rochester", "Salem", "Merrimack", "Hudson", "Londonderry",
    "Keene", "Bedford", "Portsmouth", "Goffstown", "Laconia",
    "Hampton", "Milford", "Durham", "Exeter", "Windham",
  ],
  NJ: [
    "Newark", "Jersey City", "Paterson", "Elizabeth", "Edison",
    "Woodbridge", "Lakewood", "Toms River", "Hamilton", "Trenton",
    "Clifton", "Camden", "Brick", "Cherry Hill", "Passaic",
    "Middletown", "Union City", "Old Bridge", "Gloucester Township", "East Orange",
  ],
  NY: [
    "New York City", "Buffalo", "Rochester", "Yonkers", "Syracuse",
    "Albany", "New Rochelle", "Mount Vernon", "Schenectady", "Utica",
    "White Plains", "Hempstead", "Troy", "Niagara Falls", "Binghamton",
    "Freeport", "Valley Stream", "Long Beach", "Spring Valley", "Ithaca",
  ],
  PA: [
    "Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading",
    "Scranton", "Bethlehem", "Lancaster", "Harrisburg", "Altoona",
    "York", "Wilkes-Barre", "Chester", "Easton", "Lebanon",
    "Hazelton", "Norristown", "McKeesport", "Johnstown", "Pottsville",
  ],
  RI: [
    "Providence", "Cranston", "Warwick", "Pawtucket", "East Providence",
    "Woonsocket", "Coventry", "Cumberland", "North Providence", "South Kingstown",
    "West Warwick", "Johnston", "North Kingstown", "Newport", "Bristol",
    "Westerly", "Smithfield", "Lincoln", "Central Falls", "Portsmouth",
  ],
  VT: [
    "Burlington", "Essex", "Rutland", "South Burlington", "Colchester",
    "Bennington", "Brattleboro", "Hartford", "Shelburne", "Milton",
    "Barre", "Montpelier", "Williston", "Winooski", "St. Albans",
    "Middlebury", "Springfield", "St. Johnsbury", "Newport", "Morristown",
  ],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Contribution {
  id: string;
  service_types: string[];
  service_municipalities: string[];
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

interface Props {
  orgId: string;
  stateCode: string;
  isLoggedIn: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContributionSection({ orgId, stateCode, isLoggedIn }: Props) {
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loadingContributions, setLoadingContributions] = useState(true);
  const [showForm, setShowForm]       = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Form state
  const [selectedServices, setSelectedServices]         = useState<string[]>([]);
  const [municipalities, setMunicipalities]             = useState<string[]>([]);
  const [municipalityInput, setMunicipalityInput]       = useState("");
  const [municipalitySuggestions, setMunicipalitySuggestions] = useState<string[]>([]);
  const [notes, setNotes]                               = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = MUNICIPALITIES[stateCode.toUpperCase()] ?? [];

  // ── Load existing contributions on mount ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingContributions(true);

    fetch(`/api/haulers/${orgId}/contribute`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const data: Contribution[] = json.data ?? [];
        setContributions(data);

        // Pre-fill form if user has a pending/approved contribution
        if (isLoggedIn && data.length > 0) {
          // The server already scopes own contributions regardless of status
          const own = data[0]; // most recent first
          if (own) {
            setSelectedServices(own.service_types ?? []);
            setMunicipalities(own.service_municipalities ?? []);
            setNotes(own.notes ?? "");
          }
        }
      })
      .catch(() => {/* silently ignore */})
      .finally(() => {
        if (!cancelled) setLoadingContributions(false);
      });

    return () => { cancelled = true; };
  }, [orgId, isLoggedIn]);

  // ── Municipality tag input ────────────────────────────────────────────────
  const handleMunicipalityInput = useCallback(
    (value: string) => {
      setMunicipalityInput(value);

      if (!value.trim()) {
        setMunicipalitySuggestions([]);
        return;
      }

      const lower = value.toLowerCase();
      const filtered = suggestions
        .filter(
          (s) =>
            s.toLowerCase().includes(lower) &&
            !municipalities.includes(s)
        )
        .slice(0, 6);
      setMunicipalitySuggestions(filtered);
    },
    [suggestions, municipalities]
  );

  const addMunicipality = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || municipalities.includes(trimmed)) return;
      setMunicipalities((prev) => [...prev, trimmed]);
      setMunicipalityInput("");
      setMunicipalitySuggestions([]);
      inputRef.current?.focus();
    },
    [municipalities]
  );

  const removeMunicipality = useCallback((name: string) => {
    setMunicipalities((prev) => prev.filter((m) => m !== name));
  }, []);

  const handleMunicipalityKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        addMunicipality(municipalityInput);
      } else if (
        e.key === "Backspace" &&
        !municipalityInput &&
        municipalities.length > 0
      ) {
        setMunicipalities((prev) => prev.slice(0, -1));
      }
    },
    [municipalityInput, municipalities, addMunicipality]
  );

  // ── Service type toggle ───────────────────────────────────────────────────
  const toggleService = useCallback((value: string) => {
    setSelectedServices((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    );
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);

      try {
        const res = await fetch(`/api/haulers/${orgId}/contribute`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_types:          selectedServices,
            service_municipalities: municipalities,
            notes:                  notes.trim() || null,
          }),
        });

        if (res.ok) {
          setSubmitSuccess(true);
          setShowForm(false);
          // Refresh contributions list
          const json = await fetch(`/api/haulers/${orgId}/contribute`).then(
            (r) => r.json()
          );
          setContributions(json.data ?? []);
        }
      } catch {/* silently ignore */}
      finally {
        setSubmitting(false);
      }
    },
    [orgId, selectedServices, municipalities, notes]
  );

  const approvedCount = contributions.filter(
    (c) => c.status === "approved"
  ).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      {/* Section header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-900">Know this hauler?</h2>
          {!loadingContributions && approvedCount > 0 && (
            <Badge
              variant="secondary"
              className="text-xs bg-[#2D6A4F]/10 text-[#2D6A4F] border-0"
            >
              {approvedCount} community{" "}
              {approvedCount === 1 ? "contribution" : "contributions"}
            </Badge>
          )}
        </div>

        {isLoggedIn ? (
          <button
            type="button"
            onClick={() => {
              setShowForm((v) => !v);
              setSubmitSuccess(false);
            }}
            className="flex items-center gap-1.5 text-sm font-medium text-[#2D6A4F] hover:text-[#1d4d38] transition-colors"
          >
            {showForm ? "Cancel" : "Add Services & Coverage"}
            {!showForm && <ChevronDown className="size-4" />}
          </button>
        ) : (
          <Link
            href="/login"
            className="text-sm text-[#2D6A4F] hover:text-[#1d4d38] underline underline-offset-4 transition-colors"
          >
            Login to add services &amp; coverage
          </Link>
        )}
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Help improve this listing by sharing what services this hauler provides
        and which towns they serve.
      </p>

      {/* Success message */}
      {submitSuccess && (
        <div className="flex items-center gap-2 text-sm text-[#2D6A4F] bg-[#2D6A4F]/8 rounded-lg px-4 py-3 mb-4">
          <CheckCircle className="size-4 shrink-0" />
          <span>
            Thank you! Your contribution has been submitted for review.
          </span>
        </div>
      )}

      {/* Inline form */}
      {showForm && isLoggedIn && (
        <form onSubmit={handleSubmit} className="space-y-5 border-t border-gray-100 pt-5">
          {/* Service types */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              Services Offered
            </p>
            <div className="flex flex-wrap gap-2">
              {SERVICE_TYPES.map(({ value, label }) => {
                const selected = selectedServices.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleService(value)}
                    className={[
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      selected
                        ? "bg-[#2D6A4F] text-white border-[#2D6A4F]"
                        : "bg-white text-gray-600 border-gray-200 hover:border-[#2D6A4F] hover:text-[#2D6A4F]",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Municipality tag input */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1.5">
              Towns / Municipalities Served
            </p>
            <p className="text-xs text-gray-400 mb-2">
              Type a town name and press Enter or comma to add it.
            </p>

            {/* Tag container */}
            <div className="relative">
              <div
                className={[
                  "flex flex-wrap gap-1.5 min-h-[42px] px-3 py-2 rounded-lg border bg-white",
                  "focus-within:ring-2 focus-within:ring-[#2D6A4F]/30 focus-within:border-[#2D6A4F]",
                  "border-gray-200 transition-colors",
                ].join(" ")}
                onClick={() => inputRef.current?.focus()}
              >
                {municipalities.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#2D6A4F]/10 text-[#2D6A4F] text-xs font-medium"
                  >
                    {m}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeMunicipality(m);
                      }}
                      className="hover:text-[#1d4d38] transition-colors"
                      aria-label={`Remove ${m}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <input
                  ref={inputRef}
                  type="text"
                  value={municipalityInput}
                  onChange={(e) => handleMunicipalityInput(e.target.value)}
                  onKeyDown={handleMunicipalityKeyDown}
                  onBlur={() =>
                    setTimeout(() => setMunicipalitySuggestions([]), 150)
                  }
                  placeholder={
                    municipalities.length === 0 ? "e.g. Burlington, Essex..." : ""
                  }
                  className="flex-1 min-w-[120px] outline-none text-sm bg-transparent text-gray-800 placeholder:text-gray-400"
                />
              </div>

              {/* Dropdown suggestions */}
              {municipalitySuggestions.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-md overflow-hidden">
                  {municipalitySuggestions.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addMunicipality(s);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-[#2D6A4F]/8 hover:text-[#2D6A4F] transition-colors"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="contribution-notes"
              className="text-sm font-medium text-gray-700 mb-1.5 block"
            >
              Additional Notes{" "}
              <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              id="contribution-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any other details about this hauler's services, schedules, or coverage area…"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F] transition-colors"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#1d4d38] disabled:opacity-60 transition-colors"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? "Submitting…" : "Submit Contribution"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Approved contributions list */}
      {!loadingContributions && approvedCount > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
          {contributions
            .filter((c) => c.status === "approved")
            .map((c) => (
              <div key={c.id} className="text-sm text-gray-600">
                {c.service_types && c.service_types.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {c.service_types.map((s) => {
                      const label =
                        SERVICE_TYPES.find((t) => t.value === s)?.label ?? s;
                      return (
                        <Badge key={s} variant="outline" className="text-xs">
                          {label}
                        </Badge>
                      );
                    })}
                  </div>
                )}
                {c.service_municipalities && c.service_municipalities.length > 0 && (
                  <p className="text-xs text-gray-500">
                    Serves: {c.service_municipalities.join(", ")}
                  </p>
                )}
                {c.notes && (
                  <p className="text-xs text-gray-500 mt-1 italic">{c.notes}</p>
                )}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
