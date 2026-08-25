const geo = require('../src/brc-geo.js');
const geoData = require('../data/geo/brc-2026.json');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

// 1. Bearing table assertion
const bearingTests = [
  { clock: 10.5, expected: 0 },
  { clock: 12.0, expected: 45 },
  { clock: 3.0, expected: 135 },
  { clock: 4.5, expected: 180 },
  { clock: 6.0, expected: 225 },
  { clock: 7.5, expected: 270 },
  { clock: 9.0, expected: 315 }
];

for (const t of bearingTests) {
  const b = geo.clockToBearing(t.clock);
  assert(Math.abs(b - t.expected) <= 0.01, `Bearing for clock ${t.clock} expected ${t.expected}, got ${b}`);
}
console.log('PASS 1: Bearing table assertions (10:30->0, 12:00->45, 3:00->135, 4:30->180, 6:00->225, 7:30->270, 9:00->315)');

// 2. Round trip assertion
const rings = ['ESP', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
let roundTripCount = 0;

for (let h = 2; h <= 10; h += 0.25) {
  const hrs = Math.floor(h);
  const mins = Math.round((h % 1) * 60);
  const clkStr = `${hrs}:${mins.toString().padStart(2, '0')}`;

  for (const r of rings) {
    const addr = `${clkStr} & ${r}`;
    const latLon = geo.addressToLatLon(addr);
    assert(latLon !== null, `addressToLatLon returned null for ${addr}`);
    const res = geo.latLonToAddress(latLon);
    assert(res && res.address === addr, `Round trip failed for ${addr}: got ${res ? res.address : 'null'}`);
    roundTripCount++;
  }
}
console.log(`PASS 2: Round trip verified for all ${roundTripCount} grid addresses (15-min steps x 12 rings)`);

// 3. Landmark sanity assertions
const ccDist = geo.distanceFt('6:00 & ESP', 'Center Camp');
assert(!isNaN(ccDist) && ccDist < 600, `addressToLatLon("6:00 & ESP") expected within 600 ft of Center Camp, got ${ccDist} ft`);

const manLandmark = geo.landmark('The Man');
assert(manLandmark !== null, 'Landmark "The Man" not found');
const manDist = geo.distanceFt(manLandmark, geoData.man);
assert(!isNaN(manDist) && manDist < 50, `The Man landmark expected within 50 ft of man lat/lon, got ${manDist} ft`);

const templeLandmark = geo.landmark('The Temple');
assert(templeLandmark !== null, 'Landmark "The Temple" not found');
const templeAddr = geo.latLonToAddress(templeLandmark);
assert(templeAddr !== null, 'latLonToAddress(The Temple) returned null');
assert(templeAddr.clock === '12:00', `latLonToAddress(The Temple) clock expected near 12:00, got ${templeAddr.clock}`);
assert(templeAddr.street === null, `latLonToAddress(The Temple) street expected null (not snapped), got ${templeAddr.street}`);
assert(templeAddr.confidence === 'open_playa' || templeAddr.address.includes('Open Playa'), `latLonToAddress(The Temple) expected open playa flag`);

console.log(`PASS 3: Landmark sanity assertions verified (Center Camp dist=${ccDist.toFixed(1)}ft, Man dist=${manDist.toFixed(3)}ft, Temple clock=${templeAddr.clock} street=null open_playa)`);

// 4. parseAddress normalization assertion
const validAddresses = [
  "7:30 & E",
  "7:30 and E",
  "7:30&E",
  "7:30 & Eternal",
  "E & 7:30",
  "7:30 & e",
  " 7:30  &  Eternal "
];

for (const raw of validAddresses) {
  const parsed = geo.parseAddress(raw);
  assert(parsed !== null && parsed.address === "7:30 & E", `parseAddress("${raw}") expected "7:30 & E", got ${parsed ? parsed.address : 'null'}`);
}
console.log('PASS 4: parseAddress normalized address "7:30 & E" verified for all 7 input formats');

// 5. walkMinutes & bikeMinutes assertion
const walkMins = geo.walkMinutes("6:00 & ESP", "6:00 & K");
const bikeMins = geo.bikeMinutes("6:00 & ESP", "6:00 & K");
assert(!isNaN(walkMins) && walkMins > 0 && walkMins < 60, `walkMinutes expected > 0 and < 60, got ${walkMins}`);
assert(!isNaN(bikeMins) && bikeMins > 0 && bikeMins < walkMins, `bikeMinutes expected > 0 and < walkMinutes (${walkMins}), got ${bikeMins}`);

console.log(`PASS 5: walkMinutes (${walkMins.toFixed(2)} min) and bikeMinutes (${bikeMins.toFixed(2)} min) assertions verified`);

// 6. Unknown / garbage input assertion
const garbageInputs = [
  null,
  undefined,
  "",
  "   ",
  123,
  "garbage input",
  "7:30 & Z",
  "15:00 & E",
  "E & X",
  "&&&"
];

for (const input of garbageInputs) {
  let result;
  try {
    result = geo.parseAddress(input);
  } catch (err) {
    assert(false, `parseAddress threw an exception for input: ${input}`);
  }
  assert(result === null, `parseAddress expected null for garbage input: ${input}, got ${JSON.stringify(result)}`);
}
console.log('PASS 6: Unknown/garbage inputs return null and do not throw');
