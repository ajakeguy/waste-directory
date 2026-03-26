import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch saved items with their list info.
  // item_id is NOT a named FK so org data must be fetched separately.
  const { data, error } = await supabase
    .from("saved_items")
    .select("id, item_id, list_id, notes, created_at, user_lists(id, name, color)")
    .eq("user_id", user.id)
    .eq("item_type", "organization")
    .order("created_at", { ascending: false });

  if (error) {
    // Migration 014 may not be applied yet — fall back to basic columns
    const msg = error.message.toLowerCase();
    if (msg.includes("list_id") || msg.includes("notes") || msg.includes("column")) {
      console.error("[/api/saved GET] Falling back to basic select (migration 014 may not be applied):", error.message);
      const { data: basic, error: basicErr } = await supabase
        .from("saved_items")
        .select("id, item_id, created_at")
        .eq("user_id", user.id)
        .eq("item_type", "organization")
        .order("created_at", { ascending: false });
      if (basicErr) {
        console.error("[/api/saved GET] Basic select also failed:", basicErr.message);
        return NextResponse.json({ error: basicErr.message }, { status: 500 });
      }
      return NextResponse.json(
        (basic ?? []).map((r) => ({ ...r, list_id: null, notes: null, user_lists: null }))
      );
    }
    console.error("[/api/saved GET] Query failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { org_id, list_id, notes } = body as {
    org_id?: string;
    list_id?: string;
    notes?: string;
  };

  if (!org_id) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }

  // Prevent duplicates
  const { data: existing } = await supabase
    .from("saved_items")
    .select("id")
    .eq("user_id", user.id)
    .eq("item_id", org_id)
    .eq("item_type", "organization")
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Already saved" }, { status: 409 });
  }

  // Resolve target list: use provided list_id, or find/create Favorites
  let targetListId: string | null = list_id ?? null;

  if (!targetListId) {
    // Look for an existing "Favorites" list first
    const { data: favList, error: favErr } = await supabase
      .from("user_lists")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", "Favorites")
      .maybeSingle();

    if (favErr) {
      // user_lists table may not exist yet (migration 014 not applied) — proceed without a list
      console.error("[/api/saved POST] Error querying user_lists:", favErr.message);
    } else if (favList) {
      targetListId = favList.id;
    } else {
      // Check if the user has any lists at all
      const { data: anyList, error: anyErr } = await supabase
        .from("user_lists")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (anyErr) {
        console.error("[/api/saved POST] Error querying any user list:", anyErr.message);
      } else if (anyList) {
        targetListId = anyList.id;
      } else {
        // First save ever — create the Favorites list
        const { data: newList, error: newListErr } = await supabase
          .from("user_lists")
          .insert({ user_id: user.id, name: "Favorites", color: "#2D6A4F" })
          .select("id")
          .single();
        if (newListErr) {
          console.error("[/api/saved POST] Error creating Favorites list:", newListErr.message);
        } else {
          targetListId = newList?.id ?? null;
        }
      }
    }
  }

  // Attempt full insert (requires migration 014 — list_id + notes columns on saved_items).
  // If those columns don't exist yet, fall back to a minimal insert so saves still work.
  const fullInsert = await supabase
    .from("saved_items")
    .insert({
      user_id: user.id,
      item_type: "organization",
      item_id: org_id,
      list_id: targetListId,
      notes: notes || null,
    })
    .select("id, item_id, list_id, notes")
    .single();

  if (fullInsert.error) {
    const msg = fullInsert.error.message.toLowerCase();
    const missingColumn = msg.includes("list_id") || msg.includes("notes") || msg.includes("column");

    if (missingColumn) {
      // Migration 014 not yet applied — fall back to basic insert (no list_id / notes)
      console.error("[/api/saved POST] list_id/notes columns missing, trying basic insert:", fullInsert.error.message);
      const basicInsert = await supabase
        .from("saved_items")
        .insert({ user_id: user.id, item_type: "organization", item_id: org_id })
        .select("id, item_id")
        .single();
      if (basicInsert.error) {
        console.error("[/api/saved POST] Basic insert also failed:", basicInsert.error.message);
        return NextResponse.json({ error: basicInsert.error.message }, { status: 500 });
      }
      return NextResponse.json({ ...basicInsert.data, list_id: null, notes: null }, { status: 201 });
    }

    console.error("[/api/saved POST] Insert failed:", fullInsert.error.message);
    return NextResponse.json({ error: fullInsert.error.message }, { status: 500 });
  }

  return NextResponse.json(fullInsert.data, { status: 201 });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { org_id } = body as { org_id?: string };

  if (!org_id) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("saved_items")
    .delete()
    .eq("user_id", user.id)
    .eq("item_id", org_id)
    .eq("item_type", "organization");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
