import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Plus, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DiversionReport } from "@/types";
import {
  getTotalTons,
  getDiversionRate,
  formatNumber,
} from "@/lib/diversion-calculations";

export const metadata: Metadata = {
  title: "Diversion Reports | WasteDirectory",
  description: "Create and manage professional waste diversion reports for your customers.",
};

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/reports");

  const { data } = await supabase
    .from("diversion_reports")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const reports = (data ?? []) as DiversionReport[];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Diversion Reports</h1>
          <p className="text-gray-500 text-sm mt-1">
            Generate professional waste diversion reports for your customers.
          </p>
        </div>
        <Link href="/reports/new" prefetch={false}>
          <Button className="bg-[#2D6A4F] hover:bg-[#245a42] text-white gap-2">
            <Plus className="size-4" />
            New Report
          </Button>
        </Link>
      </div>

      {/* Empty state */}
      {reports.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText className="size-10 text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">No reports yet</h2>
          <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
            Create your first diversion report to show customers their environmental impact.
          </p>
          <Link href="/reports/new" prefetch={false}>
            <Button className="bg-[#2D6A4F] hover:bg-[#245a42] text-white gap-2">
              <Plus className="size-4" />
              Create your first diversion report
            </Button>
          </Link>
        </div>
      )}

      {/* Report cards */}
      {reports.length > 0 && (
        <div className="space-y-3">
          {reports.map((report) => {
            const totalTons = getTotalTons(report.material_streams ?? []);
            const divRate   = getDiversionRate(report.material_streams ?? []);

            return (
              <div
                key={report.id}
                className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:border-[#2D6A4F]/30 transition-colors"
              >
                {/* Left: info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 truncate">{report.report_name}</h3>
                    <Badge
                      variant="outline"
                      className={
                        report.status === "published"
                          ? "border-[#2D6A4F]/30 text-[#2D6A4F] bg-[#2D6A4F]/5"
                          : "border-gray-200 text-gray-500"
                      }
                    >
                      {report.status === "published" ? "Published" : "Draft"}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600 mb-0.5">{report.customer_name}</p>
                  <p className="text-xs text-gray-400">
                    {fmtDate(report.period_start)} – {fmtDate(report.period_end)}
                  </p>
                </div>

                {/* Center: stats */}
                <div className="flex gap-6 text-center shrink-0">
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Managed</p>
                    <p className="text-base font-bold text-gray-900">{formatNumber(totalTons)} t</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Diversion</p>
                    <p className="text-base font-bold text-[#2D6A4F]">{formatNumber(divRate, 0)}%</p>
                  </div>
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <Link href={`/reports/${report.id}/edit`} prefetch={false}>
                    <Button variant="outline" size="sm">Edit</Button>
                  </Link>
                  <Link href={`/reports/${report.id}`} prefetch={false}>
                    <Button
                      size="sm"
                      className="bg-[#2D6A4F] hover:bg-[#245a42] text-white"
                    >
                      View
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
