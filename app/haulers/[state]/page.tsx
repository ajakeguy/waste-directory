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
      </div>
    </div>
  );
}

// ── Hauler profile page ───────────────────────────────────────────────────────

/** Human-readable labels for license_metadata keys. */
const LICENSE_METADATA_LABELS: Record<string, string> = {
  me_waste_category:  "Waste Categories (ME)",
  bic_number:         "BIC License Number",
  boro:               "Borough",
  renewal:            "License Renewal Date",
  pa_wh_id:           "PA Hauler ID",
  pa_license_id:      "PA License ID",
  pa_client_id:       "PA Client ID",
  vt_permit_type:     "Permit Type",
  vt_permit_number:   "Permit Year",
  vt_waste_type_raw:  "Waste Type Codes",
};

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

      {/* License & Authorization Details — shown whenever column exists */}
      {org.license_metadata !== null && org.license_metadata !== undefined && (
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">
            License &amp; Authorization Details
          </h2>
          {Object.keys(org.license_metadata).length === 0 ? (
            <p className="text-sm text-gray-400">No license details on file.</p>
          ) : (
            <dl className="space-y-2">
              {Object.entries(org.license_metadata).map(([key, value]) => {
                if (!value) return null;
                const label = LICENSE_METADATA_LABELS[key] ?? key;
                return (
                  <div key={key} className="flex gap-3 text-sm">
                    <dt className="text-gray-500 shrink-0 min-w-[140px]">{label}</dt>
                    <dd className="text-gray-900 font-medium">{value}</dd>
                  </div>
                );
              })}
            </dl>
          )}
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

      {/* My Notes — visible to logged-in users only */}
      <HaulerNotes
        orgId={org.id}
        userId={user?.id ?? null}
        isSaved={isSaved}
        initialNote={savedNote}
      />

      {/* Footer */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-100 mt-2">
        <Link
          href="/directory"
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
