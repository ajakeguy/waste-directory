import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ListingForm } from "@/components/marketplace/ListingForm";

export const metadata: Metadata = {
  title: "Post a Listing | WasteDirectory Marketplace",
};

export default async function NewListingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/marketplace/new");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Post a Listing</h1>
        <p className="text-gray-500 text-sm mt-1">
          Your listing will be active for 90 days.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ListingForm userId={user.id} />
      </div>
    </div>
  );
}
