import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { name, description, color } = body as {
    name?: string;
    description?: string;
    color?: string;
  };

  const update: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  if (name !== undefined) update.name = name.trim();
  if (description !== undefined) update.description = description?.trim() || null;
  if (color !== undefined) update.color = color;

  const { data, error } = await supabase
    .from("user_lists")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id) // belt-and-suspenders alongside RLS
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // saved_items.list_id has ON DELETE SET NULL — deleting the list
  // automatically nullifies saved items that referenced it.
  const { error } = await supabase
    .from("user_lists")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
