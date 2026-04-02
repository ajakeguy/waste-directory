import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ReportPreview } from "@/components/reports/ReportPreview";
import { PrintTrigger } from "@/components/reports/PrintTrigger";
import { PrintToolbar } from "@/components/reports/PrintToolbar";
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
  return { title: `${data.report_name} — Print | WasteDirectory` };
}

export default async function PrintReportPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/reports/${id}/print`);

  const { data } = await supabase
    .from("diversion_reports")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) notFound();
  const report = data as DiversionReport;

  return (
    <>
      {/* Print-specific global styles injected into <head> via Next.js */}
      <style>{`
        @media print {
          /* Hide navigation, toolbar and any chrome */
          header, nav, footer, #print-toolbar { display: none !important; }

          /* Hide everything, then reveal only the report */
          body > * { visibility: hidden !important; }
          #print-report,
          #print-report * { visibility: visible !important; }
          #print-report {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            margin: 0;
            padding: 0;
          }

          /* Force colour printing */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

          @page {
            size: A4;
            margin: 12mm 14mm;
          }
        }
      `}</style>

      {/* Toolbar — screen only, hidden on print via .print:hidden + the CSS above */}
      <PrintToolbar />

      {/* Report body — this is what gets printed */}
      <div
        id="print-report"
        className="max-w-4xl mx-auto px-4 py-6 print:p-0 print:max-w-none"
      >
        <ReportPreview report={report} />
      </div>

      {/* Auto-trigger the print dialog after images/fonts load */}
      <PrintTrigger />
    </>
  );
}
