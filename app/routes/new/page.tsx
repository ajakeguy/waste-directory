import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { RouteBuilder } from "@/components/routes/RouteBuilder";

export const metadata: Metadata = {
  title: "New Route | WasteDirectory",
};

export default async function NewRoutePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/routes/new");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New Route</h1>
        <p className="text-gray-500 text-sm mt-1">
          Add your stops, geocode addresses, then hit Optimize to get the shortest route.
        </p>
      </div>
      <RouteBuilder userId={user.id} />
    </div>
  );
}
