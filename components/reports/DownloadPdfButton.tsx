"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  reportId: string;
};

export function DownloadPdfButton({ reportId }: Props) {
  function handleDownload() {
    window.open(`/reports/${reportId}/print`, "_blank");
  }

  return (
    <Button
      onClick={handleDownload}
      className="w-full gap-2 bg-[#2D6A4F] hover:bg-[#245a42] text-white"
    >
      <Download className="size-4" />
      Download PDF
    </Button>
  );
}
