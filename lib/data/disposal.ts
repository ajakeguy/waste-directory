import { createClient } from "@/lib/supabase/server";
import type { DisposalFacility } from "@/types";

export type DisposalFilters = {
  state?: string;           // 2-letter code
  facility_type?: string;
  active_only?: boolean;
  q?: string;
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

  if (filters.state) {
    query = query.contains("service_area_states", [filters.state]);
  }

  if (filters.facility_type) {
    query = query.eq("facility_type", filters.facility_type);
  }

  if (filters.q) {
    query = query.ilike("name", `%${filters.q}%`);
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

  if (filters.state) {
    query = query.contains("service_area_states", [filters.state]);
  }

  if (filters.facility_type) {
    query = query.eq("facility_type", filters.facility_type);
  }

  if (filters.q) {
    query = query.ilike("name", `%${filters.q}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("Error fetching disposal facilities (paginated):", error);
    return { data: [], count: 0 };
  }
  return { data: data ?? [], count: count ?? 0 };
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
