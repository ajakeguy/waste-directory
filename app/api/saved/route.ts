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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
    const { data: favList } = await supabase
      .from("user_lists")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", "Favorites")
      .maybeSingle();

    if (favList) {
      targetListId = favList.id;
    } else {
      // Check if the user has any lists at all
      const { data: anyList } = await supabase
        .from("user_lists")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (anyList) {
        targetListId = anyList.id;
      } else {
        // First save ever — create the Favorites list
        const { data: newList } = await supabase
          .from("user_lists")
          .insert({ user_id: user.id, name: "Favorites", color: "#2D6A4F" })
          .select("id")
          .single();
        targetListId = newList?.id ?? null;
      }
    }
  }

  const { data, error } = await supabase
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
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
