import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ── GET /api/routes ─────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("saved_routes")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/routes]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// ── POST /api/routes ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as Record<string, unknown>;
  const {
    route_name,
    start_address,
    end_address,
    stops,
    optimized_order,
    total_distance_km,
    status,
  } = body;

  if (!route_name || !start_address || !end_address) {
    return NextResponse.json(
      { error: "route_name, start_address, and end_address are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("saved_routes")
    .insert({
      user_id:           user.id,
      route_name:        String(route_name).trim(),
      start_address:     String(start_address).trim(),
      end_address:       String(end_address).trim(),
      stops:             Array.isArray(stops) ? stops : [],
      optimized_order:   Array.isArray(optimized_order) ? optimized_order : null,
      total_distance_km: typeof total_distance_km === "number" ? total_distance_km : null,
      status:            typeof status === "string" ? status : "draft",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[POST /api/routes]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
