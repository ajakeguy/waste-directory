"use client";

import { useState } from "react";
import { Heart } from "lucide-react";

export function DisposalSaveButton({
  facilityId,
  initialSaved,
  size = "md",
}: {
  facilityId: string;
  initialSaved: boolean;
  size?: "sm" | "md";
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    try {
      if (saved) {
        await fetch("/api/saved-disposal", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facility_id: facilityId }),
        });
        setSaved(false);
      } else {
        const res = await fetch("/api/saved-disposal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facility_id: facilityId }),
        });
        if (res.ok || res.status === 409) setSaved(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={saved ? "Unsave facility" : "Save facility"}
      disabled={loading}
      className={`shrink-0 p-1.5 rounded-full transition-colors ${
        saved ? "text-rose-500 hover:text-rose-600" : "text-gray-300 hover:text-rose-400"
      } ${loading ? "opacity-50" : ""}`}
    >
      <Heart
        className={`${size === "sm" ? "size-4" : "size-5"} ${saved ? "fill-current" : ""}`}
      />
    </button>
  );
}
