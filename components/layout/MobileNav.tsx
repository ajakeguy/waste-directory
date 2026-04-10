"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

/**
 * Hamburger menu for small screens (hidden on sm+).
 * Renders a slide-down overlay with all nav links + auth action.
 */
export function MobileNav({
  isLoggedIn,
}: {
  isLoggedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="sm:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="flex items-center justify-center size-9 rounded-lg hover:bg-white/10 transition-colors"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-40 bg-[#2D6A4F] border-t border-white/10 shadow-lg">
          <nav className="max-w-7xl mx-auto px-4 py-3 space-y-0.5">
            <NavLink href="/directory" onClose={() => setOpen(false)}>
              Haulers
            </NavLink>
            <NavLink href="/disposal" onClose={() => setOpen(false)}>
              Disposal
            </NavLink>
            <NavLink href="/tools" onClose={() => setOpen(false)}>
              Tools
            </NavLink>
            <NavLink href="/marketplace" onClose={() => setOpen(false)}>
              Marketplace
            </NavLink>
            <NavLink href="/news" onClose={() => setOpen(false)}>
              News
            </NavLink>
            <div className="h-px bg-white/10 my-2" />
            {isLoggedIn ? (
              <NavLink href="/dashboard" onClose={() => setOpen(false)}>
                Dashboard
              </NavLink>
            ) : (
              <>
                <NavLink href="/login" onClose={() => setOpen(false)}>
                  Login
                </NavLink>
                <NavLink href="/register" onClose={() => setOpen(false)}>
                  Create account
                </NavLink>
              </>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}

function NavLink({
  href,
  onClose,
  children,
}: {
  href: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className="flex items-center h-10 px-3 rounded-lg text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white transition-colors"
    >
      {children}
    </Link>
  );
}
