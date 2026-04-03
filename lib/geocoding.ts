/**
 * lib/geocoding.ts
 *
 * Geocoding utilities using the OpenRouteService free tier.
 * API key: NEXT_PUBLIC_ORS_API_KEY (accessible in the browser).
 * Free plan: 2 000 geocoding requests / day.
 */

const ORS_BASE = "https://api.openrouteservice.org/geocode/search";

export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.NEXT_PUBLIC_ORS_API_KEY;
  if (!key) {
    console.warn("[geocoding] NEXT_PUBLIC_ORS_API_KEY is not set");
    return null;
  }

  try {
    const url = `${ORS_BASE}?api_key=${encodeURIComponent(key)}&text=${encodeURIComponent(address)}&size=1`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[geocoding] ORS returned", res.status, "for", address);
      return null;
    }
    const json = (await res.json()) as {
      features?: Array<{
        geometry: { coordinates: [number, number] };
      }>;
    };
    const feature = json.features?.[0];
    if (!feature) return null;

    // ORS returns [lng, lat]
    const [lng, lat] = feature.geometry.coordinates;
    return { lat, lng };
  } catch (err) {
    console.error("[geocoding] fetch error for", address, err);
    return null;
  }
}

/**
 * Geocodes an array of addresses sequentially with a 100 ms delay between
 * requests to stay within rate limits.
 *
 * @param addresses  - list of address strings
 * @param onProgress - optional callback called after each geocode completes
 */
export async function geocodeAddresses(
  addresses: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<Array<{ lat: number; lng: number } | null>> {
  const results: Array<{ lat: number; lng: number } | null> = [];

  for (let i = 0; i < addresses.length; i++) {
    results.push(await geocodeAddress(addresses[i]));
    onProgress?.(i + 1, addresses.length);
    if (i < addresses.length - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return results;
}
