/**
 * lib/road-routing.ts
 *
 * Fetches a real road route from ORS Directions API (driving-hgv profile).
 * Handles chunking for routes > 48 intermediate stops.
 */

const ORS_DIRECTIONS =
  "https://api.openrouteservice.org/v2/directions/driving-hgv/geojson";

export type LatLng = { lat: number; lng: number };

export type RoadRouteResult = {
  /** Flat array of [lng, lat] coordinate pairs for the road path GeoJSON */
  coordinates: [number, number][];
  /** Total road distance in miles */
  distanceMiles: number;
};

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

  // ORS allows max 50 waypoints per request — chunk at 50 with 1-pt overlap
  const CHUNK_SIZE = 50;
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

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const coordinates = chunk.map((p) => [p.lng, p.lat] as [number, number]);

    try {
      const res = await fetch(ORS_DIRECTIONS, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": key,
        },
        body: JSON.stringify({ coordinates, instructions: false }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[road-routing] chunk ${ci} failed — HTTP ${res.status}: ${body.slice(0, 300)}`);
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
        console.error("[road-routing] no features in response for chunk", ci);
        return null;
      }

      const coords = feature.geometry.coordinates;
      // Avoid duplicating the joining point between chunks
      const start = ci === 0 ? 0 : 1;
      allCoords.push(...coords.slice(start));
      totalDistanceMeters += feature.properties.summary.distance;

    } catch (err) {
      console.error("[road-routing] fetch error for chunk", ci, err);
      return null;
    }
  }

  const METERS_PER_MILE = 1609.344;
  const distanceMiles = totalDistanceMeters / METERS_PER_MILE;
  console.log(`[road-routing] success: ${distanceMiles.toFixed(2)} miles road distance (${chunks.length} chunk${chunks.length !== 1 ? "s" : ""})`);
  return { coordinates: allCoords, distanceMiles };
}
