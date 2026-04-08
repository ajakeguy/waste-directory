import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ── DELETE /api/locations/[id] ───────────────────────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { error } = await supabase
    .from("saved_locations")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id); // RLS belt-and-suspenders

  if (error) {
    console.error("[DELETE /api/locations/:id]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
