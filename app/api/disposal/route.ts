import { NextRequest, NextResponse } from "next/server";
import { getDisposalFacilitiesPaginated } from "@/lib/data/disposal";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const stateParam     = searchParams.get("state")          ?? undefined;
  const statesParam    = searchParams.get("states");
  const states         = statesParam ? statesParam.split(",").filter(Boolean) : undefined;
  const facility_type  = searchParams.get("type")           ?? undefined;  // legacy single-type
  const typesParam     = searchParams.get("types");
  const facility_types = typesParam ? typesParam.split(",").filter(Boolean) : undefined;
  const q              = searchParams.get("search")         ?? undefined;
  const active_only    = searchParams.get("active") !== "0";
  const page           = Math.max(1, parseInt(searchParams.get("page")     ?? "1",  10) || 1);
  const per_page       = Math.min(100, parseInt(searchParams.get("per_page") ?? "25", 10) || 25);

  const materialsParam = searchParams.get("materials");
  const materials      = materialsParam ? materialsParam.split(",").filter(Boolean) : undefined;

  const { data, count } = await getDisposalFacilitiesPaginated(
    { state: stateParam, states, facility_type, facility_types, active_only, q, materials },
    page,
    per_page
  );

  return NextResponse.json({ data, count, page, per_page });
}
