import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Header() {
  return (
    <header className="bg-[#2D6A4F] text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Site name */}
        <Link href="/" className="text-xl font-bold tracking-tight hover:opacity-90 transition-opacity">
          WasteDirectory
        </Link>

        {/* Nav links */}
        <nav className="hidden sm:flex items-center gap-8">
          <Link
            href="/directory"
            className="text-sm font-medium text-white/90 hover:text-white transition-colors"
          >
            Directory
          </Link>
          <Link
            href="/news"
            className="text-sm font-medium text-white/90 hover:text-white transition-colors"
          >
            News
          </Link>
        </nav>

        {/* Login */}
        <Button
          asChild
          variant="outline"
          size="sm"
          className="border-white/40 text-white bg-transparent hover:bg-white/10 hover:text-white"
        >
          <Link href="/login">Login</Link>
        </Button>
      </div>
    </header>
  );
}
