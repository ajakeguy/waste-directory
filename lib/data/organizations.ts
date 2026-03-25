import { createClient } from "@/lib/supabase/server";
import type { Organization } from "@/types";

export type Contact = {
  id: string;
  organization_id: string;
  name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  contact_type: string;
  source: string | null;
  verified: boolean;
  created_at: string;
};

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
    // Filter by service area, not HQ state — so a NJ-based company with a
    // VT permit still shows up when browsing Vermont haulers.
    query = query.contains("service_area_states", [filters.state]);
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

export async function getOrganizationContacts(
  organizationId: string
): Promise<Contact[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("organization_id", organizationId)
    .order("contact_type")
    .order("name");

  if (error) {
    console.error("Error fetching contacts:", error);
    return [];
  }

  return data ?? [];
}

export async function getOrganizationCountByState(
  state: string
): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .contains("service_area_states", [state])
    .eq("active", true);

  if (error) return 0;
  return count ?? 0;
}
