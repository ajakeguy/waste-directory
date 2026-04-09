import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  MapPin,
  Phone,
  Mail,
  Globe,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Building2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getDisposalFacilityBySlug } from "@/lib/data/disposal";
import { createClient } from "@/lib/supabase/server";
import { DisposalSaveButton } from "@/components/disposal/DisposalSaveButton";
import {
  FACILITY_TYPE_LABELS,
  FACILITY_TYPE_COLORS,
} from "@/types";
import type { FacilityType } from "@/types";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const facility = await getDisposalFacilityBySlug(slug);
  if (!facility) return {};

  const typeLabel = FACILITY_TYPE_LABELS[facility.facility_type as FacilityType] ?? facility.facility_type;
  const location  = [facility.city, facility.state].filter(Boolean).join(", ");

  return {
    title: `${facility.name} | ${typeLabel} | WasteDirectory`,
    description: `${facility.name} is a ${typeLabel.toLowerCase()} located in ${location}. Find contact info, permit details, and accepted materials.`,
  };
}

// ── Accepted materials row ────────────────────────────────────────────────────

function MaterialRow({ label, accepted }: { label: string; accepted: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {accepted ? (
        <CheckCircle className="size-4 text-[#2D6A4F] shrink-0" />
      ) : (
        <XCircle className="size-4 text-gray-300 shrink-0" />
      )}
      <span className={accepted ? "text-gray-800" : "text-gray-400"}>{label}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DisposalFacilityPage({ params }: Props) {
  const { slug } = await params;
  const facility = await getDisposalFacilityBySlug(slug);

  if (!facility) notFound();

  // Check if the current user has saved this facility
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initialSaved = false;
  if (user) {
    const { data } = await supabase
      .from("saved_disposal_facilities")
      .select("id")
      .eq("user_id", user.id)
      .eq("facility_id", facility.id)
      .maybeSingle();
    initialSaved = !!data;
  }

  const typeLabel = FACILITY_TYPE_LABELS[facility.facility_type as FacilityType] ?? facility.facility_type;
  const typeColor = FACILITY_TYPE_COLORS[facility.facility_type as FacilityType] ?? "bg-gray-100 text-gray-700";

  const hasContact    = facility.phone || facility.email || facility.website || facility.operator_name;
  const hasDetails    = facility.permit_number || facility.permit_status || facility.permitted_capacity_tons_per_day || facility.hours_of_operation || facility.tipping_fee_per_ton;
  const hasMaterials  = facility.accepts_msw || facility.accepts_recycling || facility.accepts_cd || facility.accepts_organics || facility.accepts_hazardous || facility.accepts_special_waste;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href="/disposal"
        className="inline-flex items-center gap-1.5 text-sm text-[#2D6A4F] hover:underline mb-6"
      >
        <ArrowLeft className="size-4" />
        Disposal Facilities
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full ${typeColor}`}>
              {typeLabel}
            </span>
            {!facility.active && (
              <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-red-50 text-red-600">
                Closed / Inactive
              </span>
            )}
            {facility.verified && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[#2D6A4F]">
                <CheckCircle className="size-3.5" />
                Verified
              </span>
            )}
          </div>
          {user && (
            <DisposalSaveButton
              facilityId={facility.id}
              initialSaved={initialSaved}
              size="md"
            />
          )}
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2 mt-3">{facility.name}</h1>

        {(facility.address || facility.city) && (
          <div className="flex items-start gap-2 text-gray-600 text-sm">
            <MapPin className="size-4 shrink-0 mt-0.5" />
            <span>
              {[facility.address, facility.city, facility.state, facility.zip]
                .filter(Boolean)
                .join(", ")}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Contact Information */}
        {hasContact && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wider">
              Contact Information
            </h2>
            <div className="space-y-3">
              {facility.operator_name && (
                <div className="flex items-start gap-2">
                  <Building2 className="size-4 text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-gray-500">Operator</p>
                    <p className="text-sm text-gray-800">{facility.operator_name}</p>
                  </div>
                </div>
              )}
              {facility.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="size-4 text-gray-400 shrink-0" />
                  <a
                    href={`tel:${facility.phone.replace(/\D/g, "")}`}
                    className="text-sm text-[#2D6A4F] hover:underline"
                  >
                    {facility.phone}
                  </a>
                </div>
              )}
              {facility.email && (
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-gray-400 shrink-0" />
                  <a
                    href={`mailto:${facility.email}`}
                    className="text-sm text-[#2D6A4F] hover:underline"
                  >
                    {facility.email}
                  </a>
                </div>
              )}
              {facility.website && (
                <div className="flex items-center gap-2">
                  <Globe className="size-4 text-gray-400 shrink-0" />
                  <a
                    href={facility.website.startsWith("http") ? facility.website : `https://${facility.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#2D6A4F] hover:underline truncate"
                  >
                    {facility.website.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Facility Details */}
        {hasDetails && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wider">
              Facility Details
            </h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Type</dt>
                <dd className="text-gray-800 font-medium text-right">{typeLabel}</dd>
              </div>
              {facility.permit_number && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Permit No.</dt>
                  <dd className="text-gray-800 font-mono text-right">{facility.permit_number}</dd>
                </div>
              )}
              {facility.permit_status && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Permit Status</dt>
                  <dd className={`font-medium text-right capitalize ${
                    facility.permit_status === "active" ? "text-[#2D6A4F]" : "text-gray-500"
                  }`}>
                    {facility.permit_status}
                  </dd>
                </div>
              )}
              {facility.permitted_capacity_tons_per_day != null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Permitted Capacity</dt>
                  <dd className="text-gray-800 text-right">
                    {facility.permitted_capacity_tons_per_day.toLocaleString()} TPD
                  </dd>
                </div>
              )}
              {facility.tipping_fee_per_ton != null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Tipping Fee</dt>
                  <dd className="text-gray-800 text-right">
                    ${facility.tipping_fee_per_ton}/ton
                  </dd>
                </div>
              )}
              {facility.hours_of_operation && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Hours</dt>
                  <dd className="text-gray-800 text-right">{facility.hours_of_operation}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* Materials Accepted */}
        {(hasMaterials || true) && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wider">
              Materials Accepted
            </h2>
            <div className="grid grid-cols-2 gap-y-2">
              <MaterialRow label="Municipal Solid Waste" accepted={facility.accepts_msw} />
              <MaterialRow label="Recycling"             accepted={facility.accepts_recycling} />
              <MaterialRow label="C&D Debris"            accepted={facility.accepts_cd} />
              <MaterialRow label="Organics"              accepted={facility.accepts_organics} />
              <MaterialRow label="Hazardous Waste"       accepted={facility.accepts_hazardous} />
              <MaterialRow label="Special Waste"         accepted={facility.accepts_special_waste} />
            </div>
          </div>
        )}

        {/* Service Area */}
        {facility.service_area_states && facility.service_area_states.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wider">
              Service Area
            </h2>
            <div className="flex flex-wrap gap-2">
              {facility.service_area_states.map((s) => (
                <span
                  key={s}
                  className="text-xs font-medium bg-[#2D6A4F]/10 text-[#2D6A4F] px-2.5 py-1 rounded-full"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {facility.notes && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wider">
            Notes
          </h2>
          <p className="text-sm text-gray-600 leading-relaxed">{facility.notes}</p>
        </div>
      )}
    </div>
  );
}
