/**
 * app/haulers/[state]/page.tsx
 *
 * Handles two URL shapes under /haulers/:
 *   /haulers/vermont          → state landing page (search + pagination)
 *   /haulers/some-org-slug    → hauler profile page
 *
 * Next.js only allows one dynamic segment folder at this path level, so
 * both cases are handled here and branched on whether the segment matches
 * a known state slug.
 */

import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  CheckCircle,
  Phone,
  Mail,
  Globe,
  MapPin,
  ArrowLeft,
  UserCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { OrganizationCard } from "@/components/directory/OrganizationCard";
import { SearchBar } from "@/components/directory/SearchBar";
import { PerPageSelector } from "@/components/directory/PerPageSelector";
import { Pagination } from "@/components/directory/Pagination";
import {
  getOrganizationsByState,
  getOrganizationBySlug,
  getOrganizationContacts,
} from "@/lib/data/organizations";
import { getSavedOrgIds } from "@/lib/data/saved-items";
import { HaulerNotes } from "@/components/hauler/HaulerNotes";
import { ContributionSection } from "@/components/hauler/ContributionSection";
import { SuggestContactButton } from "@/components/shared/SuggestContactButton";
import { createClient } from "@/lib/supabase/server";
import {
  STATE_SLUG_TO_CODE,
  STATE_SLUG_TO_NAME,
  VALID_STATE_SLUGS,
  SERVICE_TYPE_LABELS,
} from "@/types";

const VALID_PER_PAGE = [25, 50, 100] as const;

// ── Shared types ──────────────────────────────────────────────────────────────

type Props = {
  params: Promise<{ state: string }>;
  searchParams: Promise<{
    search?: string;
    page?: string;
    per_page?: string;
  }>;
};

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state: segment } = await params;

  if (VALID_STATE_SLUGS.includes(segment)) {
    const stateName = STATE_SLUG_TO_NAME[segment];
    return {
      title: `${stateName} Waste Haulers | WasteDirectory`,
      description: `Find licensed waste haulers serving ${stateName}. Browse residential pickup, commercial services, roll-off containers, recycling, and more.`,
      openGraph: {
        title: `${stateName} Waste Haulers | WasteDirectory`,
        description: `The complete directory of waste haulers in ${stateName}.`,
      },
    };
  }

  // Hauler profile
  const org = await getOrganizationBySlug(segment);
  if (!org) return {};

  const serviceStates = org.service_area_states?.join(", ") ?? "";
  const description =
    org.description ??
    `${org.name} is a licensed waste hauler${serviceStates ? ` serving ${serviceStates}` : ""}. Find contact info, services offered, and more.`;

  return {
    title: `${org.name} - Waste Hauler | WasteDirectory`,
    description,
    openGraph: {
      title: `${org.name} | WasteDirectory`,
      description,
    },
  };
}

// Pre-render state landing pages at build time; hauler profiles are ISR
export function generateStaticParams() {
  return VALID_STATE_SLUGS.map((state) => ({ state }));
}

// ── State info banners ────────────────────────────────────────────────────────

type StateInfo = {
  source: string;
  govBody: string;
  requirements: string;
  lastUpdated: string;
};

