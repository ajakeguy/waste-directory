"use client";

import { useState, useCallback } from "react";
import { StickyNote, Heart } from "lucide-react";

type Props = {
  orgId: string;
  userId: string | null;
  isSaved: boolean;
  initialNote: string | null;
};

export function HaulerNotes({ orgId, userId, isSaved: initialSaved, initialNote }: Props) {
  const [isSaved, setIsSaved] = useState(initialSaved);
  const [note, setNote] = useState(initialNote ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [saving, setSaving] = useState(false);

  // Not logged in — show nothing
  if (!userId) return null;

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setStatus("saving");

    try {
      await fetch(`/api/saved/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: note }),
      });
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("idle");
    } finally {
      setSaving(false);
    }
  }, [orgId, note, saving]);

  const handleFirstSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (res.ok) setIsSaved(true);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <StickyNote className="size-4 text-yellow-500 shrink-0" />
        <h2 className="font-semibold text-gray-900">My Notes</h2>
      </div>

      {!isSaved ? (
        /* Prompt to save first */
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 mb-3">
            Save this hauler to add private notes
          </p>
          <button
            onClick={handleFirstSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors disabled:opacity-60"
          >
            <Heart className="size-3.5" />
            {saving ? "Saving…" : "Save this hauler"}
          </button>
        </div>
      ) : (
        /* Notes textarea */
        <div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={handleSave}
            placeholder="Add your private notes about this hauler…"
            rows={4}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-[#2D6A4F] focus:border-[#2D6A4F] text-gray-700 placeholder:text-gray-400"
          />
          <div className="flex items-center justify-between mt-2">
            <span
              className={`text-xs transition-opacity duration-300 ${
                status === "saved"
                  ? "text-[#2D6A4F] opacity-100"
                  : status === "saving"
                  ? "text-gray-400 opacity-100"
                  : "opacity-0"
              }`}
            >
              {status === "saving" ? "Saving…" : "Saved ✓"}
            </span>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs text-white bg-[#2D6A4F] hover:bg-[#245a42] rounded-md px-3 py-1.5 transition-colors disabled:opacity-60"
            >
              Save note
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
