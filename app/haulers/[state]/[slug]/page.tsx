import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle, Phone, Mail, Globe, MapPin, ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getOrganizationBySlug } from "@/lib/data/organizations";
import {
  STATE_SLUG_TO_CODE,
  STATE_SLUG_TO_NAME,
  SERVICE_TYPE_LABELS,
} from "@/types";

type Props = {
  params: Promise<{ state: string; slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, state: stateSlug } = await params;
  const org = await getOrganizationBySlug(slug);
  if (!org) return {};

  const stateName = STATE_SLUG_TO_NAME[stateSlug] ?? stateSlug;
  const location = [org.city, org.state].filter(Boolean).join(", ");

  return {
    title: `${org.name} | ${stateName} Waste Hauler | WasteDirectory`,
    description:
      org.description ??
      `${org.name} is a waste hauler serving ${location}. Find contact info, services offered, and more.`,
    openGraph: {
      title: `${org.name} | WasteDirectory`,
      description:
        org.description ??
        `Waste hauler serving ${location}.`,
    },
  };
}

export default async function HaulerProfilePage({ params }: Props) {
  const { state: stateSlug, slug } = await params;

  const stateCode = STATE_SLUG_TO_CODE[stateSlug];
  if (!stateCode) notFound();

  const org = await getOrganizationBySlug(slug);
  if (!org || org.state !== stateCode) notFound();

  const stateName = STATE_SLUG_TO_NAME[stateSlug] ?? stateSlug;

  const correctionSubject = encodeURIComponent(
    `Correction suggestion: ${org.name}`
  );
  const correctionBody = encodeURIComponent(
    `Hi,\n\nI'd like to suggest a correction for the following listing:\n\nCompany: ${org.name}\nSlug: ${org.slug}\n\nCorrection:\n`
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 mb-6">
        <Link href="/directory" className="hover:text-[#2D6A4F] transition-colors">
          Directory
        </Link>
        <span>/</span>
        <Link
          href={`/haulers/${stateSlug}`}
          className="hover:text-[#2D6A4F] transition-colors"
        >
          {stateName}
        </Link>
        <span>/</span>
        <span className="text-gray-700 truncate">{org.name}</span>
      </nav>

      {/* Company header */}
      <div className="mb-6">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight">
            {org.name}
          </h1>
          {org.verified && (
            <Badge className="bg-[#2D6A4F]/10 text-[#2D6A4F] border-0 mt-1 shrink-0">
              <CheckCircle className="size-3.5 mr-1" />
              Verified
            </Badge>
          )}
        </div>
        {(org.city || org.state) && (
          <p className="flex items-center gap-1.5 text-gray-500 mt-1.5">
            <MapPin className="size-4 shrink-0" />
            {[org.address, org.city, org.state, org.zip]
              .filter(Boolean)
              .join(", ")}
          </p>
        )}
      </div>

      {/* Contact info */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">
          Contact Information
        </h2>
        {!org.phone && !org.email && !org.website ? (
          <p className="text-sm text-gray-400">
            No contact information on file.
          </p>
        ) : (
          <div className="space-y-3">
            {org.phone && (
              <div className="flex items-center gap-3 text-sm">
                <Phone className="size-4 text-gray-400 shrink-0" />
                <a
                  href={`tel:${org.phone}`}
                  className="text-gray-700 hover:text-[#2D6A4F] transition-colors"
                >
                  {org.phone}
                </a>
              </div>
            )}
            {org.email && (
              <div className="flex items-center gap-3 text-sm">
                <Mail className="size-4 text-gray-400 shrink-0" />
                <a
                  href={`mailto:${org.email}`}
                  className="text-gray-700 hover:text-[#2D6A4F] transition-colors"
                >
                  {org.email}
                </a>
              </div>
            )}
            {org.website && (
              <div className="flex items-center gap-3 text-sm">
                <Globe className="size-4 text-gray-400 shrink-0" />
                <a
                  href={org.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-700 hover:text-[#2D6A4F] transition-colors"
                >
                  {org.website.replace(/^https?:\/\//, "")}
                </a>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Services */}
      {org.service_types && org.service_types.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">
            Services Offered
          </h2>
          <div className="flex flex-wrap gap-2">
            {org.service_types.map((type) => (
              <Badge key={type} variant="outline">
                {SERVICE_TYPE_LABELS[
                  type as keyof typeof SERVICE_TYPE_LABELS
                ] ?? type}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {/* Service area states */}
      {org.service_area_states && org.service_area_states.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">Service Area</h2>
          <div className="flex flex-wrap gap-2">
            {org.service_area_states.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {/* Description */}
      {org.description && (
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">About</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            {org.description}
          </p>
        </section>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-100 mt-2">
        <Link
          href={`/haulers/${stateSlug}`}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2D6A4F] transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to {stateName} haulers
        </Link>

        <a
          href={`mailto:hello@wastedirectory.com?subject=${correctionSubject}&body=${correctionBody}`}
          className="text-sm text-gray-400 hover:text-gray-600 underline underline-offset-4"
        >
          Suggest a correction
        </a>
      </div>
    </div>
  );
}
