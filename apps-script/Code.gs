/**
 * Green Track Records — Google Sheet helper.
 * Adds a "Track Records" menu to the sheet:
 *   - Import Track Central export…  (All Career Performances: adds only new results, safe to import the full file every time.
 *                                    Scoring Performances: fills in Place and Points on results already in the sheet.)
 *   - Publish website now           (asks GitHub to rebuild the site right away; optional)
 *   - Format sheet for data entry   (keeps marks as plain text so 4:35 isn't turned into a clock time)
 *   - Website setup info            (sheet ID + tab IDs to paste into config.json)
 *
 * Install: Extensions > Apps Script, paste this file as Code.gs and ImportDialog.html as an HTML file, Save, reload the sheet.
 */

var TABS = { results: 'Results', athletes: 'Athletes', meets: 'Meets', events: 'Events', coverage: 'Coverage', team: 'Team Results' };
var RESULT_HEADER = ['Gender', 'Athlete', 'Event', 'Meet', 'Date', 'Mark', 'Relay Total', 'Status', 'Notes', 'Source', 'Place', 'Points', 'Wind', 'Series'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Track Records')
    .addItem('Import Track Central export…', 'showImportDialog')
    .addItem('Publish website now', 'publishWebsite')
    .addSeparator()
    .addItem('Format sheet for data entry', 'formatSheet')
    .addItem('Website setup info', 'showSetupInfo')
    .addToUi();
}

function showImportDialog() {
  var html = HtmlService.createHtmlOutputFromFile('ImportDialog').setWidth(520).setHeight(470);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import from Track Central');
}

// ---------- parsing (mirrors scripts/import_trackcentral.py) ----------
function isRelay_(event) {
  var e = event.toUpperCase();
  return e.indexOf('4X') >= 0 || e.indexOf(' X ') >= 0 || e.indexOf('SMR') === 0 || e.indexOf('DMR') === 0;
}

function isoDate_(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    var y = m[3].length === 2 ? '20' + m[3] : m[3];
    return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  }
  return s;
}

/** Returns rows in Results-tab order: [Gender, Athlete, Event, Meet, Date(yyyy-mm-dd), Mark, Relay Total, Status, Notes, Source] */
function parseTrackCentral_(text, gender) {
  var lines = String(text).replace(/\r/g, '').split('\n');
  var out = [], athlete = null;
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (ln.indexOf('\t') < 0) {
      var s = ln.trim();
      var next = '';
      for (var j = i + 1; j < Math.min(i + 3, lines.length); j++) { if (lines[j].trim()) { next = lines[j].trim(); break; } }
      if (s && s !== 'Top' && next === 'Top') athlete = s;
      continue;
    }
    var p = ln.split('\t');
    if (!athlete || p.length < 4) continue;
    var event = p[0].trim(), meet = p[1].trim(), date = isoDate_(p[2]), mark = p[3].trim();
    var main = mark, total = '', note = '';
    var m = mark.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (isRelay_(event)) {
      if (m) { main = m[1].trim(); total = m[2].trim(); } else { main = ''; total = mark; }
    } else if (m) {
      main = m[2].trim(); note = 'Entered as ' + m[1].trim();
    }
    out.push([gender, athlete, event, meet, date, main, total, '', note, 'Track Central', '', '']);
  }
  return out;
}

function key_(r) {
  return [r[0], r[1], r[2], r[3], isoDate_(r[4]), r[5], r[6]].map(function (x) { return String(x).trim().toLowerCase(); }).join('|');
}

function headerIndex_(sheet) {
  var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = {};
  h.forEach(function (name, i) { idx[String(name).trim()] = i; });
  return idx;
}

