const geoData = require('../data/geo/brc-2026.json');

// Build street lookup map from geo JSON rings
const streetMap = {};
for (const ring of geoData.rings) {
  streetMap[ring.letter.toLowerCase()] = ring.letter;
  streetMap[ring.name.toLowerCase()] = ring.letter;
}

// Build landmark map from landmarks and plazas
const landmarkMap = {};
if (geoData.landmarks) {
  for (const [k, v] of Object.entries(geoData.landmarks)) {
    landmarkMap[k.toLowerCase()] = { lat: v.lat, lon: v.lon };
  }
}
if (geoData.plazas) {
  for (const plaza of geoData.plazas) {
    if (plaza.name) {
      landmarkMap[plaza.name.toLowerCase()] = { lat: plaza.lat, lon: plaza.lon };
    }
  }
}

/**
 * Compass bearing from clock position.
 * formula: ((clock_hours - 10.5) * 30) mod 360
 * 10:30 -> 0 deg (N), 12:00 -> 45 deg (NE), 4:30 -> 180 deg (S), etc.
 */
function clockToBearing(clock_hours) {
  let bearing = ((clock_hours - 10.5) * 30) % 360;
  if (bearing < 0) bearing += 360;
  return bearing;
}

/**
 * Clock position from compass bearing.
 */
function bearingToClock(bearing_deg) {
  let clock_hours = 10.5 + bearing_deg / 30;
  while (clock_hours > 12) clock_hours -= 12;
  while (clock_hours <= 0) clock_hours += 12;
  return clock_hours;
}

/**
 * Format numeric clock hours (e.g. 7.5) to string (e.g. "7:30").
 */
