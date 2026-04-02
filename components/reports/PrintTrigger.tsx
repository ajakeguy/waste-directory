"use client";

import { useEffect } from "react";

/**
 * Invisible client component that automatically triggers window.print()
 * after a short delay to allow fonts/images to finish loading.
 */
export function PrintTrigger() {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.print();
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  return null;
}
