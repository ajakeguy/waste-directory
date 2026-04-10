import { createClient } from "@/lib/supabase/server";
import type { DisposalFacility } from "@/types";

// ---------------------------------------------------------------------------
// Materials filter helper
// ---------------------------------------------------------------------------

const BOOL_MAP: Record<string, string> = {
  recycling:    "accepts_recycling",
  composting:   "accepts_organics",
  organics:     "accepts_organics",
  food:         "accepts_organics",
  fw:           "accepts_organics",
  hazardous:    "accepts_hazardous",
  cd:           "accepts_cd",
  construction: "accepts_cd",
  msw:          "accepts_msw",
  special:      "accepts_special_waste",
};

const CODE_MAP: Record<string, string> = {
  tires:        "T",
  t:            "T",
  electronics:  "CE",
  ewaste:       "CE",
  ce:           "CE",
  asphalt:      "A",
  a:            "A",
  concrete:     "C",
  c:            "C",
  batteries:    "B",
  b:            "B",
  "food waste": "FW",
  leaves:       "L",
  l:            "L",
  brush:        "BR",
  br:           "BR",
  wood:         "W",
  w:            "W",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyMaterialsFilter(query: any, materials: string[]): any {
  const orParts: string[] = [];
  const codeSet    = new Set<string>();
  const boolFields = new Set<string>();

  for (const m of materials) {
    const key = m.toLowerCase().trim();
    if (BOOL_MAP[key]) {
      boolFields.add(BOOL_MAP[key]);
    } else if (CODE_MAP[key]) {
      codeSet.add(CODE_MAP[key]);
    } else {
      // Treat as raw material code (e.g. "FW", "CE", "BB")
      codeSet.add(m.toUpperCase());
    }
  }

  for (const field of boolFields) {
    orParts.push(`${field}.eq.true`);
  }
  for (const code of codeSet) {
    orParts.push(`accepted_materials->codes.cs.["${code}"]`);
  }

  if (orParts.length > 0) {
    query = query.or(orParts.join(","));
  }

  return query;
}

export type DisposalFilters = {
  state?: string;      // single 2-letter code (legacy/landing pages)
  states?: string[];   // multi-select — used by directory page
  facility_type?: string;
  active_only?: boolean;
  q?: string;
  materials?: string[]; // accepted material filter (codes or friendly names)
};

export async function getDisposalFacilities(
  filters: DisposalFilters = {}
): Promise<DisposalFacility[]> {
  const supabase = await createClient();

  let query = supabase
    .from("disposal_facilities")
    .select("*")
    .order("name");

  if (filters.active_only !== false) {
    query = query.eq("active", true);
  }

  if (filters.states && filters.states.length > 0) {
    query = query.overlaps("service_area_states", filters.states);
  } else if (filters.state) {
    query = query.contains("service_area_states", [filters.state]);
  }

  if (filters.facility_type) {
    query = query.eq("facility_type", filters.facility_type);
  }

  if (filters.q) {
    query = query.ilike("name", `%${filters.q}%`);
  }

  if (filters.materials && filters.materials.length > 0) {
    query = applyMaterialsFilter(query, filters.materials);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Error fetching disposal facilities:", error);
    return [];
  }
  return data ?? [];
}

export async function getDisposalFacilitiesPaginated(
  filters: DisposalFilters = {},
  page: number = 1,
  pageSize: number = 25
): Promise<{ data: DisposalFacility[]; count: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to   = from + pageSize - 1;

  let query = supabase
    .from("disposal_facilities")
    .select("*", { count: "exact" })
    .order("name")
    .range(from, to);

  if (filters.active_only !== false) {
    query = query.eq("active", true);
  }

  if (filters.states && filters.states.length > 0) {
    query = query.overlaps("service_area_states", filters.states);
  } else if (filters.state) {
    query = query.contains("service_area_states", [filters.state]);
  }

  if (filters.facility_type) {
    query = query.eq("facility_type", filters.facility_type);
  }

  if (filters.q) {
    query = query.ilike("name", `%${filters.q}%`);
  }

  if (filters.materials && filters.materials.length > 0) {
    query = applyMaterialsFilter(query, filters.materials);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("Error fetching disposal facilities (paginated):", error);
    return { data: [], count: 0 };
  }
  return { data: data ?? [], count: count ?? 0 };
}

export async function getDisposalFacilitiesForMap(
  filters: DisposalFilters = {}
): Promise<
  Pick<
    DisposalFacility,
    "id" | "name" | "slug" | "city" | "state" | "facility_type" | "lat" | "lng" | "phone"
  >[]
> {
  const supabase = await createClient();

  let query = supabase
    .from("disposal_facilities")
    .select("id, name, slug, city, state, facility_type, lat, lng, phone")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .order("name")
    .limit(500);

  if (filters.active_only !== false) {
    query = query.eq("active", true);
  }
  if (filters.states && filters.states.length > 0) {
    query = query.overlaps("service_area_states", filters.states);
  } else if (filters.state) {
    query = query.contains("service_area_states", [filters.state]);
  }
  if (filters.facility_type) {
    query = query.eq("facility_type", filters.facility_type);
  }
  if (filters.q) {
    query = query.ilike("name", `%${filters.q}%`);
  }

  if (filters.materials && filters.materials.length > 0) {
    query = applyMaterialsFilter(query, filters.materials);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Error fetching disposal facilities for map:", error);
    return [];
  }
  return (data ?? []) as Pick<
    DisposalFacility,
    "id" | "name" | "slug" | "city" | "state" | "facility_type" | "lat" | "lng" | "phone"
  >[];
}

export async function getDisposalFacilityBySlug(
  slug: string
): Promise<DisposalFacility | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("disposal_facilities")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error) return null;
  return data;
}
