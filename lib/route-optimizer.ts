/**
 * lib/route-optimizer.ts
 *
 * Client-side TSP optimization.
 *
 * Algorithm:
 *   1. Nearest-Neighbor heuristic  — O(n²) — produces a good initial tour
 *   2. 2-opt improvement           — iteratively swaps edge pairs to shorten
 *
 * Good enough for ≤ 250 stops in <1 s in the browser.
 */

export type LatLng = { lat: number; lng: number };

// ── Haversine distance ─────────────────────────────────────────────────────────

export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Pre-compute distance matrix ────────────────────────────────────────────────

function buildMatrix(points: LatLng[]): Float64Array[] {
  const n = points.length;
  const matrix: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    matrix[i] = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        matrix[i][j] = haversineDistance(
          points[i].lat,
          points[i].lng,
          points[j].lat,
          points[j].lng
        );
      }
    }
  }
  return matrix;
}

// ── Route distance (including start → first and last → end) ───────────────────

function routeDistance(
  order: number[],
  matrix: Float64Array[],
  startToStop: Float64Array,
  stopToEnd: Float64Array
): number {
  if (order.length === 0) return 0;
  let d = startToStop[order[0]];
  for (let i = 0; i < order.length - 1; i++) {
    d += matrix[order[i]][order[i + 1]];
  }
  d += stopToEnd[order[order.length - 1]];
  return d;
}

// ── Nearest Neighbor heuristic ─────────────────────────────────────────────────

function nearestNeighbor(
  n: number,
  startToStop: Float64Array,
  matrix: Float64Array[]
): number[] {
  const visited = new Uint8Array(n);
  const order: number[] = [];

  // Find nearest stop to start
  let nearest = 0;
  let nearestDist = startToStop[0];
  for (let j = 1; j < n; j++) {
    if (startToStop[j] < nearestDist) {
      nearestDist = startToStop[j];
      nearest = j;
    }
  }
  visited[nearest] = 1;
  order.push(nearest);

  // Greedily add nearest unvisited stop
  for (let step = 1; step < n; step++) {
    const last = order[order.length - 1];
    let bestJ = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && matrix[last][j] < bestD) {
        bestD = matrix[last][j];
        bestJ = j;
      }
    }
    visited[bestJ] = 1;
    order.push(bestJ);
  }

  return order;
}

// ── 2-opt improvement ──────────────────────────────────────────────────────────

function twoOpt(
  initial: number[],
  matrix: Float64Array[],
  startToStop: Float64Array,
  stopToEnd: Float64Array,
  maxIter: number
): number[] {
  let best = [...initial];
  let bestDist = routeDistance(best, matrix, startToStop, stopToEnd);
  let improved = true;
  let iter = 0;

  while (improved && iter < maxIter) {
    improved = false;
    iter++;

    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 2; j < best.length; j++) {
        // Reverse segment [i+1 .. j]
        const candidate = [
          ...best.slice(0, i + 1),
          ...best.slice(i + 1, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const d = routeDistance(candidate, matrix, startToStop, stopToEnd);
        if (d < bestDist - 1e-9) {
          best = candidate;
          bestDist = d;
          improved = true;
        }
      }
    }
  }

  return best;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export type OptimizeResult = {
  /** Indices into the original stops array, in visit order. */
  orderedIndices: number[];
  /** Total route distance in km (start → stops → end). */
  totalDistanceKm: number;
};

export function optimizeRoute(
  stops: LatLng[],
  startCoords: LatLng,
  endCoords: LatLng
): OptimizeResult {
  const n = stops.length;
  if (n === 0) return { orderedIndices: [], totalDistanceKm: 0 };
  if (n === 1) {
    const d =
      haversineDistance(startCoords.lat, startCoords.lng, stops[0].lat, stops[0].lng) +
      haversineDistance(stops[0].lat, stops[0].lng, endCoords.lat, endCoords.lng);
    return { orderedIndices: [0], totalDistanceKm: d };
  }

  // Build distance matrix between all stops
  const matrix = buildMatrix(stops);

  // Pre-compute start → each stop and each stop → end
  const startToStop = new Float64Array(n);
  const stopToEnd = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    startToStop[i] = haversineDistance(
      startCoords.lat, startCoords.lng,
      stops[i].lat, stops[i].lng
    );
    stopToEnd[i] = haversineDistance(
      stops[i].lat, stops[i].lng,
      endCoords.lat, endCoords.lng
    );
  }

  // Cap 2-opt iterations for large stop counts
  const maxIter = n > 100 ? 100 : 500;

  const initial = nearestNeighbor(n, startToStop, matrix);
  const orderedIndices = twoOpt(initial, matrix, startToStop, stopToEnd, maxIter);
  const totalDistanceKm = routeDistance(orderedIndices, matrix, startToStop, stopToEnd);

  return { orderedIndices, totalDistanceKm };
}
