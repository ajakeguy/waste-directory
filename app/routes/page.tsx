import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Plus, MapPin, Route, Trash2 } from "lucide-react";
import type { SavedRoute } from "@/types";

export const metadata: Metadata = {
  title: "Route Optimizer | WasteDirectory",
};

export default async function RoutesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/routes");

  const { data } = await supabase
    .from("saved_routes")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const routes = (data ?? []) as SavedRoute[];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Route Optimizer</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Build, optimize, and save pickup routes for your fleet.
          </p>
        </div>
        <Link
          href="/routes/new"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
        >
          <Plus className="size-4" />
          New Route
        </Link>
      </div>

      {routes.length === 0 ? (
        /* Empty state */
        <div className="rounded-xl border border-dashed border-gray-200 py-20 text-center px-4">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Route className="size-6 text-gray-400" />
          </div>
          <p className="font-semibold text-gray-700 mb-1">No saved routes yet</p>
          <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
            Enter your stops, geocode addresses, and run the optimizer to get the
            shortest route in seconds.
          </p>
          <Link
            href="/routes/new"
            className="inline-flex h-9 items-center px-5 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
          >
            Build your first route
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {routes.map((route) => (
            <div
              key={route.id}
              className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 hover:border-[#2D6A4F]/30 hover:shadow-sm transition-all"
            >
              <div className="w-10 h-10 rounded-full bg-[#2D6A4F]/10 flex items-center justify-center shrink-0">
                <MapPin className="size-4 text-[#2D6A4F]" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 truncate">{route.route_name}</p>
                <p className="text-sm text-gray-500 truncate">
                  {route.stops.length} stop{route.stops.length !== 1 ? "s" : ""}
                  {route.total_distance_km
                    ? ` · ${route.total_distance_km.toFixed(1)} km`
                    : ""}
                  {" · "}
                  {new Date(route.created_at).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                  })}
                </p>
              </div>

              <span
                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                  route.status === "optimized"
                    ? "bg-[#2D6A4F]/10 text-[#2D6A4F]"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {route.status === "optimized" ? "Optimized" : "Draft"}
              </span>

              <Link
                href={`/routes/${route.id}`}
                className="shrink-0 inline-flex h-8 items-center px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Open
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
