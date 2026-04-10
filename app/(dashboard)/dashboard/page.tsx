import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import type { Organization, SavedItemWithOrg, UserList, EquipmentListing, DiversionReport, SavedRoute, DisposalFacility } from "@/types";

export const metadata: Metadata = {
  title: "Dashboard | WasteDirectory",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Display name
  const { data: profile } = await supabase
    .from("users")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();

  const displayName = profile?.name ?? user.email ?? "there";

  // User's lists
  const { data: listsData } = await supabase
    .from("user_lists")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at");

  const lists: UserList[] = (listsData ?? []) as UserList[];

  // Saved items with list info (user_lists join via list_id FK)
  const { data: savedRows } = await supabase
    .from("saved_items")
    .select("id, item_id, list_id, notes, user_lists(id, name, color)")
    .eq("user_id", user.id)
    .eq("item_type", "organization")
    .order("created_at", { ascending: false });

  // Supabase infers joined tables as arrays; use `unknown` to cast to the
  // actual runtime shape (PostgREST returns the parent FK row as object | null).
  const rows = (savedRows ?? []) as unknown as Array<{
    id: string;
    item_id: string;
    list_id: string | null;
    notes: string | null;
    user_lists: { id: string; name: string; color: string } | null;
  }>;

  // Fetch org data for all saved item IDs
  let savedItems: SavedItemWithOrg[] = [];

  if (rows.length > 0) {
    const orgIds = rows.map((r) => r.item_id);
    const { data: orgsData } = await supabase
      .from("organizations")
      .select("*")
      .in("id", orgIds)
      .eq("active", true);

    const orgMap = new Map(
      ((orgsData ?? []) as Organization[]).map((o) => [o.id, o])
    );

    savedItems = rows
      .filter((r) => orgMap.has(r.item_id))
      .map((r) => ({
        id: r.id,
        item_id: r.item_id,
        list_id: r.list_id,
        notes: r.notes,
        org: orgMap.get(r.item_id)!,
        list: r.user_lists ?? null,
      }));
  }

  // User's marketplace listings (all statuses)
  const { data: listingsData } = await supabase
    .from("equipment_listings")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const myListings = (listingsData ?? []) as unknown as EquipmentListing[];

  // Recent diversion reports (latest 5)
  const { data: reportsData } = await supabase
    .from("diversion_reports")
    .select("id, report_name, customer_name, period_start, period_end, status, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(5);

  const recentReports = (reportsData ?? []) as unknown as Pick<
    DiversionReport,
    "id" | "report_name" | "customer_name" | "period_start" | "period_end" | "status" | "created_at" | "updated_at"
  >[];

  // Recent saved routes (latest 3)
  const { data: routesData } = await supabase
    .from("saved_routes")
    .select("id, route_name, stops, total_distance_km, status, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(3);

  const recentRoutes = (routesData ?? []) as unknown as Pick<
    SavedRoute,
    "id" | "route_name" | "stops" | "total_distance_km" | "status" | "updated_at"
  >[];

  // Saved disposal facilities (latest 20)
  // NOTE: PostgREST returns the joined table data under the table name as the key,
  // not the alias. So the key is "disposal_facilities", not "facility".
  type SavedFacilityRow = {
    facility_id: string;
    disposal_facilities: Pick<DisposalFacility, "id" | "name" | "slug" | "facility_type" | "city" | "state"> | null;
  };

  const { data: savedDisposalRows } = await supabase
    .from("saved_disposal_facilities")
    .select("facility_id, disposal_facilities(id, name, slug, facility_type, city, state)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const savedFacilities = ((savedDisposalRows ?? []) as unknown as SavedFacilityRow[])
    .filter((r) => r.disposal_facilities !== null && r.disposal_facilities?.slug)
    .map((r) => r.disposal_facilities!);

  return (
    <DashboardClient
      userId={user.id}
      displayName={displayName}
      lists={lists}
      savedItems={savedItems}
      myListings={myListings}
      recentReports={recentReports}
      recentRoutes={recentRoutes}
      savedFacilities={savedFacilities}
    />
  );
}
