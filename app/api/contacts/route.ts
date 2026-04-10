import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/contacts — submit a contact suggestion for a hauler or facility
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    entity_type?: string;
    entity_id?: string;
    contact_name?: string;
    contact_title?: string;
    contact_email?: string;
    contact_phone?: string;
    contact_type?: string;
    notes?: string;
  };

  const { entity_type, entity_id, contact_name, contact_title, contact_email, contact_phone, contact_type, notes } = body;

  if (!entity_type || !entity_id) {
    return NextResponse.json({ error: "entity_type and entity_id are required" }, { status: 400 });
  }
  if (!["hauler", "facility"].includes(entity_type)) {
    return NextResponse.json({ error: "entity_type must be 'hauler' or 'facility'" }, { status: 400 });
  }
  if (!contact_name && !contact_email && !contact_phone) {
    return NextResponse.json({ error: "At least one of contact_name, contact_email, or contact_phone is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_submitted_contacts")
    .insert({
      entity_type,
      entity_id,
      contributor_id: user.id,
      contact_name:  contact_name  || null,
      contact_title: contact_title || null,
      contact_email: contact_email || null,
      contact_phone: contact_phone || null,
      contact_type:  contact_type  || "general",
      notes:         notes         || null,
      status:        "pending",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

// GET /api/contacts?entity_type=hauler&entity_id={id}
// Returns approved contacts + the current user's pending submissions
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const entity_type = searchParams.get("entity_type");
  const entity_id   = searchParams.get("entity_id");

  if (!entity_type || !entity_id) {
    return NextResponse.json({ error: "entity_type and entity_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Approved contacts (visible to everyone)
  let query = supabase
    .from("user_submitted_contacts")
    .select("id, contact_name, contact_title, contact_email, contact_phone, contact_type, notes, status, created_at")
    .eq("entity_type", entity_type)
    .eq("entity_id", entity_id);

  if (user) {
    // Logged-in users see approved + their own pending
    query = query.or(`status.eq.approved,and(status.eq.pending,contributor_id.eq.${user.id})`);
  } else {
    query = query.eq("status", "approved");
  }

  const { data, error } = await query.order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
