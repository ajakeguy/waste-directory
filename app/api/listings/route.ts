import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ── GET /api/listings ──────────────────────────────────────────────────────────
// Public — returns active, non-expired listings with optional filters.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const condition = searchParams.get("condition");
  const state = searchParams.get("state");
  const q = searchParams.get("q");
  const priceMin = searchParams.get("price_min");
  const priceMax = searchParams.get("price_max");

  const supabase = await createClient();

  let query = supabase
    .from("equipment_listings")
    .select(
      "id, title, category, condition, price, price_negotiable, quantity, " +
      "location_city, location_state, photos, status, expires_at, created_at"
    )
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (category) query = query.eq("category", category);
  if (condition) query = query.eq("condition", condition);
  if (state) query = query.eq("location_state", state);
  if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  if (priceMin) query = query.gte("price", parseFloat(priceMin));
  if (priceMax) query = query.lte("price", parseFloat(priceMax));

  const { data, error } = await query;
  if (error) {
    console.error("[GET /api/listings]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// ── POST /api/listings ─────────────────────────────────────────────────────────
// Auth required — create a new listing.

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const {
    title, description, category, condition,
    price, price_negotiable, quantity,
    location_city, location_state,
    photos,
    contact_name, contact_email, contact_phone,
  } = body as Record<string, unknown>;

  if (!title || !description || !category || !condition) {
    return NextResponse.json(
      { error: "title, description, category, and condition are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("equipment_listings")
    .insert({
      user_id: user.id,
      title: String(title).trim(),
      description: String(description).trim(),
      category,
      condition,
      price: price ? parseFloat(String(price)) : null,
      price_negotiable: Boolean(price_negotiable),
      quantity: quantity ? parseInt(String(quantity)) : 1,
      location_city: location_city ? String(location_city).trim() : null,
      location_state: location_state ? String(location_state) : null,
      photos: Array.isArray(photos) ? photos : [],
      contact_name: contact_name ? String(contact_name).trim() : null,
      contact_email: contact_email ? String(contact_email).trim() : null,
      contact_phone: contact_phone ? String(contact_phone).trim() : null,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[POST /api/listings]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
