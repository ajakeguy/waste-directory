import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { RouteViewClient } from "@/components/routes/RouteViewClient";
import type { SavedRoute } from "@/types";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await supabase
    .from("saved_routes")
    .select("route_name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  return { title: data ? `${data.route_name} | WasteDirectory` : "Route | WasteDirectory" };
}

export default async function RouteViewPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/routes/${id}`);

  const { data } = await supabase
    .from("saved_routes")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) notFound();
  return <RouteViewClient route={data as SavedRoute} />;
}
