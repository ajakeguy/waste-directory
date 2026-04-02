"use client";

/**
 * Screen-only toolbar shown at the top of the print page.
 * Hidden automatically via @media print CSS on the parent page.
 */
export function PrintToolbar() {
  return (
    <div
      id="print-toolbar"
      className="sticky top-0 z-50 bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 print:hidden"
    >
      <span className="text-sm text-gray-500">
        Your browser&rsquo;s print / save-as-PDF dialog will open automatically.
      </span>
      <button
        onClick={() => window.print()}
        className="ml-auto inline-flex h-8 items-center px-4 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
      >
        Print / Save PDF
      </button>
      <button
        onClick={() => window.close()}
        className="inline-flex h-8 items-center px-4 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
      >
        Close
      </button>
    </div>
  );
}
