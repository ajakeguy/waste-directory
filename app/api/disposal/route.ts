import { NextRequest, NextResponse } from "next/server";
import {
  getDisposalFacilitiesPaginated,
  type DisposalFilters,
} from "@/lib/data/disposal";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const state         = searchParams.get("state")  ?? undefined;
  const facility_type = searchParams.get("type")   ?? undefined;
  const q             = searchParams.get("search") ?? undefined;
  const active_only   = searchParams.get("active") !== "0";
  const page          = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  // Hard cap at 25 — matches the page component; prevents large DB reads via API
  const per_page      = 25;

  const filters: DisposalFilters = { state, facility_type, active_only, q };

  const { data, count } = await getDisposalFacilitiesPaginated(filters, page, per_page);

  return NextResponse.json(
    { data, count, page, per_page },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
