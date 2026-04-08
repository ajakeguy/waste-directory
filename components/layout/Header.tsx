import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "@/components/layout/UserMenu";
import { HeaderShell } from "@/components/layout/HeaderShell";
import { MobileNav } from "@/components/layout/MobileNav";

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch the display name from the public users table if logged in
  let displayName = "";
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();
    displayName = profile?.name ?? user.email ?? "Account";
  }

  return (
    <HeaderShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Site name */}
        <Link
          href="/"
          className="text-xl font-bold tracking-tight hover:opacity-90 transition-opacity"
        >
          WasteDirectory
        </Link>

        {/* Nav links — desktop only */}
        <nav className="hidden sm:flex items-center gap-8">
          <Link
            href="/directory"
            className="text-sm font-medium text-white/90 hover:text-white transition-colors"
          >
            Directory
          </Link>
          <Link
            href="/disposal"
            className="text-sm font-medium text-white/90 hover:text-white transition-colors"
          >
            Disposal
          </Link>
          <Link
            href="/marketplace"
            className="text-sm font-medium text-white/90 hover:text-white transition-colors"
          >
            Marketplace
          </Link>
          <Link
            href="/reports"
            className="text-sm font-medium text-white/90 hover:text-white transition-colors"
          >
            Reports
          </Link>
          <Link
            href="/routes"
            className="text-sm font-medium text-white/90 hover:text-white transition-colors"
          >
            Routes
          </Link>
          <Link
            href="/news"
            className="text-sm font-medium text-white/90 hover:text-white transition-colors"
          >
            News
          </Link>
        </nav>

        {/* Auth area — desktop only */}
        <div className="hidden sm:block">
          {user ? (
            <UserMenu name={displayName} email={user.email ?? ""} />
          ) : (
            <Link href="/login">
              <Button
                variant="outline"
                size="sm"
                className="border-white/40 text-white bg-transparent hover:bg-white/10 hover:text-white"
              >
                Login
              </Button>
            </Link>
          )}
        </div>

        {/* Hamburger — mobile only */}
        <MobileNav isLoggedIn={!!user} />
      </div>
    </HeaderShell>
  );
}
