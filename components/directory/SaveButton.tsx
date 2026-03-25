"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toggleSaved } from "@/lib/actions/saved-items";

type Props = {
  orgId: string;
  orgName: string;
  initialSaved: boolean;
  userId: string | null;
};

export function SaveButton({ orgId, orgName, initialSaved, userId }: Props) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    if (!userId) {
      router.push("/login");
      return;
    }

    // Optimistic update — flip immediately, reconcile with server response
    setSaved((prev) => !prev);
    setPending(true);

    try {
      const result = await toggleSaved(orgId);
      setSaved(result.saved);
    } catch {
      // Revert on error
      setSaved((prev) => !prev);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      aria-label={saved ? `Unsave ${orgName}` : `Save ${orgName}`}
      title={userId ? (saved ? "Remove from saved" : "Save hauler") : "Sign in to save"}
      className={`p-1.5 rounded-lg transition-colors shrink-0 disabled:opacity-50 ${
        saved
          ? "text-rose-500 hover:text-rose-600 hover:bg-rose-50"
          : "text-gray-300 hover:text-rose-500 hover:bg-rose-50"
      }`}
    >
      <Heart className={`size-4 ${saved ? "fill-current" : ""}`} />
    </button>
  );
}
