"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  getTotalTons,
  getDivertedTons,
  getDiversionRate,
  formatNumber,
} from "@/lib/diversion-calculations";
import type { MaterialStream, DiversionReport } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MATERIAL_PRESETS = [
  "Cardboard",
  "Mixed Paper",
  "Food Waste / Organics",
  "Metal",
  "Glass",
  "Plastic (#1–7)",
  "E-Waste",
  "Textiles",
  "Construction & Demolition",
  "Mixed Recycling",
  "Trash / Landfill",
  "Other",
];

const CATEGORY_OPTIONS: Array<{ value: MaterialStream["category"]; label: string }> = [
  { value: "recycling", label: "Recycling" },
  { value: "organics",  label: "Organics"  },
  { value: "landfill",  label: "Landfill"  },
  { value: "other",     label: "Other"     },
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

function emptyStream(): MaterialStream {
  return { material: "Cardboard", quantity: 0, unit: "tons", category: "recycling", diverted: true };
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  userId: string;
  /** When provided, the form is in edit mode. */
  report?: DiversionReport;
  /** URL of the most recent logo the user has uploaded across any report. */
  previousLogoUrl?: string | null;
  /** Hauler name from the most recent report, used as a hint. */
  previousHaulerName?: string | null;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ReportForm({ userId, report, previousLogoUrl, previousHaulerName }: Props) {
  const router = useRouter();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const isEdit = !!report;

  // ── Section 1: Report Info
  const [reportName,   setReportName]   = useState(report?.report_name   ?? "");
  const [periodStart,  setPeriodStart]  = useState(report?.period_start  ?? "");
  const [periodEnd,    setPeriodEnd]    = useState(report?.period_end     ?? "");

  // ── Section 2: Hauler Info
  const [haulerName,    setHaulerName]   = useState(report?.hauler_name    ?? previousHaulerName ?? "");
  const [haulerLogoUrl, setHaulerLogoUrl]= useState(report?.hauler_logo_url ?? "");
  const [logoUploading, setLogoUploading]= useState(false);
  const [logoPreview,   setLogoPreview]  = useState(report?.hauler_logo_url ?? "");
  // Offer to reuse the previous logo only in create mode when one exists
  const showPreviousLogoOffer = !isEdit && !!previousLogoUrl && !logoPreview;

  // ── Section 3: Customer Info
  const [customerName,    setCustomerName]    = useState(report?.customer_name    ?? "");
  const [serviceAddress,  setServiceAddress]  = useState(report?.service_address  ?? "");
  const [serviceCity,     setServiceCity]     = useState(report?.service_city     ?? "");
  const [serviceState,    setServiceState]    = useState(report?.service_state    ?? "");
  const [serviceZip,      setServiceZip]      = useState(report?.service_zip      ?? "");

  // ── Section 4: Material Streams
  const [streams, setStreams] = useState<MaterialStream[]>(
    report?.material_streams?.length ? report.material_streams : [emptyStream()]
  );

  // ── Section 5: Notes
  const [notes, setNotes] = useState(report?.notes ?? "");

  // ── Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // ── Logo upload ───────────────────────────────────────────────────────────────

  async function handleLogoFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Logo must be an image file.");
      return;
    }
    setLogoUploading(true);
    setError(null);
    const supabase = createClient();
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("report-logos")
      .upload(path, file, { upsert: true });
    if (upErr) {
      setError(`Logo upload failed: ${upErr.message}`);
      setLogoUploading(false);
      return;
    }
    const { data: { publicUrl } } = supabase.storage.from("report-logos").getPublicUrl(path);
    setHaulerLogoUrl(publicUrl);
    setLogoPreview(publicUrl);
    setLogoUploading(false);
  }

  function handleLogoDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleLogoFile(file);
  }

  // ── Material stream helpers ───────────────────────────────────────────────────

  function addStream() {
    setStreams((prev) => [...prev, emptyStream()]);
  }

  function removeStream(idx: number) {
    setStreams((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateStream<K extends keyof MaterialStream>(idx: number, key: K, val: MaterialStream[K]) {
    setStreams((prev) => prev.map((s, i) => (i === idx ? { ...s, [key]: val } : s)));
  }

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      report_name:     reportName.trim(),
      hauler_name:     haulerName.trim(),
      hauler_logo_url: haulerLogoUrl || null,
      customer_name:   customerName.trim(),
      service_address: serviceAddress.trim(),
      service_city:    serviceCity.trim() || null,
      service_state:   serviceState || null,
      service_zip:     serviceZip.trim() || null,
      period_start:    periodStart,
      period_end:      periodEnd,
      material_streams: streams.map((s) => ({
        ...s,
        quantity: Number(s.quantity),
      })),
      notes: notes.trim() || null,
    };

    try {
      const url    = isEdit ? `/api/reports/${report!.id}` : "/api/reports";
      const method = isEdit ? "PATCH" : "POST";
      const res    = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save report");
      const id = isEdit ? report!.id : json.id;
      router.push(`/reports/${id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setSubmitting(false);
    }
  }

  // ── Running totals ────────────────────────────────────────────────────────────

  const totalTons    = getTotalTons(streams);
  const divertedTons = getDivertedTons(streams);
  const divRate      = getDiversionRate(streams);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* Section 1: Report Info */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          Report Info
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Report Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="e.g. Q1 2025 – Whole Foods Tribeca"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Period Start <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Period End <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                required
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Hauler Info */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          Hauler Information
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Company Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={haulerName}
              onChange={(e) => setHaulerName(e.target.value)}
              placeholder="Your hauling company name"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Company Logo
            </label>

            {/* ── Offer to reuse previous logo (create mode only) ── */}
            {showPreviousLogoOffer && (
              <div className="mb-3 flex items-center gap-3 rounded-lg border border-[#2D6A4F]/20 bg-[#2D6A4F]/5 px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previousLogoUrl!}
                  alt="Previous logo"
                  className="h-10 w-auto object-contain rounded bg-white border border-gray-100 p-1 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">Use logo from previous report?</p>
                  <p className="text-xs text-gray-500 truncate">{previousHaulerName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setHaulerLogoUrl(previousLogoUrl!);
                    setLogoPreview(previousLogoUrl!);
                  }}
                  className="shrink-0 inline-flex h-8 items-center px-3 rounded-lg bg-[#2D6A4F] text-white text-xs font-medium hover:bg-[#245a42] transition-colors"
                >
                  Use this logo
                </button>
              </div>
            )}

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleLogoDrop}
              onClick={() => logoInputRef.current?.click()}
              className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-[#2D6A4F]/40 hover:bg-gray-50 transition-colors"
            >
              {logoPreview ? (
                <div className="flex items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoPreview} alt="Logo preview" className="h-14 w-auto object-contain rounded" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setLogoPreview(""); setHaulerLogoUrl(""); }}
                    className="ml-auto text-gray-400 hover:text-red-500"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : logoUploading ? (
                <div className="flex items-center justify-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Uploading…
                </div>
              ) : (
                <div className="text-gray-400 text-sm">
                  <Upload className="size-5 mx-auto mb-2" />
                  Drag & drop or click to upload logo
                </div>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); }}
            />
          </div>
        </div>
      </section>

      {/* Section 3: Customer Info */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          Customer Information
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer / Account Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Whole Foods Market – Tribeca"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Service Address <span className="text-red-500">*</span>
            </label>
            <Input
              value={serviceAddress}
              onChange={(e) => setServiceAddress(e.target.value)}
              placeholder="123 Main Street"
              required
            />
          </div>
          <div className="grid grid-cols-6 gap-3">
            <div className="col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <Input
                value={serviceCity}
                onChange={(e) => setServiceCity(e.target.value)}
                placeholder="New York"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
              <select
                value={serviceState}
                onChange={(e) => setServiceState(e.target.value)}
                className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
              >
                <option value="">—</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
              <Input
                value={serviceZip}
                onChange={(e) => setServiceZip(e.target.value)}
                placeholder="10013"
                maxLength={10}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Material Streams */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          Material Streams
        </h2>

        <div className="space-y-2">
          {/* Table header */}
          <div className="hidden sm:grid grid-cols-[2fr_1fr_80px_1fr_80px_40px] gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            <span>Material</span>
            <span>Quantity</span>
            <span>Unit</span>
            <span>Category</span>
            <span className="text-center">Diverted?</span>
            <span />
          </div>

          {streams.map((stream, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_80px_1fr_80px_40px] gap-2 items-center bg-gray-50 rounded-lg p-3 sm:p-2 sm:bg-transparent sm:rounded-none sm:border-b sm:border-gray-100 last:border-0"
            >
              {/* Material */}
              <div>
                <label className="sm:hidden text-xs font-medium text-gray-500 mb-1 block">Material</label>
                {stream.material === "Other" ? (
                  <Input
                    value={stream.material === "Other" ? "" : stream.material}
                    onChange={(e) => updateStream(idx, "material", e.target.value || "Other")}
                    placeholder="Custom material name"
                  />
                ) : (
                  <select
                    value={MATERIAL_PRESETS.includes(stream.material) ? stream.material : "Other"}
                    onChange={(e) => updateStream(idx, "material", e.target.value)}
                    className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
                  >
                    {MATERIAL_PRESETS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Quantity */}
              <div>
                <label className="sm:hidden text-xs font-medium text-gray-500 mb-1 block">Quantity</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={stream.quantity || ""}
                  onChange={(e) => updateStream(idx, "quantity", parseFloat(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>

              {/* Unit */}
              <div>
                <label className="sm:hidden text-xs font-medium text-gray-500 mb-1 block">Unit</label>
                <select
                  value={stream.unit}
                  onChange={(e) => updateStream(idx, "unit", e.target.value as "tons" | "lbs")}
                  className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
                >
                  <option value="tons">tons</option>
                  <option value="lbs">lbs</option>
                </select>
              </div>

              {/* Category */}
              <div>
                <label className="sm:hidden text-xs font-medium text-gray-500 mb-1 block">Category</label>
                <select
                  value={stream.category}
                  onChange={(e) => updateStream(idx, "category", e.target.value as MaterialStream["category"])}
                  className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Diverted toggle */}
              <div className="flex items-center sm:justify-center gap-2">
                <label className="sm:hidden text-xs font-medium text-gray-500">Diverted?</label>
                <button
                  type="button"
                  onClick={() => updateStream(idx, "diverted", !stream.diverted)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                    stream.diverted ? "bg-[#2D6A4F]" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      stream.diverted ? "translate-x-4.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Delete */}
              <div className="flex justify-end sm:justify-center">
                <button
                  type="button"
                  onClick={() => removeStream(idx)}
                  disabled={streams.length === 1}
                  className="text-gray-300 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addStream}
          className="mt-3 gap-1.5"
        >
          <Plus className="size-3.5" /> Add Material Stream
        </Button>

        {/* Running totals */}
        {streams.some((s) => s.quantity > 0) && (
          <div className="mt-4 bg-[#2D6A4F]/5 border border-[#2D6A4F]/20 rounded-lg p-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-0.5">Total Managed</p>
              <p className="text-lg font-bold text-gray-900">{formatNumber(totalTons)} t</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-0.5">Total Diverted</p>
              <p className="text-lg font-bold text-[#2D6A4F]">{formatNumber(divertedTons)} t</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-0.5">Diversion Rate</p>
              <p className="text-lg font-bold text-gray-900">{formatNumber(divRate, 0)}%</p>
            </div>
          </div>
        )}
      </section>

      {/* Section 5: Notes */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          Notes <span className="text-gray-400 font-normal text-sm">(optional)</span>
        </h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Any additional context for the customer…"
          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F] resize-none"
        />
      </section>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {/* Submit */}
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={submitting}
          className="bg-[#2D6A4F] hover:bg-[#245a42] text-white"
        >
          {submitting && <Loader2 className="size-4 animate-spin mr-2" />}
          {isEdit ? "Save Changes" : "Save Report"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
