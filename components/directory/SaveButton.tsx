"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Heart,
  List,
  StickyNote,
  Trash2,
  ChevronLeft,
  Check,
} from "lucide-react";

type UserList = {
  id: string;
  name: string;
  color: string;
};

type RawSavedItem = {
  item_id: string;
  list_id: string | null;
  notes: string | null;
  user_lists: { id: string; name: string; color: string } | null;
};

type Props = {
  orgId: string;
  orgName: string;
  initialSaved: boolean;
  userId: string | null;
};

export function SaveButton({ orgId, orgName, initialSaved, userId }: Props) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<"menu" | "move-list" | "add-note">("menu");

  // Popover data — fetched lazily when popover first opens
  const [lists, setLists] = useState<UserList[] | null>(null);
  const [currentListId, setCurrentListId] = useState<string | null>(null);
  const [currentListName, setCurrentListName] = useState("Favorites");
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setView("menu");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen]);

  /** Fetch lists + this item's current data in parallel, populate popover. */
  const loadPopoverData = useCallback(async () => {
    const [listsRes, savedRes] = await Promise.all([
      fetch("/api/lists"),
      fetch("/api/saved"),
    ]);

    if (listsRes.ok) {
      const data: UserList[] = await listsRes.json();
      setLists(data);
    }

    if (savedRes.ok) {
      const items: RawSavedItem[] = await savedRes.json();
      const item = items.find((s) => s.item_id === orgId);
      if (item) {
        setCurrentListId(item.list_id);
        setNote(item.notes ?? "");
        if (item.user_lists?.name) setCurrentListName(item.user_lists.name);
      }
    }
  }, [orgId]);

  const openPopover = useCallback(() => {
    setIsOpen(true);
    setView("menu");
    loadPopoverData();
  }, [loadPopoverData]);

  const handleHeartClick = async () => {
    if (!userId) {
      router.push("/login");
      return;
    }

    if (saved) {
      openPopover();
      return;
    }

    // Optimistic save
    setSaved(true);
    setPending(true);

    try {
      const res = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });

      if (!res.ok) {
        let errBody = "(no body)";
        try { errBody = await res.text(); } catch { /* ignore */ }
        console.error(`[SaveButton] POST /api/saved failed ${res.status}:`, errBody);
        setSaved(false);
        return;
      }

      const data = await res.json();
      setCurrentListId(data.list_id ?? null);
      openPopover();
      router.refresh();
    } catch (err) {
      console.error("[SaveButton] POST /api/saved threw:", err);
      setSaved(false);
    } finally {
      setPending(false);
    }
  };

  const handleRemove = async () => {
    setSaved(false);
    setIsOpen(false);
    setView("menu");
    setPending(true);

    try {
      const res = await fetch("/api/saved", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (!res.ok) {
        let errBody = "(no body)";
        try { errBody = await res.text(); } catch { /* ignore */ }
        console.error(`[SaveButton] DELETE /api/saved failed ${res.status}:`, errBody);
        setSaved(true); // revert
      } else {
        router.refresh();
      }
    } catch (err) {
      console.error("[SaveButton] DELETE /api/saved threw:", err);
      setSaved(true);
    } finally {
      setPending(false);
    }
  };

  const handleMoveToList = async (listId: string, listName: string) => {
    setCurrentListId(listId);
    setCurrentListName(listName);
    setView("menu");
    await fetch(`/api/saved/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list_id: listId }),
    });
    router.refresh();
  };

  const handleSaveNote = async () => {
    await fetch(`/api/saved/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: note }),
    });
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
    router.refresh();
  };

  const displayListName =
    lists?.find((l) => l.id === currentListId)?.name ?? currentListName;

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* Heart toggle */}
      <button
        onClick={handleHeartClick}
        disabled={pending}
        aria-label={saved ? `Unsave ${orgName}` : `Save ${orgName}`}
        title={
          userId
            ? saved
              ? "Saved — click to manage"
              : "Save hauler"
            : "Sign in to save"
        }
        className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
          saved
            ? "text-rose-500 hover:text-rose-600 hover:bg-rose-50"
            : "text-gray-300 hover:text-rose-500 hover:bg-rose-50"
        }`}
      >
        <Heart className={`size-4 ${saved ? "fill-current" : ""}`} />
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute right-0 top-8 z-50 w-56 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
          {/* ── Main menu ─────────────────────────────────────────────── */}
          {view === "menu" && (
            <>
              <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2">
                <Heart className="size-3.5 fill-rose-500 text-rose-500 shrink-0" />
                <span className="text-xs font-medium text-gray-700 truncate">
                  Saved to {displayListName}
                </span>
              </div>

              <div className="py-1">
                <button
                  onClick={() => setView("move-list")}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                >
                  <List className="size-3.5 text-gray-400 shrink-0" />
                  Move to list…
                </button>

                <button
                  onClick={() => setView("add-note")}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                >
                  <StickyNote className="size-3.5 text-gray-400 shrink-0" />
                  {note ? "Edit note…" : "Add note…"}
                </button>

                <div className="h-px bg-gray-100 my-1" />

                <button
                  onClick={handleRemove}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 transition-colors text-left"
                >
                  <Trash2 className="size-3.5 shrink-0" />
                  Remove from saved
                </button>
              </div>
            </>
          )}

          {/* ── Move to list ───────────────────────────────────────────── */}
          {view === "move-list" && (
            <>
              <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2">
                <button
                  onClick={() => setView("menu")}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Back"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-xs font-medium text-gray-700">
                  Move to list
                </span>
              </div>

              <div className="py-1 max-h-48 overflow-y-auto">
                {lists === null ? (
                  <p className="text-xs text-gray-400 px-3 py-2">Loading…</p>
                ) : lists.length === 0 ? (
                  <p className="text-xs text-gray-400 px-3 py-2">
                    No lists yet
                  </p>
                ) : (
                  lists.map((list) => (
                    <button
                      key={list.id}
                      onClick={() => handleMoveToList(list.id, list.name)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                    >
                      <span
                        className="size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: list.color }}
                      />
                      <span className="flex-1 truncate">{list.name}</span>
                      {list.id === currentListId && (
                        <Check className="size-3.5 text-[#2D6A4F] shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {/* ── Add / edit note ─────────────────────────────────────────── */}
          {view === "add-note" && (
            <>
              <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2">
                <button
                  onClick={() => setView("menu")}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Back"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-xs font-medium text-gray-700">
                  My note
                </span>
              </div>

              <div className="p-3">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={handleSaveNote}
                  placeholder="Add a private note…"
                  autoFocus
                  rows={3}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#2D6A4F] focus:border-[#2D6A4F] text-gray-700 placeholder:text-gray-400"
                />
                <div className="flex items-center justify-between mt-2">
                  <span
                    className={`text-xs text-[#2D6A4F] transition-opacity duration-300 ${
                      noteSaved ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    Saved ✓
                  </span>
                  <button
                    onClick={handleSaveNote}
                    className="text-xs text-white bg-[#2D6A4F] hover:bg-[#245a42] rounded-md px-2.5 py-1 transition-colors"
                  >
                    Save note
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
