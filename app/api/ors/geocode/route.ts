import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const text = searchParams.get("text");

  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const apiKey =
    process.env.ORS_API_KEY || process.env.NEXT_PUBLIC_ORS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "ORS API key not configured" },
      { status: 500 }
    );
  }

  const url =
    `https://api.openrouteservice.org/geocode/search` +
    `?api_key=${apiKey}` +
    `&text=${encodeURIComponent(text)}` +
    `&size=1` +
    `&boundary.country=US`;

  try {
    const res  = await fetch(url);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }
}
