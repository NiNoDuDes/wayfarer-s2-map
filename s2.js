/**
 * Minimal S2 geometry library — covers everything needed for
 * Wayfarer cell visualisation (L14 + L17) in browser JS.
 *
 * Based on the open-source S2 Geometry specification.
 * Ported / condensed for browser use — no Node dependencies.
 */

const S2 = (() => {

  // ── Low-level helpers ──────────────────────────────────────────

  function toRadians(deg) { return deg * Math.PI / 180; }
  function toDegrees(rad) { return rad * 180 / Math.PI; }

  /** Convert lat/lng (degrees) → unit vector (x,y,z) */
  function llToXYZ(lat, lng) {
    const φ = toRadians(lat);
    const λ = toRadians(lng);
    return {
      x: Math.cos(φ) * Math.cos(λ),
      y: Math.cos(φ) * Math.sin(λ),
      z: Math.sin(φ)
    };
  }

  /** Convert unit vector → lat/lng degrees */
  function xyzToLL(v) {
    return {
      lat: toDegrees(Math.atan2(v.z, Math.sqrt(v.x * v.x + v.y * v.y))),
      lng: toDegrees(Math.atan2(v.y, v.x))
    };
  }

  // ── Face projection ────────────────────────────────────────────

  function xyzToFaceUV(p) {
    let face, u, v;
    const ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z);

    if (ax > ay && ax > az) {
      face = p.x > 0 ? 0 : 3;
      u = (face === 0) ? p.y / p.x : -p.y / p.x;
      v = (face === 0) ? p.z / p.x : -p.z / p.x;
    } else if (ay > az) {
      face = p.y > 0 ? 1 : 4;
      u = (face === 1) ? -p.x / p.y : p.x / p.y;
      v = (face === 1) ? p.z / p.y : -p.z / p.y;
    } else {
      face = p.z > 0 ? 2 : 5;
      u = (face === 2) ? -p.x / p.z : p.x / p.z;
      v = (face === 2) ? -p.y / p.z : p.y / p.z;
    }
    return { face, u, v };
  }

  /** Quadratic ST ↔ UV transforms (matches Google's implementation) */
  function uvToST(u) {
    return u >= 0
      ? 0.5 * Math.sqrt(1 + 3 * u)
      : 1 - 0.5 * Math.sqrt(1 - 3 * u);
  }

  function stToUV(s) {
    return s >= 0.5
      ? (1 / 3) * (4 * s * s - 1)
      : (1 / 3) * (1 - 4 * (1 - s) * (1 - s));
  }

  function stToIJ(s, level) {
    const cells = 1 << level;  // 2^level
    return Math.max(0, Math.min(cells - 1, Math.floor(s * cells)));
  }

  // ── Cell ID ────────────────────────────────────────────────────

  /**
   * Returns the S2 cell token (hex) for a given lat/lng + level.
   * Uses BigInt for 64-bit precision.
   */
  function latLngToToken(lat, lng, level) {
    const xyz = llToXYZ(lat, lng);
    const { face, u, v } = xyzToFaceUV(xyz);
    const su = uvToST(u);
    const sv = uvToST(v);
    const maxSI = (1 << 30);                 // 2^30
    const i = Math.min(maxSI - 1, Math.floor(su * maxSI));
    const j = Math.min(maxSI - 1, Math.floor(sv * maxSI));

    // Interleave bits of i and j
    function interleave(n) {
      let b = BigInt(n) & 0x3fffffffn;
      b = (b | (b << 16n)) & 0x0000ffff0000ffffn;
      b = (b | (b <<  8n)) & 0x00ff00ff00ff00ffn;
      b = (b | (b <<  4n)) & 0x0f0f0f0f0f0f0f0fn;
      b = (b | (b <<  2n)) & 0x3333333333333333n;
      b = (b | (b <<  1n)) & 0x5555555555555555n;
      return b;
    }

    const bits = (interleave(i) << 1n) | interleave(j);
    const faceBig = BigInt(face);

    // Shift to include face in top 3 bits
    let id = (faceBig << 61n) | (bits << 1n) | 1n;

    // Shift to desired level (shift right then set trailing bit)
    const levelShift = BigInt(2 * (30 - level));
    id = ((id >> levelShift) | 1n) << levelShift;

    // Convert to 16-char hex token
    const hex = id.toString(16).padStart(16, '0');
    // Remove trailing zeros (S2 token convention)
    return hex.replace(/0+$/, '') || '0';
  }

  // ── Cell corner computation ────────────────────────────────────

  /**
   * Given face + i + j + level, return the 4 corner lat/lngs of the cell.
   */
  function cellCorners(face, i, j, level) {
    const scale = 1 / (1 << level);

    function samplePoint(di, dj) {
      const si = (i + di) * scale;
      const sj = (j + dj) * scale;
      const u = stToUV(si);
      const v = stToUV(sj);
      let xyz;
      switch (face) {
        case 0: xyz = { x:  1,  y:  u, z:  v }; break;
        case 1: xyz = { x: -u,  y:  1, z:  v }; break;
        case 2: xyz = { x: -u,  y: -v, z:  1 }; break;
        case 3: xyz = { x: -1,  y: -v, z: -u }; break;
        case 4: xyz = { x:  v,  y: -1, z: -u }; break;
        case 5: xyz = { x:  v,  y:  u, z: -1 }; break;
      }
      const len = Math.sqrt(xyz.x**2 + xyz.y**2 + xyz.z**2);
      return xyzToLL({ x: xyz.x/len, y: xyz.y/len, z: xyz.z/len });
    }

    return [
      samplePoint(0, 0),
      samplePoint(1, 0),
      samplePoint(1, 1),
      samplePoint(0, 1),
    ];
  }

  /**
   * Get all S2 cells at `level` that intersect the given lat/lng bounding box.
   * Returns array of { corners: [{lat,lng}×4], token, center:{lat,lng} }
   */
  function getCellsInBounds(swLat, swLng, neLat, neLng, level) {
    const cells = [];
    const seen = new Set();

    // Sample a grid of points across the viewport, get the cell for each,
    // then deduplicate by token.
    const STEPS = level >= 17 ? 40 : 14;
    const latStep = (neLat - swLat) / STEPS;
    const lngStep = (neLng - swLng) / STEPS;

    for (let row = 0; row <= STEPS; row++) {
      for (let col = 0; col <= STEPS; col++) {
        const lat = swLat + row * latStep;
        const lng = swLng + col * lngStep;

        if (lat < -85 || lat > 85) continue;

        const xyz = llToXYZ(lat, lng);
        const { face, u, v } = xyzToFaceUV(xyz);
        const su = uvToST(u);
        const sv = uvToST(v);
        const i = stToIJ(su, level);
        const j = stToIJ(sv, level);

        const key = `${face}:${i}:${j}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const corners = cellCorners(face, i, j, level);
        const center = {
          lat: corners.reduce((s, c) => s + c.lat, 0) / 4,
          lng: corners.reduce((s, c) => s + c.lng, 0) / 4
        };
        const token = latLngToToken(center.lat, center.lng, level);

        cells.push({ corners, center, token, face, i, j });
      }
    }

    return cells;
  }

  /** Get the single cell that contains lat/lng at `level` */
  function getCellForLatLng(lat, lng, level) {
    const xyz = llToXYZ(lat, lng);
    const { face, u, v } = xyzToFaceUV(xyz);
    const su = uvToST(u);
    const sv = uvToST(v);
    const i = stToIJ(su, level);
    const j = stToIJ(sv, level);

    const corners = cellCorners(face, i, j, level);
    const center = {
      lat: corners.reduce((s, c) => s + c.lat, 0) / 4,
      lng: corners.reduce((s, c) => s + c.lng, 0) / 4
    };
    const token = latLngToToken(center.lat, center.lng, level);
    return { corners, center, token, face, i, j };
  }

  /**
   * Wayfarer gym logic:
   *   An L14 cell gets a gym if it contains ≥ 2 stops (or ≥ 1 stop that is
   *   already a gym). The first stop added becomes a gym at ≥ 2 total.
   *   At 6 stops → extra gym, at 20 → another extra gym (approximate rule).
   *
   * Returns { gyms: number, nextGymAt: number|null }
   */
  function gymCount(stopCount) {
    if (stopCount === 0) return { gyms: 0, nextGymAt: 2 };
    if (stopCount === 1) return { gyms: 0, nextGymAt: 2 };
    if (stopCount < 6)  return { gyms: 1, nextGymAt: 6 };
    if (stopCount < 20) return { gyms: 2, nextGymAt: 20 };
    return { gyms: 3, nextGymAt: null };
  }

  return { getCellsInBounds, getCellForLatLng, latLngToToken, gymCount };
})();
