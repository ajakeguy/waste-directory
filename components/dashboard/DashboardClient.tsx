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
  Truck,
  MapPin,
  ShoppingBag,
  ArrowRight,
  Clock,
  Search,
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
import { FACILITY_TYPE_LABELS, FACILITY_TYPE_COLORS } from "@/types";
import type { FacilityType } from "@/types";
import type {
  UserList,
  SavedItemWithOrg,
  EquipmentListing,
  DiversionReport,
  SavedRoute,
  DisposalFacility,
} from "@/types";

// ── Color presets (shared with NewListModal) ───────────────────────────────

const PRESET_COLORS = [
  { hex: "#2D6A4F", label: "Forest green" },
  { hex: "#94A3B8", label: "Silver" },
  { hex: "#3B82F6", label: "Blue" },
  { hex: "#F59E0B", label: "Amber" },
  { hex: "#EF4444", label: "Red" },
  { hex: "#8B5CF6", label: "Purple" },
];

// ── Types ──────────────────────────────────────────────────────────────────

type RecentReport = Pick<
  DiversionReport,
  | "id"
  | "report_name"
  | "customer_name"
  | "period_start"
  | "period_end"
  | "status"
  | "created_at"
  | "updated_at"
>;

type RecentRoute = Pick<
  SavedRoute,
  "id" | "route_name" | "stops" | "total_distance_km" | "status" | "updated_at"
>;

type SavedFacility = Pick<
  DisposalFacility,
  "id" | "name" | "slug" | "facility_type" | "city" | "state"
>;

