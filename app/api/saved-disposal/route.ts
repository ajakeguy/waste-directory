import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ids: [] });

  const { data, error } = await supabase
    .from("saved_disposal_facilities")
    .select("facility_id")
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ids: (data ?? []).map((r) => r.facility_id) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { facility_id } = (await request.json()) as { facility_id?: string };
  if (!facility_id)
    return NextResponse.json({ error: "facility_id required" }, { status: 400 });

  const { error } = await supabase
    .from("saved_disposal_facilities")
    .insert({ user_id: user.id, facility_id });

  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ error: "Already saved" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { facility_id, notes } = (await request.json()) as {
    facility_id?: string;
    notes?: string;
  };
  if (!facility_id)
    return NextResponse.json({ error: "facility_id required" }, { status: 400 });

  const { error } = await supabase
    .from("saved_disposal_facilities")
    .update({ notes: notes ?? null })
    .eq("user_id", user.id)
    .eq("facility_id", facility_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { facility_id } = (await request.json()) as { facility_id?: string };
  if (!facility_id)
    return NextResponse.json({ error: "facility_id required" }, { status: 400 });

  const { error } = await supabase
    .from("saved_disposal_facilities")
    .delete()
    .eq("user_id", user.id)
    .eq("facility_id", facility_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
