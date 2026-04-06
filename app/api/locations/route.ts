import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ── GET /api/locations ───────────────────────────────────────────────────────
// Returns the signed-in user's saved locations.
// Optional ?type=depot|disposal|both query param to filter by type.

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  let query = supabase
    .from("saved_locations")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (type) {
    query = query.or(`type.eq.${type},type.eq.both`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[GET /api/locations]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// ── POST /api/locations ──────────────────────────────────────────────────────
// Save a new location.  Body: { name, address, type, lat?, lng? }

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    name: string;
    address: string;
    type: "depot" | "disposal" | "both";
    lat?: number;
    lng?: number;
  };

  if (!body.name?.trim() || !body.address?.trim() || !["depot", "disposal", "both"].includes(body.type)) {
    return NextResponse.json({ error: "name, address, and valid type are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("saved_locations")
    .insert({
      user_id: user.id,
      name:    body.name.trim(),
      address: body.address.trim(),
      type:    body.type,
      lat:     body.lat ?? null,
      lng:     body.lng ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error("[POST /api/locations]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
