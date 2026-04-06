import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/ors/directions
 *
 * Server-side proxy for the ORS Directions API (GeoJSON response).
 * Expects { profile, coordinates, instructions? } in the request body.
 * Forwards to ORS driving-hgv or driving-car endpoint and returns GeoJSON.
 * Running server-side avoids browser CSP / CORS restrictions and keeps
 * the API key out of client bundles.
 */
export async function POST(req: NextRequest) {
  const key = (process.env.ORS_API_KEY || process.env.NEXT_PUBLIC_ORS_API_KEY)?.trim();
  if (!key) {
    console.error("[/api/ors/directions] ORS API key not configured — set ORS_API_KEY in Vercel env vars");
    return NextResponse.json({ error: "ORS_API_KEY not configured on server" }, { status: 500 });
  }
  console.log("[/api/ors/directions] key length:", key.length, "first4:", key.slice(0, 4));

  let body: { profile?: string; coordinates: unknown; instructions?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const profile = body.profile ?? "driving-car";
  const orsBody = { coordinates: body.coordinates, instructions: body.instructions ?? false };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);

  try {
    const orsRes = await fetch(
      `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": key,
        },
        body: JSON.stringify(orsBody),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    const responseBody = await orsRes.text();
    if (!orsRes.ok) {
      console.error(`[/api/ors/directions] ORS returned ${orsRes.status}: ${responseBody.slice(0, 300)}`);
      return NextResponse.json(
        { error: `ORS returned ${orsRes.status}`, body: responseBody.slice(0, 300) },
        { status: orsRes.status }
      );
    }

    return NextResponse.json(JSON.parse(responseBody), { status: 200 });

  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/ors/directions]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
