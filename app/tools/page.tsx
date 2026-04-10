import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Route, FileText, CheckCircle2, TrendingUp } from "lucide-react";

export const metadata: Metadata = {
  title: "Industry Tools | waste.markets",
  description:
    "Route optimization for waste collection runs and diversion reports for compliance — built for waste industry professionals.",
};

const tools = [
  {
    icon: TrendingUp,
    title: "Market Prices",
    description:
      "Track diesel, recyclable commodity, and natural gas prices relevant to your operations — updated daily from EIA and FRED public data.",
    features: [
      "Diesel & crude oil (EIA daily)",
      "OCC, plastics, aluminum prices",
      "Natural gas & electricity rates",
      "Community price submissions",
    ],
    href: "/prices",
    cta: "View Prices",
    color: "bg-amber-50 text-amber-600",
    border: "hover:border-amber-300",
  },
  {
    icon: Route,
    title: "Route Optimizer",
    description:
      "Plan optimized collection routes for multiple stops. Upload stop lists, calculate distances, estimate fuel costs, and export optimized route as CSV.",
    features: [
      "Multi-stop TSP optimization",
      "Fuel cost calculator",
      "CSV export",
      "Saved routes",
    ],
    href: "/routes",
    cta: "Open Route Optimizer",
    color: "bg-blue-50 text-blue-600",
    border: "hover:border-blue-300",
  },
  {
    icon: FileText,
    title: "Diversion Reports",
    description:
      "Generate professional diversion reports for compliance and client reporting. Track material streams, calculate diversion rates, and export branded PDFs.",
    features: [
      "Material stream tracking",
      "EPA WARM equivalencies",
      "Branded PDF export",
      "Dashboard history",
    ],
    href: "/reports",
    cta: "Create Report",
    color: "bg-green-50 text-green-600",
    border: "hover:border-green-300",
  },
];

export default function ToolsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Industry Tools
        </h1>
        <p className="text-gray-500">
          Operational tools built for waste collection companies and waste
          managers — from planning routes to generating compliance reports.
        </p>
      </div>

      {/* Tool cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <div
              key={tool.href}
              className={`bg-white rounded-2xl border border-gray-200 p-8 flex flex-col transition-all hover:shadow-md ${tool.border}`}
            >
              {/* Icon + title */}
              <div className="flex items-start gap-4 mb-4">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${tool.color}`}
                >
                  <Icon className="size-6" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {tool.title}
                  </h2>
                </div>
              </div>

              {/* Description */}
              <p className="text-gray-600 text-sm leading-relaxed mb-5">
                {tool.description}
              </p>

              {/* Feature list */}
              <ul className="space-y-2 mb-8 flex-1">
                {tool.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <CheckCircle2 className="size-4 text-[#2D6A4F] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Link
                href={tool.href}
                className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[#2D6A4F] text-white text-sm font-semibold hover:bg-[#245a42] transition-colors self-start"
              >
                {tool.cta} →
              </Link>
            </div>
          );
        })}
      </div>

      {/* More coming */}
      <div className="mt-10 rounded-xl border border-dashed border-gray-200 p-8 text-center">
        <MapPin className="size-8 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-500">More tools coming soon</p>
        <p className="text-xs text-gray-400 mt-1">
          Cost calculators, fleet tracking integrations, and more.
        </p>
      </div>
    </div>
  );
}
