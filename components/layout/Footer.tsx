import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-gray-800 text-gray-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div>
          <span className="text-white font-semibold">WasteDirectory</span>
          <span className="ml-3 text-sm text-gray-400">
            The definitive waste industry resource
          </span>
        </div>
        <p className="text-xs text-gray-500">
          &copy; {new Date().getFullYear()} WasteDirectory. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
