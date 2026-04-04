/**
 * lib/geocoding.ts
 *
 * Geocoding utilities using the OpenRouteService free tier.
 * API key: NEXT_PUBLIC_ORS_API_KEY (set at build time — must be in .env.local)
 * Free plan: 2 000 geocoding requests / day.
 */

const ORS_BASE = "https://api.openrouteservice.org/geocode/search";

export type GeocodeSuccess = { ok: true; lat: number; lng: number };
export type GeocodeFailure = { ok: false; error: string };
export type GeocodeResult  = GeocodeSuccess | GeocodeFailure;

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const key = process.env.NEXT_PUBLIC_ORS_API_KEY;

  // Debug: log first 8 chars so we can confirm the key is present in the browser
  if (key) {
    console.debug(`[geocoding] key present: ${key.slice(0, 8)}… | querying: "${address}"`);
  } else {
    console.warn("[geocoding] NEXT_PUBLIC_ORS_API_KEY is not set — geocoding will fail");
    return { ok: false, error: "API key not configured. Add NEXT_PUBLIC_ORS_API_KEY to .env.local" };
  }

  const url =
    `${ORS_BASE}` +
    `?api_key=${encodeURIComponent(key)}` +
    `&text=${encodeURIComponent(address)}` +
    `&size=1` +
    `&boundary.country=US`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `ORS returned HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`;
      console.error("[geocoding]", msg, "| address:", address);
      return { ok: false, error: msg };
    }

    const json = (await res.json()) as {
      features?: Array<{
        geometry: { coordinates: [number, number] };
        properties?: { label?: string };
      }>;
    };

    const feature = json.features?.[0];
    if (!feature) {
      console.warn("[geocoding] no results for:", address);
      return { ok: false, error: "No results found — try a more specific address" };
    }

    // ORS returns [lng, lat]
    const [lng, lat] = feature.geometry.coordinates;
    console.debug(`[geocoding] resolved "${address}" → ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    return { ok: true, lat, lng };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[geocoding] fetch error for:", address, err);
    return { ok: false, error: `Network error: ${msg}` };
  }
}

/**
 * Geocode an array of addresses one-by-one with a 120 ms delay between
 * requests to stay inside ORS rate limits (40 req/s on free plan).
 *
 * Calls onEach after every result so the caller can update UI incrementally.
 */
export async function geocodeAddressesSequential(
  addresses: string[],
  onEach: (index: number, result: GeocodeResult) => void,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < addresses.length; i++) {
    const result = await geocodeAddress(addresses[i]);
    onEach(i, result);
    onProgress?.(i + 1, addresses.length);
    if (i < addresses.length - 1) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
}
