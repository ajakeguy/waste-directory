import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULTS } from "@/components/routes/RouteCostCalculator";
import type { CostAssumptions } from "@/components/routes/RouteCostCalculator";

// ── GET /api/route-preferences ───────────────────────────────────────────────
// Returns the user's saved assumptions, or the app defaults if none saved.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(DEFAULTS);

  const { data } = await supabase
    .from("user_route_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!data) return NextResponse.json(DEFAULTS);

  const prefs: CostAssumptions = {
    serviceMinPerStop:  Number(data.service_min_per_stop),
    mpg:                Number(data.mpg),
    fuelPricePerGallon: Number(data.fuel_price_per_gallon),
    laborRatePerHour:   Number(data.labor_rate_per_hour),
    lbsPerYard:         Number(data.lbs_per_yard),
    disposalCostPerTon: Number(data.disposal_cost_per_ton),
  };
  return NextResponse.json(prefs);
}

// ── POST /api/route-preferences ──────────────────────────────────────────────
// Upserts the user's default cost assumptions.

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as CostAssumptions;

  const { error } = await supabase
    .from("user_route_preferences")
    .upsert({
      user_id:               user.id,
      service_min_per_stop:  body.serviceMinPerStop,
      mpg:                   body.mpg,
      fuel_price_per_gallon: body.fuelPricePerGallon,
      labor_rate_per_hour:   body.laborRatePerHour,
      lbs_per_yard:          body.lbsPerYard,
      disposal_cost_per_ton: body.disposalCostPerTon,
      updated_at:            new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (error) {
    console.error("[POST /api/route-preferences]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