// ---------- import ----------
function importTrackCentral(text, gender) {
  if (/Scoring Performances/i.test(String(text).slice(0, 300))) return importScoring_(text);
  if (gender !== 'Boys' && gender !== 'Girls') throw new Error('Pick Boys or Girls first.');
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TABS.results);
  if (!sh) throw new Error('No "Results" tab found.');
  var rows = parseTrackCentral_(text, gender);
  if (!rows.length) throw new Error('No results found in that file. Use the "All Career Performances" export saved as text.');

  var last = sh.getLastRow();
  var existing = last > 1 ? sh.getRange(2, 1, last - 1, 7).getDisplayValues() : [];
  var seen = {};
  existing.forEach(function (r) { seen[key_(r)] = true; });
  var fresh = [];
  rows.forEach(function (r) {
    var k = key_(r);
    if (!seen[k]) { seen[k] = true; fresh.push(r); }
  });

  if (fresh.length) {
    var start = last + 1;
    var range = sh.getRange(start, 1, fresh.length, RESULT_HEADER.length);
    range.setNumberFormat('@');
    var values = fresh.map(function (r) {
      var d = r[4].split('-');
      var copy = r.slice();
      while (copy.length < RESULT_HEADER.length) copy.push('');
      copy[4] = d.length === 3 ? new Date(+d[0], +d[1] - 1, +d[2]) : r[4];
      return copy;
    });
    sh.getRange(start, 5, fresh.length, 1).setNumberFormat('yyyy-mm-dd');
    range.setValues(values);
  }

  // new athletes
  var newAthletes = addMissing_(TABS.athletes, ['Gender', 'Athlete'], fresh.map(function (r) { return [r[0], r[1]]; }), 6);
  // new meet names
  var newMeets = addMissing_(TABS.meets, ['Date', 'Meet'], fresh.map(function (r) { return [r[4], r[3]]; }), 5, true);
  // unknown events
  var ev = ss.getSheetByName(TABS.events);
  var known = {};
  if (ev && ev.getLastRow() > 1) ev.getRange(2, 1, ev.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) { known[r[0].toLowerCase()] = true; });
  var unknown = {};
  fresh.forEach(function (r) { if (!known[r[2].toLowerCase()]) unknown[r[2]] = true; });

  return {
    found: rows.length, added: fresh.length, athletes: newAthletes, meets: newMeets,
    unknownEvents: Object.keys(unknown)
  };
}

/** Appends rows to a tab when the key columns aren't already there. Returns the number added. */
function addMissing_(tabName, keyCols, pairs, width, isDateFirst) {
  var sh = SpreadsheetApp.getActive().getSheetByName(tabName);
  if (!sh) return 0;
  var last = sh.getLastRow();
  var have = {};
  if (last > 1) sh.getRange(2, 1, last - 1, 2).getDisplayValues().forEach(function (r) {
    have[(isDateFirst ? isoDate_(r[0]) : r[0]).toLowerCase() + '|' + r[1].toLowerCase()] = true;
  });
  var add = [];
  pairs.forEach(function (p) {
    var k = String(p[0]).toLowerCase() + '|' + String(p[1]).toLowerCase();
    if (!have[k]) {
      have[k] = true;
      var row = [p[0], p[1]];
      while (row.length < width) row.push('');
      if (isDateFirst) { var d = String(p[0]).split('-'); if (d.length === 3) row[0] = new Date(+d[0], +d[1] - 1, +d[2]); }
      add.push(row);
    }
  });
  if (add.length) {
    var r = sh.getRange(last + 1, 1, add.length, width);
    r.setNumberFormat('@');
    if (isDateFirst) sh.getRange(last + 1, 1, add.length, 1).setNumberFormat('yyyy-mm-dd');
    r.setValues(add);
  }
  return add.length;
}

// ---------- scoring report (places + points; mirrors scripts/import_tc_scoring.py) ----------
/** Seconds for times, inches for field marks, null if unreadable. */
function markValue_(s) {
  s = String(s || '').trim().replace(/[hH]$/, '').trim();
  if (!s) return null;
  var m = s.match(/^(\d+)-(\d+(?:\.\d+)?)$/);
  if (m) return +m[1] * 12 + +m[2];
  if (s.indexOf(':') >= 0) {
    var p = s.split(':').map(Number);
    if (p.some(isNaN)) return null;
    return p.reduce(function (acc, x) { return acc * 60 + x; }, 0);
  }
  var v = parseFloat(s);
  return isNaN(v) ? null : v;
}

function parseScoring_(text) {
  var lines = String(text).replace(/\r/g, '').split('\n');
  var team = '', season = 0, out = [], athlete = null;
  for (var i = 0; i < Math.min(12, lines.length); i++) {
    var h = lines[i].trim().match(/^(Boys|Girls)\b.*\b((?:19|20)\d\d)$/);
    if (h) { team = h[1]; season = +h[2]; break; }
  }
  for (i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (ln.indexOf('\t') < 0) {
      var s = ln.trim(), next = '';
      for (var j = i + 1; j < Math.min(i + 3, lines.length); j++) { if (lines[j].trim()) { next = lines[j].trim(); break; } }
      if (s && s !== 'Top' && next === 'Top') athlete = s;
      continue;
    }
    var p = ln.split('\t').map(function (x) { return x.trim(); });
    if (!athlete || p.length < 6 || p[0] === 'Date' || isNaN(parseFloat(p[5]))) continue;
    var perf = p[3], parts = perf.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    // 'leg (total)' for relays: the team time decides, since a split can repeat across relays the same day
    out.push({ athlete: athlete, date: isoDate_(p[0]), opponent: p[1], event: p[2], perf: perf,
               total: parts ? parts[2].trim() : null, mark: (parts ? parts[1] : perf).trim(),
               place: /^\d+$/.test(p[4]) ? p[4] : '', points: parseFloat(p[5]) });
  }
  return { team: team, season: season, rows: out };
}

