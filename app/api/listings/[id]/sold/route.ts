import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ── POST /api/listings/[id]/sold ──────────────────────────────────────────────
// Auth required, owner only. Marks the listing as sold.

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("equipment_listings")
    .update({ status: "sold", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, status")
    .single();

  if (error) {
    console.error("[POST /api/listings/[id]/sold]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found or forbidden" }, { status: 404 });
  return NextResponse.json(data);
}