const STATE_INFO: Record<string, StateInfo> = {
  connecticut: {
    source: "Connecticut Department of Energy and Environmental Protection (DEEP) and municipal hauler permit registrations",
    govBody: "CT DEEP, Waste Engineering and Enforcement Division",
    requirements:
      "Connecticut solid waste haulers must obtain permits from individual municipalities. CT DEEP regulates solid waste facilities under CGS Section 22a-208 et seq. Haulers transporting C&D debris or special waste must also comply with CT DEEP permit requirements. The state operates under a Solid Waste Management Plan requiring increasing diversion from disposal.",
    lastUpdated: "Data sourced from municipal permit registrations — coverage expanding",
  },
  maine: {
    source: "Maine DEP Non-Hazardous Waste Transporter List",
    govBody: "Maine Department of Environmental Protection (ME DEP)",
    requirements:
      "Waste transporters operating in Maine must be licensed by the ME DEP under 38 M.R.S. §1304. Licenses are renewed annually and categorized by waste type: A (Special/C&D), B (Municipal Solid Waste), and C (Septage). Operating without a valid license is a civil violation.",
    lastUpdated: "Updated from ME DEP active transporter list (2026)",
  },
  massachusetts: {
    source:
      "MassDEP Licensed Hazardous Waste Transporters list (March 2025) and municipal solid waste hauler permit registrations (in progress)",
    govBody: "Massachusetts Department of Environmental Protection (MassDEP)",
    requirements:
      "Massachusetts does not maintain a statewide solid waste hauler registration system — regulation is handled at the municipal level by each of the state's 351 cities and towns. This directory currently includes companies licensed by MassDEP to transport hazardous waste, many of which also provide general solid waste services. Municipal hauler permit data is being added progressively by city and town. All haulers must comply with MassDEP Waste Disposal Bans under 310 CMR 19.017.",
    lastUpdated:
      "MassDEP Hazardous Waste Transporter list updated monthly; municipal permit data added as available",
  },
  "new-hampshire": {
    source: "NH DES Registered Solid Waste Hauler List",
    govBody: "New Hampshire Department of Environmental Services (NH DES)",
    requirements:
      "Solid waste collectors operating in New Hampshire must register with NH DES under RSA 149-M:29-a. Registration is renewed annually and requires disclosure of company name, address, and contact information. Haulers must comply with the NH Solid Waste Management Act and applicable local ordinances.",
    lastUpdated: "Updated from NH DES registered hauler list (2025)",
  },
  "new-jersey": {
    source: "New Jersey DEP A-901 Solid Waste Transporter Licenses",
    govBody: "New Jersey Department of Environmental Protection (NJ DEP) — Division of Solid and Hazardous Waste",
    requirements:
      "Commercial solid waste transporters in New Jersey must hold an A-901 license issued by NJ DEP under N.J.S.A. 13:1E-126 et seq. The licensing process includes a criminal background investigation. Unlicensed transport of solid waste is a crime under New Jersey law. Licenses must be renewed every three years.",
    lastUpdated: "Updated from NJ DEP A-901 license database (2025–2026)",
  },
  "new-york": {
    source: "New York State DEC Solid Waste Transporter Registrations",
    govBody: "New York State Department of Environmental Conservation (NYSDEC)",
    requirements:
      "Solid waste transporters in New York must register with NYSDEC under 6 NYCRR Part 364. Registration requires a vehicle list, insurance certificates, and compliance with state solid waste regulations. NYC commercial haulers are additionally licensed by the Business Integrity Commission (BIC).",
    lastUpdated: "Updated from NYSDEC transporter registration data and NYC BIC license database (2025–2026)",
  },
  pennsylvania: {
    source: "Pennsylvania DEP Waste Hauler (WH) Registration Database",
    govBody: "Pennsylvania Department of Environmental Protection (PA DEP)",
    requirements:
      "Municipal and residual waste haulers in Pennsylvania must register with PA DEP under the Solid Waste Management Act (35 P.S. §§ 6018.101–6018.1003). Registration requires disclosure of vehicle information, insurance, and waste types transported. Registrations are renewed annually.",
    lastUpdated: "Updated from PA DEP waste hauler registration database (2025–2026)",
  },
  "rhode-island": {
    source: "Rhode Island Resource Recovery Corporation (RIRRC) Waste and Recycling Hauler List",
    govBody:
      "Rhode Island Resource Recovery Corporation (RIRRC) and RI Department of Environmental Management (RIDEM)",
    requirements:
      "Waste haulers operating in Rhode Island must register with RIRRC and comply with the Rhode Island Refuse Disposal Act (RIGL Chapter 23-18.9). Commercial haulers must also comply with the RI Recycling Act. RIRRC operates the Central Landfill in Johnston, RI — the state's primary disposal facility. Haulers transporting C&D debris must follow additional RIDEM regulations.",
    lastUpdated: "Updated from RIRRC hauler list (October 2024)",
  },
  vermont: {
    source: "Vermont DEC Solid Waste Hauler Permit Database",
    govBody: "Vermont Department of Environmental Conservation (VT DEC) — Waste Management & Prevention Division",
    requirements:
      "Solid waste haulers in Vermont must hold a permit issued by VT DEC under 10 V.S.A. Chapter 159. Permits specify the types of waste authorized for collection and transport. Haulers must comply with Vermont's Universal Recycling Law (Act 148), which requires separate collection of food scraps, leaf and yard debris, and recyclables.",
    lastUpdated: "Updated from VT DEC solid waste permit database (2025)",
  },
};

