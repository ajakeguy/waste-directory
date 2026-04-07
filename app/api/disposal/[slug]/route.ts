import { NextRequest, NextResponse } from "next/server";
import { getDisposalFacilityBySlug } from "@/lib/data/disposal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const facility = await getDisposalFacilityBySlug(slug);

  if (!facility) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(facility);
}
