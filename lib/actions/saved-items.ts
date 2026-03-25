"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Toggle a saved organization for the currently authenticated user.
 * Returns the new saved state.
 * Throws if the user is not authenticated (should never reach this via SaveButton).
 */
export async function toggleSaved(
  orgId: string
): Promise<{ saved: boolean }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Check whether this org is already saved
  const { data: existing } = await supabase
    .from("saved_items")
    .select("id")
    .eq("user_id", user.id)
    .eq("item_id", orgId)
    .eq("item_type", "organization")
    .maybeSingle();

  if (existing) {
    await supabase.from("saved_items").delete().eq("id", existing.id);
    return { saved: false };
  } else {
    await supabase.from("saved_items").insert({
      user_id: user.id,
      item_type: "organization",
      item_id: orgId,
    });
    return { saved: true };
  }
}
