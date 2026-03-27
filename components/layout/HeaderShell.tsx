"use client";

import { useEffect, useState } from "react";

/**
 * Thin client wrapper that:
 *  - makes the header sticky at the top of the viewport (z-50)
 *  - adds a subtle drop-shadow once the user has scrolled past the fold
 *
 * The outer Header component stays a server component (so it can fetch
 * auth data); only this shell needs to be a client component.
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    // Set initial value in case page loads scrolled
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`relative sticky top-0 z-50 bg-[#2D6A4F] text-white transition-shadow duration-200 ${
        scrolled ? "shadow-md" : ""
      }`}
    >
      {children}
    </header>
  );
}
