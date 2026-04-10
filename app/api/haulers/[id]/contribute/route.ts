import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET — return approved contributions for this org (+ own contributions if logged in)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("hauler_service_contributions")
    .select("*")
    .eq("organization_id", id)
    .order("created_at", { ascending: false });

  if (user) {
    // Logged-in user sees their own (all statuses) + others' approved
    query = query.or(`status.eq.approved,contributor_id.eq.${user.id}`);
  } else {
    query = query.eq("status", "approved");
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

// POST — submit a contribution (requires auth)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { service_types, service_municipalities, notes } = body;

  // Check if user already contributed to this org
  const { data: existing } = await supabase
    .from("hauler_service_contributions")
    .select("id")
    .eq("organization_id", id)
    .eq("contributor_id", user.id)
    .maybeSingle();

  let result;
  if (existing) {
    // Update existing contribution
    result = await supabase
      .from("hauler_service_contributions")
      .update({
        service_types:          service_types ?? [],
        service_municipalities: service_municipalities ?? [],
        notes:                  notes ?? null,
        status:                 "pending",
      })
      .eq("id", existing.id)
      .select()
      .single();
  } else {
    // Insert new contribution
    result = await supabase
      .from("hauler_service_contributions")
      .insert({
        organization_id:        id,
        contributor_id:         user.id,
        service_types:          service_types ?? [],
        service_municipalities: service_municipalities ?? [],
        notes:                  notes ?? null,
        status:                 "pending",
      })
      .select()
      .single();
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  return NextResponse.json({ data: result.data });
}
