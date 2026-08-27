/* Zero-dependency PDF builder for the starred-list export.
 *
 * "High-class, easy to read, printable": a vertical list of cards grouped by
 * day. Each card: title, times, address (accent colour, its own line), and
 * the description, word-wrapped. Letter portrait, Helvetica core fonts only
 * (nothing embedded), uncompressed content streams so tests can grep the
 * text straight out of the bytes.
 *
 * Scope: this is NOT a general PDF library. It writes exactly the objects
 * this document needs (catalog, pages, page + content pairs, fonts).
 */
'use strict';

var PAGE_W = 612, PAGE_H = 792;            /* US Letter, points */
var MARGIN = 54;                            /* 0.75in */
var CARD_PAD = 12;
var BODY_SIZE = 10, DAY_SIZE = 14, TITLE_SIZE = 22, FOOT_SIZE = 8.5, CARD_TITLE = 11.5;
var LEAD = 14;

var ROUGE = '0.427 0.031 0.075';           /* #6d0813 */
var BRIGHT = '0.561 0.055 0.106';          /* #8f0e1b */
var BRASS = '0.847 0.647 0.294';           /* #d8a54b */
var GREY = '0.32 0.30 0.29';
var INK = '0.098 0.051 0.043';

/* WinAnsi-safe text: keep printable ASCII and Latin-1, drop the rest
 * (emoji, CJK). PDF literal strings escape backslash and parens. */
function pdfText(s) {
  var out = '';
  var t = String(s == null ? '' : s)
    .replace(/’|‘/g, "'")
    .replace(/“|”/g, '"')
    .replace(/–|—/g, '-')
    .replace(/…/g, '...');
  for (var i = 0; i < t.length; i++) {
    var c = t.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) { out += ' '; continue; }
    if (c < 32 || (c > 126 && c < 160) || c > 255) continue;
    var ch = t[i];
    if (ch === '\\' || ch === '(' || ch === ')') out += '\\';
    out += ch;
  }
  return out;
}

/* Helvetica has no width table here; approximate for wrapping. */
function approxW(s, size) { return String(s).length * size * 0.5; }
function fit(s, size, maxW) {
  var t = String(s == null ? '' : s);
  if (approxW(t, size) <= maxW) return t;
  var keep = Math.max(4, Math.floor(maxW / (size * 0.5)) - 3);
  return t.slice(0, keep).replace(/\s+\S*$/, '') + '...';
}