type Tab =
  | "overview"
  | "haulers"
  | "facilities"
  | "routes"
  | "reports"
  | "marketplace";

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

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Main client component ──────────────────────────────────────────────────

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
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [activeListId, setActiveListId] = useState<string | "all">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [haulerSearch, setHaulerSearch] = useState("");
  const router = useRouter();

  // ── Stats ────────────────────────────────────────────────────────────────
  const savedHaulersCount = savedItems.length;
  const savedFacilitiesCount = savedFacilities.filter(
    (f) => f != null && f.slug
  ).length;
  const routesCount = recentRoutes.length;
  const reportsCount = recentReports.length;

  // ── List helpers ─────────────────────────────────────────────────────────
  const allCount = savedItems.length;
  const countByList = (listId: string) =>
    savedItems.filter((i) => i.list_id === listId).length;

  const visibleItems =
    activeListId === "all"
      ? savedItems
      : savedItems.filter((i) => i.list_id === activeListId);

  const filteredItems = haulerSearch
    ? visibleItems.filter((i) =>
        i.org.name.toLowerCase().includes(haulerSearch.toLowerCase())
      )
    : visibleItems;

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

  // ── Recent activity feed (Overview) ──────────────────────────────────────
  type ActivityItem = {
    id: string;
    text: string;
    subtext: string;
    icon: "heart" | "route" | "file";
    href: string;
    date: string | null | undefined;
  };

  const activityItems: ActivityItem[] = [
    ...savedItems.slice(0, 10).map((i) => ({
      id: `h-${i.id}`,
      text: `Saved ${i.org.name}`,
      subtext: [i.org.city, i.org.state].filter(Boolean).join(", "),
      icon: "heart" as const,
      href: `/haulers/${i.org.slug}`,
      date: i.org.created_at,
    })),
    ...recentRoutes.map((r) => ({
      id: `r-${r.id}`,
      text: r.route_name,
      subtext: `${r.stops.length} stop${r.stops.length !== 1 ? "s" : ""}`,
      icon: "route" as const,
      href: `/routes/${r.id}`,
      date: r.updated_at,
    })),
    ...recentReports.map((r) => ({
      id: `rep-${r.id}`,
      text: r.report_name,
      subtext: r.customer_name ?? "",
      icon: "file" as const,
      href: `/reports/${r.id}`,
      date: r.updated_at,
    })),
  ]
    .sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    })
    .slice(0, 5);

  // ── Tab definitions ───────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "haulers", label: `Saved Haulers${savedHaulersCount > 0 ? ` (${savedHaulersCount})` : ""}` },
    { id: "facilities", label: `Saved Facilities${savedFacilitiesCount > 0 ? ` (${savedFacilitiesCount})` : ""}` },
    { id: "routes", label: "Routes" },
    { id: "reports", label: "Reports" },
    { id: "marketplace", label: "Marketplace" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-[#2D6A4F]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-0.5">
              Dashboard
            </p>
            <h1 className="text-xl font-bold text-white">
              {displayName}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/routes/new"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors border border-white/20"
            >
              <Plus className="size-3.5" />
              <span className="hidden sm:inline">New Route</span>
            </Link>
            <Link
              href="/reports/new"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white text-[#2D6A4F] text-sm font-semibold hover:bg-white/90 transition-colors"
            >
              <Plus className="size-3.5" />
              <span className="hidden sm:inline">New Report</span>
            </Link>
          </div>
        </div>

        {/* ── Stats bar ──────────────────────────────────────────────────── */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-0">
            {[
              { label: "Saved Haulers", count: savedHaulersCount, icon: Truck, tab: "haulers" as Tab },
              { label: "Saved Facilities", count: savedFacilitiesCount, icon: Building2, tab: "facilities" as Tab },
              { label: "Routes", count: routesCount, icon: Route, tab: "routes" as Tab },
              { label: "Reports", count: reportsCount, icon: FileText, tab: "reports" as Tab },
            ].map((s) => (
              <button
                key={s.label}
                onClick={() => setActiveTab(s.tab)}
                className="bg-white/10 hover:bg-white/20 transition-colors rounded-t-lg px-4 py-3 text-left group border border-white/10 border-b-0"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <s.icon className="size-3.5 text-white/60" />
                  <p className="text-2xl font-bold text-white">{s.count}</p>
                </div>
                <p className="text-xs text-white/70 font-medium">{s.label}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab navigation ─────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <nav className="flex gap-0 overflow-x-auto [-webkit-overflow-scrolling:touch] scrollbar-none">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-[#2D6A4F] text-[#2D6A4F]"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left column */}
            <div className="flex-1 min-w-0 space-y-6">

              {/* Recent Activity */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Clock className="size-4 text-[#2D6A4F]" />
                  Recent Activity
                </h2>
                {activityItems.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">
                    No activity yet — start by saving haulers or creating reports.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {activityItems.map((item) => (
                      <Link
                        key={item.id}
                        href={item.href}
                        className="flex items-center gap-3 group hover:bg-gray-50 rounded-lg p-2 -mx-2 transition-colors"
                      >
                        <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${
                          item.icon === "heart"
                            ? "bg-rose-50"
                            : item.icon === "route"
                            ? "bg-blue-50"
                            : "bg-amber-50"
                        }`}>
                          {item.icon === "heart" && <Heart className="size-3.5 text-rose-400" />}
                          {item.icon === "route" && <Route className="size-3.5 text-blue-500" />}
                          {item.icon === "file" && <FileText className="size-3.5 text-amber-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate group-hover:text-[#2D6A4F] transition-colors">
                            {item.text}
                          </p>
                          {item.subtext && (
                            <p className="text-xs text-gray-500 truncate">{item.subtext}</p>
                          )}
                        </div>
                        {item.date && (
                          <p className="text-xs text-gray-400 shrink-0">{fmtDate(item.date)}</p>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Saved Haulers preview */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                    <Truck className="size-4 text-[#2D6A4F]" />
                    Saved Haulers
                  </h2>
                  <button
                    onClick={() => setActiveTab("haulers")}
                    className="text-sm text-[#2D6A4F] hover:underline flex items-center gap-1"
                  >
                    View all <ArrowRight className="size-3.5" />
                  </button>
                </div>
                {savedItems.length === 0 ? (
                  <EmptyState
                    icon={<BookmarkX className="size-5 text-gray-400" />}
                    title="No saved haulers yet"
                    description="Browse the directory and click ♥ to save haulers here"
                    action={{ label: "Browse directory", href: "/directory" }}
                  />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {savedItems.slice(0, 4).map((item) => (
                      <HaulerPreviewCard key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right column */}
            <div className="lg:w-72 shrink-0 space-y-6">

              {/* Quick Actions */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Quick Actions</h2>
                <div className="space-y-2">
                  {[
                    { label: "Browse Haulers", href: "/directory", icon: Truck },
                    { label: "Browse Disposal Facilities", href: "/disposal", icon: Building2 },
                    { label: "Plan a Route", href: "/routes/new", icon: Route },
                    { label: "Create Report", href: "/reports/new", icon: FileText },
                    { label: "Post Marketplace Listing", href: "/marketplace/new", icon: ShoppingBag },
                  ].map((a) => (
                    <Link
                      key={a.href}
                      href={a.href}
                      className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-[#2D6A4F]/40 flex items-center gap-3 transition-colors group"
                    >
                      <a.icon className="size-4 text-gray-400 group-hover:text-[#2D6A4F] transition-colors shrink-0" />
                      <span className="text-sm text-gray-700 group-hover:text-gray-900 font-medium">
                        {a.label}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Saved Facilities preview */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                    <Building2 className="size-4 text-[#2D6A4F]" />
                    Saved Facilities
                  </h2>
                  <button
                    onClick={() => setActiveTab("facilities")}
                    className="text-sm text-[#2D6A4F] hover:underline flex items-center gap-1"
                  >
                    View all <ArrowRight className="size-3.5" />
                  </button>
                </div>
                {savedFacilities.filter((f) => f?.slug).length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-3">
                    <Link href="/disposal" className="text-[#2D6A4F] hover:underline">
                      Browse disposal facilities →
                    </Link>
                  </p>
                ) : (
                  <div className="space-y-2">
                    {savedFacilities.filter((f) => f?.slug).slice(0, 3).map((f) => {
                      const typeColor = FACILITY_TYPE_COLORS[f.facility_type as FacilityType] ?? "bg-gray-100 text-gray-700";
                      const typeLabel = FACILITY_TYPE_LABELS[f.facility_type as FacilityType] ?? f.facility_type;
                      return (
                        <Link
                          key={f.id}
                          href={`/disposal/${f.slug}`}
                          className="flex items-center justify-between gap-2 py-2 border-b border-gray-100 last:border-0 hover:text-[#2D6A4F] transition-colors group"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate group-hover:text-[#2D6A4F]">
                              {f.name}
                            </p>
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <MapPin className="size-2.5" />
                              {[f.city, f.state].filter(Boolean).join(", ")}
                            </p>
                          </div>
                          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${typeColor}`}>
                            {typeLabel}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── SAVED HAULERS TAB ─────────────────────────────────────────────── */}
        {activeTab === "haulers" && (
          <div className="flex flex-col md:flex-row gap-6 items-start">

            {/* List sidebar */}
            <aside className="md:w-52 shrink-0 bg-white rounded-xl border border-gray-200 p-4 md:sticky md:top-20">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                My Lists
              </p>
              <div className="space-y-0.5">
                <SidebarItem
                  label="All Saved"
                  count={allCount}
                  active={activeListId === "all"}
                  icon={<Heart className="size-3.5" />}
                  onClick={() => setActiveListId("all")}
                />
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
                <button
                  onClick={() => setModalOpen(true)}
                  className="w-full flex items-center gap-2 px-2 py-2 text-sm text-[#2D6A4F] hover:bg-[#2D6A4F]/8 rounded-lg transition-colors mt-1"
                >
                  <Plus className="size-3.5 shrink-0" />
                  New list
                </button>
              </div>
            </aside>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  {activeList && (
                    <span
                      className="size-3 rounded-full"
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
                <Link href="/directory" className="text-sm text-[#2D6A4F] hover:underline shrink-0">
                  Browse more →
                </Link>
              </div>

              {/* Search within tab */}
              {savedItems.length > 0 && (
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                  <input
                    type="text"
                    value={haulerSearch}
                    onChange={(e) => setHaulerSearch(e.target.value)}
                    placeholder="Search saved haulers..."
                    className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/20 focus:border-[#2D6A4F]"
                  />
                </div>
              )}

              {savedItems.length === 0 ? (
                <EmptyState
                  icon={<BookmarkX className="size-5 text-gray-400" />}
                  title="No saved haulers yet"
                  description={<>Browse the directory and click <span className="text-rose-400">♥</span> on any hauler to save it here</>}
                  action={{ label: "Browse the directory", href: "/directory" }}
                />
              ) : visibleItems.length === 0 ? (
                <EmptyState
                  icon={<FolderOpen className="size-4 text-gray-400" />}
                  title="No haulers in this list yet"
                  description={<>Save a hauler and move it here using the <span className="text-rose-400">♥</span> button</>}
                />
              ) : filteredItems.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-12">No haulers match your search.</p>
              ) : (
                <div className="space-y-3">
                  {filteredItems.map((item) => (
                    <div key={item.id}>
                      <OrganizationCard
                        org={item.org}
                        savedOrgIds={savedSet}
                        userId={userId}
                      />
                      {item.notes && (
                        <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-b-xl -mt-1 px-4 py-2.5">
                          <StickyNote className="size-3.5 text-yellow-500 shrink-0 mt-0.5" />
                          <p className="text-sm text-yellow-800 leading-snug">{item.notes}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SAVED FACILITIES TAB ──────────────────────────────────────────── */}
        {activeTab === "facilities" && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Saved Facilities</h2>
              <Link href="/disposal" className="text-sm text-[#2D6A4F] hover:underline">
                Browse facilities →
              </Link>
            </div>
            {savedFacilities.filter((f) => f?.slug).length === 0 ? (
              <EmptyState
                icon={<Building2 className="size-5 text-gray-400" />}
                title="No saved facilities yet"
                description={<>Browse the disposal directory and click <span className="text-rose-400">♥</span> on any facility to save it here</>}
                action={{ label: "Browse facilities", href: "/disposal" }}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {savedFacilities.filter((f) => f?.slug).map((f) => {
                  const typeColor = FACILITY_TYPE_COLORS[f.facility_type as FacilityType] ?? "bg-gray-100 text-gray-700";
                  const typeLabel = FACILITY_TYPE_LABELS[f.facility_type as FacilityType] ?? f.facility_type;
                  return (
                    <Link
                      key={f.id}
                      href={`/disposal/${f.slug}`}
                      className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-[#2D6A4F]/30 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="font-semibold text-gray-900 group-hover:text-[#2D6A4F] transition-colors leading-snug">
                          {f.name}
                        </p>
                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${typeColor}`}>
                          {typeLabel}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 flex items-center gap-1">
                        <MapPin className="size-3 shrink-0" />
                        {[f.city, f.state].filter(Boolean).join(", ")}
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ROUTES TAB ───────────────────────────────────────────────────── */}
        {activeTab === "routes" && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Saved Routes</h2>
              <Link
                href="/routes/new"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
              >
                <Plus className="size-3.5" />
                New Route
              </Link>
            </div>
            {recentRoutes.length === 0 ? (
              <EmptyState
                icon={<Route className="size-5 text-gray-400" />}
                title="No saved routes yet"
                description="Add your stops, optimize, and get the shortest pickup route"
                action={{ label: "Build your first route", href: "/routes/new" }}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {recentRoutes.map((r) => (
                  <Link
                    key={r.id}
                    href={`/routes/${r.id}`}
                    className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-[#2D6A4F]/30 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-semibold text-gray-900 group-hover:text-[#2D6A4F] transition-colors">
                        {r.route_name}
                      </p>
                      <span
                        className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.status === "optimized"
                            ? "bg-[#2D6A4F]/10 text-[#2D6A4F]"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {r.status === "optimized" ? "Optimized" : "Draft"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      {r.stops.length} stop{r.stops.length !== 1 ? "s" : ""}
                      {r.total_distance_km
                        ? ` · ${r.total_distance_km.toFixed(1)} km`
                        : ""}
                    </p>
                    {r.updated_at && (
                      <p className="text-xs text-gray-400 mt-2">
                        Updated {fmtDate(r.updated_at)}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── REPORTS TAB ──────────────────────────────────────────────────── */}
        {activeTab === "reports" && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Diversion Reports</h2>
              <Link
                href="/reports/new"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
              >
                <Plus className="size-3.5" />
                New Report
              </Link>
            </div>
            {recentReports.length === 0 ? (
              <EmptyState
                icon={<FileText className="size-5 text-gray-400" />}
                title="No reports yet"
                description="Create a diversion report to show customers their recycling impact"
                action={{ label: "Create your first report", href: "/reports/new" }}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {recentReports.map((r) => (
                  <Link
                    key={r.id}
                    href={`/reports/${r.id}`}
                    className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-[#2D6A4F]/30 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-semibold text-gray-900 group-hover:text-[#2D6A4F] transition-colors leading-snug">
                        {r.report_name}
                      </p>
                      <span
                        className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.status === "published"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {r.status === "published" ? "Published" : "Draft"}
                      </span>
                    </div>
                    {r.customer_name && (
                      <p className="text-sm text-gray-500 mb-2">{r.customer_name}</p>
                    )}
                    <p className="text-xs text-gray-400">
                      {r.period_start} – {r.period_end}
                    </p>
                    {r.updated_at && (
                      <p className="text-xs text-gray-400 mt-1">
                        Updated {fmtDate(r.updated_at)}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── MARKETPLACE TAB ──────────────────────────────────────────────── */}
        {activeTab === "marketplace" && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">My Marketplace Listings</h2>
              <Link
                href="/marketplace/new"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
              >
                <Plus className="size-3.5" />
                Post Listing
              </Link>
            </div>
            {myListings.length === 0 ? (
              <EmptyState
                icon={<ShoppingBag className="size-5 text-gray-400" />}
                title="No listings yet"
                description="Post equipment, vehicles, or materials you want to sell or swap"
                action={{ label: "Post your first listing", href: "/marketplace/new" }}
              />
            ) : (
              <MyListings listings={myListings} />
            )}
          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <NewListModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleListCreated}
      />

      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={(o) => {
          if (!o) setDeleteConfirmId(null);
        }}
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
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
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
    </div>
  );
}

// ── Hauler preview card (Overview tab) ────────────────────────────────────

function HaulerPreviewCard({ item }: { item: SavedItemWithOrg }) {
  const { org } = item;
  return (
    <Link
      href={`/haulers/${org.slug}`}
      className="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md hover:border-[#2D6A4F]/30 transition-all group"
    >
      <p className="font-semibold text-sm text-gray-900 group-hover:text-[#2D6A4F] transition-colors truncate mb-1">
        {org.name}
      </p>
      <p className="text-xs text-gray-500 flex items-center gap-1 mb-2">
        <MapPin className="size-2.5 shrink-0" />
        {[org.city, org.state].filter(Boolean).join(", ")}
      </p>
      {org.service_types && org.service_types.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {org.service_types.slice(0, 2).map((s) => (
            <span
              key={s}
              className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium capitalize"
            >
              {s.replace(/_/g, " ")}
            </span>
          ))}
          {org.service_types.length > 2 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
              +{org.service_types.length - 2}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center px-4 bg-white">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <p className="font-medium text-gray-700 mb-1">{title}</p>
      <p className="text-sm text-gray-500 mb-5">{description}</p>
      {action && (
        <Link
          href={action.href}
          className="inline-flex h-9 items-center px-5 rounded-lg bg-[#2D6A4F] text-white text-sm font-medium hover:bg-[#245a42] transition-colors"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

// ── Sidebar item (non-editable) ────────────────────────────────────────────

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

// ── Editable list sidebar item ─────────────────────────────────────────────

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
              if (e.key === "Enter") {
                e.preventDefault();
                submitRename();
              }
              if (e.key === "Escape") {
                setRenameValue(list.name);
                setMode("view");
              }
            }}
            maxLength={60}
            className="flex-1 min-w-0 text-sm border border-[#2D6A4F] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D6A4F]"
          />
        </div>
      )}

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

      {menuOpen && mode === "view" && (
        <div className="absolute left-0 right-0 top-full mt-0.5 z-20 bg-white rounded-lg border border-gray-200 shadow-md py-1 text-sm">
          <button
            onClick={() => {
              setMode("rename");
              setMenuOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-700 hover:bg-gray-50 transition-colors text-left"
          >
            <Pencil className="size-3.5 text-gray-400 shrink-0" />
            Rename
          </button>
          <button
            onClick={() => {
              setMode("color");
              setMenuOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-700 hover:bg-gray-50 transition-colors text-left"
          >
            <Palette className="size-3.5 text-gray-400 shrink-0" />
            Change color
          </button>
          {list.name !== "Favorites" && (
            <>
              <div className="h-px bg-gray-100 my-1" />
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteRequest(list.id);
                }}
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
