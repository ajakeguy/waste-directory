import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase OAuth / magic-link callback handler.
 * Supabase redirects here after Google (or any other) OAuth completes.
 * We exchange the one-time code for a session, then redirect the user on.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Honour a ?next= param so deep links work after OAuth
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Something went wrong — send back to login with an error flag
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