/* Greedy word wrap into at most maxLines lines. */
function wrap(s, size, maxW, maxLines) {
  var words = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().split(' ');
  var lines = [], cur = '';
  for (var i = 0; i < words.length; i++) {
    var next = cur ? cur + ' ' + words[i] : words[i];
    if (approxW(next, size) > maxW && cur) {
      lines.push(cur);
      cur = words[i];
      if (lines.length === maxLines - 1) {
        /* last allowed line: cram the rest, truncate */
        var rest = words.slice(i).join(' ');
        lines.push(fit(rest, size, maxW));
        return lines;
      }
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function textOp(font, size, x, y, str) {
  return 'BT /' + font + ' ' + size + ' Tf 1 0 0 1 ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' Tm (' + pdfText(str) + ') Tj ET\n';
}
function fillColor(rgb) { return rgb + ' rg\n'; }
function ruleOp(x1, y, x2, rgb, w) {
  return (rgb || BRASS) + ' RG ' + (w || 0.8) + ' w ' + x1 + ' ' + y.toFixed(1) + ' m ' + x2 + ' ' + y.toFixed(1) + ' l S\n';
}
/* Rounded-feel card: a thin border rectangle with a brass left accent bar. */
function cardBox(x, y, w, h) {
  var s = '';
  s += '0.92 0.87 0.80 RG 0.7 w ' + x + ' ' + (y - h).toFixed(1) + ' ' + w + ' ' + h.toFixed(1) + ' re S\n';
  s += BRASS + ' rg ' + x + ' ' + (y - h).toFixed(1) + ' 3 ' + h.toFixed(1) + ' re f\n';
  return s;
}

/* rows: [{day, time, title, camp, where, who, desc}] sorted; opts {name} */
function buildListPdf(rows, opts) {
  opts = opts || {};
  var pages = [];
  var cur = '';
  var y = 0;
  var CONTENT_W = PAGE_W - MARGIN * 2;
  var INNER_X = MARGIN + CARD_PAD;
  var INNER_W = CONTENT_W - CARD_PAD * 2;

  function newPage(first) {
    if (cur) pages.push(cur);
    cur = '';
    y = PAGE_H - MARGIN;
    if (first) {
      cur += fillColor(ROUGE);
      cur += textOp('F2', TITLE_SIZE, MARGIN, y - TITLE_SIZE, 'Your Playa Guide');
      y -= TITLE_SIZE + 9;
      cur += fillColor(GREY);
      var sub = 'Burning Man 2026' + (opts.name ? ' - ' + opts.name + "'s starred events" : ' - starred events');
      cur += textOp('F1', 11, MARGIN, y - 11, sub);
      y -= 11 + 7;
      cur += ruleOp(MARGIN, y, PAGE_W - MARGIN, BRASS, 1.2);
      y -= 18;
      cur += fillColor(INK);
    }
  }

  newPage(true);

  var lastDay = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];

    /* measure the card before drawing so it never splits across pages */
    var titleLines = wrap(r.title, CARD_TITLE, INNER_W, 2);
    var descLines = r.desc ? wrap(r.desc, BODY_SIZE - 0.5, INNER_W, 3) : [];
    var whoLines = r.who ? wrap('With: ' + r.who, BODY_SIZE - 0.5, INNER_W, 2) : [];
    var cardH = CARD_PAD * 2
      + titleLines.length * (CARD_TITLE + 3)
      + LEAD                      /* time line */
      + LEAD                      /* address line */
      + whoLines.length * (BODY_SIZE + 3)
      + descLines.length * (BODY_SIZE + 3);

    var needed = cardH + 10 + (r.day !== lastDay ? DAY_SIZE + 22 : 0);
    if (y - needed < MARGIN + 40) { newPage(false); lastDay = null; }

    if (r.day !== lastDay) {
      y -= 6;
      cur += fillColor(ROUGE);
      cur += textOp('F2', DAY_SIZE, MARGIN, y - DAY_SIZE, r.day);
      y -= DAY_SIZE + 4;
      cur += ruleOp(MARGIN, y, MARGIN + 120, BRASS, 1);
      y -= 12;
      cur += fillColor(INK);
      lastDay = r.day;
    }

    cur += cardBox(MARGIN, y, CONTENT_W, cardH);
    var cy = y - CARD_PAD;
    cur += fillColor(INK);
    for (var tl = 0; tl < titleLines.length; tl++) {
      cur += textOp('F2', CARD_TITLE, INNER_X, cy - CARD_TITLE, titleLines[tl]);
      cy -= CARD_TITLE + 3;
    }
    cur += fillColor(BRIGHT);
    cur += textOp('F2', BODY_SIZE, INNER_X, cy - BODY_SIZE, r.time ? r.time : 'No set time: ask at camp');
    cy -= LEAD;
    cur += fillColor(GREY);
    cur += textOp('F2', BODY_SIZE, INNER_X, cy - BODY_SIZE,
      (r.where ? r.where : 'Address TBA') + (r.camp ? '  -  ' + fit(r.camp, BODY_SIZE, INNER_W - approxW(r.where || 'Address TBA', BODY_SIZE) - 20) : ''));
    cy -= LEAD;
    for (var wl = 0; wl < whoLines.length; wl++) {
      cur += fillColor(ROUGE);
      cur += textOp('F1', BODY_SIZE - 0.5, INNER_X, cy - (BODY_SIZE - 0.5), whoLines[wl]);
      cy -= BODY_SIZE + 3;
    }
    cur += fillColor(GREY);
    for (var dl = 0; dl < descLines.length; dl++) {
      cur += textOp('F1', BODY_SIZE - 0.5, INNER_X, cy - (BODY_SIZE - 0.5), descLines[dl]);
      cy -= BODY_SIZE + 3;
    }
    cur += fillColor(INK);
    y -= cardH + 10;
  }

  /* ---- closing block on the last page (own page if it does not fit) ---- */
  var closing = [
    ['F1', 'I built this in one day, on the plane to Burning Man, from the official listings plus hundreds of'],
    ['F1', 'lineups pulled straight from camp Instagram, Telegram and WhatsApp channels. Times change out'],
    ['F1', 'there. Trust the board at the camp over any schedule, including this one.'],
    ['F1', ''],
    ['F1', 'The latest listings, searchable and offline: musecafe.vip/guide'],
    ['F1', ''],
    ['F2', 'Happy Burn. Get lost on purpose. Push the buttons you are not sure about.'],
    ['F2', 'Talk to strangers. Some of the people I love most started as one.'],
    ['F2', 'Take risks inside your window of tolerance. Then take one more.'],
    ['F1', ''],
    ['F1', 'Come say hi Thursday night at A Muse Us, Muse Cafe, 8:15 & E.'],
    ['F2', 'With love, Joe Che. You are the muse.']
  ];
  var closeH = closing.length * (BODY_SIZE + 4) + 30;
  if (y - closeH < MARGIN) newPage(false);
  y -= 12;
  cur += ruleOp(MARGIN, y, PAGE_W - MARGIN, BRASS, 1.2);
  y -= 16;
  for (var c2 = 0; c2 < closing.length; c2++) {
    cur += fillColor(closing[c2][0] === 'F2' ? ROUGE : GREY);
    if (closing[c2][1]) cur += textOp(closing[c2][0], BODY_SIZE - 0.5, MARGIN, y - BODY_SIZE, closing[c2][1]);
    y -= BODY_SIZE + 4;
  }
  cur += fillColor(INK);
  pages.push(cur);

  /* ---- assemble ---- */
  var objs = [];
  var nPages = pages.length;
  var kids = [];
  for (var p = 0; p < nPages; p++) kids.push((5 + p * 2) + ' 0 R');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Count ' + nPages + ' /Kids [' + kids.join(' ') + '] >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  for (var p2 = 0; p2 < nPages; p2++) {
    var contentRef = (6 + p2 * 2) + ' 0 R';
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + contentRef + ' >>');
    var stream = pages[p2];
    objs.push('<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + 'endstream');
  }

  var head = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  var body = '';
  var offsets = [0];
  for (var o = 0; o < objs.length; o++) {
    offsets.push(Buffer.byteLength(head + body, 'latin1'));
    body += (o + 1) + ' 0 obj\n' + objs[o] + '\nendobj\n';
  }
  var xrefPos = Buffer.byteLength(head + body, 'latin1');
  var xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  for (var x = 1; x <= objs.length; x++) {
    xref += String(offsets[x]).padStart(10, '0') + ' 00000 n \n';
  }
  var trailer = 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n';
  return Buffer.from(head + body + xref + trailer, 'latin1');
}

/* ---- hash resolution: mirror of guide.js ---- */
function hashId(str) {
  var hash = 0x811c9dc5;
  for (var k = 0; k < str.length; k++) {
    hash ^= str.charCodeAt(k);
    hash = (hash * 0x01000193) >>> 0;
  }
  var hex = hash.toString(16);
  while (hex.length < 8) hex = '0' + hex;
  return hex;
}

/* events: the loadGuide() event array. Both the full-id hash and the unique
 * title|camp alias hash resolve (mirror of the client's HASH_TO_ID). */
function buildHashIndex(events) {
  var byHash = {};
  var tcTo = {}, tcColl = {};
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    var id = e.id || (e.t + '|' + e.c + '|' + (e.s && e.s[0] && e.s[0][0] || ''));
    byHash[hashId(id)] = e;
    var tc = e.t + '|' + e.c;
    if (Object.prototype.hasOwnProperty.call(tcTo, tc)) tcColl[tc] = true;
    else tcTo[tc] = e;
  }
  for (var k in tcTo) {
    if (tcColl[k]) continue;
    var ah = hashId(k);
    if (!byHash[ah]) byHash[ah] = tcTo[k];
  }
  return byHash;
}

