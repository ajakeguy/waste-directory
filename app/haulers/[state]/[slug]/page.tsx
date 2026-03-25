/**
 * Redirect shim for old /haulers/[state]/[slug] URLs.
 *
 * Profile pages moved to /haulers/[slug]. This preserves any existing
 * bookmarks or search-engine-indexed URLs.
 */

import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function LegacyHaulerProfileRedirect({ params }: Props) {
  const { slug } = await params;
  redirect(`/haulers/${slug}`);
}
