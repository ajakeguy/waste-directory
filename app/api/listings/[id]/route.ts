import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteCtx = { params: Promise<{ id: string }> };

// ── GET /api/listings/[id] ────────────────────────────────────────────────────
// Public — returns listing detail. Contact info is redacted unless the caller
// is authenticated (checked server-side so it cannot be bypassed client-side).

export async function GET(_req: Request, { params }: RouteCtx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("equipment_listings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/listings/[id]]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Strip contact info for unauthenticated callers
  if (!user) {
    const { contact_name, contact_email, contact_phone, ...safe } = data;
    void contact_name; void contact_email; void contact_phone;
    return NextResponse.json({ ...safe, contact_name: null, contact_email: null, contact_phone: null });
  }

  return NextResponse.json(data);
}

// ── PATCH /api/listings/[id] ──────────────────────────────────────────────────
// Auth required, owner only.

export async function PATCH(request: Request, { params }: RouteCtx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const allowed = [
    "title", "description", "category", "condition",
    "price", "price_negotiable", "quantity",
    "location_city", "location_state", "photos",
    "contact_name", "contact_email", "contact_phone",
    "status",
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) update[key] = body[key] ?? null;
  }

  const { data, error } = await supabase
    .from("equipment_listings")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id) // owner check (belt-and-suspenders alongside RLS)
    .select()
    .single();

  if (error) {
    console.error("[PATCH /api/listings/[id]]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found or forbidden" }, { status: 404 });
  return NextResponse.json(data);
}

// ── DELETE /api/listings/[id] ─────────────────────────────────────────────────
// Auth required, owner only.

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("equipment_listings")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[DELETE /api/listings/[id]]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