/* The payload ships ~3,400 records whose description is the same text twice;
 * the client undoubles at load, so mirror it here. */
function undouble(s) {
  if (!s) return s;
  var t = String(s).replace(/\s+/g, ' ').trim();
  var n = t.length;
  if (n < 24) return s;
  var h = Math.floor(n / 2);
  var a = t.slice(0, h).trim(), b = t.slice(n - h).trim();
  if (a && a === b) return a;
  return s;
}

var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MON_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayLabelOf(mon, day) {
  var key = String(mon).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  if (key === '08-30') return 'Sunday Opening Day (August 30)';
  if (key === '09-06') return 'Sunday Temple Burn (September 6)';
  var d = new Date(Date.UTC(2026, mon - 1, day));
  return DAY_NAMES[d.getUTCDay()] + ', ' + MON_NAMES[mon - 1] + ' ' + day;
}

/* Turn resolved events into sorted printable rows. Slots are
 * ["MM-DD HH:MM", "HH:MM"] or ["MM-DD", null] or [null, null]. */
function eventsToRows(events) {
  var rows = [];
  var seenEvent = {};
  events.forEach(function (e) {
    if (!e) return;
    var evKey = e.t + '|' + e.c;
    if (seenEvent[evKey]) return;
    seenEvent[evKey] = true;
    var slots = (e.s && e.s.length) ? e.s : [[null, null]];
    var perDay = {};
    slots.forEach(function (sl) {
      var start = sl && sl[0] ? String(sl[0]) : '';
      var m = /^(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(start);
      var dayKey, dayLabel2, time, sortKey;
      if (m) {
        dayKey = m[1] + '-' + m[2];
        dayLabel2 = dayLabelOf(Number(m[1]), Number(m[2]));
        time = m[3] || '';
        if (time && sl[1]) time += ' - ' + sl[1];
        sortKey = dayKey + ' ' + ((m[3]) || '99:98');
      } else {
        dayKey = '99-99';
        dayLabel2 = 'Date to be announced';
        time = '';
        sortKey = '99-99 99:99';
      }
      if (perDay[dayKey]) {
        perDay[dayKey].sets = (perDay[dayKey].sets || 1) + 1;
        if (m && m[3] && (!perDay[dayKey].firstClock || m[3] < perDay[dayKey].firstClock)) {
          perDay[dayKey].firstClock = m[3];
          perDay[dayKey].time = time;
          perDay[dayKey].sort = sortKey;
        }
        return;
      }
      perDay[dayKey] = {
        day: dayLabel2, time: time, firstClock: (m && m[3]) || '', sort: sortKey,
        title: e.t, camp: e.c || '', where: e.a || '',
        who: e.p || '',
        /* some scraped descriptions carry literal backslash-n sequences */
        desc: String(undouble(e.d) || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
      };
    });
    Object.keys(perDay).forEach(function (k2) {
      var r = perDay[k2];
      if (r.sets && r.sets > 1) r.time = (r.time ? r.time + ' onward' : '') + ' (' + r.sets + ' sets this day)';
      rows.push(r);
    });
  });
  rows.sort(function (a, b) { return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0; });
  return rows.map(function (r) {
    return { day: r.day, time: r.time, title: r.title, camp: r.camp, where: r.where, who: r.who, desc: r.desc };
  });
}

module.exports = { buildListPdf, buildHashIndex, eventsToRows, hashId, pdfText, fit, wrap, undouble };
