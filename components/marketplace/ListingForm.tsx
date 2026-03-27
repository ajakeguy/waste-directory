"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_CONDITION_LABELS,
  type EquipmentListing,
} from "@/types";

// ── US states for location picker ────────────────────────────────────────────

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const CONDITIONS = ["new", "used", "refurbished"] as const;
const MAX_PHOTOS = 5;

// ── Photo item ─────────────────────────────────────────────────────────────────

type PhotoItem =
  | { kind: "existing"; url: string }
  | { kind: "pending"; file: File; preview: string; uploading: boolean; error?: string };

// ── Props ──────────────────────────────────────────────────────────────────────

type Props = {
  /** When provided the form is in edit mode. */
  listing?: EquipmentListing;
  userId: string;
};

// ── Component ──────────────────────────────────────────────────────────────────

export function ListingForm({ listing, userId }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEdit = !!listing;

  // Form fields
  const [title, setTitle] = useState(listing?.title ?? "");
  const [category, setCategory] = useState(listing?.category ?? "");
  const [condition, setCondition] = useState<string>(listing?.condition ?? "used");
  const [description, setDescription] = useState(listing?.description ?? "");
  const [price, setPrice] = useState(listing?.price != null ? String(listing.price) : "");
  const [priceNegotiable, setPriceNegotiable] = useState(listing?.price_negotiable ?? false);
  const [quantity, setQuantity] = useState(String(listing?.quantity ?? 1));
  const [locationCity, setLocationCity] = useState(listing?.location_city ?? "");
  const [locationState, setLocationState] = useState(listing?.location_state ?? "");
  const [contactName, setContactName] = useState(listing?.contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(listing?.contact_email ?? "");
  const [contactPhone, setContactPhone] = useState(listing?.contact_phone ?? "");

  // Photos
  const [photos, setPhotos] = useState<PhotoItem[]>(
    (listing?.photos ?? []).map((url) => ({ kind: "existing", url }))
  );

  // Submission state
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const allPhotoUrls = photos
    .filter((p): p is { kind: "existing"; url: string } => p.kind === "existing")
    .map((p) => p.url);

  const pendingUploads = photos.filter(
    (p): p is Extract<PhotoItem, { kind: "pending" }> =>
      p.kind === "pending" && p.uploading
  );

  const canAddMore = photos.length < MAX_PHOTOS;

  // ── File selection ─────────────────────────────────────────────────────────

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const toAdd = Array.from(files).slice(0, MAX_PHOTOS - photos.length);
    if (toAdd.length === 0) return;

    const supabase = createClient();

    for (const file of toAdd) {
      const preview = URL.createObjectURL(file);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const pendingItem: Extract<PhotoItem, { kind: "pending" }> = {
        kind: "pending", file, preview, uploading: true,
      };

      setPhotos((prev) => [...prev, pendingItem]);

      // Upload immediately so the user sees progress inline
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${userId}/${id}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("marketplace-photos")
        .upload(path, file, { cacheControl: "3600", upsert: false });

      if (uploadErr) {
        setPhotos((prev) =>
          prev.map((p) =>
            p.kind === "pending" && p.preview === preview
              ? { ...p, uploading: false, error: uploadErr.message }
              : p
          )
        );
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from("marketplace-photos")
        .getPublicUrl(path);

      // Replace pending item with the uploaded URL
      setPhotos((prev) =>
        prev.map((p) =>
          p.kind === "pending" && p.preview === preview
            ? { kind: "existing", url: publicUrl }
            : p
        )
      );
      URL.revokeObjectURL(preview);
    }
  };

  const removePhoto = (idx: number) => {
    const item = photos[idx];
    if (item.kind === "pending") URL.revokeObjectURL(item.preview);
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim() || !category || !condition) {
      setError("Please fill in all required fields.");
      return;
    }
    if (pendingUploads.length > 0) {
      setError("Please wait for photos to finish uploading.");
      return;
    }

    setPending(true);
    setError(null);

    const payload = {
      title: title.trim(),
      description: description.trim(),
      category,
      condition,
      price: price ? parseFloat(price) : null,
      price_negotiable: priceNegotiable,
      quantity: parseInt(quantity) || 1,
      location_city: locationCity.trim() || null,
      location_state: locationState || null,
      photos: allPhotoUrls,
      contact_name: contactName.trim() || null,
      contact_email: contactEmail.trim() || null,
      contact_phone: contactPhone.trim() || null,
    };

    try {
      const url = isEdit ? `/api/listings/${listing!.id}` : "/api/listings";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      const data = await res.json();
      router.push(`/marketplace/${isEdit ? listing!.id : data.id}`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Title */}
      <Field label="Title" required>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. 2018 Mack LR Rear Loader"
          maxLength={120}
          required
        />
      </Field>

      {/* Category */}
      <Field label="Category" required>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
          className="w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
        >
          <option value="">Select a category…</option>
          {EQUIPMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {EQUIPMENT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>

      {/* Condition */}
      <Field label="Condition" required>
        <div className="flex gap-3">
          {CONDITIONS.map((c) => (
            <label
              key={c}
              className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${
                condition === c
                  ? "border-[#2D6A4F] bg-[#2D6A4F]/5 text-[#2D6A4F]"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="condition"
                value={c}
                checked={condition === c}
                onChange={() => setCondition(c)}
                className="sr-only"
              />
              {EQUIPMENT_CONDITION_LABELS[c]}
            </label>
          ))}
        </div>
      </Field>

      {/* Description */}
      <Field label="Description" required>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the equipment — condition, hours, specifications, reason for selling…"
          rows={5}
          required
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F] placeholder:text-gray-400"
        />
      </Field>

      {/* Price */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Price">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Leave blank = contact for price"
              min={0}
              step={0.01}
              className="pl-7"
            />
          </div>
        </Field>
        <Field label="Quantity">
          <Input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            min={1}
            required
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 cursor-pointer -mt-2">
        <input
          type="checkbox"
          checked={priceNegotiable}
          onChange={(e) => setPriceNegotiable(e.target.checked)}
          className="size-4 rounded border-gray-300 accent-[#2D6A4F]"
        />
        <span className="text-sm text-gray-700">Price is negotiable</span>
      </label>

      {/* Location */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="City">
          <Input
            value={locationCity}
            onChange={(e) => setLocationCity(e.target.value)}
            placeholder="e.g. Burlington"
          />
        </Field>
        <Field label="State">
          <select
            value={locationState}
            onChange={(e) => setLocationState(e.target.value)}
            className="w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
          >
            <option value="">Select state…</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Photos */}
      <Field label={`Photos (up to ${MAX_PHOTOS})`}>
        <div
          className={`rounded-lg border-2 border-dashed p-4 transition-colors ${
            canAddMore
              ? "border-gray-200 hover:border-[#2D6A4F]/40 cursor-pointer"
              : "border-gray-100 opacity-60 cursor-not-allowed"
          }`}
          onClick={() => canAddMore && fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            if (canAddMore) handleFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          {photos.length === 0 ? (
            <div className="text-center py-6">
              <Camera className="size-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                Drag & drop or <span className="text-[#2D6A4F] font-medium">click to upload</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">JPG, PNG, WebP up to {MAX_PHOTOS} photos</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {photos.map((photo, idx) => (
                <div key={idx} className="relative size-20 rounded-lg overflow-hidden border border-gray-200 shrink-0">
                  {photo.kind === "existing" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.preview} alt="" className="w-full h-full object-cover" />
                      {photo.uploading && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <Loader2 className="size-5 text-white animate-spin" />
                        </div>
                      )}
                      {photo.error && (
                        <div className="absolute inset-0 bg-red-500/70 flex items-center justify-center">
                          <X className="size-5 text-white" />
                        </div>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removePhoto(idx); }}
                    className="absolute top-0.5 right-0.5 size-5 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center transition-colors"
                    aria-label="Remove photo"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {canAddMore && (
                <div className="size-20 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 hover:text-gray-400 hover:border-gray-300 transition-colors shrink-0">
                  <Camera className="size-6" />
                </div>
              )}
            </div>
          )}
        </div>
      </Field>

      {/* Contact */}
      <div className="pt-2">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Contact Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Name">
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Your name"
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Phone">
            <Input
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="(555) 000-0000"
            />
          </Field>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          disabled={pending}
          className="bg-[#2D6A4F] hover:bg-[#245a42] h-10 px-6"
        >
          {pending ? (
            <><Loader2 className="size-4 mr-2 animate-spin" /> Saving…</>
          ) : isEdit ? (
            "Save Changes"
          ) : (
            "Post Listing"
          )}
        </Button>
      </div>
    </form>
  );
}

// ── Helper: field label wrapper ───────────────────────────────────────────────

function Field({
  label, required, children,
}: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
