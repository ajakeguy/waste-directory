import { createClient } from "@/lib/supabase/server";

/** Returns the set of org IDs the given user has saved. */
export async function getSavedOrgIds(userId: string): Promise<Set<string>> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("saved_items")
    .select("item_id")
    .eq("user_id", userId)
    .eq("item_type", "organization");

  return new Set((data ?? []).map((row: { item_id: string }) => row.item_id));
}
