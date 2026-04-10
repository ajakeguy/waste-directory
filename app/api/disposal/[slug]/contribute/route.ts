import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ slug: string }> };

// POST /api/disposal/[slug]/contribute
// Submit suggested accepted materials for a disposal facility
export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Look up the facility by slug
  const { data: facility } = await supabase
    .from("disposal_facilities")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  const body = (await req.json()) as {
    material_codes?: string[];
    material_descriptions?: string[];
    notes?: string;
  };

  if (!body.material_codes?.length && !body.material_descriptions?.length) {
    return NextResponse.json({ error: "At least one material is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("facility_material_contributions")
    .insert({
      facility_id:           facility.id,
      contributor_id:        user.id,
      material_codes:        body.material_codes        || null,
      material_descriptions: body.material_descriptions || null,
      notes:                 body.notes                 || null,
      status:                "pending",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}
