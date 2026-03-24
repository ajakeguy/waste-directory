import { createClient } from "@/lib/supabase/server";
import type { Organization } from "@/types";

export type OrganizationFilters = {
  state?: string; // 2-letter code e.g. "VT"
  services?: string[];
  verified?: boolean;
  q?: string;
};

export async function getOrganizations(
  filters: OrganizationFilters = {}
): Promise<Organization[]> {
  const supabase = await createClient();

  let query = supabase
    .from("organizations")
    .select("*")
    .eq("active", true)
    .order("name");

  if (filters.state) {
    query = query.eq("state", filters.state);
  }

  if (filters.verified) {
    query = query.eq("verified", true);
  }

  if (filters.services && filters.services.length > 0) {
    query = query.overlaps("service_types", filters.services);
  }

  if (filters.q) {
    query = query.textSearch("search_vector", filters.q, {
      type: "websearch",
    });
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching organizations:", error);
    return [];
  }

  return data ?? [];
}

export async function getOrganizationBySlug(
  slug: string
): Promise<Organization | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .single();

  if (error) return null;
  return data;
}

export async function getOrganizationCountByState(
  state: string
): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .eq("state", state)
    .eq("active", true);

  if (error) return 0;
  return count ?? 0;
}
