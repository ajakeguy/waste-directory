import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { RouteBuilder } from "@/components/routes/RouteBuilder";
import type { SavedRoute } from "@/types";

export const metadata: Metadata = { title: "Edit Route | WasteDirectory" };

type Props = { params: Promise<{ id: string }> };

export default async function EditRoutePage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/routes/${id}/edit`);

  const { data } = await supabase
    .from("saved_routes")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) notFound();
  const route = data as SavedRoute;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Edit Route</h1>
        <p className="text-gray-500 text-sm mt-1">{route.route_name}</p>
      </div>
      <RouteBuilder userId={user.id} existingRoute={route} />
    </div>
  );
}
