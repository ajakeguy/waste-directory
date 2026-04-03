import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PrintTrigger } from "@/components/reports/PrintTrigger";
import { PrintToolbar } from "@/components/reports/PrintToolbar";
import { haversineDistance } from "@/lib/route-optimizer";
import type { SavedRoute, RouteStop } from "@/types";

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

function distKm(a: RouteStop, b: RouteStop): string {
  if (!a.lat || !a.lng || !b.lat || !b.lng) return "—";
  return haversineDistance(a.lat, a.lng, b.lat, b.lng).toFixed(1) + " km";
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
    <>
      <style>{`
        @media print {
          header, nav, footer, #print-toolbar { display: none !important; }
          body > * { visibility: hidden !important; }
          #print-route, #print-route * { visibility: visible !important; }
          #print-route {
            position: absolute; top: 0; left: 0; width: 100%; margin: 0; padding: 0;
          }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          @page { size: A4; margin: 14mm 14mm; }
        }
      `}</style>

      <PrintToolbar />

      <div id="print-route" className="max-w-3xl mx-auto px-4 py-6 print:p-0 print:max-w-none">

        {/* Header */}
        <div className="bg-[#2D6A4F] text-white rounded-xl p-6 mb-6 print:rounded-none">
          <p className="text-xs font-bold uppercase tracking-widest text-white/60 mb-1">Route Sheet</p>
          <h1 className="text-2xl font-bold mb-2">{route.route_name}</h1>
          <div className="flex flex-wrap gap-4 text-sm text-white/80">
            <span>{orderedStops.length} stops</span>
            {route.total_distance_km && (
              <span>{route.total_distance_km.toFixed(1)} km total</span>
            )}
            <span>Generated {today}</span>
          </div>
        </div>

        {/* Stop table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-0 print:rounded-none">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-10">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name / Address</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Dist. from prev</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {/* Start */}
              <tr className="bg-green-50">
                <td className="px-4 py-3">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-xs font-bold">S</span>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-0.5">Start — Depot / Garage</p>
                  <p className="text-gray-800">{route.start_address}</p>
                </td>
                <td className="px-4 py-3 text-right text-gray-400">—</td>
              </tr>

              {/* Stops */}
              {orderedStops.map((stop, i) => {
                const prev = i === 0 ? null : orderedStops[i - 1];
                const dist = prev ? distKm(prev, stop) : "—";
                return (
                  <tr key={stop.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold">{i + 1}</span>
                    </td>
                    <td className="px-4 py-3">
                      {stop.name && <p className="font-medium text-gray-700 mb-0.5">{stop.name}</p>}
                      <p className="text-gray-600">{stop.address}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">{dist}</td>
                  </tr>
                );
              })}

              {/* End */}
              <tr className="bg-red-50">
                <td className="px-4 py-3">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold">E</span>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-0.5">End — Disposal Facility</p>
                  <p className="text-gray-800">{route.end_address}</p>
                </td>
                <td className="px-4 py-3 text-right text-gray-400">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        {route.total_distance_km && (
          <p className="text-right text-sm text-gray-500 mt-3 pr-1">
            Total route distance: <strong>{route.total_distance_km.toFixed(1)} km</strong>
          </p>
        )}

        <p className="text-xs text-gray-400 text-center mt-8">
          WasteDirectory.com · Route Optimizer
        </p>
      </div>

      <PrintTrigger />
    </>
  );
}
