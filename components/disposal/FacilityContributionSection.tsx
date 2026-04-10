"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Material options grouped by category
const MATERIAL_GROUPS = [
  {
    label: "Recyclables",
    items: [
      { code: "paper",       label: "Paper / Cardboard" },
      { code: "glass",       label: "Glass" },
      { code: "metal",       label: "Metal / Aluminum" },
      { code: "plastics",    label: "Plastics" },
      { code: "ewaste",      label: "Electronics / E-Waste" },
    ],
  },
  {
    label: "Organics",
    items: [
      { code: "food_waste",  label: "Food Waste" },
      { code: "yard_waste",  label: "Yard Waste / Brush" },
      { code: "wood_waste",  label: "Wood Waste" },
      { code: "leaves_grass", label: "Leaves / Grass" },
    ],
  },
  {
    label: "Construction & Demolition",
    items: [
      { code: "concrete",   label: "Concrete" },
      { code: "asphalt",    label: "Asphalt" },
      { code: "brick",      label: "Brick & Block" },
      { code: "drywall",    label: "Drywall / Gypsum" },
      { code: "tires",      label: "Tires" },
    ],
  },
  {
    label: "Special Waste",
    items: [
      { code: "petro_soil", label: "Petroleum Contaminated Soil" },
      { code: "used_oil",   label: "Used Oil" },
      { code: "batteries",  label: "Batteries" },
      { code: "lamps",      label: "Lamps / Fluorescent" },
      { code: "paint",      label: "Paint" },
    ],
  },
];

// Flat lookup: code -> label
const CODE_TO_LABEL = Object.fromEntries(
  MATERIAL_GROUPS.flatMap((g) => g.items.map((i) => [i.code, i.label]))
);

type Props = {
  facilitySlug: string;
  isLoggedIn:   boolean;
};

export function FacilityContributionSection({ facilitySlug, isLoggedIn }: Props) {
  const [expanded, setExpanded]   = useState(false);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [notes, setNotes]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.size === 0) {
      setError("Please select at least one material.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const codes = Array.from(selected);
    const descriptions = codes.map((c) => CODE_TO_LABEL[c] ?? c);
    try {
      const res = await fetch(`/api/disposal/${facilitySlug}/contribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material_codes: codes, material_descriptions: descriptions, notes }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? "Something went wrong.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            Community-Suggested Materials
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Know what this facility accepts? Help others by submitting materials.
          </p>
        </div>
        {!submitted && (
          <button
            onClick={() => setExpanded((o) => !o)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2D6A4F] hover:underline shrink-0"
          >
            Suggest Materials
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        )}
      </div>

      {submitted && (
        <div className="flex items-center gap-2 mt-4 text-[#2D6A4F]">
          <CheckCircle className="size-5" />
          <p className="text-sm font-medium">
            Thank you! Your material suggestions have been submitted for review.
          </p>
        </div>
      )}

      {!submitted && expanded && (
        <form onSubmit={handleSubmit} className="mt-5">
          {!isLoggedIn ? (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-center">
              <p className="text-sm text-gray-600 mb-3">Log in to suggest materials.</p>
              <a
                href="/login"
                className="inline-flex h-8 items-center px-4 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
              >
                Log in
              </a>
            </div>
          ) : (
            <>
              <div className="space-y-5">
                {MATERIAL_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {group.label}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4">
                      {group.items.map((item) => (
                        <label key={item.code} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected.has(item.code)}
                            onChange={() => toggle(item.code)}
                            className="size-4 rounded border-gray-300 accent-[#2D6A4F]"
                          />
                          <span className="text-sm text-gray-700">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Notes <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional details about materials or restrictions..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F] resize-none"
                />
              </div>

              {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

              <div className="flex justify-end gap-2 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setExpanded(false); setSelected(new Set()); setNotes(""); setError(null); }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitting || selected.size === 0}
                  className="bg-[#2D6A4F] hover:bg-[#245a42] text-white"
                >
                  {submitting ? (
                    <><Loader2 className="size-3.5 animate-spin mr-1.5" />Submitting…</>
                  ) : (
                    `Submit ${selected.size > 0 ? `(${selected.size})` : ""}`
                  )}
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
