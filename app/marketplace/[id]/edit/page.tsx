"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListingForm } from "@/components/marketplace/ListingForm";
import { createClient } from "@/lib/supabase/client";
import type { EquipmentListing } from "@/types";

export default function EditListingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [listing, setListing] = useState<EquipmentListing | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action states
  const [markingSold, setMarkingSold] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      // Check auth via browser Supabase client
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/login?next=/marketplace/${id}/edit`);
        return;
      }
      const user_id = user.id;
      setUserId(user_id);

      // Fetch listing
      const res = await fetch(`/api/listings/${id}`);
      if (!res.ok) {
        setError("Listing not found.");
        setLoading(false);
        return;
      }
      const data: EquipmentListing = await res.json();

      if (data.user_id !== user_id) {
        setError("You don't have permission to edit this listing.");
        setLoading(false);
        return;
      }

      setListing(data);
      setLoading(false);
    }
    load();
  }, [id, router]);

  const handleMarkSold = async () => {
    if (!listing) return;
    setMarkingSold(true);
    await fetch(`/api/listings/${id}/sold`, { method: "POST" });
    setMarkingSold(false);
    router.push(`/marketplace/${id}`);
    router.refresh();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await fetch(`/api/listings/${id}`, { method: "DELETE" });
    setDeleting(false);
    setDeleteOpen(false);
    router.push("/marketplace");
    router.refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="size-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error || !listing || !userId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">{error ?? "Unable to load listing."}</p>
        <Link href="/marketplace" prefetch={false} className="text-sm text-[#2D6A4F] hover:underline mt-4 inline-block">
          Back to Marketplace
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/marketplace/${id}`}
          prefetch={false}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Listing</h1>
          <p className="text-gray-500 text-sm mt-0.5">{listing.title}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <ListingForm listing={listing} userId={userId} />
      </div>

      {/* Danger zone */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Listing Actions</h2>

        {listing.status === "active" && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-900 font-medium">Mark as Sold</p>
              <p className="text-xs text-gray-500">This will remove the listing from public view.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkSold}
              disabled={markingSold}
            >
              {markingSold ? <Loader2 className="size-4 animate-spin" /> : "Mark as Sold"}
            </Button>
          </div>
        )}

        <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm text-rose-700 font-medium">Delete Listing</p>
            <p className="text-xs text-gray-500">Permanently remove this listing.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-rose-200 text-rose-600 hover:bg-rose-50"
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={(o) => { if (!o) setDeleteOpen(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this listing?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 mt-1">
            This cannot be undone. The listing will be permanently removed.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : "Delete listing"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
