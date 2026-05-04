import Link from "next/link";
import { CheckCircle, MapPin, Phone, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SaveButton } from "@/components/directory/SaveButton";
import { SERVICE_TYPE_LABELS } from "@/types";
import type { Organization } from "@/types";

type Props = {
  org: Organization;
  /** IDs of orgs the current user has saved. Pass undefined when not logged in. */
  savedOrgIds?: Set<string>;
  /** Current user's ID — null/undefined means not logged in. */
  userId?: string | null;
};

export function OrganizationCard({ org, savedOrgIds, userId = null }: Props) {
  const profileUrl = `/haulers/${org.slug}`;
  const isSaved = savedOrgIds?.has(org.id) ?? false;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-[#2D6A4F]/40 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Name + verified */}
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={profileUrl}
              prefetch={false}
              className="font-semibold text-gray-900 hover:text-[#2D6A4F] transition-colors leading-snug"
            >
              {org.name}
            </Link>
            {org.verified && (
              <Badge
                variant="secondary"
                className="bg-[#2D6A4F]/10 text-[#2D6A4F] border-0 text-xs gap-1"
              >
                <CheckCircle className="size-3" />
                Verified
              </Badge>
            )}
          </div>

          {/* Location */}
          {(org.city || org.state) && (
            <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
              <MapPin className="size-3.5 shrink-0" />
              <span>{[org.city, org.state].filter(Boolean).join(", ")}</span>
            </div>
          )}
        </div>

        {/* Save button — optimistic UI, redirects to /login if not authenticated */}
        <SaveButton
          orgId={org.id}
          orgName={org.name}
          initialSaved={isSaved}
          userId={userId}
        />
      </div>

      {/* Service badges */}
      {org.service_types && org.service_types.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {org.service_types.map((type) => (
            <Badge key={type} variant="outline" className="text-xs">
              {SERVICE_TYPE_LABELS[type as keyof typeof SERVICE_TYPE_LABELS] ??
                type}
            </Badge>
          ))}
        </div>
      )}

      {/* Contact info */}
      {(org.phone || org.website) && (
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          {org.phone && (
            <a
              href={`tel:${org.phone}`}
              className="flex items-center gap-1 hover:text-[#2D6A4F] transition-colors"
            >
              <Phone className="size-3" />
              {org.phone}
            </a>
          )}
          {org.website && (
            <a
              href={org.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-[#2D6A4F] transition-colors"
            >
              <Globe className="size-3" />
              Website
            </a>
          )}
        </div>
      )}
    </div>
  );
}
