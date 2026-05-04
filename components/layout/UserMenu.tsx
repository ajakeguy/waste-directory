"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, LayoutDashboard, LogOut, PlusCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  name: string;
  email: string;
};

export function UserMenu({ name, email }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setOpen(false);
    router.push("/");
    router.refresh();
  };

  // Build initials from display name (up to 2 chars)
  const initials = name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/10 transition-colors"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center text-xs font-bold shrink-0">
          {initials || "?"}
        </div>
        <span className="text-sm font-medium text-white hidden sm:block max-w-[140px] truncate">
          {name}
        </span>
        <ChevronDown
          className={`size-3.5 text-white/70 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
          {/* User info header */}
          <div className="px-4 py-2.5 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-900 truncate">{name}</p>
            <p className="text-xs text-gray-400 truncate">{email}</p>
          </div>

          <Link
            href="/dashboard"
            prefetch={false}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <LayoutDashboard className="size-4 text-gray-400" />
            Dashboard
          </Link>

          <Link
            href="/submit"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <PlusCircle className="size-4 text-gray-400" />
            Submit a Listing
          </Link>

          <button
            onClick={signOut}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <LogOut className="size-4 text-gray-400" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