function formatClock(clock_hours) {
  let h = clock_hours;
  while (h > 12) h -= 12;
  while (h <= 0) h += 12;
  let totalMins = Math.round(h * 60);
  let hrs = Math.floor(totalMins / 60);
  let mins = totalMins % 60;
  if (hrs === 0) hrs = 12;
  return `${hrs}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Parse clock string (e.g. "7:30" or "6") to decimal hours.
 */
function parseClockString(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hours = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  if (hours < 1 || hours > 12 || mins < 0 || mins >= 60) return null;
  return hours + mins / 60;
}

/**
 * Resolve street name/letter to letter code (e.g. "Esplanade" -> "ESP", "Eternal" -> "E").
 */
function resolveStreet(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  return streetMap[s] || null;
}

/**
 * Parse address string (e.g. "7:30 & E", "E & 7:30", "7:30 and Eternal")
 * Returns { clock_hours, street, clock, address } or null.
 */
function parseAddress(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  if (!s) return null;

  let parts;
  if (/\bAND\b/i.test(s)) {
    parts = s.split(/\bAND\b/i);
  } else if (s.includes('&')) {
    parts = s.split('&');
  } else if (s.includes('@')) {
    parts = s.split('@');
  } else {
    parts = [s];
  }

  parts = parts.map(p => p.trim()).filter(Boolean);

  let clockPart = null;
  let streetPart = null;

  if (parts.length === 2) {
    const st0 = resolveStreet(parts[0]);
    const cl0 = parseClockString(parts[0]);
    const st1 = resolveStreet(parts[1]);
    const cl1 = parseClockString(parts[1]);

    if (st0 && cl1 !== null) {
      streetPart = st0;
      clockPart = cl1;
    } else if (st1 && cl0 !== null) {
      streetPart = st1;
      clockPart = cl0;
    }
  } else if (parts.length === 1) {
    const match1 = s.match(/^(\d{1,2}(?::\d{2})?)\s*([^0-9\s].*)$/i);
    if (match1) {
      const cl = parseClockString(match1[1]);
      const st = resolveStreet(match1[2]);
      if (cl !== null && st) {
        clockPart = cl;
        streetPart = st;
      }
    }
    if (!streetPart) {
      const match2 = s.match(/^([^0-9\s].*?)\s*(\d{1,2}(?::\d{2})?)$/i);
      if (match2) {
        const st = resolveStreet(match2[1]);
        const cl = parseClockString(match2[2]);
        if (st && cl !== null) {
          streetPart = st;
          clockPart = cl;
        }
      }
    }
  }

  if (!streetPart || clockPart === null) return null;
  if (clockPart < 1.0 || clockPart > 12.0) return null;

  const clockStr = formatClock(clockPart);
  const address = `${clockStr} & ${streetPart}`;

  return {
    clock_hours: clockPart,
    street: streetPart,
    clock: clockStr,
    address: address
  };
}

/**
 * Convert address string or object to { lat, lon }.
 */
function addressToLatLon(input) {
  let parsed;
  if (typeof input === 'string') {
    parsed = parseAddress(input);
  } else if (input && typeof input === 'object') {
    if (typeof input.lat === 'number' && typeof input.lon === 'number') {
      return { lat: input.lat, lon: input.lon };
    }
    parsed = input;
  }
  if (!parsed || parsed.clock_hours === undefined || !parsed.street) {
    return null;
  }

  const ring = geoData.rings.find(r => r.letter === parsed.street);
  if (!ring) return null;

  const bearing_deg = clockToBearing(parsed.clock_hours);
  const bearing_rad = bearing_deg * Math.PI / 180;
  const north_ft = ring.radius_ft * Math.cos(bearing_rad);
  const east_ft = ring.radius_ft * Math.sin(bearing_rad);

  const lat = geoData.man.lat + north_ft / geoData.ft_per_deg_lat;
  const lon = geoData.man.lon + east_ft / geoData.ft_per_deg_lon;

  return { lat, lon };
}

/**
 * Inverse: Convert lat/lon to snapped BRC address object.
 */
function latLonToAddress(arg1, arg2) {
  let lat, lon;
  if (typeof arg1 === 'object' && arg1 !== null) {
    lat = arg1.lat;
    lon = arg1.lon;
  } else {
    lat = arg1;
    lon = arg2;
  }
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const dLat = lat - geoData.man.lat;
  const dLon = lon - geoData.man.lon;

  const north_ft = dLat * geoData.ft_per_deg_lat;
  const east_ft = dLon * geoData.ft_per_deg_lon;

  const radius_ft = Math.sqrt(north_ft * north_ft + east_ft * east_ft);
  const bearing_rad = Math.atan2(east_ft, north_ft);
  let bearing_deg = bearing_rad * 180 / Math.PI;
  if (bearing_deg < 0) bearing_deg += 360;

  const clock_hours = bearingToClock(bearing_deg);
  const clock_str = formatClock(clock_hours);

  const espRadius = geoData.rings[0].radius_ft;
  const kRadius = geoData.rings[geoData.rings.length - 1].radius_ft;

  const isCitySector = (clock_hours >= 1.99 && clock_hours <= 10.01);

  if (radius_ft < espRadius - 200) {
    return {
      address: "Open Playa",
      clock: clock_str,
      street: null,
      radius_ft,
      confidence: "open_playa"
    };
  }

  if (radius_ft > kRadius + 300) {
    return {
      address: "Outer playa / walk-in",
      clock: clock_str,
      street: null,
      radius_ft,
      confidence: "outer_playa"
    };
  }

  if (!isCitySector) {
    return {
      address: "Open Playa",
      clock: clock_str,
      street: null,
      radius_ft,
      confidence: "open_playa"
    };
  }

  let nearestRing = geoData.rings[0];
  let minDiff = Math.abs(radius_ft - nearestRing.radius_ft);

  for (let i = 1; i < geoData.rings.length; i++) {
    const diff = Math.abs(radius_ft - geoData.rings[i].radius_ft);
    if (diff < minDiff) {
      minDiff = diff;
      nearestRing = geoData.rings[i];
    }
  }

  const address = `${clock_str} & ${nearestRing.letter}`;

  return {
    address,
    clock: clock_str,
    street: nearestRing.letter,
    radius_ft,
    confidence: "high"
  };
}

/**
 * Lookup landmark by case-insensitive name.
 */
function landmark(name) {
  if (!name || typeof name !== 'string') return null;
  const s = name.trim().toLowerCase();
  const found = landmarkMap[s];
  if (found) return { lat: found.lat, lon: found.lon };
  return null;
}

/**
 * Resolve argument (address string, landmark name, or {lat,lon}) to {lat,lon}.
 */
function resolvePoint(p) {
  if (!p) return null;
  if (typeof p === 'object' && typeof p.lat === 'number' && typeof p.lon === 'number') {
    return { lat: p.lat, lon: p.lon };
  }
  if (typeof p === 'string') {
    const lm = landmark(p);
    if (lm) return lm;
    const ll = addressToLatLon(p);
    if (ll) return ll;
  }
  return null;
}

/**
 * Distance in feet between two points.
 */
function distanceFt(a, b) {
  const p1 = resolvePoint(a);
  const p2 = resolvePoint(b);
  if (!p1 || !p2) return NaN;

  const dLat = p2.lat - p1.lat;
  const dLon = p2.lon - p1.lon;

  const north_ft = dLat * geoData.ft_per_deg_lat;
  const east_ft = dLon * geoData.ft_per_deg_lon;

  return Math.sqrt(north_ft * north_ft + east_ft * east_ft);
}

/**
 * Walking time in minutes at 3.0 ft/sec.
 */
function walkMinutes(a, b) {
  const dist = distanceFt(a, b);
  if (isNaN(dist)) return NaN;
  return dist / 180.0;
}

/**
 * Biking time in minutes at 8.0 ft/sec.
 */
function bikeMinutes(a, b) {
  const dist = distanceFt(a, b);
  if (isNaN(dist)) return NaN;
  return dist / 480.0;
}

/**
 * Direction description from point A to point B.
 */
function directionFrom(a, b) {
  const p1 = resolvePoint(a);
  const p2 = resolvePoint(b);
  if (!p1 || !p2) return null;

  const dLat = p2.lat - p1.lat;
  const dLon = p2.lon - p1.lon;

  const north_ft = dLat * geoData.ft_per_deg_lat;
  const east_ft = dLon * geoData.ft_per_deg_lon;

  const dist_ft = Math.sqrt(north_ft * north_ft + east_ft * east_ft);
  const bearing_rad = Math.atan2(east_ft, north_ft);
  let bearing_deg = bearing_rad * 180 / Math.PI;
  if (bearing_deg < 0) bearing_deg += 360;

  const compassDirections = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compassIndex = Math.round(bearing_deg / 22.5) % 16;
  const compass = compassDirections[compassIndex];

  const clock_hours = bearingToClock(bearing_deg);
  const clock_str = formatClock(clock_hours);

  const blocks = Math.round(dist_ft / 300);

  return `toward ${clock_str} (${compass}), ${dist_ft.toFixed(0)} ft (${blocks} block${blocks === 1 ? '' : 's'})`;
}

module.exports = {
  parseAddress,
  addressToLatLon,
  latLonToAddress,
  distanceFt,
  walkMinutes,
  bikeMinutes,
  directionFrom,
  landmark,
  clockToBearing,
  bearingToClock
};