function importScoring_(text) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(TABS.results);
  var rep = parseScoring_(text);
  if (!rep.rows.length) throw new Error('No scoring lines found. Use the "Scoring Performances" report saved as text.');
  var idx = headerIndex_(sh);
  if (idx.Points === undefined) {  // older sheets: add the column
    var col = sh.getLastColumn() + 1;
    sh.getRange(1, col).setValue('Points');
    sh.getRange(2, col, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
    idx = headerIndex_(sh);
  }
  var n = sh.getLastRow() - 1, width = sh.getLastColumn();
  var data = sh.getRange(2, 1, n, width).getDisplayValues();
  var byDay = {};
  data.forEach(function (r, i) {
    var k = r[idx.Athlete].trim().toLowerCase() + '|' + isoDate_(r[idx.Date]);
    (byDay[k] = byDay[k] || []).push(i);
  });
  var places = data.map(function (r) { return [r[idx.Place]]; }), points = data.map(function (r) { return [r[idx.Points]]; });
  var matched = 0, filled = 0, unmatched = [];
  // Same mark = same kind (time or feet-inches) and same value, so a 62-second 400 never matches a 5-02 high jump.
  var isField = function (x) { return /^\s*\d+-\d/.test(x || ''); };
  var same = function (a, b) {
    if (!a || !b || isField(a) !== isField(b)) return false;
    var va = markValue_(a), vb = markValue_(b);
    return va !== null && vb !== null && Math.abs(va - vb) < 0.006;
  };
  var evKey = function (e) { return String(e).toLowerCase().split(/\s+-\s+|\s*\(|\s+800m/)[0].replace(/[^a-z0-9]/g, ''); };
  var used = {}, acc = {};
  rep.rows.forEach(function (s) {
    var day = byDay[s.athlete.toLowerCase() + '|' + s.date] || [];
    var hits = day.filter(function (i) {
      return s.total !== null ? same(data[i][idx['Relay Total']], s.total)
        : same(data[i][idx.Mark], s.mark) || same(data[i][idx['Relay Total']], s.mark);
    });
    if (!hits.length && s.total !== null) {  // metric entry shown as '0.25m (0-9.75)': converted mark in brackets
      hits = day.filter(function (i) { return !data[i][idx['Relay Total']] && same(data[i][idx.Mark], s.total); });
    }
    if (!hits.length) { unmatched.push(s.athlete + ' ' + s.date + ' ' + s.event + ' ' + s.perf); return; }
    // Best row: same event, then this report's team (mixed-relay runners are on both rosters), then not excluded,
    // then not already used by another line of this report.
    var ek = evKey(s.event);
    var rank = function (i) {
      return (evKey(data[i][idx.Event].replace(' (Trials)', '')) !== ek ? 8 : 0) + (data[i][idx.Gender] !== rep.team ? 4 : 0) +
        (/^ex/i.test(data[i][idx.Status]) ? 2 : 0) + (used[i + '|' + s.opponent] ? 1 : 0);
    };
    hits.sort(function (a, b) { return rank(a) - rank(b); });
    var pick = hits[0];
    used[pick + '|' + s.opponent] = true;
    // a double-dual lists one performance once per opponent: keep each opponent's points ("5+3")
    acc[pick] = (acc[pick] || []).concat([String(Math.round(s.points * 100) / 100)]);
    var pts = acc[pick].join('+');
    hits.slice(1).forEach(function (i) {  // the same relay on the other roster: count it once
      if (data[i][idx.Gender] !== data[pick][idx.Gender] && evKey(data[i][idx.Event]) === evKey(data[pick][idx.Event]) && points[i][0] === pts) points[i][0] = '';
    });
    points[pick][0] = pts;
    matched++;
    if (s.place && !places[pick][0]) { places[pick][0] = s.place; filled++; }
  });
  sh.getRange(2, idx.Place + 1, n, 1).setValues(places);
  sh.getRange(2, idx.Points + 1, n, 1).setValues(points);

  // Coverage tab: note that this season's points are in
  var cov = ss.getSheetByName(TABS.coverage);
  if (cov && rep.team && rep.season) {
    var ci = headerIndex_(cov), cl = cov.getLastRow();
    var cv = cl > 1 ? cov.getRange(2, 1, cl - 1, cov.getLastColumn()).getDisplayValues() : [];
    var at = -1;
    cv.forEach(function (r, i) { if (r[ci.Season] === String(rep.season) && r[ci.Team] === rep.team && r[ci.Level] === 'Points') at = i; });
    var row = [];
    row[ci.Season] = String(rep.season); row[ci.Team] = rep.team; row[ci.Level] = 'Points'; row[ci.Status] = 'Complete';
    row[ci['Green Results']] = String(matched); row[ci.Source] = 'Track Central scoring report';
    row[ci.Notes] = at >= 0 ? cv[at][ci.Notes] : '';
    for (var c = 0; c < cov.getLastColumn(); c++) if (row[c] === undefined) row[c] = '';
    cov.getRange(at >= 0 ? at + 2 : cl + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  }
  return { scoring: true, team: rep.team, season: rep.season, found: rep.rows.length, matched: matched, places: filled, unmatched: unmatched };
}

// ---------- publish (optional) ----------
/**
 * One-time setup: Extensions > Apps Script > Project Settings > Script Properties, add
 *   GITHUB_REPO  = your-user/green-track-records
 *   GITHUB_TOKEN = a fine-grained token limited to that repo with "Actions: Read and write"
 * Without these, the site still updates on its own every night.
 */
function publishWebsite() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var repo = props.getProperty('GITHUB_REPO'), token = props.getProperty('GITHUB_TOKEN');
  if (!repo || !token) {
    ui.alert('Publish website now',
      'This button isn\'t set up yet, but the website still updates by itself every night.\n\n' +
      'To turn it on, add GITHUB_REPO and GITHUB_TOKEN under Extensions > Apps Script > Project Settings > Script Properties (see the README).',
      ui.ButtonSet.OK);
    return;
  }
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/actions/workflows/update.yml/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ ref: props.getProperty('GITHUB_BRANCH') || 'main' })
  });
  if (res.getResponseCode() === 204) {
    ui.alert('Website update started', 'The site will show the new results in about 2 minutes.', ui.ButtonSet.OK);
  } else {
    ui.alert('GitHub said no (' + res.getResponseCode() + ')', res.getContentText().slice(0, 400) +
      '\n\nCheck that GITHUB_REPO is right and the token has Actions: Read and write.', ui.ButtonSet.OK);
  }
}

