"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  reportName:  string;
  customerName: string;
  periodStart: string;
  periodEnd:   string;
};

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function DownloadPdfButton({ reportName, customerName, periodStart, periodEnd }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      // Dynamically load html2pdf.js from CDN
      await new Promise<void>((resolve, reject) => {
        if ((window as unknown as Record<string, unknown>)["html2pdf"]) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load html2pdf.js"));
        document.head.appendChild(script);
      });

      const element = document.getElementById("report-preview");
      if (!element) throw new Error("Report preview not found");

      const filename = `${toSlug(customerName)}_diversion_report_${periodStart}_${periodEnd}.pdf`;

      const html2pdf = (window as unknown as Record<string, unknown>)["html2pdf"] as (
        el: HTMLElement,
        opts: Record<string, unknown>
      ) => { save: () => void };

      html2pdf(element, {
        margin:      [10, 10, 10, 10],
        filename,
        image:       { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
      }).save();
    } catch (err) {
      console.error("PDF generation failed:", err);
      // Fallback to browser print
      window.print();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      onClick={handleDownload}
      disabled={loading}
      className="w-full gap-2 bg-[#2D6A4F] hover:bg-[#245a42] text-white"
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Download className="size-4" />
      )}
      {loading ? "Generating…" : "Download PDF"}
    </Button>
  );
}
