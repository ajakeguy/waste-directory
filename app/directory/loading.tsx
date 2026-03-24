import { Skeleton } from "@/components/ui/skeleton";

export default function DirectoryLoading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Skeleton className="h-8 w-56 mb-2" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="flex gap-6 items-start">
        {/* Sidebar skeleton */}
        <div className="w-64 shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <Skeleton className="h-5 w-16 mb-5" />
            <Skeleton className="h-4 w-12 mb-2" />
            <Skeleton className="h-9 w-full mb-6" />
            <Skeleton className="h-4 w-24 mb-3" />
            <div className="space-y-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>

        {/* Results skeleton */}
        <div className="flex-1 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-200 p-5"
            >
              <Skeleton className="h-5 w-48 mb-2" />
              <Skeleton className="h-4 w-32 mb-4" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
