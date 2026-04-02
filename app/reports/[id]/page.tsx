import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ReportPreview } from "@/components/reports/ReportPreview";
import { DownloadPdfButton } from "@/components/reports/DownloadPdfButton";
import { DeleteReportButton } from "@/components/reports/DeleteReportButton";
import type { DiversionReport } from "@/types";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await supabase
    .from("diversion_reports")
    .select("report_name, customer_name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return {};
  return {
    title: `${data.report_name} | WasteDirectory`,
    description: `Diversion report for ${data.customer_name}`,
  };
}

export default async function ReportViewPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/reports/${id}`);

  const { data } = await supabase
    .from("diversion_reports")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) notFound();
  const report = data as DiversionReport;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Back link */}
      <Link
        href="/reports"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="size-3.5" />
        All reports
      </Link>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* ── Preview (left / main) */}
        <div className="flex-1 min-w-0">
          <ReportPreview report={report} />
        </div>

        {/* ── Actions sidebar (right) */}
        <div className="w-full lg:w-56 shrink-0 space-y-3 lg:sticky lg:top-24">
          <Link href={`/reports/${id}/edit`} className="block">
            <Button variant="outline" className="w-full gap-2">
              <Pencil className="size-4" />
              Edit Report
            </Button>
          </Link>

          <DownloadPdfButton reportId={id} />

          <div className="pt-2 border-t border-gray-100">
            <DeleteReportButton reportId={id} />
          </div>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #report-preview, #report-preview * { visibility: visible; }
          #report-preview { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
}
