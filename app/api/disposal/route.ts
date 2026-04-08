import { NextRequest, NextResponse } from "next/server";
import { getDisposalFacilitiesPaginated } from "@/lib/data/disposal";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const state         = searchParams.get("state")         ?? undefined;
  const facility_type = searchParams.get("type")          ?? undefined;
  const q             = searchParams.get("search")        ?? undefined;
  const active_only   = searchParams.get("active") !== "0";
  const page          = Math.max(1, parseInt(searchParams.get("page")     ?? "1",  10) || 1);
  const per_page      = Math.min(100, parseInt(searchParams.get("per_page") ?? "25", 10) || 25);

  const { data, count } = await getDisposalFacilitiesPaginated(
    { state, facility_type, active_only, q },
    page,
    per_page
  );

  return NextResponse.json({ data, count, page, per_page });
}
