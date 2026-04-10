"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const STATE_OPTIONS = [
  { code: "CT", name: "Connecticut" },
  { code: "ME", name: "Maine" },
  { code: "MA", name: "Massachusetts" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NY", name: "New York" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "VT", name: "Vermont" },
];

const HAULER_SERVICE_TYPES = [
  { value: "residential",  label: "Residential Pickup" },
  { value: "commercial",   label: "Commercial Pickup" },
  { value: "roll_off",     label: "Roll-Off Containers" },
  { value: "industrial",   label: "Industrial Waste" },
  { value: "recycling",    label: "Recycling Services" },
  { value: "composting",   label: "Composting" },
  { value: "hazmat",       label: "Hazardous Waste" },
  { value: "e_waste",      label: "E-Waste / Electronics" },
  { value: "medical",      label: "Medical Waste" },
];

const FACILITY_TYPES = [
  { value: "landfill",        label: "Landfill" },
  { value: "transfer_station", label: "Transfer Station" },
  { value: "mrf",             label: "MRF (Materials Recovery Facility)" },
  { value: "composting",      label: "Composting Facility" },
  { value: "wte",             label: "Waste-to-Energy" },
  { value: "hazardous_waste", label: "Hazardous Waste Facility" },
  { value: "cd_facility",     label: "C&D Debris Facility" },
  { value: "incinerator",     label: "Incinerator" },
];

const FACILITY_MATERIALS = [
  { value: "msw",       label: "Municipal Solid Waste" },
  { value: "recycling", label: "Recycling" },
  { value: "cd",        label: "C&D Debris" },
  { value: "organics",  label: "Organics / Food Waste" },
  { value: "hazardous", label: "Hazardous Waste" },
  { value: "special",   label: "Special Waste" },
];

type SubmissionType = "hauler" | "facility";

export default function SubmitPage() {
  const [type, setType] = useState<SubmissionType>("hauler");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // Common fields
  const [companyName, setCompanyName] = useState("");
  const [address,     setAddress]     = useState("");
  const [city,        setCity]        = useState("");
  const [state,       setState]       = useState("");
  const [zip,         setZip]         = useState("");
  const [phone,       setPhone]       = useState("");
  const [email,       setEmail]       = useState("");
  const [website,     setWebsite]     = useState("");
  const [notes,       setNotes]       = useState("");

  // Hauler-specific
  const [serviceTypes,  setServiceTypes]  = useState<string[]>([]);
  const [serviceStates, setServiceStates] = useState<string[]>([]);
  const [licenseNumber, setLicenseNumber] = useState("");

  // Facility-specific
  const [facilityType,       setFacilityType]       = useState("");
  const [acceptedMaterials,  setAcceptedMaterials]  = useState<string[]>([]);

  const toggleArr = (arr: string[], val: string, set: (v: string[]) => void) => {
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      setError("Company / facility name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_type:    type,
          company_name:       companyName,
          address,
          city,
          state,
          zip,
          phone,
          email,
          website,
          notes,
          // hauler-specific
          service_types:   type === "hauler" ? serviceTypes  : undefined,
          service_states:  type === "hauler" ? serviceStates : undefined,
          license_number:  type === "hauler" ? licenseNumber : undefined,
          // facility-specific
          facility_type:      type === "facility" ? facilityType      : undefined,
          accepted_materials: type === "facility" ? acceptedMaterials : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? "Something went wrong. Please try again.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-[#2D6A4F]/10 flex items-center justify-center mx-auto mb-5">
          <CheckCircle className="size-8 text-[#2D6A4F]" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Submission received!</h1>
        <p className="text-gray-500 mb-8">
          Thank you! We&apos;ll review your submission and add it to the directory within a few business days.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/directory"
            className="inline-flex h-10 items-center px-5 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
          >
            Browse haulers
          </Link>
          <button
            onClick={() => {
              setSubmitted(false);
              setCompanyName(""); setAddress(""); setCity(""); setState(""); setZip("");
              setPhone(""); setEmail(""); setWebsite(""); setNotes("");
              setServiceTypes([]); setServiceStates([]); setLicenseNumber("");
              setFacilityType(""); setAcceptedMaterials([]);
            }}
            className="inline-flex h-10 items-center px-5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <Link
        href="/directory"
        className="inline-flex items-center gap-1.5 text-sm text-[#2D6A4F] hover:underline mb-6"
      >
        <ArrowLeft className="size-4" />
        Back to directory
      </Link>

      <div className="mb-7">
        <h1 className="text-2xl font-bold text-gray-900">Submit a Missing Listing</h1>
        <p className="text-gray-500 text-sm mt-1">
          Know a hauler or facility that isn&apos;t listed? Submit it here and we&apos;ll review and add it.
          No login required.
        </p>
      </div>

      {/* Type toggle */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-7 max-w-xs">
        {(["hauler", "facility"] as SubmissionType[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors capitalize ${
              type === t
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "hauler" ? "Waste Hauler" : "Disposal Facility"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Common fields */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            Basic Information
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {type === "hauler" ? "Company Name" : "Facility Name"} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              placeholder={type === "hauler" ? "Smith Waste Services" : "Regional Landfill Authority"}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                State <span className="text-red-500">*</span>
              </label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                required
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F] bg-white"
              >
                <option value="">Select state…</option>
                {STATE_OPTIONS.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Burlington"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
              <input
                type="text"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="05401"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(802) 555-5555"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://example.com"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
              />
            </div>
          </div>

          {type === "hauler" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="info@smithwaste.com"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
              />
            </div>
          )}
        </div>

        {/* Hauler-specific */}
        {type === "hauler" && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                Services
              </h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Services Offered
                </label>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                  {HAULER_SERVICE_TYPES.map((s) => (
                    <label key={s.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={serviceTypes.includes(s.value)}
                        onChange={() => toggleArr(serviceTypes, s.value, setServiceTypes)}
                        className="size-4 rounded border-gray-300 accent-[#2D6A4F]"
                      />
                      <span className="text-sm text-gray-700">{s.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  States Served
                </label>
                <div className="grid grid-cols-3 gap-y-2 gap-x-4">
                  {STATE_OPTIONS.map((s) => (
                    <label key={s.code} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={serviceStates.includes(s.code)}
                        onChange={() => toggleArr(serviceStates, s.code, setServiceStates)}
                        className="size-4 rounded border-gray-300 accent-[#2D6A4F]"
                      />
                      <span className="text-sm text-gray-700">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  License / Permit Number <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="e.g. A-901-12345"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
                />
              </div>
            </div>
          </>
        )}

        {/* Facility-specific */}
        {type === "facility" && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
              Facility Details
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Facility Type
              </label>
              <select
                value={facilityType}
                onChange={(e) => setFacilityType(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F] bg-white"
              >
                <option value="">Select type…</option>
                {FACILITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Materials Accepted
              </label>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                {FACILITY_MATERIALS.map((m) => (
                  <label key={m.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acceptedMaterials.includes(m.value)}
                      onChange={() => toggleArr(acceptedMaterials, m.value, setAcceptedMaterials)}
                      className="size-4 rounded border-gray-300 accent-[#2D6A4F]"
                    />
                    <span className="text-sm text-gray-700">{m.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-3">
            Additional Notes
          </h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything else that would help us verify or add this listing..."
            rows={3}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F] resize-none"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={submitting}
            className="bg-[#2D6A4F] hover:bg-[#245a42] text-white h-11 px-8"
          >
            {submitting ? (
              <><Loader2 className="size-4 animate-spin mr-2" />Submitting…</>
            ) : (
              "Submit listing"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
