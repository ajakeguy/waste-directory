import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/prices/contribute
// Accepts a community-sourced price submission for a manual/SMP commodity
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // No auth required — contributor_id is optional

  const body = (await req.json()) as {
    commodity_key?: string;
    price?: number;
    unit?: string;
    region?: string;
    source_description?: string;
  };

  const { commodity_key, price, unit } = body;

  if (!commodity_key) {
    return NextResponse.json({ error: "commodity_key is required" }, { status: 400 });
  }
  if (price === undefined || price === null || isNaN(Number(price))) {
    return NextResponse.json({ error: "price is required and must be a number" }, { status: 400 });
  }
  if (!unit) {
    return NextResponse.json({ error: "unit is required" }, { status: 400 });
  }

  const { error } = await supabase.from("commodity_price_contributions").insert({
    commodity_key,
    price:              Number(price),
    unit,
    region:             body.region             || null,
    source_description: body.source_description || null,
    contributor_id:     user?.id                ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
