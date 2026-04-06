import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/server";
import type { SavedRoute, RouteStop } from "@/types";

// RoutePrintClient handles map init, html2canvas capture, and window.print()
const RoutePrintClient = dynamic(
  () => import("@/components/routes/RoutePrintClient").then((m) => ({ default: m.RoutePrintClient })),
  { ssr: false }
);

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
  return { title: data ? `${data.route_name} — Print` : "Route Print" };
}

export default async function PrintRoutePage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/routes/${id}/print`);

  const { data } = await supabase
    .from("saved_routes")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) notFound();
  const route = data as SavedRoute;

  const orderedStops: RouteStop[] = route.optimized_order
    ? route.optimized_order.map((i) => route.stops[i]).filter(Boolean)
    : route.stops;

  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <RoutePrintClient route={route} orderedStops={orderedStops} today={today} />
  );
}
