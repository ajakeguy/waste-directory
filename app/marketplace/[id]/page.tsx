import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, MapPin, Package, Tag, User, Mail, Phone, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PhotoGallery } from "@/components/marketplace/PhotoGallery";
import { createClient } from "@/lib/supabase/server";
import type { EquipmentListing } from "@/types";
import { EQUIPMENT_CATEGORY_LABELS, EQUIPMENT_CONDITION_LABELS } from "@/types";

type Props = { params: Promise<{ id: string }> };

const conditionStyles: Record<string, string> = {
  new: "bg-green-100 text-green-800 border-0",
  refurbished: "bg-blue-100 text-blue-800 border-0",
  used: "bg-gray-100 text-gray-700 border-0",
};

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatPrice(price: number | null, negotiable: boolean): string {
  if (price == null) return "Contact for price";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(price);
  return negotiable ? `${formatted} (negotiable)` : formatted;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("equipment_listings")
    .select("title, description")
    .eq("id", id)
    .maybeSingle();
  if (!data) return {};
  return {
    title: `${data.title} | WasteDirectory Marketplace`,
    description: data.description?.substring(0, 160),
  };
}

export default async function ListingDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch listing — RLS: public sees active, owner sees all
  const { data, error } = await supabase
    .from("equipment_listings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) notFound();
  const listing = data as unknown as EquipmentListing;

  const isOwner = user?.id === listing.user_id;
  const showContact = !!user;
  const postedDaysAgo = daysAgo(listing.created_at);
  const expiresInDays = daysUntil(listing.expires_at);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 mb-6">
        <Link href="/marketplace" className="hover:text-[#2D6A4F] transition-colors">
          Marketplace
        </Link>
        <span>/</span>
        <span className="text-gray-700 truncate">{listing.title}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: photos + description */}
        <div className="lg:col-span-2 space-y-6">
          <PhotoGallery photos={listing.photos ?? []} title={listing.title} />

          {/* Title + badges */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">{listing.title}</h1>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-[#2D6A4F]/10 text-[#2D6A4F] border-0">
                <Tag className="size-3 mr-1" />
                {EQUIPMENT_CATEGORY_LABELS[listing.category] ?? listing.category}
              </Badge>
              <Badge className={conditionStyles[listing.condition] ?? conditionStyles.used}>
                {EQUIPMENT_CONDITION_LABELS[listing.condition] ?? listing.condition}
              </Badge>
              {listing.status === "sold" && (
                <Badge className="bg-rose-100 text-rose-700 border-0">Sold</Badge>
              )}
            </div>
          </div>

          {/* Description */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Description</h2>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {listing.description}
            </p>
          </section>
        </div>

        {/* Right: price + details + contact */}
        <div className="space-y-4">
          {/* Price card */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-gray-900 mb-1">
              {formatPrice(listing.price, listing.price_negotiable)}
            </p>
            {listing.price_negotiable && listing.price && (
              <p className="text-xs text-gray-500">Price is negotiable</p>
            )}
          </section>

          {/* Details */}
          <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Details</h2>
            {(listing.location_city || listing.location_state) && (
              <div className="flex items-start gap-2.5 text-sm text-gray-700">
                <MapPin className="size-4 text-gray-400 shrink-0 mt-0.5" />
                <span>
                  {[listing.location_city, listing.location_state]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            )}
            {listing.quantity > 1 && (
              <div className="flex items-start gap-2.5 text-sm text-gray-700">
                <Package className="size-4 text-gray-400 shrink-0 mt-0.5" />
                <span>Quantity: {listing.quantity}</span>
              </div>
            )}
            <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">
              Listed {postedDaysAgo === 0 ? "today" : `${postedDaysAgo} day${postedDaysAgo !== 1 ? "s" : ""} ago`}
              {expiresInDays > 0 && ` · Expires in ${expiresInDays} day${expiresInDays !== 1 ? "s" : ""}`}
            </p>
          </section>

          {/* Contact card */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Contact Seller</h2>

            {showContact ? (
              <div className="space-y-2.5">
                {listing.contact_name && (
                  <div className="flex items-center gap-2.5 text-sm text-gray-700">
                    <User className="size-4 text-gray-400 shrink-0" />
                    <span>{listing.contact_name}</span>
                  </div>
                )}
                {listing.contact_email && (
                  <a
                    href={`mailto:${listing.contact_email}`}
                    className="flex items-center gap-2.5 text-sm text-[#2D6A4F] hover:underline"
                  >
                    <Mail className="size-4 shrink-0" />
                    {listing.contact_email}
                  </a>
                )}
                {listing.contact_phone && (
                  <a
                    href={`tel:${listing.contact_phone}`}
                    className="flex items-center gap-2.5 text-sm text-[#2D6A4F] hover:underline"
                  >
                    <Phone className="size-4 shrink-0" />
                    {listing.contact_phone}
                  </a>
                )}
                {!listing.contact_name && !listing.contact_email && !listing.contact_phone && (
                  <p className="text-sm text-gray-400">No contact info provided.</p>
                )}
              </div>
            ) : (
              <div className="text-center py-3">
                <Lock className="size-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-600 mb-3">
                  Create a free account to view contact information
                </p>
                <Link
                  href="/register"
                  className="inline-flex h-9 items-center px-4 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
                >
                  Sign up free
                </Link>
              </div>
            )}
          </section>

          {/* Owner actions */}
          {isOwner && (
            <Link
              href={`/marketplace/${listing.id}/edit`}
              className="flex h-9 items-center justify-center rounded-lg border border-[#2D6A4F] text-[#2D6A4F] text-sm font-medium hover:bg-[#2D6A4F]/5 transition-colors"
            >
              Edit listing
            </Link>
          )}
        </div>
      </div>

      {/* Back link */}
      <div className="mt-8 pt-6 border-t border-gray-100">
        <Link
          href="/marketplace"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2D6A4F] transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to Marketplace
        </Link>
      </div>
    </div>
  );
}
