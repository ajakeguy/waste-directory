"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Heart,
  Plus,
  FolderOpen,
  BookmarkX,
  StickyNote,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { OrganizationCard } from "@/components/directory/OrganizationCard";
import { NewListModal } from "@/components/dashboard/NewListModal";
import type { UserList, SavedItemWithOrg } from "@/types";

type Props = {
  userId: string;
  displayName: string;
  lists: UserList[];
  savedItems: SavedItemWithOrg[];
};

export function DashboardClient({
  userId,
  displayName,
  lists: initialLists,
  savedItems,
}: Props) {
  const [lists, setLists] = useState<UserList[]>(initialLists);
  const [activeListId, setActiveListId] = useState<string | "all">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();

  // Build counts per list
  const allCount = savedItems.length;
  const countByList = (listId: string) =>
    savedItems.filter((i) => i.list_id === listId).length;

  // Filter items for current view
  const visibleItems =
    activeListId === "all"
      ? savedItems
      : savedItems.filter((i) => i.list_id === activeListId);

  const savedSet = new Set(savedItems.map((i) => i.item_id));

  const handleListCreated = (newList: UserList) => {
    setLists((prev) => [...prev, newList]);
    setModalOpen(false);
    setActiveListId(newList.id);
    router.refresh();
  };

  const activeList = lists.find((l) => l.id === activeListId);

  return (
    <>
      {/* Hero */}
      <section className="bg-[#2D6A4F] text-white py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-1">
            Dashboard
          </p>
          <h1 className="text-2xl font-bold">
            Welcome back, {displayName.split(" ")[0]}
          </h1>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex gap-6 items-start">
          {/* ── Left sidebar ────────────────────────────────────────── */}
          <aside className="w-52 shrink-0 sticky top-6 space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest px-2 mb-3">
              Saved haulers
            </p>

            {/* All saved */}
            <SidebarItem
              label="All Saved"
              count={allCount}
              active={activeListId === "all"}
              icon={<Heart className="size-3.5" />}
              onClick={() => setActiveListId("all")}
            />

            {/* User lists */}
            {lists.map((list) => (
              <SidebarItem
                key={list.id}
                label={list.name}
                count={countByList(list.id)}
                active={activeListId === list.id}
                dot={list.color}
                onClick={() => setActiveListId(list.id)}
              />
            ))}

            {/* New list button */}
            <button
              onClick={() => setModalOpen(true)}
              className="w-full flex items-center gap-2 px-2 py-2 text-sm text-[#2D6A4F] hover:bg-[#2D6A4F]/8 rounded-lg transition-colors mt-2"
            >
              <Plus className="size-3.5 shrink-0" />
              New list
            </button>
          </aside>

          {/* ── Main content ─────────────────────────────────────────── */}
          <main className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                {activeList && (
                  <span
                    className="size-3 rounded-full shrink-0"
                    style={{ backgroundColor: activeList.color }}
                  />
                )}
                <h2 className="font-semibold text-gray-900">
                  {activeListId === "all" ? "All Saved" : (activeList?.name ?? "List")}
                </h2>
                <Badge variant="secondary" className="text-xs">
                  {visibleItems.length}
                </Badge>
              </div>

              {savedItems.length > 0 && (
                <Link
                  href="/directory"
                  className="text-sm text-[#2D6A4F] hover:underline"
                >
                  Browse more →
                </Link>
              )}
            </div>

            {/* Grid / empty states */}
            {savedItems.length === 0 ? (
              /* No saved haulers at all */
              <div className="rounded-xl border border-dashed border-gray-200 py-20 text-center px-4">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <BookmarkX className="size-5 text-gray-400" />
                </div>
                <p className="font-medium text-gray-700 mb-1">
                  No saved haulers yet
                </p>
                <p className="text-sm text-gray-500 mb-5">
                  Browse the directory and click the{" "}
                  <span className="text-rose-400">♥</span> on any hauler to
                  save it here
                </p>
                <Link
                  href="/directory"
                  className="inline-flex h-9 items-center px-5 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
                >
                  Browse the directory
                </Link>
              </div>
            ) : visibleItems.length === 0 ? (
              /* Empty selected list */
              <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center px-4">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                  <FolderOpen className="size-4 text-gray-400" />
                </div>
                <p className="font-medium text-gray-700 mb-1">
                  No haulers in this list yet
                </p>
                <p className="text-sm text-gray-500">
                  Save a hauler and move it here using the{" "}
                  <span className="text-rose-400">♥</span> button
                </p>
              </div>
            ) : (
              /* Saved item cards with optional sticky notes */
              <div className="space-y-3">
                {visibleItems.map((item) => (
                  <div key={item.id}>
                    <OrganizationCard
                      org={item.org}
                      savedOrgIds={savedSet}
                      userId={userId}
                    />
                    {item.notes && (
                      <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-b-xl -mt-1 px-4 py-2.5">
                        <StickyNote className="size-3.5 text-yellow-500 shrink-0 mt-0.5" />
                        <p className="text-sm text-yellow-800 leading-snug">
                          {item.notes}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* New list modal */}
      <NewListModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleListCreated}
      />
    </>
  );
}

// ── Sidebar item ──────────────────────────────────────────────────────────────

function SidebarItem({
  label,
  count,
  active,
  icon,
  dot,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  icon?: React.ReactNode;
  dot?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors text-left ${
        active
          ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
          : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {dot ? (
        <span
          className="size-2.5 rounded-full shrink-0"
          style={{ backgroundColor: dot }}
        />
      ) : (
        icon && (
          <span className="shrink-0 text-current opacity-60">{icon}</span>
        )
      )}
      <span className="flex-1 truncate">{label}</span>
      <span
        className={`text-xs tabular-nums ${
          active ? "text-[#2D6A4F]" : "text-gray-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
