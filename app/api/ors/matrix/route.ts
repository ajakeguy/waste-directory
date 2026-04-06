import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/ors/matrix
 *
 * Server-side proxy for the ORS Matrix API.
 * Forwards { locations, metrics, units } to ORS and returns the response.
 * Running server-side avoids browser CSP / CORS restrictions and keeps
 * the API key out of client bundles.
 */
export async function POST(req: NextRequest) {
  const key = process.env.NEXT_PUBLIC_ORS_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "ORS API key not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const orsRes = await fetch(
      "https://api.openrouteservice.org/v2/matrix/driving-car",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": key,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    const data = await orsRes.json();
    return NextResponse.json(data, { status: orsRes.status });

  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/ors/matrix]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
