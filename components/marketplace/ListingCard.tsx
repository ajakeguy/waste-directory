import Link from "next/link";
import { Camera, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { EquipmentListing } from "@/types";
import { EQUIPMENT_CATEGORY_LABELS } from "@/types";

type CardListing = Pick<
  EquipmentListing,
  | "id" | "title" | "category" | "condition" | "price" | "price_negotiable"
  | "location_city" | "location_state" | "photos" | "expires_at" | "created_at"
>;

const conditionStyles: Record<string, string> = {
  new: "bg-green-100 text-green-800 border-0",
  refurbished: "bg-blue-100 text-blue-800 border-0",
  used: "bg-gray-100 text-gray-700 border-0",
};

function daysUntil(dateStr: string): number {
  return Math.ceil(
    (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
}

function formatPrice(price: number | null, negotiable: boolean): string {
  if (price == null) return "Contact for price";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(price);
  return negotiable ? `${formatted} (negotiable)` : formatted;
}

export function ListingCard({ listing }: { listing: CardListing }) {
  const daysLeft = daysUntil(listing.expires_at);
  const expiringSoon = daysLeft > 0 && daysLeft <= 14;
  const firstPhoto = listing.photos?.[0] ?? null;

  return (
    <Link
      href={`/marketplace/${listing.id}`}
      className="group block bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-[#2D6A4F]/40 hover:shadow-sm transition-all"
    >
      {/* Photo */}
      <div className="relative h-44 bg-gray-100 overflow-hidden">
        {firstPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={firstPhoto}
            alt={listing.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className="size-10 text-gray-300" />
          </div>
        )}

        {/* Expiring soon badge */}
        {expiringSoon && (
          <div className="absolute top-2 left-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
              <Clock className="size-3" />
              {daysLeft}d left
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2 mb-2 group-hover:text-[#2D6A4F] transition-colors">
          {listing.title}
        </h3>

        <div className="flex flex-wrap gap-1.5 mb-3">
          <Badge className="bg-[#2D6A4F]/10 text-[#2D6A4F] border-0 text-xs">
            {EQUIPMENT_CATEGORY_LABELS[listing.category] ?? listing.category}
          </Badge>
          <Badge className={`text-xs ${conditionStyles[listing.condition] ?? conditionStyles.used}`}>
            {listing.condition.charAt(0).toUpperCase() + listing.condition.slice(1)}
          </Badge>
        </div>

        <p className="text-base font-semibold text-gray-900">
          {formatPrice(listing.price, listing.price_negotiable)}
        </p>

        {(listing.location_city || listing.location_state) && (
          <p className="text-xs text-gray-500 mt-1">
            {[listing.location_city, listing.location_state]
              .filter(Boolean)
              .join(", ")}
          </p>
        )}
      </div>
    </Link>
  );
}
