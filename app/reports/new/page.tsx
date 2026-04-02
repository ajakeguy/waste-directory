import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ReportForm } from "@/components/reports/ReportForm";

export const metadata: Metadata = {
  title: "New Diversion Report | WasteDirectory",
};

export default async function NewReportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/reports/new");

  // Fetch the most recent logo this user has uploaded so we can offer to reuse it
  const { data: prevReport } = await supabase
    .from("diversion_reports")
    .select("hauler_logo_url, hauler_name")
    .eq("user_id", user.id)
    .not("hauler_logo_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousLogoUrl  = prevReport?.hauler_logo_url  ?? null;
  const previousHaulerName = prevReport?.hauler_name ?? null;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New Diversion Report</h1>
        <p className="text-gray-500 text-sm mt-1">
          Fill in the details below. Your report will be saved as a draft.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ReportForm
          userId={user.id}
          previousLogoUrl={previousLogoUrl}
          previousHaulerName={previousHaulerName}
        />
      </div>
    </div>
  );
}
