import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ReportForm } from "@/components/reports/ReportForm";
import type { DiversionReport } from "@/types";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = {
  title: "Edit Diversion Report | WasteDirectory",
};

export default async function EditReportPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/reports/${id}/edit`);

  const { data } = await supabase
    .from("diversion_reports")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) notFound();
  const report = data as DiversionReport;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Edit Report</h1>
        <p className="text-gray-500 text-sm mt-1">{report.report_name}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ReportForm userId={user.id} report={report} />
      </div>
    </div>
  );
}