// ---------- housekeeping ----------
function formatSheet() {
  var ss = SpreadsheetApp.getActive();
  var text = {
    Results: ['Athlete', 'Event', 'Meet', 'Mark', 'Relay Total', 'Status', 'Notes', 'Source', 'Place', 'Points'],
    Athletes: ['Athlete', 'Merge Into', 'Hide', 'Notes'],
    Meets: ['Meet', 'Display Name', 'Meet Type', 'Notes'],
    Events: ['Event', 'Standard Event', 'Display Name', 'Leg', 'Mark Min', 'Mark Max', 'Total Min', 'Total Max'],
    Coverage: ['Team', 'Level', 'Status', 'Source', 'Notes']
  };
  Object.keys(text).forEach(function (tab) {
    var sh = ss.getSheetByName(tab);
    if (!sh) return;
    var idx = headerIndex_(sh), rows = sh.getMaxRows() - 1;
    text[tab].forEach(function (h) { if (idx[h] !== undefined) sh.getRange(2, idx[h] + 1, rows, 1).setNumberFormat('@'); });
    if (idx.Date !== undefined) sh.getRange(2, idx.Date + 1, rows, 1).setNumberFormat('yyyy-mm-dd');
    sh.setFrozenRows(1);
  });
  SpreadsheetApp.getActive().toast('Mark columns are plain text, dates are yyyy-mm-dd.', 'Sheet formatted');
}

function showSetupInfo() {
  var ss = SpreadsheetApp.getActive();
  var tabs = {};
  Object.keys(TABS).forEach(function (k) {
    var sh = ss.getSheetByName(TABS[k]);
    tabs[k] = sh ? String(sh.getSheetId()) : 'MISSING';
  });
  var json = '"sheet_id": "' + ss.getId() + '",\n"tabs": ' + JSON.stringify(tabs, null, 2);
  var html = HtmlService.createHtmlOutput(
    '<p style="font-family:Arial;font-size:13px">Paste these lines into <b>config.json</b> in the GitHub repo (replacing the old sheet_id and tabs lines):</p>' +
    '<textarea style="width:100%;height:190px;font-family:monospace">' + json.replace(/</g, '&lt;') + '</textarea>' +
    '<p style="font-family:Arial;font-size:13px">Also make sure Share is set to <b>Anyone with the link: Viewer</b> so the website can read it.</p>'
  ).setWidth(480).setHeight(350);
  SpreadsheetApp.getUi().showModalDialog(html, 'Website setup info');
}
