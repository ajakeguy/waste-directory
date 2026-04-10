"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Heart,
  Plus,
  FolderOpen,
  BookmarkX,
  StickyNote,
  MoreHorizontal,
  Pencil,
  Palette,
  Trash2,
  FileText,
  Route,
  Building2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OrganizationCard } from "@/components/directory/OrganizationCard";
import { NewListModal } from "@/components/dashboard/NewListModal";
import { MyListings } from "@/components/dashboard/MyListings";
import type { UserList, SavedItemWithOrg, EquipmentListing, DiversionReport, SavedRoute, DisposalFacility } from "@/types";

// ── Color presets (shared with NewListModal) ──────────────────────────────────

const PRESET_COLORS = [
  { hex: "#2D6A4F", label: "Forest green" },
  { hex: "#94A3B8", label: "Silver" },
  { hex: "#3B82F6", label: "Blue" },
  { hex: "#F59E0B", label: "Amber" },
  { hex: "#EF4444", label: "Red" },
  { hex: "#8B5CF6", label: "Purple" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type RecentReport = Pick<
  DiversionReport,
  "id" | "report_name" | "customer_name" | "period_start" | "period_end" | "status" | "created_at" | "updated_at"
>;

type RecentRoute = Pick<
  SavedRoute,
  "id" | "route_name" | "stops" | "total_distance_km" | "status" | "updated_at"
>;

type SavedFacility = Pick<
  DisposalFacility,
  "id" | "name" | "slug" | "facility_type" | "city" | "state"
>;

type Props = {
  userId: string;
  displayName: string;
  lists: UserList[];
  savedItems: SavedItemWithOrg[];
  myListings: EquipmentListing[];
  recentReports: RecentReport[];
  recentRoutes: RecentRoute[];
  savedFacilities: SavedFacility[];
};

// ── Main client component ─────────────────────────────────────────────────────

export function DashboardClient({
  userId,
  displayName,
  lists: initialLists,
  savedItems,
  myListings,
  recentReports,
  recentRoutes,
  savedFacilities,
}: Props) {
  const [lists, setLists] = useState<UserList[]>(initialLists);
  const [activeListId, setActiveListId] = useState<string | "all">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
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

  const handleRename = async (listId: string, newName: string) => {
    await fetch(`/api/lists/${listId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    setLists((prev) =>
      prev.map((l) => (l.id === listId ? { ...l, name: newName } : l))
    );
  };

  const handleColorChange = async (listId: string, newColor: string) => {
    await fetch(`/api/lists/${listId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: newColor }),
    });
    setLists((prev) =>
      prev.map((l) => (l.id === listId ? { ...l, color: newColor } : l))
    );
  };

  const handleDeleteList = async (listId: string) => {
    await fetch(`/api/lists/${listId}`, { method: "DELETE" });
    setLists((prev) => prev.filter((l) => l.id !== listId));
    setDeleteConfirmId(null);
    if (activeListId === listId) setActiveListId("all");
    router.refresh();
  };

  const activeList = lists.find((l) => l.id === activeListId);
  const deleteTarget = lists.find((l) => l.id === deleteConfirmId);

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

        {/* ── Mobile: horizontal scrollable list tabs ─────────────── */}
        <div className="md:hidden mb-5">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
            <button
              onClick={() => setActiveListId("all")}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-sm whitespace-nowrap shrink-0 transition-colors ${
                activeListId === "all"
                  ? "bg-[#2D6A4F] text-white font-medium"
                  : "bg-white border border-gray-200 text-gray-600 hover:border-[#2D6A4F]/40"
              }`}
            >
              <Heart className="size-3" />
              All Saved
              <span className="text-xs opacity-70 ml-0.5">{allCount}</span>
            </button>

            {lists.map((list) => (
              <button
                key={list.id}
                onClick={() => setActiveListId(list.id)}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-sm whitespace-nowrap shrink-0 transition-colors ${
                  activeListId === list.id
                    ? "text-white font-medium"
                    : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
                style={activeListId === list.id ? { backgroundColor: list.color } : {}}
              >
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: activeListId === list.id ? "rgba(255,255,255,0.6)" : list.color }}
                />
                {list.name}
                <span className="text-xs opacity-70 ml-0.5">{countByList(list.id)}</span>
              </button>
            ))}

            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-full text-sm whitespace-nowrap shrink-0 border border-dashed border-[#2D6A4F]/50 text-[#2D6A4F] hover:border-[#2D6A4F] transition-colors"
            >
              <Plus className="size-3" />
              New list
            </button>
          </div>
        </div>

        <div className="flex gap-6 items-start">
          {/* ── Left sidebar — desktop only ──────────────────────────── */}
          <aside className="hidden md:block w-52 shrink-0 sticky top-24 space-y-1">
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

            {/* User lists with edit controls */}
            {lists.map((list) => (
              <EditableListItem
                key={list.id}
                list={list}
                count={countByList(list.id)}
                active={activeListId === list.id}
                onClick={() => setActiveListId(list.id)}
                onRename={handleRename}
                onColorChange={handleColorChange}
                onDeleteRequest={(id) => setDeleteConfirmId(id)}
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
                  {activeListId === "all"
                    ? "All Saved"
                    : (activeList?.name ?? "List")}
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

      {/* My Marketplace Listings */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-6">
        <MyListings listings={myListings} />
      </div>

      {/* My Reports */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="size-4 text-[#2D6A4F]" />
            My Diversion Reports
          </h2>
          <Link
            href="/reports/new"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
          >
            <Plus className="size-3.5" />
            New Report
          </Link>
        </div>

        {recentReports.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center px-4">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <FileText className="size-4 text-gray-400" />
            </div>
            <p className="font-medium text-gray-700 mb-1">No reports yet</p>
            <p className="text-sm text-gray-500 mb-4">
              Create a diversion report to show customers their recycling impact
            </p>
            <Link
              href="/reports/new"
              className="inline-flex h-9 items-center px-5 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
            >
              Create your first report
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentReports.map((r) => (
              <Link
                key={r.id}
                href={`/reports/${r.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-[#2D6A4F]/40 hover:shadow-sm transition-all"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{r.report_name}</p>
                  <p className="text-sm text-gray-500 truncate">{r.customer_name}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-500">
                    {r.period_start} – {r.period_end}
                  </p>
                  <span
                    className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      r.status === "published"
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {r.status === "published" ? "Published" : "Draft"}
                  </span>
                </div>
              </Link>
            ))}
            {recentReports.length >= 5 && (
              <div className="text-center pt-1">
                <Link
                  href="/reports"
                  className="text-sm text-[#2D6A4F] hover:underline"
                >
                  View all reports →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recent Routes */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Route className="size-4 text-[#2D6A4F]" />
            Route Optimizer
          </h2>
          <Link
            href="/routes/new"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
          >
            <Plus className="size-3.5" />
            New Route
          </Link>
        </div>

        {recentRoutes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center px-4">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Route className="size-4 text-gray-400" />
            </div>
            <p className="font-medium text-gray-700 mb-1">No saved routes yet</p>
            <p className="text-sm text-gray-500 mb-4">
              Add your stops, optimize, and get the shortest pickup route
            </p>
            <Link
              href="/routes/new"
              className="inline-flex h-9 items-center px-5 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
            >
              Build your first route
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentRoutes.map((r) => (
              <Link
                key={r.id}
                href={`/routes/${r.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-[#2D6A4F]/40 hover:shadow-sm transition-all"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{r.route_name}</p>
                  <p className="text-sm text-gray-500 truncate">
                    {r.stops.length} stop{r.stops.length !== 1 ? "s" : ""}
                    {r.total_distance_km ? ` · ${r.total_distance_km.toFixed(1)} km` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                    r.status === "optimized"
                      ? "bg-[#2D6A4F]/10 text-[#2D6A4F]"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {r.status === "optimized" ? "Optimized" : "Draft"}
                </span>
              </Link>
            ))}
            <div className="text-center pt-1">
              <Link href="/routes" className="text-sm text-[#2D6A4F] hover:underline">
                View all routes →
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Saved Disposal Facilities */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="size-4 text-[#2D6A4F]" />
            Saved Facilities
          </h2>
          <Link
            href="/disposal"
            className="text-sm text-[#2D6A4F] hover:underline"
          >
            Browse facilities →
          </Link>
        </div>

        {savedFacilities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center px-4">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Building2 className="size-4 text-gray-400" />
            </div>
            <p className="font-medium text-gray-700 mb-1">No saved facilities yet</p>
            <p className="text-sm text-gray-500 mb-4">
              Browse the disposal directory and click the{" "}
              <span className="text-rose-400">♥</span> on any facility to save it here
            </p>
            <Link
              href="/disposal"
              className="inline-flex h-9 items-center px-5 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
            >
              Browse facilities
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {savedFacilities.filter((f) => f != null && f.slug).map((f) => (
              <Link
                key={f.id}
                href={`/disposal/${f.slug}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-[#2D6A4F]/40 hover:shadow-sm transition-all"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{f.name}</p>
                  <p className="text-sm text-gray-500 truncate">
                    {[f.city, f.state].filter(Boolean).join(", ")}
                  </p>
                </div>
                <span className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium bg-[#2D6A4F]/10 text-[#2D6A4F] capitalize">
                  {f.facility_type.replace(/_/g, " ")}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* New list modal */}
      <NewListModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleListCreated}
      />

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={(o) => { if (!o) setDeleteConfirmId(null); }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deleteTarget?.name}&rdquo;?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 mt-1">
            Haulers in this list will be moved to Favorites. This cannot be
            undone.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancel
            </Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={() =>
                deleteConfirmId && handleDeleteList(deleteConfirmId)
              }
            >
              Delete list
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Sidebar item (non-editable, used for "All Saved") ─────────────────────────

function SidebarItem({
  label,
  count,
  active,
  icon,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  icon?: React.ReactNode;
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
      {icon && (
        <span className="shrink-0 text-current opacity-60">{icon}</span>
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

// ── Editable list sidebar item ─────────────────────────────────────────────────

function EditableListItem({
  list,
  count,
  active,
  onClick,
  onRename,
  onColorChange,
  onDeleteRequest,
}: {
  list: UserList;
  count: number;
  active: boolean;
  onClick: () => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onColorChange: (id: string, color: string) => Promise<void>;
  onDeleteRequest: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<"view" | "rename" | "color">("view");
  const [renameValue, setRenameValue] = useState(list.name);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Keep rename input in sync when list name changes externally
  useEffect(() => {
    setRenameValue(list.name);
  }, [list.name]);

  const submitRename = async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== list.name) {
      await onRename(list.id, trimmed);
    } else {
      setRenameValue(list.name);
    }
    setMode("view");
  };

  return (
    <div ref={containerRef} className="relative group">
      {/* ── Rename mode ── */}
      {mode === "rename" && (
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <span
            className="size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: list.color }}
          />
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submitRename(); }
              if (e.key === "Escape") { setRenameValue(list.name); setMode("view"); }
            }}
            maxLength={60}
            className="flex-1 min-w-0 text-sm border border-[#2D6A4F] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D6A4F]"
          />
        </div>
      )}

      {/* ── Color picker mode ── */}
      {mode === "color" && (
        <div className="px-2 py-2">
          <p className="text-xs text-gray-500 mb-2">Choose color</p>
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.label}
                onClick={async () => {
                  await onColorChange(list.id, c.hex);
                  setMode("view");
                }}
                className={`size-6 rounded-full transition-all ${
                  list.color === c.hex
                    ? "ring-2 ring-offset-1 ring-gray-400 scale-110"
                    : "hover:scale-105"
                }`}
                style={{ backgroundColor: c.hex }}
                aria-label={c.label}
              />
            ))}
          </div>
          <button
            onClick={() => setMode("view")}
            className="text-xs text-gray-400 hover:text-gray-600 mt-2 block"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Normal view ── */}
      {mode === "view" && (
        <button
          onClick={onClick}
          className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors text-left ${
            active
              ? "bg-[#2D6A4F]/10 text-[#2D6A4F] font-medium"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span
            className="size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: list.color }}
          />
          <span className="flex-1 truncate">{list.name}</span>
          <span
            className={`text-xs tabular-nums ${
              active ? "text-[#2D6A4F]" : "text-gray-400"
            }`}
          >
            {count}
          </span>

          {/* "…" options button — shown on hover or when menu is open */}
          <span
            role="button"
            aria-label="List options"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            className={`shrink-0 p-0.5 rounded transition-colors hover:bg-black/10 ${
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <MoreHorizontal className="size-3.5" />
          </span>
        </button>
      )}

      {/* ── Dropdown menu ── */}
      {menuOpen && mode === "view" && (
        <div className="absolute left-0 right-0 top-full mt-0.5 z-20 bg-white rounded-lg border border-gray-200 shadow-md py-1 text-sm">
          <button
            onClick={() => { setMode("rename"); setMenuOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-700 hover:bg-gray-50 transition-colors text-left"
          >
            <Pencil className="size-3.5 text-gray-400 shrink-0" />
            Rename
          </button>
          <button
            onClick={() => { setMode("color"); setMenuOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-700 hover:bg-gray-50 transition-colors text-left"
          >
            <Palette className="size-3.5 text-gray-400 shrink-0" />
            Change color
          </button>
          {list.name !== "Favorites" && (
            <>
              <div className="h-px bg-gray-100 my-1" />
              <button
                onClick={() => { setMenuOpen(false); onDeleteRequest(list.id); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-rose-600 hover:bg-rose-50 transition-colors text-left"
              >
                <Trash2 className="size-3.5 shrink-0" />
                Delete list
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
