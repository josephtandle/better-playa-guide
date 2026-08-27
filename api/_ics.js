/* Server-side ICS feed for the starred list. Served at /api/list-ics so
 * Google Calendar ("from URL") and iPhone (webcal://) can subscribe with one
 * tap: no file juggling, and the calendar updates if the list link updates.
 * Mirrors the client's buildIcs rules: Pacific time, per-day collapse of
 * multi-set days, date-only slots become all-day entries, undated events are
 * left out (inventing a date would be a lie). */
'use strict';

var TZID = 'America/Los_Angeles';
var PRODID = '-//Muse Cafe//Better Playa Guide//EN';
var GUIDE_URL = 'https://musecafe.vip/guide/';

function icsEscape(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/* RFC 5545 line folding at 75 octets. */
function fold(line) {
  var out = [];
  var cur = '';
  var bytes = 0;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    var b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = ' ' + ch;
      bytes = 1 + b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join('\r\n');
}

function p2(n) { return n < 10 ? '0' + n : '' + n; }

function stampOf(mmdd, hhmm) {
  return '2026' + mmdd.replace('-', '') + 'T' + (hhmm || '00:00').replace(':', '') + '00';
}
function nextDay(mmdd) {
  var mon = Number(mmdd.slice(0, 2)), day = Number(mmdd.slice(3, 5));
  var d = new Date(Date.UTC(2026, mon - 1, day + 1));
  return p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
}
/* end <= start means it wrapped past midnight */
function endStamp(mmdd, startHm, endHm) {
  if (!endHm) {
    /* default 1 hour */
    var h = Number(startHm.slice(0, 2)), m = Number(startHm.slice(3, 5));
    h += 1;
    if (h >= 24) return stampOf(nextDay(mmdd), p2(h - 24) + ':' + p2(m));
    return stampOf(mmdd, p2(h) + ':' + p2(m));
  }
  if (endHm <= startHm) return stampOf(nextDay(mmdd), endHm);
  return stampOf(mmdd, endHm);
}

function hashIdIcs(str) {
  var hash = 0x811c9dc5;
  for (var k = 0; k < str.length; k++) { hash ^= str.charCodeAt(k); hash = (hash * 0x01000193) >>> 0; }
  var hex = hash.toString(16);
  while (hex.length < 8) hex = '0' + hex;
  return hex;
}

/* events: resolved guide events (t,c,a,p,s). Returns the full VCALENDAR text. */
function buildListIcs(events, nowIso) {
  var lines = [];
  var stamp = (nowIso || new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:' + PRODID);
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push('X-WR-CALNAME:My Playa Guide');
  lines.push('X-WR-TIMEZONE:' + TZID);
  lines.push('BEGIN:VTIMEZONE');
  lines.push('TZID:' + TZID);
  lines.push('BEGIN:DAYLIGHT');
  lines.push('TZOFFSETFROM:-0800');
  lines.push('TZOFFSETTO:-0700');
  lines.push('TZNAME:PDT');
  lines.push('DTSTART:19700308T020000');
  lines.push('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
  lines.push('END:DAYLIGHT');
  lines.push('BEGIN:STANDARD');
  lines.push('TZOFFSETFROM:-0700');
  lines.push('TZOFFSETTO:-0800');
  lines.push('TZNAME:PST');
  lines.push('DTSTART:19701101T020000');
  lines.push('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
  lines.push('END:STANDARD');
  lines.push('END:VTIMEZONE');

  var seen = {};
  events.forEach(function (e) {
    if (!e) return;
    var evKey = e.t + '|' + e.c;
    if (seen[evKey]) return;
    seen[evKey] = true;
    var slots = (e.s && e.s.length) ? e.s : [];
    /* collapse per day: earliest timed slot wins, count the rest */
    var perDay = {};
    slots.forEach(function (sl) {
      var start = sl && sl[0] ? String(sl[0]) : '';
      var m = /^(\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/.exec(start);
      if (!m) return;
      var day = m[1], hm = m[2] || null;
      if (!perDay[day]) perDay[day] = { first: hm, end: sl[1] || null, count: hm ? 1 : 0, dateOnly: !hm };
      else {
        if (hm) {
          perDay[day].count++;
          perDay[day].dateOnly = false;
          if (!perDay[day].first || hm < perDay[day].first) { perDay[day].first = hm; perDay[day].end = sl[1] || null; }
        }
      }
    });
    Object.keys(perDay).forEach(function (day) {
      var d = perDay[day];
      var uid = 'bpg-' + hashIdIcs(evKey) + '-' + day.replace('-', '') + '@musecafe.vip';
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uid);
      lines.push('DTSTAMP:' + stamp);
      if (d.dateOnly || !d.first) {
        lines.push('DTSTART;VALUE=DATE:2026' + day.replace('-', ''));
        lines.push('DTEND;VALUE=DATE:2026' + nextDay(day).replace('-', ''));
        lines.push('SUMMARY:' + icsEscape(e.t + ' (no set time: ask at camp)'));
      } else {
        lines.push('DTSTART;TZID=' + TZID + ':' + stampOf(day, d.first));
        lines.push('DTEND;TZID=' + TZID + ':' + endStamp(day, d.first, d.end));
        lines.push('SUMMARY:' + icsEscape(e.t + (d.count > 1 ? ' (' + d.count + ' sets this day)' : '')));
      }
      lines.push('LOCATION:' + icsEscape((e.a || 'location unknown') + ', ' + e.c));
      var descBits = [];
      if (e.p) descBits.push('Lineup: ' + e.p);
      descBits.push('Better Playa Guide: ' + GUIDE_URL);
      lines.push('DESCRIPTION:' + icsEscape(descBits.join('\n')));
      if (!d.dateOnly && d.first) {
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push('DESCRIPTION:' + icsEscape(e.t + ' starts in 30 minutes'));
        lines.push('TRIGGER:-PT30M');
        lines.push('END:VALARM');
      }
      lines.push('END:VEVENT');
    });
  });

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildListIcs, icsEscape, fold };