// ── State landing page ────────────────────────────────────────────────────────

function ResultsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
          <Skeleton className="h-5 w-48 mb-2" />
          <Skeleton className="h-4 w-32 mb-4" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function StateResults({
  stateCode,
  stateName,
  search,
  page,
  perPage,
  userId,
}: {
  stateCode: string;
  stateName: string;
  search?: string;
  page: number;
  perPage: number;
  userId: string | null;
}) {
  const [{ data: organizations, count: total }, savedOrgIds] =
    await Promise.all([
      getOrganizationsByState(stateCode, { search, page, perPage }),
      userId ? getSavedOrgIds(userId) : Promise.resolve(new Set<string>()),
    ]);

  if (total === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-lg font-medium text-gray-700 mb-1">
          No haulers found
        </p>
        <p className="text-sm text-gray-500">
          {search
            ? 'No results for "' + search + '". Try a different search term.'
            : "Check back as we add more listings."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        {total.toLocaleString()} hauler{total !== 1 ? "s" : ""} found in{" "}
        {stateName}
      </p>
      {organizations.map((org) => (
        <OrganizationCard
          key={org.id}
          org={org}
          savedOrgIds={savedOrgIds}
          userId={userId}
        />
      ))}
      <Suspense fallback={null}>
        <Pagination page={page} pageSize={perPage} total={total} />
      </Suspense>
    </div>
  );
}

async function StateLandingPage({
  segment,
  search,
  page,
  perPage,
}: {
  segment: string;
  search?: string;
  page: number;
  perPage: number;
}) {
  const stateCode = STATE_SLUG_TO_CODE[segment];
  const stateName = STATE_SLUG_TO_NAME[segment];

  if (!stateCode || !stateName) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div>
      {/* State hero */}
      <section className="bg-[#2D6A4F] text-white py-14 px-4">
        <div className="max-w-5xl mx-auto">
          <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-2">
            Waste Hauler Directory
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">{stateName}</h1>
          <p className="text-white/80 text-lg">
            Licensed waste haulers serving {stateName}
          </p>
        </div>
      </section>

      {/* Search + results */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* About this data banner */}
        {STATE_INFO[segment] && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">
              About this data
            </h2>
            <div className="space-y-3 text-sm text-gray-600">
              <p>
                <span className="font-medium text-gray-800">Data source:</span>{" "}
                {STATE_INFO[segment].source}
              </p>
              <p>
                <span className="font-medium text-gray-800">Governing body:</span>{" "}
                {STATE_INFO[segment].govBody}
              </p>
              <p>
                <span className="font-medium text-gray-800">Operating requirements:</span>{" "}
                {STATE_INFO[segment].requirements}
              </p>
              <p className="text-xs text-gray-400 border-t border-gray-100 pt-3 mt-1">
                {STATE_INFO[segment].lastUpdated}
              </p>
            </div>
          </div>
        )}

        {/* Toolbar: search bar + per-page selector */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="flex-1">
            <Suspense
              fallback={
                <div className="w-full h-[42px] rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />
              }
            >
              <SearchBar paramName="search" />
            </Suspense>
          </div>
          <Suspense fallback={null}>
            <PerPageSelector />
          </Suspense>
        </div>

        {/* Results list */}
        <Suspense fallback={<ResultsSkeleton />}>
          <StateResults
            stateCode={stateCode}
            stateName={stateName}
            search={search}
            page={page}
            perPage={perPage}
            userId={user?.id ?? null}
          />
        </Suspense>

        {/* Add missing hauler banner */}
        <div className="mt-8 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-600">
            Don&apos;t see a hauler you know about?
          </p>
          <Link
            href="/submit"
            className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-[#2D6A4F] hover:underline"
          >
            Add a missing hauler →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Hauler profile page ───────────────────────────────────────────────────────

/** Human-readable labels for license_metadata keys. */
const LICENSE_METADATA_LABELS: Record<string, string> = {
  // New Jersey A-901
  nj_county:                  "County",
  nj_njems_pi:                "NJEMS PI Number",
  nj_a901_bill:               "A-901 License #",
  nj_dep_number:              "DEP Registration #",
  nj_site_city:               "Site City",
  // Maine DEP
  me_waste_category:          "Waste Categories (ME)",
  me_category_descriptions:   "Waste Types",
  me_license_expiry:          "License Expiry",
  // Pennsylvania DEP
  pa_wh_id:                   "WH Number (PA)",
  pa_license_id:              "License ID (PA)",
  pa_client_id:               "Client ID (PA)",
  // Vermont DEC
  vt_permit_type:             "Permit Type (VT)",
  vt_permit_number:           "Permit Number (VT)",
  vt_waste_type_raw:          "Waste Type (VT)",
  // Massachusetts DEP Hazardous Waste
  ma_hw_license:              "HW License #",
  ma_hw_expiration:           "License Expiry",
  ma_hw_epa_number:           "EPA ID Number",
  // New Hampshire DES
  nh_date_registered:         "Registered Since",
  // nh_contact_name / nh_contact_email / nh_website → surfaced in Contact Information
  // Rhode Island RIRRC
  ri_materials_hauled:        "Materials Hauled (RI)",
  // ri_contact_name / ri_contact_email → surfaced in Contact Information
  // NYC BIC
  bic_number:                 "BIC License Number",
  boro:                       "Borough",
  authorized_recycling_type:  "Recycling Authorization",
  renewal:                    "Renewal",
  effective_date:             "Effective Date",
};

/** Fallback: convert a raw metadata key to a readable label. */
function formatMetadataKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Human-readable label for a contact source identifier. */
function contactSourceLabel(source: string | null): string | null {
  if (!source) return null;
  if (source === "vt_dec_permit_2025") return "From VT permit registry";
  return null;
}

async function HaulerProfilePage({ segment }: { segment: string }) {
  const org = await getOrganizationBySlug(segment);
  if (!org) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch the user's saved item for this org (notes + save state)
  let savedNote: string | null = null;
  let isSaved = false;

  if (user) {
    const { data: savedRow } = await supabase
      .from("saved_items")
      .select("id, notes")
      .eq("user_id", user.id)
      .eq("item_id", org.id)
      .eq("item_type", "organization")
      .maybeSingle();

    if (savedRow) {
      isSaved = true;
      savedNote = savedRow.notes ?? null;
    }
  }

  const orgContacts = await getOrganizationContacts(org.id);

  // ── Surface contact/website fields stored in license_metadata ────────────────
  // Any key ending in _website, _contact_name, or _contact_email from ANY state
  // is shown in Contact Information rather than the License section.
  const meta = org.license_metadata ?? {};
  const metaWebsite     = Object.entries(meta).find(([k]) => k.endsWith("_website"))?.[1]      ?? null;
  const metaContactName = Object.entries(meta).find(([k]) => k.endsWith("_contact_name"))?.[1] ?? null;
  const metaContactEmail= Object.entries(meta).find(([k]) => k.endsWith("_contact_email"))?.[1]?? null;

  // Priority: org column → license_metadata fallback
  const displayWebsite      = org.website      || metaWebsite      || null;
  const displayContactEmail = org.email        || metaContactEmail  || null;

  // Normalise URL: prepend https:// if the stored value has no scheme
  const websiteHref = displayWebsite
    ? (displayWebsite.startsWith("http") ? displayWebsite : `https://${displayWebsite}`)
    : null;
  const websiteLabel = displayWebsite ? displayWebsite.replace(/^https?:\/\//, "") : null;

  // Keys to suppress in the License section (surfaced in Contact Information instead)
  const CONTACT_META_SUFFIXES = ["_website", "_contact_name", "_contact_email"];
  const isContactMeta = (key: string) =>
    CONTACT_META_SUFFIXES.some((suffix) => key.endsWith(suffix));

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
        <Link href="/directory" prefetch={false} className="hover:text-[#2D6A4F] transition-colors">
          Directory
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
        {!org.phone && !displayContactEmail && !displayWebsite && !metaContactName ? (
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
            {/* Contact name from license_metadata (e.g. nh_contact_name) */}
            {metaContactName && (
              <div className="flex items-center gap-3 text-sm">
                <UserCircle className="size-4 text-gray-400 shrink-0" />
                <span className="text-gray-700">{metaContactName}</span>
              </div>
            )}
            {/* Email: org column first, then license_metadata fallback */}
            {displayContactEmail && (
              <div className="flex items-center gap-3 text-sm">
                <Mail className="size-4 text-gray-400 shrink-0" />
                <a
                  href={`mailto:${displayContactEmail}`}
                  className="text-gray-700 hover:text-[#2D6A4F] transition-colors"
                >
                  {displayContactEmail}
                </a>
              </div>
            )}
            {/* Website: org column first, then license_metadata fallback */}
            {websiteHref && websiteLabel && (
              <div className="flex items-center gap-3 text-sm">
                <Globe className="size-4 text-gray-400 shrink-0" />
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-700 hover:text-[#2D6A4F] transition-colors"
                >
                  {websiteLabel}
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
                {SERVICE_TYPE_LABELS[type as keyof typeof SERVICE_TYPE_LABELS] ??
                  type}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {/* Service area — ALL states shown as badges */}
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

      {/* License & Authorization Details — shown only when non-contact license keys exist */}
      {org.license_metadata !== null &&
        org.license_metadata !== undefined &&
        Object.entries(org.license_metadata).some(([k, v]) => v && !isContactMeta(k)) && (
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">
            License &amp; Authorization Details
          </h2>
          <dl className="space-y-2">
            {Object.entries(org.license_metadata).map(([key, value]) => {
              // Skip blank values and contact-type fields (shown in Contact Information)
              if (!value) return null;
              if (isContactMeta(key)) return null;
              const label = LICENSE_METADATA_LABELS[key] ?? formatMetadataKey(key);
              return (
                <div key={key} className="flex gap-3 text-sm">
                  <dt className="text-gray-500 shrink-0 min-w-[140px]">{label}</dt>
                  <dd className="text-gray-900 font-medium">{value}</dd>
                </div>
              );
            })}
          </dl>
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

      {/* Contacts */}
      {orgContacts.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="font-semibold text-gray-900 mb-4">Contacts</h2>
          <div className="space-y-4">
            {orgContacts.map((contact) => (
              <div key={contact.id} className="flex items-start gap-3">
                <UserCircle className="size-5 text-gray-300 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  {contact.name && (
                    <p className="text-sm font-medium text-gray-900">
                      {contact.name}
                    </p>
                  )}
                  {contact.title && (
                    <p className="text-xs text-gray-500">{contact.title}</p>
                  )}
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      className="flex items-center gap-1 text-xs text-gray-600 hover:text-[#2D6A4F] transition-colors mt-0.5"
                    >
                      <Phone className="size-3 shrink-0" />
                      {contact.phone}
                    </a>
                  )}
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="flex items-center gap-1 text-xs text-gray-600 hover:text-[#2D6A4F] transition-colors mt-0.5"
                    >
                      <Mail className="size-3 shrink-0" />
                      {contact.email}
                    </a>
                  )}
                  {contactSourceLabel(contact.source) && (
                    <p className="text-xs text-gray-400 mt-1">
                      {contactSourceLabel(contact.source)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Suggest a contact */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-3">Know a Contact?</h2>
        <p className="text-sm text-gray-500 mb-3">
          Help others by submitting contact information for this hauler.
          Submissions are reviewed before being added.
        </p>
        <SuggestContactButton
          entityType="hauler"
          entityId={org.id}
          isLoggedIn={!!user}
        />
      </section>

      {/* My Notes — visible to logged-in users only */}
      <HaulerNotes
        orgId={org.id}
        userId={user?.id ?? null}
        isSaved={isSaved}
        initialNote={savedNote}
      />

      {/* Community contributions */}
      <ContributionSection
        orgId={org.id}
        stateCode={org.state ?? ""}
        isLoggedIn={!!user}
      />

      {/* Footer */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-100 mt-2">
        <Link
          href="/directory"
          prefetch={false}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2D6A4F] transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to directory
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

// ── Route entry point ─────────────────────────────────────────────────────────

export default async function HaulerOrStatePage({ params, searchParams }: Props) {
  const { state: segment } = await params;
  const sp = await searchParams;

  if (VALID_STATE_SLUGS.includes(segment)) {
    const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
    const rawPerPage = parseInt(sp.per_page ?? "25", 10);
    const perPage = (VALID_PER_PAGE as readonly number[]).includes(rawPerPage)
      ? rawPerPage
      : 25;

    return (
      <StateLandingPage
        segment={segment}
        search={sp.search}
        page={page}
        perPage={perPage}
      />
    );
  }

  return <HaulerProfilePage segment={segment} />;
}
