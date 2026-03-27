"use client";

import { useState } from "react";
import { Camera } from "lucide-react";

export function PhotoGallery({ photos, title }: { photos: string[]; title: string }) {
  const [mainIdx, setMainIdx] = useState(0);

  if (photos.length === 0) {
    return (
      <div className="w-full aspect-video bg-gray-100 rounded-xl flex items-center justify-center">
        <Camera className="size-16 text-gray-300" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Main photo */}
      <div className="w-full aspect-video bg-gray-100 rounded-xl overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photos[mainIdx]}
          alt={`${title} — photo ${mainIdx + 1}`}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Thumbnails */}
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((url, i) => (
            <button
              key={i}
              onClick={() => setMainIdx(i)}
              className={`relative shrink-0 size-16 rounded-lg overflow-hidden border-2 transition-all ${
                i === mainIdx
                  ? "border-[#2D6A4F]"
                  : "border-transparent hover:border-gray-300"
              }`}
              aria-label={`View photo ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`thumbnail ${i + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
