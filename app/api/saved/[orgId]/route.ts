import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { orgId } = await params;
  const body = await request.json();
  const { notes, list_id } = body as { notes?: string | null; list_id?: string | null };

  const update: Record<string, string | null> = {};
  if (notes !== undefined) update.notes = notes || null;
  if (list_id !== undefined) update.list_id = list_id;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("saved_items")
    .update(update)
    .eq("user_id", user.id)
    .eq("item_id", orgId)
    .eq("item_type", "organization")
    .select("id, item_id, list_id, notes")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
