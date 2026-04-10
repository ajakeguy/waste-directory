import { NextRequest, NextResponse } from "next/server";

// ORS-compatible response shape so existing client code needs no changes.
// {"features": [{"geometry": {"coordinates": [lng, lat]}}]}

const CENSUS_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Census: best for full street addresses
async function tryCensus(
  address: string
): Promise<[number, number] | null> {
  try {
    const url =
      CENSUS_URL +
      "?address=" +
      encodeURIComponent(address) +
      "&benchmark=Public_AR_Current&format=json";

    const res = await fetch(url, {
      next: { revalidate: 0 },
      headers: { "User-Agent": "WasteDirectory/1.0 (geocoding proxy)" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const matches: unknown[] = data?.result?.addressMatches ?? [];
    if (matches.length === 0) return null;

    const coords = (matches[0] as Record<string, Record<string, number>>)
      ?.coordinates;
    const lng = coords?.x;
    const lat = coords?.y;

    if (typeof lng === "number" && typeof lat === "number") {
      return [lng, lat];
    }
    return null;
  } catch {
    return null;
  }
}

// Nominatim: handles city names, landmarks, partial addresses — free, no key
async function tryNominatim(
  address: string
): Promise<[number, number] | null> {
  try {
    const url =
      NOMINATIM_URL +
      "?q=" +
      encodeURIComponent(address) +
      "&format=json&limit=1&countrycodes=us";

    const res = await fetch(url, {
      next: { revalidate: 0 },
      headers: {
        // Nominatim requires a descriptive User-Agent (policy)
        "User-Agent": "WasteDirectory/1.0 (https://waste.markets; geocoding proxy)",
        "Accept-Language": "en",
      },
    });
    if (!res.ok) return null;

    const data: unknown[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const first = data[0] as Record<string, string>;
    const lat = parseFloat(first?.lat ?? "");
    const lon = parseFloat(first?.lon ?? "");

    if (isFinite(lat) && isFinite(lon)) {
      return [lon, lat];
    }
    return null;
  } catch {
    return null;
  }
}

async function tryMapbox(
  address: string,
  token: string
): Promise<[number, number] | null> {
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
      encodeURIComponent(address) +
      `.json?access_token=${token}&country=US&limit=1`;

    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return null;

    const data = await res.json();
    const features: unknown[] = data?.features ?? [];
    if (features.length === 0) return null;

    const coordinates = (
      features[0] as Record<string, Record<string, number[]>>
    )?.geometry?.coordinates;

    if (
      Array.isArray(coordinates) &&
      coordinates.length >= 2 &&
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number"
    ) {
      return [coordinates[0] as number, coordinates[1] as number];
    }
    return null;
  } catch {
    return null;
  }
}

function makeOrsResponse(lngLat: [number, number]) {
  return NextResponse.json({
    features: [
      {
        geometry: {
          coordinates: lngLat,
        },
      },
    ],
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const text = searchParams.get("text");

  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  // 1. Try Census Bureau (best for full street addresses, free, no rate limit)
  const censusResult = await tryCensus(text);
  if (censusResult) {
    return makeOrsResponse(censusResult);
  }

  // 2. Nominatim / OpenStreetMap (handles city names, partial addresses, free)
  const nominatimResult = await tryNominatim(text);
  if (nominatimResult) {
    return makeOrsResponse(nominatimResult);
  }

  // 3. Mapbox (if configured — commercial fallback)
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
  if (mapboxToken) {
    const mapboxResult = await tryMapbox(text, mapboxToken);
    if (mapboxResult) {
      return makeOrsResponse(mapboxResult);
    }
  }

  // 4. No match found — return empty features array (ORS-compatible)
  return NextResponse.json({ features: [] });
}
