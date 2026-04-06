/**
 * lib/road-routing.ts
 *
 * Fetches a real road route from ORS Directions API.
 * Tries driving-hgv first (best for trucks), falls back to driving-car
 * if HGV profile returns 503/504 (common during ORS graph rebuilds).
 * Handles chunking for routes > 48 intermediate stops.
 */

const PROFILES = ["driving-hgv", "driving-car"] as const;
const TIMEOUT_MS = 30_000;

export type LatLng = { lat: number; lng: number };

export type RoadRouteResult = {
  /** Flat array of [lng, lat] coordinate pairs for the road path GeoJSON */
  coordinates: [number, number][];
  /** Total road distance in miles */
  distanceMiles: number;
};

async function tryFetchChunk(
  coordinates: [number, number][],
  key: string,
  profile: string
): Promise<{ coords: [number, number][]; meters: number } | null> {
  const url = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": key,
      },
      body: JSON.stringify({ coordinates, instructions: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // 503/504 → profile unavailable, signal caller to try next profile
    if (res.status === 503 || res.status === 504) {
      console.warn(`[road-routing] ${profile} returned ${res.status} — trying next profile`);
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[road-routing] ${profile} HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const json = await res.json() as {
      features?: Array<{
        geometry: { coordinates: [number, number][] };
        properties: { summary: { distance: number } };
      }>;
    };

    const feature = json.features?.[0];
    if (!feature) {
      console.error(`[road-routing] ${profile} — no features in response`);
      return null;
    }

    return {
      coords: feature.geometry.coordinates,
      meters: feature.properties.summary.distance,
    };

  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`[road-routing] ${profile} timed out after ${TIMEOUT_MS}ms`);
    } else {
      console.error(`[road-routing] ${profile} fetch error:`, err);
    }
    return null;
  }
}

/**
 * Fetch road distance only (no geometry) using the ORS Matrix API.
 * For routes with ≤ 56 intermediate stops (≤ 58 total points), the Matrix API
 * handles it in a single fast call (~2–5s vs 30s+ for Directions).
 * Larger routes fall back to the chunked Directions API.
 *
 * Returns total road distance in miles, or null on failure.
 */
export async function fetchRoadDistanceMatrix(
  start: LatLng,
  orderedStops: LatLng[],
  end: LatLng
): Promise<number | null> {
  const allPoints: LatLng[] = [start, ...orderedStops, end];
  const n = allPoints.length;

  console.log("[matrix] starting for", n, "points");

  const key = process.env.NEXT_PUBLIC_ORS_API_KEY;
  if (!key) {
    console.warn("[matrix] NEXT_PUBLIC_ORS_API_KEY not set");
    return null;
  }

  // Matrix free-tier limit: 3,500 (origins × destinations). 58×58 = 3,364 ≤ limit.
  // For larger routes fall back to chunked Directions (geometry not needed here).
  if (n > 58) {
    console.log("[matrix] route too large for matrix API (" + n + " points), falling back to Directions");
    const result = await fetchRoadRoute(start, orderedStops, end);
    return result?.distanceMiles ?? null;
  }

  const MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-car";
  const locations = allPoints.map((p) => [p.lng, p.lat]);

  console.log("[matrix] calling URL:", MATRIX_URL, "with", n, "points, key present:", !!key);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(
      MATRIX_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": key,
        },
        body: JSON.stringify({ locations, metrics: ["distance"], units: "mi" }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[matrix] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const json = await res.json() as { distances?: number[][] };
    const distances = json.distances;
    if (!distances || distances.length < 2) {
      console.warn("[matrix] unexpected response shape");
      return null;
    }

    // Sum the super-diagonal: distances[0][1] + distances[1][2] + … + distances[N-2][N-1]
    let totalMiles = 0;
    for (let i = 0; i < distances.length - 1; i++) {
      totalMiles += distances[i][i + 1];
    }

    console.log(`[matrix] success: ${totalMiles.toFixed(2)} mi (${n} points)`);
    return totalMiles;

  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[matrix] timed out after 15s");
    } else {
      console.warn("[matrix] fetch error:", err);
    }
    return null;
  }
}

/**
 * Fetch the road geometry from start → ordered stops → end.
 * If more than 48 intermediate stops, splits into chunks of 48 and stitches.
 */
export async function fetchRoadRoute(
  start: LatLng,
  orderedStops: LatLng[],
  end: LatLng
): Promise<RoadRouteResult | null> {
  const key = process.env.NEXT_PUBLIC_ORS_API_KEY;
  if (!key) {
    console.warn("[road-routing] NEXT_PUBLIC_ORS_API_KEY not set");
    return null;
  }

  // Build full waypoint list: start, ...stops, end
  const allWaypoints: LatLng[] = [start, ...orderedStops, end];

  // ORS allows max 50 waypoints per request — use 15 for reliability on free tier
  const CHUNK_SIZE = 15;
  const chunks: LatLng[][] = [];

  if (allWaypoints.length <= CHUNK_SIZE) {
    chunks.push(allWaypoints);
  } else {
    for (let i = 0; i < allWaypoints.length; i += CHUNK_SIZE - 1) {
      const chunk = allWaypoints.slice(i, i + CHUNK_SIZE);
      chunks.push(chunk);
      if (i + CHUNK_SIZE >= allWaypoints.length) break;
    }
  }

  const allCoords: [number, number][] = [];
  let totalDistanceMeters = 0;
  let usedProfile: string | null = null;

  for (let ci = 0; ci < chunks.length; ci++) {
    const coordinates = chunks[ci].map((p) => [p.lng, p.lat] as [number, number]);

    let chunkResult: { coords: [number, number][]; meters: number } | null = null;
    let succeededProfile: string | null = null;

    for (const profile of PROFILES) {
      console.log(`[road-routing] chunk ${ci + 1}/${chunks.length} - ${profile}`);
      chunkResult = await tryFetchChunk(coordinates, key, profile);
      if (chunkResult) {
        succeededProfile = profile;
        break;
      }
    }

    if (!chunkResult) {
      console.error(`[road-routing] all profiles failed for chunk ${ci} — giving up`);
      return null;
    }

    // Log which profile is being used (once, on first chunk success)
    if (ci === 0) {
      usedProfile = succeededProfile;
      if (succeededProfile !== PROFILES[0]) {
        console.log(`[road-routing] using ${succeededProfile} (${PROFILES[0]} unavailable)`);
      }
    }

    // Avoid duplicating the joining point between chunks
    const sliceFrom = ci === 0 ? 0 : 1;
    allCoords.push(...chunkResult.coords.slice(sliceFrom));
    totalDistanceMeters += chunkResult.meters;
  }

  const METERS_PER_MILE = 1609.344;
  const distanceMiles = totalDistanceMeters / METERS_PER_MILE;
  console.log(`[road-routing] success: ${distanceMiles.toFixed(2)} miles via ${usedProfile} (${chunks.length} chunk${chunks.length !== 1 ? "s" : ""})`);
  return { coordinates: allCoords, distanceMiles };
}
