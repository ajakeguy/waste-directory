"use client";

import { useState } from "react";
import { UserPlus, X, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type ContactType = "general" | "billing" | "operations" | "sales" | "emergency";

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  general:    "General",
  billing:    "Billing",
  operations: "Operations",
  sales:      "Sales",
  emergency:  "Emergency",
};

type Props = {
  entityType: "hauler" | "facility";
  entityId:   string;
  isLoggedIn: boolean;
};

export function SuggestContactButton({ entityType, entityId, isLoggedIn }: Props) {
  const [open, setOpen]         = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const [form, setForm] = useState({
    contact_name:  "",
    contact_title: "",
    contact_phone: "",
    contact_email: "",
    contact_type:  "general" as ContactType,
    notes:         "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.contact_name && !form.contact_email && !form.contact_phone) {
      setError("Please provide at least a name, email, or phone number.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, ...form }),
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

  const handleClose = () => {
    setOpen(false);
    setSubmitted(false);
    setError(null);
    setForm({ contact_name: "", contact_title: "", contact_phone: "", contact_email: "", contact_type: "general", notes: "" });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-sm text-[#2D6A4F] hover:underline"
      >
        <UserPlus className="size-4" />
        Suggest a contact
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={handleClose}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10">
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X className="size-5" />
            </button>

            <h2 className="text-lg font-semibold text-gray-900 mb-1">Suggest a Contact</h2>
            <p className="text-sm text-gray-500 mb-5">
              Know a contact for this {entityType === "hauler" ? "hauler" : "facility"}? Submissions are reviewed before being added.
            </p>

            {!isLoggedIn ? (
              <div className="text-center py-6">
                <p className="text-sm text-gray-600 mb-3">You must be logged in to submit contacts.</p>
                <a
                  href="/login"
                  className="inline-flex h-9 items-center px-5 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
                >
                  Log in
                </a>
              </div>
            ) : submitted ? (
              <div className="text-center py-6">
                <CheckCircle className="size-10 text-[#2D6A4F] mx-auto mb-3" />
                <p className="font-medium text-gray-900 mb-1">Thank you!</p>
                <p className="text-sm text-gray-500">Your contact suggestion has been submitted for review.</p>
                <button
                  onClick={handleClose}
                  className="mt-4 text-sm text-[#2D6A4F] hover:underline"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Contact Name
                    </label>
                    <input
                      type="text"
                      value={form.contact_name}
                      onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                      placeholder="Jane Smith"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Title / Role <span className="text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={form.contact_title}
                      onChange={(e) => setForm((f) => ({ ...f, contact_title: e.target.value }))}
                      placeholder="Operations Manager"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Phone <span className="text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="tel"
                      value={form.contact_phone}
                      onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                      placeholder="(555) 555-5555"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Email <span className="text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="email"
                      value={form.contact_email}
                      onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                      placeholder="jane@example.com"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Contact Type
                  </label>
                  <select
                    value={form.contact_type}
                    onChange={(e) => setForm((f) => ({ ...f, contact_type: e.target.value as ContactType }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F] bg-white"
                  >
                    {(Object.entries(CONTACT_TYPE_LABELS) as [ContactType, string][]).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Notes <span className="text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Any additional context..."
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F] resize-none"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={submitting}
                    className="bg-[#2D6A4F] hover:bg-[#245a42] text-white"
                  >
                    {submitting ? (
                      <><Loader2 className="size-3.5 animate-spin mr-1.5" />Submitting…</>
                    ) : (
                      "Submit"
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
