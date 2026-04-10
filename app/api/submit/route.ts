import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/submit — submit a missing hauler or facility
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const body = (await req.json()) as {
    submission_type?: string;
    company_name?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    email?: string;
    website?: string;
    // hauler-specific
    service_types?: string[];
    service_states?: string[];
    license_number?: string;
    // facility-specific
    facility_type?: string;
    accepted_materials?: string[];
    notes?: string;
  };

  const { submission_type, company_name } = body;

  if (!submission_type || !["hauler", "facility"].includes(submission_type)) {
    return NextResponse.json({ error: "submission_type must be 'hauler' or 'facility'" }, { status: 400 });
  }
  if (!company_name?.trim()) {
    return NextResponse.json({ error: "company_name is required" }, { status: 400 });
  }

  const { error } = await supabase.from("directory_submissions").insert({
    submission_type,
    contributor_id:    user?.id ?? null,
    company_name:      body.company_name?.trim(),
    address:           body.address           || null,
    city:              body.city              || null,
    state:             body.state?.toUpperCase() || null,
    zip:               body.zip               || null,
    phone:             body.phone             || null,
    email:             body.email             || null,
    website:           body.website           || null,
    service_types:     body.service_types     || null,
    service_states:    body.service_states    || null,
    license_number:    body.license_number    || null,
    facility_type:     body.facility_type     || null,
    accepted_materials: body.accepted_materials || null,
    notes:             body.notes             || null,
    status:            "pending",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
