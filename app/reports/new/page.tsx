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

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New Diversion Report</h1>
        <p className="text-gray-500 text-sm mt-1">
          Fill in the details below. Your report will be saved as a draft.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ReportForm userId={user.id} />
      </div>
    </div>
  );
}
