"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, CheckSquare, Clock, PackageX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { EquipmentListing, EquipmentListingStatus } from "@/types";
import { EQUIPMENT_CATEGORY_LABELS } from "@/types";

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<EquipmentListingStatus, string> = {
  active: "bg-green-100 text-green-800 border-0",
  sold: "bg-gray-100 text-gray-600 border-0",
  draft: "bg-yellow-100 text-yellow-800 border-0",
  expired: "bg-red-100 text-red-700 border-0",
};

function daysUntil(dateStr: string): number {
  return Math.ceil(
    (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
}

function formatPrice(price: number | null, negotiable: boolean): string {
  if (price == null) return "Contact for price";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(price) + (negotiable ? " (neg.)" : "");
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MyListings({
  listings: initialListings,
}: {
  listings: EquipmentListing[];
}) {
  const [listings, setListings] = useState(initialListings);
  const [pending, setPending] = useState<string | null>(null);
  const router = useRouter();

  const handleMarkSold = async (id: string) => {
    setPending(id);
    await fetch(`/api/listings/${id}/sold`, { method: "POST" });
    setListings((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status: "sold" as EquipmentListingStatus } : l))
    );
    setPending(null);
    router.refresh();
  };

  return (
    <section className="mt-10">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900 text-lg">My Marketplace Listings</h2>
        <Link
          href="/marketplace/new"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
        >
          <Plus className="size-3.5" />
          Post New Listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center px-4">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <PackageX className="size-5 text-gray-400" />
          </div>
          <p className="font-medium text-gray-700 mb-1">No listings yet</p>
          <p className="text-sm text-gray-500 mb-4">
            Post equipment for sale in the marketplace.
          </p>
          <Link
            href="/marketplace/new"
            className="inline-flex h-9 items-center px-5 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
          >
            Post your first listing
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((listing) => {
            const daysLeft = daysUntil(listing.expires_at);
            const expiring = listing.status === "active" && daysLeft <= 14 && daysLeft > 0;

            return (
              <div
                key={listing.id}
                className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-4"
              >
                {/* Thumbnail */}
                <div className="size-14 rounded-lg bg-gray-100 overflow-hidden shrink-0">
                  {listing.photos?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={listing.photos[0]}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">
                      No photo
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <Link
                      href={`/marketplace/${listing.id}`}
                      className="font-medium text-gray-900 hover:text-[#2D6A4F] transition-colors text-sm leading-snug"
                    >
                      {listing.title}
                    </Link>
                    <Badge className={`text-xs ${STATUS_STYLES[listing.status]}`}>
                      {listing.status.charAt(0).toUpperCase() + listing.status.slice(1)}
                    </Badge>
                  </div>

                  <p className="text-xs text-gray-500 mt-0.5">
                    {EQUIPMENT_CATEGORY_LABELS[listing.category] ?? listing.category}
                    {" · "}
                    {formatPrice(listing.price, listing.price_negotiable)}
                  </p>

                  {listing.status === "active" && (
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="size-3 text-gray-400" />
                      <span className={`text-xs ${expiring ? "text-amber-600 font-medium" : "text-gray-400"}`}>
                        {daysLeft > 0 ? `Expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}` : "Expired"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {listing.status === "active" && (
                    <button
                      onClick={() => handleMarkSold(listing.id)}
                      disabled={pending === listing.id}
                      title="Mark as sold"
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      <CheckSquare className="size-3.5" />
                      Sold
                    </button>
                  )}
                  <Link
                    href={`/marketplace/${listing.id}/edit`}
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
