import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ── GET /api/reports ────────────────────────────────────────────────────────────
// Returns all diversion reports for the authenticated user.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("diversion_reports")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/reports]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// ── POST /api/reports ───────────────────────────────────────────────────────────
// Create a new diversion report. Returns the new report's id.

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as Record<string, unknown>;
  const {
    report_name,
    hauler_name,
    hauler_logo_url,
    customer_name,
    service_address,
    service_city,
    service_state,
    service_zip,
    period_start,
    period_end,
    material_streams,
    notes,
  } = body;

  if (!report_name || !hauler_name || !customer_name || !service_address || !period_start || !period_end) {
    return NextResponse.json(
      { error: "report_name, hauler_name, customer_name, service_address, period_start, and period_end are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("diversion_reports")
    .insert({
      user_id:          user.id,
      report_name:      String(report_name).trim(),
      hauler_name:      String(hauler_name).trim(),
      hauler_logo_url:  hauler_logo_url ? String(hauler_logo_url) : null,
      customer_name:    String(customer_name).trim(),
      service_address:  String(service_address).trim(),
      service_city:     service_city ? String(service_city).trim() : null,
      service_state:    service_state ? String(service_state) : null,
      service_zip:      service_zip ? String(service_zip).trim() : null,
      period_start:     String(period_start),
      period_end:       String(period_end),
      material_streams: Array.isArray(material_streams) ? material_streams : [],
      notes:            notes ? String(notes).trim() : null,
      status:           "draft",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[POST /api/reports]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
