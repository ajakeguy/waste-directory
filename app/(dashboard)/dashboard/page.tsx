import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { BookmarkX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { OrganizationCard } from "@/components/directory/OrganizationCard";
import type { Organization } from "@/types";

export const metadata: Metadata = {
  title: "Dashboard | WasteDirectory",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware should catch unauthenticated requests, but double-check here
  if (!user) redirect("/login");

  // Fetch public profile for display name
  const { data: profile } = await supabase
    .from("users")
    .select("name, user_type")
    .eq("id", user.id)
    .maybeSingle();

  const displayName = profile?.name ?? user.email ?? "there";

  // Fetch saved org IDs
  const { data: savedRows } = await supabase
    .from("saved_items")
    .select("item_id")
    .eq("user_id", user.id)
    .eq("item_type", "organization");

  const savedOrgIds = (savedRows ?? []).map(
    (r: { item_id: string }) => r.item_id
  );

  // Fetch the full org records for saved IDs
  let savedOrgs: Organization[] = [];
  if (savedOrgIds.length > 0) {
    const { data } = await supabase
      .from("organizations")
      .select("*")
      .in("id", savedOrgIds)
      .eq("active", true)
      .order("name");
    savedOrgs = (data ?? []) as Organization[];
  }

  const savedSet = new Set(savedOrgIds);

  return (
    <div>
      {/* Hero */}
      <section className="bg-[#2D6A4F] text-white py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-1">
            Dashboard
          </p>
          <h1 className="text-2xl font-bold">
            Welcome back, {displayName.split(" ")[0]}
          </h1>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        {/* Saved Haulers */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Saved Haulers
            </h2>
            {savedOrgs.length > 0 && (
              <Link
                href="/directory"
                className="text-sm text-[#2D6A4F] hover:underline"
              >
                Browse more →
              </Link>
            )}
          </div>

          {savedOrgs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <BookmarkX className="size-5 text-gray-400" />
              </div>
              <p className="font-medium text-gray-700 mb-1">
                No saved haulers yet
              </p>
              <p className="text-sm text-gray-500 mb-5">
                Browse the directory and click the{" "}
                <span className="text-rose-400">♥</span> on any hauler to save
                it here
              </p>
              <Link
                href="/directory"
                className="inline-flex h-9 items-center px-5 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
              >
                Browse the directory
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {savedOrgs.map((org) => (
                <OrganizationCard
                  key={org.id}
                  org={org}
                  savedOrgIds={savedSet}
                  userId={user.id}
                />
              ))}
            </div>
          )}
        </section>

        {/* Your Searches — placeholder for M5 */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Your Searches
          </h2>
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
            <p className="text-sm text-gray-400">
              Saved searches coming soon
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
