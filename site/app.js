/* Green Track & Field Record Book — static site. Reads data/db.json (built from the Google Sheet). */
(function () {
  "use strict";

  const HAND = 1, PRELIM = 2, FLAGGED = 4, NOMARK = 8, WINDY = 16, ASTER = 32;
  const SPRINT_CONV = new Set(["60M", "100M", "200M", "60M HH", "100HH", "110HH", "300IH", "4X100M", "4X200M",
    "4X200M Mixed", "4X100M Shuttle Hurdle", "4X110M Shuttle Hurdle", "4X100M Throwers"]);
  const $app = document.getElementById("app");
  const $tip = document.getElementById("tip");
  let D, E, A, M, slugOf, bySlug, aRes, aRel, cache = {};
  const state = { top: { g: "B", per: true, timing: "raw", n: 25, from: "", to: "", grade: "" },
                  rel: { g: "B", n: 25, from: "", to: "", per: false } };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const yearOf = (m) => +M[m][0].slice(0, 4);
  const dateOf = (m) => M[m][0];
  const lower = (e) => E[e].t === "run" || E[e].t === "relay";
  const better = (e, a, b) => (lower(e) ? a < b : a > b);
  const cmp = (e) => (lower(e) ? (x, y) => x - y : (x, y) => y - x);
  const G = { B: "Boys", G: "Girls", X: "Mixed" };
  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `${m}/${d}/${y}`;
  }
  function nameOf(a, plain) {
    const at = A[a];
    if (at[3]) return "Name withheld";
    const [last, first] = at[0].split(",").map((s) => s.trim());
    return first ? `${first} ${last}` : last;
  }
  function lastName(a) { return A[a][3] ? "—" : A[a][0].split(",")[0].trim(); }
  // Relay lineup as last names; teammates who share a last name get a first initial.
  function lineup(ids) {
    const ln = ids.map(lastName), dup = new Set(ln.filter((n, i) => n !== "—" && ln.indexOf(n) !== i));
    return ids.map((a, i) => dup.has(ln[i]) ? `${(A[a][0].split(",")[1] || "").trim().charAt(0)}. ${ln[i]}` : ln[i]).join(", ");
  }
  // Lineup for a relay team; r[8] = runners not on file yet
  function relayWho(r) {
    const known = lineup(r[6].map((l) => l[0])), u = r[8] || 0;
    if (!u) return known;
    return known ? `${known} + ${u} not on file` : "Runners not on file";
  }
  // phone-only meta cell for tables that stack on small screens (.tbl-wrap.stk): desktop shows the separate columns
  const phCell = (...parts) => `<td class="ph">${parts.filter(Boolean).join(" · ")}</td>`;
  const meetLink = (m) => `<a href="#/meet/${m}">${esc(M[m][1])}</a>`;
  // long tables: rows past the first n are hidden (data-more) until "Show all" is pressed
  const moreBtn = (total, n, what) => (total > n ? `<button type="button" class="more show-all">Show all ${total} ${what}</button>` : "");
  function wireMore() {
    document.querySelectorAll(".show-all").forEach((b) => (b.onclick = () => {
      const t = b.previousElementSibling;
      t.querySelectorAll("tr[data-more]").forEach((tr) => { tr.hidden = false; tr.removeAttribute("data-more"); });
      b.remove();
    }));
  }
  // jump links for long pages: buttons that scroll to a section (the router owns the #hash, so these can't be plain anchors)
  const jumpNav = (items) => { const it = items.filter(Boolean); return it.length > 1 ? `<nav class="jump" aria-label="Jump to">${it.map(([id, l]) => `<button type="button" data-jump="${id}">${esc(l)}</button>`).join("")}</nav>` : ""; };
  const jwrap = (id, h) => (h ? `<div id="${id}" class="jump-target">${h}</div>` : "");
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-jump]"); if (!b) return;
    const el = document.getElementById(b.dataset.jump); if (!el) return;
    if (el.tagName === "DETAILS") el.open = true;
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });
  const andList = (xs) => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " & " + xs[xs.length - 1];
  function aLink(a) {
    if (A[a][3]) return `<span class="dim">Name withheld</span>`;
    return `<a href="#/a/${slugOf[a]}">${esc(nameOf(a))}</a>`;
  }
  const gradeNum = (a, year) => (A[a][2] ? 12 - (A[a][2] - year) : 0);
  function gradeLabel(a, year) {
    return { 9: "Fr", 10: "So", 11: "Jr", 12: "Sr" }[gradeNum(a, year)] || "";
  }
  function nmHTML(mk) { return `<span class="dim">${/^[A-Z]{1,7}$/.test(mk || "") ? esc(mk) : "NM"}</span>`; }
  // Wind reading (m/s) for an individual result row: [athlete, event, meet, value, mark, flags, place, wind]
  const windOf = (r) => (r && !Array.isArray(r[6]) ? r[7] : undefined);
  function markHTML(mk, f, w) {
    let s = esc(mk);
    if (f & HAND) s += `<span class="h" title="Hand timed">h</span>`;
    const wv = Array.isArray(w) ? windOf(w) : w;
    if (f & ASTER) {
      const nt = Array.isArray(w) ? (Array.isArray(w[6]) ? w[9] : w[9]) : "";
      s += `<span class="ast" tabindex="0" title="${esc(nt || "Uncertain: see the note in the sheet")}">*</span>`;
    }
    if (wv) s += ` <span class="wind${f & WINDY ? " aided" : ""}" title="Wind ${esc(wv)} m/s${f & WINDY ? " (wind-aided: over +2.0)" : ""}">${f & WINDY ? "w " : ""}${esc(wv)}</span>`;
    return s;
  }
  // Full field series for an individual result (index 8): "17-10, F, 16-7.25" or "5-8 XO, 5-10 O, 6-0 XXX"
  const seriesOf = (r) => (r && !Array.isArray(r[6]) && r[8]) || "";
  function seriesBtn(r) {
    const sr = seriesOf(r);
    if (!sr) return "";
    return sr[0] === "|" ? ` <button type="button" class="ser-btn" aria-expanded="false" title="Show lap splits">Splits</button>`
      : ` <button type="button" class="ser-btn" aria-expanded="false" title="Show every attempt">Series</button>`;
  }
  function lapSecs(t) { const p = t.split(":"); return p.length > 1 ? +p[0] * 60 + +p[1] : +p[0]; }
  function lapFmt(v) { const m = Math.floor(v / 60), s = (v - m * 60).toFixed(2); return m ? `${m}:${s.padStart(5, "0")}` : s; }
  function seriesHTML(r) {
    if (seriesOf(r)[0] === "|") { // lap splits from fully automatic timing
      let run = 0;
      return `<ol class="ser laps" aria-label="Lap splits">${seriesOf(r).slice(1).split(/,\s*/).map((t, i) => { run += lapSecs(t);
        return `<li><span class="n">${i + 1}</span><b>${esc(t)}</b><span class="cum">${lapFmt(run)}</span></li>`; }).join("")}</ol>`;
    }
    const toks = seriesOf(r).split(/,\s*/);
    if (/\s/.test(toks[0])) { // vertical: height + attempts
      return `<ol class="ser vert" aria-label="Heights and attempts">${toks.map((t) => { const [h, att] = t.split(/\s+/), made = att.includes("O");
        return `<li class="${made ? (h === r[4] ? "best" : "") : "out"}"><b>${esc(h)}</b><span>${[...att].map((c) => `<i class="a-${c === "O" ? "o" : c === "X" ? "x" : "p"}" title="${c === "O" ? "Make" : c === "X" ? "Miss" : "Pass"}">${c === "-" ? "P" : esc(c)}</i>`).join("")}</span></li>`; }).join("")}</ol>`;
    }
    let bestDone = false;
    return `<ol class="ser" aria-label="Attempts in order">${toks.map((t, i) => { const best = !bestDone && t === r[4]; if (best) bestDone = true;
      const miss = /^(F|P|-)$/.test(t);
      return `<li class="${best ? "best" : miss ? "out" : ""}"><span class="n">${i + 1}</span><b>${miss ? (t === "F" ? "Foul" : "Pass") : esc(t)}</b></li>`; }).join("")}</ol>`;
  }
  const seriesRow = (r, cols) => (seriesOf(r) ? `<tr class="ser-row" hidden><td colspan="${cols}">${seriesHTML(r)}</td></tr>` : "");
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest(".ser-btn");
    if (!b) return;
    const row = b.closest("tr").nextElementSibling;
    if (!row || !row.classList.contains("ser-row")) return;
    row.hidden = !row.hidden;
    b.setAttribute("aria-expanded", String(!row.hidden));
  });
  function slugify(s) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function eventByKey(k) { return E.findIndex((e) => e.k === k); }
  function convAmt(e) { return SPRINT_CONV.has(E[e].k) ? 0.24 : 0.14; }
  const html = (s) => { $app.innerHTML = s; window.scrollTo(0, 0); };

  // ---------- data prep ----------
  function prep(db) {
    D = db; E = db.events; A = db.athletes; M = db.meets;
    slugOf = []; bySlug = {};
    A.forEach((a, i) => {
      let base = a[1].toLowerCase() + "-" + slugify(a[3] ? "athlete-" + i : nameOf(i)), s = base, n = 2;
      while (bySlug[s] !== undefined) s = base + "-" + n++;
      slugOf[i] = s; bySlug[s] = i;
    });
    aRes = A.map(() => []); aRel = A.map(() => []); PS = null; RH = null;
    D.results.forEach((r, i) => aRes[r[0]].push(i));
    D.relays.forEach((r, i) => r[6].forEach((leg) => aRel[leg[0]].push(i)));
  }
  const valid = (r) => !(r[5] & (FLAGGED | NOMARK));

  // individual ranking: returns [{r, v, rank}]
  function ranking(e, g, o = {}) {
    const timing = o.timing || "raw", per = o.per !== false;
    const from = +o.from || 0, to = +o.to || 9999, grade = +o.grade || 0;
    const key = ["rk", e, g, timing, per, from, to, grade].join("|");
    if (cache[key]) return cache[key];
    const c = cmp(e), conv = convAmt(e);
    let list = [];
    for (const r of D.results) {
      if (r[1] !== e || A[r[0]][1] !== g || !valid(r)) continue;
      const y = yearOf(r[2]);
      if (y < from || y > to) continue;
      if (grade && gradeNum(r[0], y) !== grade) continue;
      if (timing === "fat" && E[e].h && (r[5] & HAND)) continue;
      const v = timing === "conv" && (r[5] & HAND) ? r[3] + conv : r[3];
      list.push({ r, v });
    }
    list.sort((x, y) => c(x.v, y.v) || (dateOf(x.r[2]) < dateOf(y.r[2]) ? -1 : 1));
    if (per) {
      const seen = new Set();
      list = list.filter((x) => (seen.has(x.r[0]) ? false : seen.add(x.r[0])));
    }
    let rank = 0, prev = null;
    list.forEach((x, i) => { if (prev === null || Math.abs(x.v - prev) > 1e-9) rank = i + 1; x.rank = rank; prev = x.v; });
    return (cache[key] = list);
  }
  function relayRanking(e, g, o = {}) {
    const from = +o.from || 0, to = +o.to || 9999;
    const key = ["rl", e, g, from, to, !!o.per].join("|");
    if (cache[key]) return cache[key];
    const c = cmp(e);
    let list = D.relays.filter((r) => r[0] === e && r[2] === g && !(r[5] & FLAGGED) && yearOf(r[1]) >= from && yearOf(r[1]) <= to)
      .map((r) => ({ r, v: r[3] }));
    list.sort((x, y) => c(x.v, y.v) || (dateOf(x.r[1]) < dateOf(y.r[1]) ? -1 : 1));
    if (o.per) { // best per season
      const seen = new Set();
      list = list.filter((x) => { const y = yearOf(x.r[1]); return seen.has(y) ? false : seen.add(y); });
    }
    let rank = 0, prev = null;
    list.forEach((x, i) => { if (prev === null || Math.abs(x.v - prev) > 1e-9) rank = i + 1; x.rank = rank; prev = x.v; });
    return (cache[key] = list);
  }
  function eventsFor(g, relay) {
    return E.map((e, i) => i).filter((i) => {
      const isRel = E[i].t === "relay" || E[i].t === "frelay";
      if (isRel !== !!relay) return false;
      return relay ? D.relays.some((r) => r[0] === i && r[2] === g) : D.results.some((r) => r[1] === i && A[r[0]][1] === g && valid(r));
    });
  }
  function rankMap(e, g) { // athlete -> all-time rank (best per athlete, as recorded)
    const key = "rm|" + e + "|" + g;
    if (cache[key]) return cache[key];
    const m = new Map();
    ranking(e, g).forEach((x) => m.set(x.r[0], x.rank));
    return (cache[key] = m);
  }
  // Points from Track Central scoring reports: career and per-season totals per athlete.
  function pointsIndex() {
    if (cache.pts) return cache.pts;
    const P = D.points || { seasons: {}, by: [] };
    const career = new Map(), season = new Map(), bySeason = {};
    P.by.forEach(([a, y, v]) => {
      career.set(a, (career.get(a) || 0) + v);
      season.set(a + "|" + y, v);
      (bySeason[y] = bySeason[y] || []).push([a, v]);
    });
    const ys = Object.keys(P.seasons || {}).map(Number).sort();
    // all-time career rank within each team (ties share a rank)
    const rank = new Map();
    for (const g of ["B", "G"]) {
      const list = [...career.entries()].filter(([a, v]) => A[a][1] === g && v > 0).sort((x, y) => y[1] - x[1]);
      let r = 0, prev = null;
      list.forEach(([a, v], i) => { if (prev === null || Math.abs(v - prev) > 0.005) r = i + 1; rank.set(a, r); prev = v; });
    }
    return (cache.pts = { career, season, bySeason, ys, rank, teams: P.seasons || {} });
  }
  // points to the hundredth, only as far as needed: 518, 245.8, 297.75 (relay shares are quarters and thirds)
  const fmtPts = (v) => String(Math.round(v * 100) / 100);
  function ptsYearsLabel(ys) {
    if (!ys.length) return "";
    const runs = []; ys.forEach((y) => { const r = runs[runs.length - 1]; if (r && y === r[1] + 1 || r && y === r[1] + 2 && y - 1 === 2020) r[1] = y; else runs.push([y, y]); });
    return runs.map(([a, b]) => (a === b ? a : `${a}–${b}`)).join(", ");
  }
  function seasons() {
    if (cache.seasons) return cache.seasons;
    // Seasons with full results on file; older years only hold a few historical marks (old records, state results)
    const s = new Set(M.map((m) => +m[0].slice(0, 4)).filter((y) => !D.complete_from || y >= D.complete_from));
    return (cache.seasons = [...s].sort((a, b) => b - a));
  }
  // older years with a real share of a season on file (team scorebooks), as opposed to a few state results
  function partialSeasons() {
    if (cache.partial) return cache.partial;
    const first = Math.min(...seasons()), n = {};
    D.results.forEach((r) => { const y = yearOf(r[2]); if (y < first) n[y] = (n[y] || 0) + 1; });
    return (cache.partial = Object.keys(n).map(Number).filter((y) => n[y] >= 100).sort((a, b) => a - b));
  }
  const spanTxt = (ys) => (ys.length > 1 ? `${ys[0]} to ${ys[ys.length - 1]}` : `${ys[0]}`);
  function athleteYears(a) {
    const ys = new Set();
    aRes[a].forEach((i) => ys.add(yearOf(D.results[i][2])));
    aRel[a].forEach((i) => ys.add(yearOf(D.relays[i][1])));
    return [...ys].sort();
  }
  function yearsLabel(a) {
    const ys = athleteYears(a);
    if (!ys.length) return "";
    return ys[0] === ys[ys.length - 1] ? `${ys[0]}` : `${ys[0]}–${ys[ys.length - 1]}`;
  }
  function relayLegs(r, skip) {
    return r[6].map((l) => {
      const leg = l[2] ? `<span class="split">${esc(l[2])}</span> ` : "";
      const sp = l[1] ? ` <span class="split">${esc(l[1])}</span>` : "";
      const ast = l[3] === "*" ? `<span class="ast" tabindex="0" title="${esc(r[9] || "Not certain this runner ran this leg")}">*</span>` : "";
      return leg + (l[0] === skip ? `<b>${esc(nameOf(l[0]))}</b>` : aLink(l[0])) + ast + sp;
    }).concat(r[8] ? [`<span class="dim">${r[6].length ? `+ ${r[8]} not on file` : "Runners not on file"}</span>`] : []).join(" · ");
  }

  // ---------- postseason ----------
  // Meet Type (Meets tab) decides the level. District "finalist" = a district mark that isn't a prelim.
  // When a team's district results are spread over two days, events that run prelims only count on the
  // last day (day 1 was semis for them). A regional or state trip that season implies a district final too.
  const PRELIM_EVENTS = new Set(["100M", "200M", "400M", "800M", "1600M", "110HH", "100HH", "300IH", "4X100M", "4X200M", "4X400M"]);
  const LEVELS = [
    { k: "State", label: "State qualifier", short: "State", cls: "st" },
    { k: "Regional", label: "Regional qualifier", short: "Regional", cls: "rg" },
    { k: "District", label: "District finalist", short: "District final", cls: "di" },
    { k: "Indoor State", label: "Indoor state qualifier", short: "Indoor state", cls: "in" },
  ];
  const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.k, l]));
  let PS = null;
  function postseasonIndex() {
    if (PS) return PS;
    const days = {}; // "year|gender" -> Set of district dates
    const note = (m, g) => { if (M[m][2] === "District") { const k = M[m][0].slice(0, 4) + "|" + g; (days[k] = days[k] || new Set()).add(M[m][0]); } };
    D.results.forEach((r) => note(r[2], A[r[0]][1]));
    D.relays.forEach((r) => note(r[1], r[2]));
    const counts = (e, m, flags, g) => {
      const t = M[m][2];
      if (!LEVEL[t]) return null;
      if (t === "District") {
        if (flags & PRELIM) return null;
        const ds = days[M[m][0].slice(0, 4) + "|" + g];
        if (PRELIM_EVENTS.has(E[e].k) && ds && ds.size > 1 && M[m][0] !== [...ds].sort().pop()) return null;
      }
      return t;
    };
    PS = A.map(() => ({ rows: [], yrs: {} }));
    const add = (a, row) => { PS[a].rows.push(row); (PS[a].yrs[row.t] = PS[a].yrs[row.t] || new Set()).add(row.y); };
    D.results.forEach((r) => { const t = counts(r[1], r[2], r[5], A[r[0]][1]); if (t) add(r[0], { t, y: yearOf(r[2]), e: r[1], m: r[2], mk: r[4], f: r[5], pl: r[6] || 0, w: r[7], nt: r[9] || "" }); });
    D.relays.forEach((r) => { const t = counts(r[0], r[1], r[5], r[2]); if (t) r[6].forEach((l) => add(l[0], { t, y: yearOf(r[1]), e: r[0], m: r[1], mk: r[4], f: r[5], pl: r[7] || 0, relay: r })); });
    // Qualified but didn't compete: a top-4 district final (top 5 from regional to state from 2026) earns the
    // next round even when the athlete scratched. Relays only count when no Bulldog team ran that relay there.
    const ADV = D.advance || { District: [[2000, 4]], Regional: [[2000, 4], [2026, 5]] };
    const advN = (lv, y) => (ADV[lv] || []).reduce((n, [from, k]) => (y >= from ? k : n), 0);
    const NEXT = { District: "Regional", Regional: "State" };
    const relayRan = new Set();
    D.relays.forEach((r) => relayRan.add([M[r[1]][2], yearOf(r[1]), r[2], r[0]].join("|")));
    PS.forEach((p, a) => {
      p.qual = [];
      const seen = new Set(p.rows.map((x) => [x.t, x.y, x.e].join("|")));
      p.rows.forEach((x) => {
        const nx = NEXT[x.t];
        if (!nx || !x.pl || x.f & PRELIM || x.pl > advN(x.t, x.y) || seen.has([nx, x.y, x.e].join("|"))) return;
        if (/lost the tiebreak/i.test(x.nt || "")) return; // tied at the cutoff and didn't get the spot
        if (x.relay && relayRan.has([nx, x.y, x.relay[2], x.e].join("|"))) return;
        seen.add([nx, x.y, x.e].join("|"));
        p.qual.push({ t: nx, y: x.y, e: x.e, from: x });
        (p.yrs[nx] = p.yrs[nx] || new Set()).add(x.y);
      });
    });
    PS.forEach((p) => {
      p.rows.sort((x, y) => (dateOf(x.m) < dateOf(y.m) ? 1 : dateOf(x.m) > dateOf(y.m) ? -1 : E[x.e].o - E[y.e].o));
      // Reaching state means qualifying out of regionals, and regionals out of district finals.
      (p.yrs.State || []).forEach((y) => (p.yrs.Regional = p.yrs.Regional || new Set()).add(y));
      (p.yrs.Regional || []).forEach((y) => (p.yrs.District = p.yrs.District || new Set()).add(y));
      const finals = p.rows.filter((x) => x.t === "State" && x.pl && !(x.f & PRELIM));
      p.champ = finals.filter((x) => x.pl === 1);
      p.allOhio = finals.filter((x) => x.pl <= 8);
      if (p.champ.length) p.yrs.Champion = new Set(p.champ.map((x) => x.y));
      if (p.allOhio.length) p.yrs.AllOhio = new Set(p.allOhio.map((x) => x.y));
    });
    return PS;
  }
  function postRows(a) {
    const p = postseasonIndex()[a], out = [];
    const q = (p.qual || []).slice().sort((x, y) => y.y - x.y || (x.t === "State" ? -1 : 1));
    p.rows.forEach((x) => { while (q.length && q[0].y >= x.y) out.push(q.shift()); out.push(x); });
    return out.concat(q);
  }
  function topLevel(a) {
    const p = postseasonIndex()[a];
    return LEVELS.find((l) => p.yrs[l.k]);
  }
  function yearList(set) {
    const ys = [...set].sort();
    return ys.join(", ");
  }
  // ---------- school record history ----------
  // Walks every event's marks in date order. The best mark of the first season on file is the starting
  // point; anyone who later beats (or ties) the standing record is a record holder until it's beaten.
  // Starting-point holders are not called "former" record holders, because older records aren't on file.
  let RH = null;
  function recordIndex() {
    if (RH) return RH;
    RH = A.map(() => ({ cur: new Map(), former: new Map() }));
    const walk = (e, entries) => { // entries: [{v, d, athletes[]}]
      if (!entries.length) return;
      entries.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : cmp(e)(x.v, y.v)));
      const firstY = entries[0].d.slice(0, 4);
      // Marks from before the first complete season were added on purpose (old records), so they count as real records.
      const historical = D.complete_from && +firstY < D.complete_from;
      let seed = null;
      for (const x of entries) if (x.d.slice(0, 4) === firstY && (!seed || better(e, x.v, seed.v))) seed = x;
      const steps = [{ ...seed, seed: !historical }];
      let best = seed.v;
      for (const x of entries) {
        if (x.d.slice(0, 4) === firstY) continue;
        if (better(e, x.v, best)) { best = x.v; steps.push(x); }
        else if (Math.abs(x.v - best) < 1e-9 && !steps.some((s0) => Math.abs(s0.v - best) < 1e-9 && s0.athletes.join() === x.athletes.join())) steps.push(x);
      }
      steps.forEach((st) => {
        const brk = steps.find((o) => o.d > st.d && better(e, o.v, st.v));
        const until = brk ? +brk.d.slice(0, 4) : null;
        st.athletes.forEach((a) => {
          const k = e;
          if (until === null) { RH[a].cur.set(k, { e, from: +st.d.slice(0, 4) }); return; }
          if (st.seed) return;
          const prev = RH[a].former.get(k);
          RH[a].former.set(k, { e, from: prev ? Math.min(prev.from, +st.d.slice(0, 4)) : +st.d.slice(0, 4), to: prev ? Math.max(prev.to, until) : until });
        });
      });
    };
    for (const g of ["B", "G"]) for (const e of eventsFor(g)) {
      walk(e, D.results.filter((r) => r[1] === e && A[r[0]][1] === g && valid(r)).map((r) => ({ v: r[3], d: dateOf(r[2]), athletes: [r[0]] })));
    }
    for (const g of ["B", "G", "X"]) for (const e of eventsFor(g, true)) {
      walk(e, D.relays.filter((r) => r[0] === e && r[2] === g && !(r[5] & FLAGGED)).map((r) => ({ v: r[3], d: dateOf(r[1]), athletes: r[6].map((l) => l[0]).sort((x, y) => x - y) })));
    }
    RH.forEach((h) => h.cur.forEach((_, k) => h.former.delete(k)));
    return RH;
  }
  const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
  const MEDAL = `<svg class="medal" viewBox="0 0 64 80" aria-hidden="true">
    <path d="M18 2h12l6 22H24z" fill="var(--accent-fill)"/><path d="M34 2h12L40 24H28z" fill="var(--board)" stroke="var(--accent-fill)" stroke-width="1.5"/>
    <circle cx="32" cy="50" r="24" fill="url(#mg)" stroke="var(--gold-line)" stroke-width="2"/>
    <circle cx="32" cy="50" r="17" fill="none" stroke="var(--gold-line)" stroke-width="1.2" opacity=".7"/>
    <path d="M32 37l3.9 8 8.8 1.2-6.4 6.1 1.6 8.7L32 56.8 24.1 61l1.6-8.7-6.4-6.1 8.8-1.2z" fill="var(--gold-ink)" opacity=".85"/>
    <defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBE9A6"/><stop offset=".5" stop-color="#E0B23A"/><stop offset="1" stop-color="#F6D97A"/></linearGradient></defs></svg>`;
  const STAR = `<svg class="star" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L10 14.8l-5.2 2.8 1-5.8L1.5 7.7l5.9-.8z" fill="currentColor"/></svg>`;
  function titleList(rows) {
    // "Pole Vault ’07, ’08" rather than repeating the event for each title
    const by = new Map();
    rows.slice().sort((p, q) => p.y - q.y).forEach((x) => { if (!by.has(x.e)) by.set(x.e, []); by.get(x.e).push(`’${String(x.y).slice(2)}`); });
    return [...by].map(([e, ys]) => `${E[e].n} ${ys.join(", ")}`).join("; ");
  }
  function champBanner(a) {
    const p = postseasonIndex()[a];
    if (!p.champ || !p.champ.length) return "";
    const ts = p.champ.slice().sort((x, y) => x.y - y.y);
    const line = (x, withYear) => `${withYear ? `<b class="cb-yr">${x.y}</b> · ` : ""}${esc(E[x.e].n)} · <b>${x.f & NOMARK ? nmHTML(x.mk) : markHTML(x.mk, x.f, x.w)}</b> · <a href="#/meet/${x.m}">${esc(M[x.m][1])}</a>`;
    const one = ts.length === 1;
    return `<section class="champ-banner">
      ${MEDAL}
      <div class="cb-text"><span class="cb-kicker">${one ? ts[0].y + " OHSAA" : "OHSAA · " + [...new Set(ts.map((x) => x.y))].join(", ")}</span>
      <span class="cb-title">${one ? "" : `${ts.length}× `}State Champion</span>
      ${ts.map((x) => `<span class="cb-sub">${line(x, !one)}</span>`).join("")}</div></section>`;
  }

  function honorChips(a) {
    const p = postseasonIndex()[a], h = recordIndex()[a];
    const byOrder = (m) => [...m.values()].sort((x, y) => E[x.e].o - E[y.e].o);
    let out = "";
    if (p.champ && p.champ.length) out += `<span class="honor champ">${STAR}State champion<b>${esc(titleList(p.champ))}</b></span>`;
    const ao = (p.allOhio || []).filter((x) => x.pl > 1);  // champions already have their own badge
    if (ao.length) out += `<span class="honor allohio">All-Ohio<b>${esc(ao.map((x) => `${E[x.e].n} ${ordinal(x.pl)} ’${String(x.y).slice(2)}`).join(", "))}</b></span>`;
    if (h.cur.size) out += `<span class="honor rec">School record<b>${esc(byOrder(h.cur).map((x) => E[x.e].n).join(", "))}</b></span>`;
    if (h.former.size) out += `<span class="honor frec">Former school record<b>${esc(byOrder(h.former).map((x) => `${E[x.e].n} (${x.from === x.to ? x.from : x.from + "–" + x.to})`).join(", "))}</b></span>`;
    return out + LEVELS.filter((l) => p.yrs[l.k]).map((l) => `<span class="honor ${l.cls}">${l.label}<b>${yearList(p.yrs[l.k])}</b></span>`).join("");
  }

  // ---------- UI bits ----------
  function seg(id, opts, cur) {
    return `<div class="seg" role="group" id="${id}">${opts.map(([v, l]) =>
      `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join("")}</div>`;
  }
  function onSeg(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) fn(b.dataset.v); });
  }
  function eventSelect(id, list, cur) {
    const opt = (i) => `<option value="${esc(E[i].k)}"${i === cur ? " selected" : ""}>${esc(E[i].n)}</option>`;
    const now = list.filter((i) => !E[i].l), old = list.filter((i) => E[i].l);
    return `<select id="${id}">${now.map(opt).join("")}${old.length ? `<optgroup label="Legacy (yards)">${old.map(opt).join("")}</optgroup>` : ""}</select>`;
  }
  // Events run in yards before Ohio went metric: their own records, kept apart from the metric lists
  function legacyBoards() {
    const rowsFor = (g) => recordRows(g, false, false, true) + recordRows(g, true, false, true);
    const b = rowsFor("B"), gl = rowsFor("G");
    return `<section class="section legacy"><div class="section-head"><h2>Legacy records <span class="dim">· yards</span></h2></div>
      <p class="note">Before Ohio went metric (around 1980), races were run in yards: the 100-yard dash, 880, mile, mile relay and so on. They're separate events with their own records, kept here rather than mixed into today's lists.</p>
      ${b || gl ? `<div class="grid2">${b ? `<section class="board"><div class="board-title"><h3>Boys</h3><span>Yards</span></div>${b}</section>` : ""}${gl ? `<section class="board"><div class="board-title"><h3>Girls</h3><span>Yards</span></div>${gl}</section>` : ""}</div>`
        : `<p class="empty">No yard-era marks are on file yet. Add them to the Results tab like any other result, with events such as 100 Yard Dash, 220 Yard Dash, 440 Yard Dash, 880 Yard Run, Mile Run, Two Mile Run, 120 Yard High Hurdles, 180 Yard Low Hurdles, 440 Yard Relay, 880 Yard Relay or Mile Relay.</p>`}</section>`;
  }
  function yearSelect(id, cur, label) {
    return `<select id="${id}"><option value="">${label}</option>${seasons().slice().reverse().map((y) => `<option${String(y) === String(cur) ? " selected" : ""}>${y}</option>`).join("")}</select>`;
  }
  function tipOn(el, text) {
    el.addEventListener("mousemove", (ev) => {
      $tip.innerHTML = text; $tip.hidden = false;
      const w = $tip.offsetWidth;
      $tip.style.left = Math.min(ev.clientX + 12, window.innerWidth - w - 8) + "px";
      $tip.style.top = ev.clientY + 14 + "px";
    });
    el.addEventListener("mouseleave", () => { $tip.hidden = true; });
  }

  // ---------- pages ----------
  function recordRows(g, relay, field, legacy) {
    return eventsFor(g, relay).filter((e) => (!relay || (E[e].t === "frelay") === !!field) && !!E[e].l === !!legacy).map((e) => {
      if (relay) {
        const top = relayRanking(e, g);
        if (!top.length) return "";
        const x = top[0], r = x.r;
        return `<a class="board-row" href="#/relays/${encodeURIComponent(E[e].k)}/${g}">
          <span class="br-event">${esc(g === "X" ? E[e].n.replace(/^Mixed /, "") : E[e].n)}</span>
          <span class="br-mark">${markHTML(r[4], r[5], r)}</span>
          <span class="br-who"><span class="br-name">${esc(relayWho(r))}</span><span class="br-meta">&nbsp;·&nbsp;${yearOf(r[1])}</span></span></a>`;
      }
      const top = ranking(e, g);
      if (!top.length) return "";
      const ties = top.filter((x) => x.rank === 1);
      const r = ties[0].r;
      const who = andList(ties.map((x) => esc(nameOf(x.r[0]))));
      const yrs = [...new Set(ties.map((x) => yearOf(x.r[2])))].join(", ");
      return `<a class="board-row" href="#/top/${encodeURIComponent(E[e].k)}/${g}">
        <span class="br-event">${esc(E[e].n)}</span>
        <span class="br-mark">${markHTML(r[4], r[5], r)}</span>
        <span class="br-who"><span class="br-name">${who}</span><span class="br-meta">&nbsp;·&nbsp;${yrs}</span></span></a>`;
    }).join("");
  }
  // ---------- record boards: boys and girls side by side, one row per event, grouped the way a meet runs ----------
  const REC_GROUPS = [
    ["Sprints", [["100M"], ["200M"], ["400M"]]],
    ["Distance", [["800M"], ["1600M"], ["3200M"]]],
    ["Hurdles", [["110HH", "100HH", "110m / 100m hurdles"], ["300IH"]]],
    ["Jumps", [["High Jump"], ["Pole Vault"], ["Long Jump"]]],
    ["Throws", [["Shot Put"], ["Discus"]]],
  ];
  const REL_GROUPS = [
    ["Standard relays", [["4X100M"], ["4X200M"], ["4X400M"], ["4X800M"]]],
    ["Invitational relays", [["SMR"], ["DMR"], ["4X1200M"], ["4X1600M"], ["4X100M Shuttle Hurdle"], ["4X110M Shuttle Hurdle"], ["4X100M Throwers"]]],
  ];
  const evIdx = (k) => E.findIndex((e) => e.k === k);
  const relLabel = (e) => E[e].n.replace(/^Mixed /, "").replace(/ Relay$/, "");
  // The record (with ties) for an event: mark, holder(s), year(s) and the all-time list it links to
  function recTop(e, g, relay) {
    if (e < 0) return null;
    if (relay) {
      const top = relayRanking(e, g);
      if (!top.length) return null;
      const r = top[0].r;
      return { mk: markHTML(r[4], r[5], r), who: esc(relayWho(r)), yrs: [yearOf(r[1])], href: `#/relays/${encodeURIComponent(E[e].k)}/${g}` };
    }
    const top = ranking(e, g);
    if (!top.length) return null;
    const ties = top.filter((x) => x.rank === 1), r = ties[0].r;
    return { mk: markHTML(r[4], r[5], r), who: andList(ties.map((x) => esc(nameOf(x.r[0])))),
      yrs: [...new Set(ties.map((x) => yearOf(x.r[2])))], href: `#/top/${encodeURIComponent(E[e].k)}/${g}` };
  }
  const yrChips = (yrs) => yrs.map((y) => `<span class="yr${+y === +seasons()[0] ? " new" : ""}">${y}</span>`).join("");
  function recCell(x, g, phoneLabel) {
    const cls = `rb-cell ${g === "B" ? "rb-b" : "rb-g"}`;
    if (!x) return `<span class="${cls} rb-none"><span class="rb-evp">${esc(phoneLabel)}</span><span class="rb-who"><span class="rb-nc">Not contested</span></span></span>`;
    return `<a class="${cls}" href="${x.href}"><span class="rb-evp">${esc(phoneLabel)}</span><span class="rb-mk">${x.mk}</span>
      <span class="rb-who"><span class="rb-name">${x.who}</span>${yrChips(x.yrs)}</span></a>`;
  }
  function recBoard(id, title, groups, relay, used) {
    let body = "";
    for (const [gt, rows] of groups) {
      let rh = "", n = 0;
      for (const [kb, kg, lab] of rows) {
        const eb = evIdx(kb), eg = evIdx(kg || kb);
        used.add(eb); used.add(eg);
        const b = recTop(eb, "B", relay), gx = recTop(eg, "G", relay);
        if (!b && !gx) continue;
        n++;
        const nm = (e) => (e < 0 ? lab : relay ? relLabel(e) : E[e].n);
        rh += `<div class="rb-row"><span class="rb-ev">${esc(lab || nm(eb))}</span>${recCell(b, "B", nm(eb))}${recCell(gx, "G", nm(eg))}</div>`;
      }
      if (n) body += `<div class="rb-group jump-target" id="${id}-${slugify(gt)}"><h3>${esc(gt)}</h3><span>${n} event${n > 1 ? "s" : ""}</span></div>${rh}`;
    }
    return body ? `<section class="rb jump-target" id="${id}" aria-labelledby="${id}-h">
      <div class="rb-head"><h2 id="${id}-h">${esc(title)}</h2><span class="rb-col rb-b">Boys</span><span class="rb-col rb-g">Girls</span></div>${body}</section>` : "";
  }
  function mixedBoard() {
    const rows = eventsFor("X", true).map((e) => {
      const x = recTop(e, "X", true);
      return x ? `<a class="rbx-row" href="${x.href}"><span class="rbx-ev">${esc(relLabel(e))}</span><span class="rb-mk">${x.mk}</span>
        <span class="rb-who"><span class="rb-name">${x.who}</span>${yrChips(x.yrs)}</span></a>` : "";
    }).join("");
    return rows ? `<section class="rb jump-target" id="rec-mixed" aria-labelledby="rec-mixed-h"><div class="rb-head2"><h2 id="rec-mixed-h">Mixed relays</h2><span>2 boys + 2 girls</span></div>
      <div class="rbx">${rows}</div></section>` : "";
  }
  // Everything that isn't on the main boards: field relays, indoor events, rarer relays
  function moreBoard(used) {
    const rows = [], counts = { frelay: 0, ind: 0, rel: 0 };
    const add = (e, g, relay) => {
      const x = recTop(e, g, relay);
      if (!x) return;
      counts[E[e].t === "frelay" ? "frelay" : relay ? "rel" : "ind"]++;
      rows.push({ o: (E[e].t === "frelay" ? 2 : relay ? 1 : 0) * 1e4 + E[e].o * 2 + (g === "G" ? 1 : 0),
        h: `<a class="rbm-row" href="${x.href}"><span class="rbm-ev">${esc(relay ? E[e].n : E[e].n)}<small>${G[g]}</small></span><span class="rbm-mk">${x.mk}</span>
          <span class="rbm-who"><b>${x.who}</b> · ${x.yrs.join(", ")}</span></a>` });
    };
    for (const g of ["B", "G"]) {
      eventsFor(g).filter((e) => !used.has(e) && !E[e].l).forEach((e) => add(e, g, false));
      eventsFor(g, true).filter((e) => !used.has(e) && !E[e].l).forEach((e) => add(e, g, true));
    }
    if (!rows.length) return "";
    rows.sort((a, b) => a.o - b.o);
    const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const sum = [counts.frelay && pl(counts.frelay, "field relay record", "field relay records"), counts.ind && pl(counts.ind, "indoor or other event", "indoor or other events"),
      counts.rel && pl(counts.rel, "other relay", "other relays")].filter(Boolean).join(", ");
    return `<details class="rb-more jump-target" id="rec-more"><summary><span><b>Field relays &amp; indoor</b><small>${sum}</small></span>
      <span class="act"><span class="act-show">Show all ${rows.length}</span><span class="act-hide">Hide</span></span></summary>
      <div class="rbm">${rows.map((r) => r.h).join("")}</div></details>`;
  }
  function pageHome() {
    const ys = seasons();
    const nRes = D.results.filter(valid).length;
    const legs = D.relays.reduce((s, r) => s + r[6].length, 0);
    const latest = ys[0];
    const wrap = jwrap;
    const used = new Set();
    const ind = recBoard("rec-ind", "Individual events", REC_GROUPS, false, used);
    const rel = recBoard("rec-rel", "Relays", REL_GROUPS, true, used);
    const mixed = mixedBoard(), more = moreBoard(used);
    const team = teamTitlesHTML(), champs = champRoll(), legacy = legacyBoards();
    const jumps = [["rec-ind", "Individual events"], rel ? ["rec-rel", "Relays"] : null, mixed ? ["rec-mixed", "Mixed relays"] : null,
      more ? ["rec-more", "Field relays & indoor"] : null, team ? ["rec-team", "Team titles"] : null, champs ? ["rec-champs", "State champions"] : null,
      ["rec-new", `${latest} top 10s`], legacy ? ["rec-legacy", "Yard-era records"] : null].filter(Boolean);
    const phJumps = [...REC_GROUPS.map(([t]) => ["rec-ind-" + slugify(t), t]), ["rec-rel", "Relays"]].filter(([id]) => ind.includes(`id="${id}"`) || rel.includes(`id="${id}"`));
    let show = "B";
    try { show = localStorage.getItem("recTeam") === "G" ? "G" : "B"; } catch (e) { /* storage blocked */ }
    html(`
      <section class="page-head">
        <span class="eyebrow">School records</span>
        <p class="lede">Every Bulldog mark on file: full seasons from ${ys[ys.length - 1]} to ${latest}${partialSeasons().length ? `, partial seasons from ${spanTxt(partialSeasons())} (team scorebooks)` : ""}, plus state meet results back to ${Math.min(...M.map((m) => +m[0].slice(0, 4)))}. Tap a record to see the all-time list behind it.</p>
        <p class="rb-legend"><span><span class="yr new">${latest}</span> Set this season</span><span><b>22.0<span class="h">h</span></b> Hand timed</span></p>
        ${jumpNav(jumps)}
      </section>
      <div class="stats">
        <div class="stat"><b>${A.length.toLocaleString()}</b><span>Athletes</span></div>
        <div class="stat"><b>${(nRes + legs).toLocaleString()}</b><span>Performances</span></div>
        <div class="stat"><b>${D.relays.length.toLocaleString()}</b><span>Relay teams</span></div>
        <div class="stat"><b>${M.length.toLocaleString()}</b><span>Meets</span></div>
        <div class="stat"><b>${ys.length}</b><span>Seasons</span></div>
      </div>
      <div class="rb-wrap" data-show="${show}">
        <div class="rb-bar">
          <div class="rb-toggle" role="group" aria-label="Team">
            <button type="button" data-team="B" aria-pressed="${show === "B"}">Boys</button><button type="button" data-team="G" aria-pressed="${show === "G"}">Girls</button>
          </div>
          ${jumpNav(phJumps)}
        </div>
        ${ind}
        ${rel}
      </div>
      ${mixed || more ? `<div class="rb-pair">${mixed}${more}</div>` : ""}
      ${wrap("rec-team", team)}
      ${wrap("rec-champs", champs)}
      ${wrap("rec-legacy", legacy)}
      <section class="section jump-target" id="rec-new">
        <div class="section-head"><h2>${latest} on the all-time lists</h2><a href="#/season/${latest}">Full ${latest} season →</a></div>
        ${newTopTen(latest, 10)}
      </section>`);
    const wrapEl = document.querySelector(".rb-wrap");
    document.querySelectorAll(".rb-toggle button").forEach((b) => b.addEventListener("click", () => {
      const t = b.dataset.team;
      wrapEl.dataset.show = t;
      document.querySelectorAll(".rb-toggle button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.team === t)));
      try { localStorage.setItem("recTeam", t); } catch (e) { /* storage blocked */ }
    }));
  }
  function champRoll() {
    const titles = [];
    postseasonIndex().forEach((p, a) => (p.champ || []).forEach((x) => titles.push([a, x])));
    if (!titles.length) return "";
    const seen = new Set(), uniq = [];
    titles.sort((p, q) => q[1].y - p[1].y).forEach(([a, x]) => {
      const k = x.relay ? "r" + D.relays.indexOf(x.relay) : "a" + a + "|" + x.e + "|" + x.y;
      if (seen.has(k)) return; seen.add(k); uniq.push([a, x]);
    });
    return `<section class="section"><div class="section-head"><h2>${STAR}State champions</h2><span class="note">Every Bulldog state title on file.</span></div>
      <div class="champ-roll">${uniq.map(([a, x]) => `<a class="champ-card" href="#/a/${slugOf[a]}">${MEDAL}
        <span><span class="cc-year">${x.y}</span><span class="cc-name">${esc(x.relay ? x.relay[6].map((l) => nameOf(l[0])).join(", ") : nameOf(a))}</span>
        <span class="cc-ev">${G[A[a][1]]} ${esc(E[x.e].n)} · ${markHTML(x.mk, x.f, x.w)}</span></span></a>`).join("")}</div></section>`;
  }
  function newTopTen(year, cutoff) {
    const rows = [];
    for (const g of ["B", "G"]) for (const e of eventsFor(g)) {
      for (const x of ranking(e, g)) {
        if (x.rank > cutoff) break;
        if (yearOf(x.r[2]) === year) rows.push({ g, e, x });
      }
    }
    // Relays: the season's best team in each relay, if it ranks on the all-time list (all teams, as on the Relays page)
    for (const g of ["B", "G", "X"]) for (const e of eventsFor(g, true)) {
      const x = relayRanking(e, g).find((x) => x.rank <= cutoff && yearOf(x.r[1]) === year);
      if (x) rows.push({ g, e, x, relay: true });
    }
    if (!rows.length) return `<p class="empty">No ${year} marks in the all-time top ${cutoff} yet.</p>`;
    rows.sort((a, b) => a.x.rank - b.x.rank || !!a.relay - !!b.relay || E[a.e].o - E[b.e].o);
    const who = (x, relay) => relay
      ? x.r[6].map((l) => aLink(l[0])).join(", ") + (x.r[8] ? `<span class="dim">${x.r[6].length ? `, + ${x.r[8]} not on file` : "Runners not on file"}</span>` : "")
      : aLink(x.r[0]);
    return `<div class="tbl-wrap stk"><table><thead><tr><th>All-time</th><th>Event</th><th>Mark</th><th>Athletes</th><th>Meet</th><th>Date</th></tr></thead><tbody>
      ${rows.map(({ g, e, x, relay }) => { const m = relay ? x.r[1] : x.r[2]; return `<tr><td class="nowrap">${x.rank === 1 ? '<span class="chip sr">Record</span>' : "#" + x.rank}</td>
        <td class="nowrap"><a href="#/${relay ? "relays" : "top"}/${encodeURIComponent(E[e].k)}/${g}">${G[g]} ${esc(g === "X" ? E[e].n.replace(/^Mixed /, "") : E[e].n)}</a></td>
        <td class="mark">${markHTML(x.r[4], x.r[5], x.r)}</td><td class="${relay ? "legs miss-who full" : "grow"}">${who(x, relay)}</td>
        <td class="dk">${meetLink(m)}</td><td class="dim nowrap dk">${fmtDate(dateOf(m))}</td>${phCell(meetLink(m), fmtDate(dateOf(m)))}</tr>`; }).join("")}
      </tbody></table></div>`;
  }

  function pageTop(ek, g) {
    const st = state.top;
    if (g) st.g = g;
    const evs = eventsFor(st.g);
    let e = ek ? eventByKey(ek) : -1;
    if (!evs.includes(e)) e = evs.includes(st.e) ? st.e : evs[0];
    st.e = e;
    const handEvent = !!E[e].h;
    const list = ranking(e, st.g, st);
    const shown = list.slice(0, st.n);
    html(`
      <section class="page-head"><span class="eyebrow">All-time top lists</span><h1>${G[st.g]} ${esc(E[e].n)}</h1></section>
      <div class="controls">
        <div class="ctl"><span class="lbl">Team</span>${seg("tg", [["B", "Boys"], ["G", "Girls"]], st.g)}</div>
        <div class="ctl"><label for="te">Event</label>${eventSelect("te", evs, e)}</div>
        <div class="ctl"><span class="lbl">List</span>${seg("tp", [["1", "Best per athlete"], ["0", "All marks"]], st.per ? "1" : "0")}</div>
        ${handEvent ? `<div class="ctl"><span class="lbl">Hand times</span>${seg("tt", [["raw", "As recorded"], ["conv", "Converted"], ["fat", "FAT only"]], st.timing)}</div>` : ""}
        <div class="ctl"><label for="tf">From</label>${yearSelect("tf", st.from, "Any")}</div>
        <div class="ctl"><label for="tto">To</label>${yearSelect("tto", st.to, "Any")}</div>
        <div class="ctl"><label for="tgr">Grade</label><select id="tgr">${[["", "Any"], ["9", "Freshman"], ["10", "Sophomore"], ["11", "Junior"], ["12", "Senior"]].map(([v, l]) => `<option value="${v}"${v === String(st.grade) ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="ctl"><label for="tn">Show</label><select id="tn">${[10, 25, 50, 100, 500].map((n) => `<option${n === st.n ? " selected" : ""}>${n}</option>`).join("")}</select></div>
      </div>
      ${st.grade ? gradeNote(e, st) : ""}
      ${handEvent ? `<p class="note">“h” marks a hand time. Converted adds ${convAmt(e).toFixed(2)}s to hand times so they compare fairly with fully automatic (FAT) times.</p>` : ""}
      ${shown.length ? `<div class="tbl-wrap stk"><table><thead><tr><th>#</th><th>Mark</th><th>Athlete</th><th>Year</th><th>Meet</th><th>Date</th></tr></thead><tbody>
        ${shown.map((x) => { const r = x.r, y = yearOf(r[2]), gl = gradeLabel(r[0], y);
          return `<tr class="${x.rank === 1 ? "top1" : ""}"><td class="rank">${x.rank}</td>
          <td class="mark">${markHTML(r[4], r[5], r)}${st.timing === "conv" && r[5] & HAND ? ` <span class="h">(${x.v.toFixed(2)})</span>` : ""}${r[5] & PRELIM ? ' <span class="chip">Prelim</span>' : ""}</td>
          <td class="grow">${aLink(r[0])}</td><td class="nowrap dk">${y}${gl ? ` <span class="dim">${gl}</span>` : ""}</td>
          <td class="dk">${meetLink(r[2])}</td><td class="dim nowrap dk">${fmtDate(dateOf(r[2]))}</td>${phCell(`${y}${gl ? " " + gl : ""}`, meetLink(r[2]), fmtDate(dateOf(r[2])))}</tr>`; }).join("")}
        </tbody></table></div>` : `<p class="empty">No marks match these filters.</p>`}
      ${list.length > shown.length ? `<p class="note">Showing ${shown.length} of ${list.length.toLocaleString()} ${st.per ? "athletes" : "marks"}.</p>` : ""}
      <section class="section">${recordProgression(e, st.g)}</section>`);
    onSeg("tg", (v) => { st.g = v; location.hash = `#/top/${encodeURIComponent(E[e].k)}/${v}`; });
    onSeg("tp", (v) => { st.per = v === "1"; pageTop(E[e].k, st.g); });
    onSeg("tt", (v) => { st.timing = v; pageTop(E[e].k, st.g); });
    document.getElementById("te").onchange = (ev) => { location.hash = `#/top/${encodeURIComponent(ev.target.value)}/${st.g}`; };
    document.getElementById("tf").onchange = (ev) => { st.from = ev.target.value; pageTop(E[e].k, st.g); };
    document.getElementById("tto").onchange = (ev) => { st.to = ev.target.value; pageTop(E[e].k, st.g); };
    document.getElementById("tn").onchange = (ev) => { st.n = +ev.target.value; pageTop(E[e].k, st.g); };
    document.getElementById("tgr").onchange = (ev) => { st.grade = ev.target.value; pageTop(E[e].k, st.g); };
    bindCharts();
  }

  // Grade filter: only athletes with a class year on file can be placed in a grade
  function gradeNote(e, st) {
    const all = ranking(e, st.g, { ...st, grade: "" }), unknown = new Set(all.filter((x) => !A[x.r[0]][2]).map((x) => x.r[0]));
    const name = { 9: "freshman", 10: "sophomore", 11: "junior", 12: "senior" }[st.grade];
    return `<p class="note">Showing ${name} marks: the grade comes from each athlete's class year. ${unknown.size ? `${unknown.size.toLocaleString()} ${unknown.size === 1 ? "athlete" : "athletes"} in this event ${unknown.size === 1 ? "has" : "have"} no class year on file yet, so ${unknown.size === 1 ? "isn't" : "aren't"} included. Coaches can add it in the Grad Year column of the Athletes tab.` : ""}</p>`;
  }

  function recordProgression(e, g) {
    const marks = D.results.filter((r) => r[1] === e && A[r[0]][1] === g && valid(r))
      .sort((x, y) => (dateOf(x[2]) < dateOf(y[2]) ? -1 : dateOf(x[2]) > dateOf(y[2]) ? 1 : 0));
    if (!marks.length) return "";
    // Start from the best mark of the first season on file, so early-season marks don't read as "records"
    const first = yearOf(marks[0][2]);
    let seed = null;
    for (const r of marks) if (yearOf(r[2]) === first && (seed === null || better(e, r[3], seed[3]))) seed = r;
    const steps = [seed];
    let best = seed[3];
    for (const r of marks) if (yearOf(r[2]) > first && better(e, r[3], best)) { best = r[3]; steps.push(r); }
    if (steps.length < 2) return "";
    return `<div class="section-head"><h3>Record progression</h3><span class="note">Starts from the best ${first} mark (the first season on file), then every improvement.</span></div>
      ${stepChart(e, steps)}
      <div class="tbl-wrap stk"><table><thead><tr><th>Mark</th><th>Athlete</th><th>Meet</th><th>Date</th></tr></thead><tbody>
      ${steps.slice().reverse().map((r) => `<tr><td class="mark">${markHTML(r[4], r[5], r)}</td><td class="grow">${aLink(r[0])}</td><td class="dk">${meetLink(r[2])}</td><td class="dim nowrap dk">${fmtDate(dateOf(r[2]))}</td>${phCell(meetLink(r[2]), fmtDate(dateOf(r[2])))}</tr>`).join("")}
      </tbody></table></div>`;
  }

  // ---------- charts (inline SVG) ----------
  let chartBindings = [];
  function bindCharts() { chartBindings.forEach((f) => f()); chartBindings = []; }
  // Charts are drawn at their real on-screen width so axis text stays readable on phones.
  const chartDraw = new Map();
  function sizeChart(id, draw) {
    const el = document.getElementById(id); if (!el) return;
    const w = Math.round(el.querySelector("svg").getBoundingClientRect().width) || 760;
    el.querySelector("svg").outerHTML = draw(Math.max(260, w));
    chartDraw.set(id, draw);
  }
  let resizeT = 0, lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastW) return; lastW = window.innerWidth;
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { for (const [id, draw] of chartDraw) { if (document.getElementById(id)) sizeChart(id, draw); else chartDraw.delete(id); } }, 150);
  });
  function niceTicks(lo, hi, n = 4) {
    const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function fmtVal(e, v) {
    if (E[e].t === "field" || E[e].t === "frelay") { const ft = Math.floor(v / 12), inch = v - ft * 12; return `${ft}-${+inch.toFixed(2)}`; }
    if (v >= 60) { const m = Math.floor(v / 60), s = v - m * 60; return `${m}:${s.toFixed(2).padStart(5, "0")}`; }
    return v.toFixed(2);
  }
  function fmtAxis(e, v) {
    if (E[e].t === "field" || E[e].t === "frelay") { const ft = Math.floor(v / 12), inch = Math.round(v - ft * 12); return `${ft}'${inch ? inch + '"' : ""}`; }
    if (v >= 60) { const m = Math.floor(v / 60), s = Math.round(v - m * 60); return `${m}:${String(s).padStart(2, "0")}`; }
    return (+v.toFixed(1)).toString();
  }
  // time-series dot+line chart; pts = [{t: Date ms, v, label}], better values plotted UP
  function lineChart(e, pts, opts = {}) {
    const id = "c" + Math.random().toString(36).slice(2, 8);
    const H = 260, L = 52, R = 14, T = 14, B = 28;
    const draw = (W) => {
    const ts = pts.map((p) => p.t), vs = pts.map((p) => p.v);
    let t0 = Math.min(...ts), t1 = Math.max(...ts);
    if (t1 - t0 < 864e5 * 20) { t0 -= 864e5 * 15; t1 += 864e5 * 15; }
    let lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo || Math.abs(hi) * 0.05 || 1) * 0.12;
    lo -= pad; hi += pad;
    const up = !lower(e);
    // seasonal: each season gets an equal band (no empty summers), and the line breaks between seasons
    const yrOf = (t) => new Date(t).getUTCFullYear();
    const sYs = opts.seasonal ? [...new Set(pts.map((p) => yrOf(p.t)))].sort((a, b) => a - b) : [];
    const doy = (t) => (t - Date.UTC(yrOf(t), 0, 1)) / 864e5;
    const x = opts.seasonal
      ? (t) => L + ((sYs.indexOf(yrOf(t)) + 0.08 + 0.84 * Math.min(1, Math.max(0, (doy(t) - 60) / 110))) / sYs.length) * (W - L - R)
      : (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const y = (v) => (up ? T + (1 - (v - lo) / (hi - lo)) * (H - T - B) : T + ((v - lo) / (hi - lo)) * (H - T - B));
    const yt = niceTicks(lo, hi, 4);
    const y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
    const xt = []; for (let yy = y0; yy <= y1 + 1; yy++) { const t = Date.UTC(yy, 0, 1); if (t >= t0 && t <= t1) xt.push(yy); }
    const maxT = Math.max(3, Math.floor((W - L) / 56));
    const xtShow = xt.length > maxT ? xt.filter((yy, i) => i % Math.ceil(xt.length / maxT) === 0) : xt;
    const path = opts.step
      ? pts.map((p, i) => (i ? `H${x(p.t).toFixed(1)}V${y(p.v).toFixed(1)}` : `M${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)).join("") + `H${(W - R).toFixed(1)}`
      : pts.map((p, i) => `${i && !(opts.seasonal && yrOf(p.t) !== yrOf(pts[i - 1].t)) ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const band = (W - L - R) / Math.max(1, sYs.length);
    const xAxis = opts.seasonal
      ? sYs.map((yy, i) => `${i ? `<line x1="${L + i * band}" x2="${L + i * band}" y1="${T}" y2="${H - B}" stroke-dasharray="3 4"/>` : ""}<text x="${L + (i + 0.5) * band}" y="${H - 8}" text-anchor="middle">${yy}</text>`).join("")
      : xtShow.map((yy) => `<text x="${x(Date.UTC(yy, 0, 1))}" y="${H - 8}" text-anchor="middle">${yy}</text>`).join("");
    const best = opts.bestIndex ?? -1;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || "Chart")}">
      <g class="ax">${yt.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke-dasharray="2 4"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtAxis(e, v)}</text>`).join("")}
        ${xAxis}
        <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/></g>
      <path d="${path}" fill="none" stroke="var(--accent-fill)" stroke-width="2" stroke-linejoin="round"/>
      ${pts.map((p, i) => `<circle data-i="${i}" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${i === best ? 6 : 4}" fill="${i === best ? "var(--accent-fill)" : "var(--surface)"}" stroke="var(--accent-fill)" stroke-width="2"/>`).join("")}
      ${pts.map((p, i) => `<circle class="hit" data-i="${i}" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="12" fill="transparent"/>`).join("")}
    </svg>`;
    };
    const svg = draw(760);
    chartBindings.push(() => {
      sizeChart(id, draw);
      document.querySelectorAll(`#${id} circle.hit`).forEach((c) => tipOn(c, pts[+c.dataset.i].label));
    });
    return `<div class="chart" id="${id}">${opts.title ? `<div class="ttl">${esc(opts.title)}</div>` : ""}${opts.cap ? `<div class="cap">${esc(opts.cap)}</div>` : ""}${svg}</div>`;
  }
  function stepChart(e, steps) {
    const pts = steps.map((r) => ({ t: Date.parse(dateOf(r[2])), v: r[3], label: `<b>${esc(r[4])}</b> · ${esc(nameOf(r[0]))}<br>${fmtDate(dateOf(r[2]))}` }));
    return lineChart(e, pts, { step: true, bestIndex: pts.length - 1, aria: `Record progression for ${E[e].n}` });
  }
  // bars: series = [{name, color, values[]}], cats = labels
  function barChart(cats, series, opts = {}) {
    const id = "c" + Math.random().toString(36).slice(2, 8);
    const H = 240, L = 40, R = 10, T = 12, B = 26;
    const draw = (W) => {
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const yt = niceTicks(0, max, 4);
    const top = Math.max(max, yt[yt.length - 1]);
    const bw = (W - L - R) / cats.length, gap = 2, inner = Math.max(2, (bw - 6) / series.length - gap);
    const y = (v) => T + (1 - v / top) * (H - T - B);
    let bars = "", hits = "";
    cats.forEach((c, ci) => {
      const tipText = `<b>${esc(c)}</b>` + series.map((s) => `<br>${esc(s.name)}: ${s.values[ci].toLocaleString()}`).join("");
      series.forEach((s, si) => {
        const v = s.values[ci]; if (!v) return;
        const bx = L + ci * bw + 3 + si * (inner + gap), by = y(v), h = H - B - by;
        const r = Math.min(3, inner / 2, h);
        bars += `<path d="M${bx},${H - B}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + inner - r}Q${bx + inner},${by} ${bx + inner},${by + r}V${H - B}Z" fill="${s.color}"/>`;
      });
      hits += `<rect class="hit" data-t="${esc(tipText)}" x="${L + ci * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>`;
    });
    const fit = Math.max(4, Math.floor((W - L) / 34)), every = Math.ceil(cats.length / fit);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || opts.title || "Bar chart")}">
      <g class="ax">${yt.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke-dasharray="2 4"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
      ${cats.map((c, ci) => (ci % every === 0 ? `<text x="${L + ci * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(opts.short ? opts.short(c) : c)}</text>` : "")).join("")}
      <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/></g>${bars}${hits}</svg>`;
    };
    const svg = draw(760);
    chartBindings.push(() => {
      sizeChart(id, draw);
      document.querySelectorAll(`#${id} rect.hit`).forEach((h) => tipOn(h, h.dataset.t));
    });
    const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
    return `<div class="chart" id="${id}"><div class="ttl">${esc(opts.title || "")}</div>${opts.cap ? `<div class="cap">${esc(opts.cap)}</div>` : ""}${legend}${svg}</div>`;
  }

  // ---------- relays ----------
  function pageRelays(ek, g) {
    const st = state.rel;
    if (g) st.g = g;
    const gs = [["B", "Boys"], ["G", "Girls"]];
    if (D.relays.some((r) => r[2] === "X")) gs.push(["X", "Mixed"]);
    const evs = eventsFor(st.g, true);
    let e = ek ? eventByKey(ek) : -1;
    if (!evs.includes(e)) e = evs.includes(st.e) ? st.e : evs[0];
    st.e = e;
    const list = relayRanking(e, st.g, st), shown = list.slice(0, st.n);
    html(`
      <section class="page-head"><span class="eyebrow">Relay top lists</span><h1>${G[st.g]} ${esc(E[e].n)}</h1></section>
      <div class="controls">
        <div class="ctl"><span class="lbl">Team</span>${seg("rg", gs, st.g)}</div>
        <div class="ctl"><label for="re">Event</label>${eventSelect("re", evs, e)}</div>
        <div class="ctl"><span class="lbl">List</span>${seg("rp", [["0", "All teams"], ["1", "Best per season"]], st.per ? "1" : "0")}</div>
        <div class="ctl"><label for="rf">From</label>${yearSelect("rf", st.from, "Any")}</div>
        <div class="ctl"><label for="rt">To</label>${yearSelect("rt", st.to, "Any")}</div>
        <div class="ctl"><label for="rn">Show</label><select id="rn">${[10, 25, 50, 100].map((n) => `<option${n === st.n ? " selected" : ""}>${n}</option>`).join("")}</select></div>
      </div>
      ${shown.length ? `<div class="tbl-wrap stk"><table><thead><tr><th>#</th><th>Mark</th><th>Team</th><th>Meet</th><th>Date</th></tr></thead><tbody>
      ${shown.map((x) => `<tr class="${x.rank === 1 ? "top1" : ""}"><td class="rank">${x.rank}</td><td class="mark">${markHTML(x.r[4], x.r[5], x.r)}</td>
        <td class="legs full">${relayLegs(x.r)}</td><td class="dk">${meetLink(x.r[1])}</td><td class="dim nowrap dk">${fmtDate(dateOf(x.r[1]))}</td>${phCell(meetLink(x.r[1]), fmtDate(dateOf(x.r[1])))}</tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">No relays match these filters.</p>`}
      <p class="note">Splits are shown next to a runner when they were recorded.</p>`);
    onSeg("rg", (v) => { st.g = v; location.hash = `#/relays/${encodeURIComponent(E[e].k)}/${v}`; });
    onSeg("rp", (v) => { st.per = v === "1"; pageRelays(E[e].k, st.g); });
    document.getElementById("re").onchange = (ev) => { location.hash = `#/relays/${encodeURIComponent(ev.target.value)}/${st.g}`; };
    document.getElementById("rf").onchange = (ev) => { st.from = ev.target.value; pageRelays(E[e].k, st.g); };
    document.getElementById("rt").onchange = (ev) => { st.to = ev.target.value; pageRelays(E[e].k, st.g); };
    document.getElementById("rn").onchange = (ev) => { st.n = +ev.target.value; pageRelays(E[e].k, st.g); };
  }

  // ---------- athletes ----------
  const athState = { q: "", g: "", y: "", ps: "", n: 120 };
  function matches(a, q) {
    if (!q) return true;
    const n = A[a][0].toLowerCase(), f = nameOf(a).toLowerCase();
    return q.split(/\s+/).every((w) => n.includes(w) || f.includes(w));
  }
  function pageAthletes() {
    const st = athState;
    html(`
      <section class="page-head"><span class="eyebrow">Athletes</span><h1>Every Bulldog on file</h1></section>
      <div class="controls">
        <div class="ctl" style="flex:1 1 220px"><label for="aq">Name</label><input id="aq" class="plain" type="search" value="${esc(st.q)}" placeholder="Type a first or last name"></div>
        <div class="ctl"><span class="lbl">Team</span>${seg("ag", [["", "All"], ["B", "Boys"], ["G", "Girls"]], st.g)}</div>
        <div class="ctl"><label for="ay">Competed in</label>${yearSelect("ay", st.y, "Any season")}</div>
        <div class="ctl"><label for="aps">Honors</label><select id="aps">
          <option value="">Anyone</option><option value="Champion"${st.ps === "Champion" ? " selected" : ""}>State champions</option>
          <option value="AllOhio"${st.ps === "AllOhio" ? " selected" : ""}>All-Ohio</option><option value="REC"${st.ps === "REC" ? " selected" : ""}>School record holders</option>
          <option value="FREC"${st.ps === "FREC" ? " selected" : ""}>Former record holders</option>${LEVELS.map((l) => `<option value="${esc(l.k)}"${st.ps === l.k ? " selected" : ""}>${l.label}s</option>`).join("")}</select></div>
      </div>
      <div id="alist"></div>`);
    const draw = () => {
      const q = st.q.trim().toLowerCase();
      const ps = postseasonIndex(), rh = recordIndex();
      const ids = A.map((_, i) => i).filter((i) => !A[i][3] && (!st.g || A[i][1] === st.g) && matches(i, q) && (!st.y || athleteYears(i).includes(+st.y))
        && (!st.ps || (st.ps === "REC" ? rh[i].cur.size : st.ps === "FREC" ? rh[i].former.size : ps[i].yrs[st.ps] && (!st.y || ps[i].yrs[st.ps].has(+st.y)))));
      ids.sort((a, b) => A[a][0].localeCompare(A[b][0]));
      const show = ids.slice(0, st.n);
      document.getElementById("alist").innerHTML = `<p class="note" style="margin-bottom:10px">${ids.length.toLocaleString()} athletes</p>
        <div class="cards">${show.map((i) => { const tl = topLevel(i), rc = recordIndex()[i];
          const pp = postseasonIndex()[i];
          const badge = pp.champ && pp.champ.length ? `<span class="honor sm champ">${STAR}State champ</span>` : rc.cur.size ? `<span class="honor sm rec">Record</span>` : pp.allOhio && pp.allOhio.length ? `<span class="honor sm allohio">All-Ohio</span>` : rc.former.size ? `<span class="honor sm frec">Former record</span>` : tl ? `<span class="honor sm ${tl.cls}">${tl.short}</span>` : "";
          return `<a class="card" href="#/a/${slugOf[i]}"><span class="t">${esc(nameOf(i))} ${badge}</span>
          <span class="m">${G[A[i][1]]} · ${yearsLabel(i)} · ${aRes[i].length + aRel[i].length} marks</span></a>`; }).join("")}</div>
        ${ids.length > show.length ? `<p style="margin-top:12px"><button class="more" id="amore">Show more</button></p>` : ""}`;
      const more = document.getElementById("amore");
      if (more) more.onclick = () => { st.n += 240; draw(); };
    };
    draw();
    document.getElementById("aq").oninput = (ev) => { st.q = ev.target.value; st.n = 120; draw(); };
    onSeg("ag", (v) => { st.g = v; pageAthletes(); });
    document.getElementById("ay").onchange = (ev) => { st.y = ev.target.value; st.n = 120; draw(); };
    document.getElementById("aps").onchange = (ev) => { st.ps = ev.target.value; st.n = 120; draw(); };
  }

  function pageAthlete(slug) {
    const a = bySlug[slug];
    if (a === undefined) return html(`<p class="empty">That athlete isn't in the record book. <a href="#/athletes">Browse athletes</a>.</p>`);
    if (A[a][3]) return html(`<section class="page-head"><h1>Name withheld</h1><p class="lede">This athlete's results count toward team lists, but their page is private.</p></section>`);
    const g = A[a][1];
    const res = aRes[a].map((i) => D.results[i]).sort((x, y) => (dateOf(x[2]) < dateOf(y[2]) ? -1 : dateOf(x[2]) > dateOf(y[2]) ? 1 : x[1] - y[1]));
    // PRs + PR flags
    const best = {}, prSet = new Set(), prCount = {};
    res.forEach((r) => {
      if (!valid(r)) return;
      const e = r[1];
      if (best[e] === undefined || better(e, r[3], best[e][3])) {
        if (best[e] !== undefined) { prCount[e] = (prCount[e] || 0) + 1; prSet.add(r); }
        best[e] = r;
      }
    });
    const evs = Object.keys(best).map(Number).sort((x, y) => E[x].o - E[y].o);
    const ys = athleteYears(a);
    const ranks = evs.map((e) => rankMap(e, g).get(a));
    const topRank = Math.min(...ranks.filter(Boolean), 999);
    const totalPRs = Object.values(prCount).reduce((s, n) => s + n, 0);
    const chartEvs = evs.filter((e) => res.filter((r) => r[1] === e && valid(r)).length >= 2);
    let cur = chartEvs.includes(evs[ranks.indexOf(topRank)]) ? evs[ranks.indexOf(topRank)] : chartEvs[0];
    const rels = aRel[a].map((i) => D.relays[i]).sort((x, y) => (dateOf(x[1]) < dateOf(y[1]) ? 1 : -1));

    const bySeason = {};
    res.forEach((r) => (bySeason[yearOf(r[2])] = bySeason[yearOf(r[2])] || []).push(r));
    html(`
      <section class="ath-head">
        <span class="eyebrow">${G[g]} · ${ys.length > 1 ? "Seasons " : "Season "}${yearsLabel(a)}${A[a][2] ? ` · Class of ${A[a][2]}` : ""}</span>
        <h1>${esc(nameOf(a))}</h1>
        <div class="facts"><span><b>${res.filter(valid).length}</b> individual ${res.filter(valid).length === 1 ? "mark" : "marks"}</span><span><b>${rels.length}</b> ${rels.length === 1 ? "relay" : "relays"}</span>
          <span><b>${evs.length}</b> ${evs.length === 1 ? "event" : "events"}</span><span><b>${totalPRs}</b> ${totalPRs === 1 ? "PR" : "PRs"}</span>
          ${pointsIndex().career.get(a) ? `<span title="Points scored for the team, from Track Central scoring reports (${ptsYearsLabel(pointsIndex().ys)})"><b>${fmtPts(pointsIndex().career.get(a))}</b> career points, <a class="pts-rank" href="#/fun">#${pointsIndex().rank.get(a)} all-time</a></span>` : ""}
          ${topRank > 1 && topRank <= 10 ? `<span><b>#${topRank} all-time</b> best individual rank</span>` : ""}</div>
        ${honorChips(a) ? `<div class="honors">${honorChips(a)}</div>` : ""}
        ${[evs.length, postseasonIndex()[a].rows.length, rels.length, res.length].filter(Boolean).length >= 3 || Object.keys(bySeason).length > 2
          ? jumpNav([evs.length ? ["a-prs", "Personal records"] : null, postseasonIndex()[a].rows.length ? ["a-post", "Postseason"] : null, rels.length ? ["a-rel", "Relays"] : null]
              .concat(res.length ? Object.keys(bySeason).sort((x, y) => y - x).map((y) => ["a-y" + y, `${y} results`]) : [])) : ""}
      </section>
      ${champBanner(a)}
      ${evs.length ? `<section class="section jump-target" id="a-prs"><h2>Personal records</h2>
        <div class="pr-grid" id="prs">${evs.map((e, i) => { const r = best[e], rk = ranks[i];
          return `<button type="button" class="pr" data-e="${e}" aria-pressed="${e === cur}"${chartEvs.includes(e) ? "" : " disabled"}>
            <span class="ev">${esc(E[e].n)}</span><span class="v">${markHTML(r[4], r[5], r)}</span>
            <span class="d">${fmtDate(dateOf(r[2]))}${gradeLabel(a, yearOf(r[2])) ? " · " + gradeLabel(a, yearOf(r[2])) : ""}</span>
            <span>${rk === 1 ? '<span class="chip sr">School record</span>' : rk <= 10 ? `<span class="chip top">#${rk} all-time</span>` : rk ? `<span class="chip">#${rk} all-time</span>` : ""}</span>
          </button>`; }).join("")}</div>
        <div id="prog"></div>
        ${evs.some((e) => FIELD_KEYS.has(E[e].k)) ? `<p class="wi-link"><a href="#/whatif/${encodeURIComponent(E[evs.filter((e) => FIELD_KEYS.has(E[e].k)).sort((x, y) => (ranks[evs.indexOf(x)] || 999) - (ranks[evs.indexOf(y)] || 999))[0]].k)}/${g}/${slugOf[a]}">What if? See where ${esc(nameOf(a).split(" ")[0])}'s PRs would have placed at district, regional and state in every year →</a></p>` : ""}</section>` : ""}
      ${postseasonIndex()[a].rows.length ? `<section class="section jump-target" id="a-post"><h2>Postseason</h2>
        <div class="tbl-wrap stk"><table><thead><tr><th>Season</th><th>Level</th><th>Event</th><th>Mark</th><th>Place</th><th>Meet</th></tr></thead><tbody>
        ${postRows(a).map((x, i) => x.from ? `<tr${i >= 12 ? " hidden data-more" : ""}><td class="nowrap">${x.y}</td><td class="nowrap"><span class="honor sm ${LEVEL[x.t].cls}">${LEVEL[x.t].short}</span></td>
          <td class="nowrap">${esc(E[x.e].n)}</td><td class="dim">—</td><td class="nowrap dim">Qualified</td>
          <td class="full dim">Didn't compete · qualified by placing ${ordinal(x.from.pl)} at ${x.from.t.toLowerCase()}</td></tr>` : `<tr class="${x.t === "State" && x.pl === 1 && !(x.f & PRELIM) ? "champ-row" : ""}"${i >= 12 ? " hidden data-more" : ""}><td class="nowrap">${x.y}</td><td class="nowrap"><span class="honor sm ${LEVEL[x.t].cls}">${LEVEL[x.t].short}</span></td>
          <td class="nowrap">${esc(E[x.e].n)}${x.f & PRELIM ? ' <span class="chip">Prelim</span>' : ""}</td><td class="mark">${x.f & NOMARK ? nmHTML(x.mk) : markHTML(x.mk, x.f, x.w)}</td>
          <td class="nowrap">${x.pl && !(x.f & PRELIM) ? (x.t === "State" && x.pl === 1 ? `<span class="honor sm champ">${STAR}Champion</span>` : x.t === "State" && x.pl <= 8 ? `${ordinal(x.pl)} <span class="honor sm allohio">All-Ohio</span>` : ordinal(x.pl)) : ""}</td>
          <td class="full dim">${meetLink(x.m)} <span class="dim nowrap">${fmtDate(dateOf(x.m))}</span></td></tr>`).join("")}
        </tbody></table></div>${moreBtn(postRows(a).length, 12, "postseason results")}</section>` : ""}
      ${rels.length ? `<section class="section jump-target" id="a-rel"><h2>Relays</h2><div class="tbl-wrap stk"><table><thead><tr><th>Event</th><th>Mark</th><th>Team</th><th>Meet</th><th>Date</th></tr></thead><tbody>
        ${rels.map((r, i) => { const rk = relayRanking(r[0], r[2]).find((x) => x.r === r);
          return `<tr${i >= 10 ? " hidden data-more" : ""}><td class="nowrap">${esc(E[r[0]].n)}</td><td class="mark">${markHTML(r[4], r[5], r)}${rk && rk.rank <= 10 ? ` <span class="chip ${rk.rank === 1 ? "sr" : "top"}">${rk.rank === 1 ? "Record" : "#" + rk.rank}</span>` : ""}</td>
          <td class="legs full">${relayLegs(r, a)}</td><td class="dk">${meetLink(r[1])}</td><td class="dim nowrap dk">${fmtDate(dateOf(r[1]))}</td>${phCell(meetLink(r[1]), fmtDate(dateOf(r[1])))}</tr>`; }).join("")}
        </tbody></table></div>${moreBtn(rels.length, 10, "relays")}</section>` : ""}
      ${res.length ? `<section class="section"><h2>Every result</h2>
        ${Object.keys(bySeason).sort((x, y) => y - x).map((y, yi, all) => `<details class="yr-block jump-target" id="a-y${y}"${yi === 0 || all.length <= 2 ? " open" : ""}><summary><h3>${y}${gradeLabel(a, +y) ? ` <span class="chip">${gradeLabel(a, +y)}</span>` : ""}</h3><span class="note">${bySeason[y].length} ${bySeason[y].length === 1 ? "result" : "results"}</span></summary>
        <div class="tbl-wrap stk"><table><thead><tr><th>Date</th><th>Meet</th><th>Event</th><th>Mark</th><th></th></tr></thead><tbody>
        ${bySeason[y].slice().reverse().map((r) => `<tr class="${valid(r) ? "" : "flag"}"><td class="dim nowrap dk">${fmtDate(dateOf(r[2]))}</td><td class="dk">${meetLink(r[2])}</td>
          <td class="nowrap">${esc(E[r[1]].n)}${r[5] & PRELIM ? ' <span class="chip">Prelim</span>' : ""}</td>
          <td class="mark">${r[5] & NOMARK ? nmHTML(r[4]) : markHTML(r[4], r[5], r)}${seriesBtn(r)}</td>
          <td>${prSet.has(r) ? '<span class="chip is-pr">PR</span>' : ""}${r[5] & FLAGGED ? '<span class="chip warn" title="Held back from the lists until a coach checks it">Check</span>' : ""}</td>${phCell(fmtDate(dateOf(r[2])), meetLink(r[2]))}</tr>${seriesRow(r, 6)}`).join("")}
        </tbody></table></div></details>`).join("")}</section>` : ""}`);
    wireMore();
    const drawProg = () => {
      const el = document.getElementById("prog");
      if (!el || cur === undefined) return;
      const pts = res.filter((r) => r[1] === cur && valid(r)).map((r) => ({ t: Date.parse(dateOf(r[2])), v: r[3], r,
        label: `<b>${esc(r[4])}</b>${r[5] & HAND ? "h" : ""} · ${esc(M[r[2]][1])}<br>${fmtDate(dateOf(r[2]))}` }));
      const bi = pts.findIndex((p) => p.r === best[cur]);
      el.innerHTML = lineChart(cur, pts, { seasonal: true, title: `${E[cur].n} progression`, cap: `Every ${E[cur].n} mark, ${lower(cur) ? "faster" : "farther"} is higher, season by season. The filled dot is the PR.`, bestIndex: bi, aria: `${E[cur].n} progression` });
      bindCharts();
    };
    drawProg();
    const prs = document.getElementById("prs");
    if (prs) prs.addEventListener("click", (ev) => {
      const b = ev.target.closest(".pr"); if (!b || b.disabled) return;
      cur = +b.dataset.e;
      prs.querySelectorAll(".pr").forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.e === cur)));
      drawProg();
    });
  }

  // ---------- seasons ----------
  function seasonPoints(y) {
    const P = pointsIndex(), l = P.bySeason[y];
    if (!l) return "";
    const list = (g) => l.filter(([a]) => A[a][1] === g && !A[a][3]).sort((x, z) => z[1] - x[1]).slice(0, 8)
      .map(([a, v], i) => `<div class="leader"><span class="n">${i + 1}</span><span>${aLink(a)}</span><span class="v">${fmtPts(v)}</span></div>`).join("");
    const tot = (g) => l.filter(([a]) => A[a][1] === g).reduce((s2, [, v]) => s2 + v, 0);
    return `<section class="section"><h2>Top scorers</h2>
      <div class="grid2">${["B", "G"].filter((g) => (P.teams[y] || []).includes(g)).map((g) => `<section class="panel"><h3>${G[g]} <span class="dim" style="text-transform:none;font-weight:600;font-size:.7em">${fmtPts(tot(g))} points in all</span></h3>${list(g)}</section>`).join("")}</div></section>`;
  }
  function pageSeason(y) {
    const ys = seasons();
    y = +y || ys[0];
    const res = D.results.filter((r) => yearOf(r[2]) === y);
    const rels = D.relays.filter((r) => yearOf(r[1]) === y);
    const ath = { B: new Set(), G: new Set() };
    res.forEach((r) => ath[A[r[0]][1]].add(r[0]));
    rels.forEach((r) => r[6].forEach((l) => ath[A[l[0]][1]].add(l[0])));
    const meets = new Set(res.map((r) => r[2]).concat(rels.map((r) => r[1])));
    const leaders = (g) => eventsFor(g).map((e) => {
      const top = ranking(e, g, { from: y, to: y }).slice(0, 3);
      if (!top.length) return "";
      const rm = rankMap(e, g);
      return `<tr><td class="nowrap full"><b><a href="#/top/${encodeURIComponent(E[e].k)}/${g}">${esc(E[e].n)}</a></b></td>
        ${[0, 1, 2].map((i) => { const x = top[i]; if (!x) return '<td class="dk"></td>';
          const at = rm.get(x.r[0]); const isAT = at && at <= 10 && ranking(e, g).find((z) => z.r[0] === x.r[0] && z.r === x.r);
          return `<td class="full" data-li="${ordinal(i + 1)}"><span class="mark" style="font-family:var(--font-display);font-weight:800;font-size:1.1rem">${markHTML(x.r[4], x.r[5], x.r)}</span> ${aLink(x.r[0])}${isAT ? ` <span class="chip ${at === 1 ? "sr" : "top"}">${at === 1 ? "Record" : "#" + at}</span>` : ""}</td>`; }).join("")}</tr>`;
    }).join("");
    const sTeam = seasonTeam(y), sPost = seasonPostseason(y), sPts = seasonPoints(y);
    html(`
      <section class="page-head"><span class="eyebrow">Season</span><h1>${y} Season</h1>
        ${jumpNav([sTeam ? ["s-team", "Team finishes"] : null, sPost ? ["s-post", "Postseason"] : null, sPts ? ["s-pts", "Top scorers"] : null,
          ["s-new", "All-time top 10"], ["s-B", "Boys leaders"], ["s-G", "Girls leaders"]])}</section>
      <div class="controls"><div class="ctl"><label for="sy">Season</label><select id="sy">${ys.concat(partialSeasons().slice().reverse()).map((s) => `<option${s === y ? " selected" : ""}>${s}${partialSeasons().includes(s) ? " (partial)" : ""}</option>`).join("")}</select></div></div>
      ${Object.entries(D.notes || {}).filter(([k]) => +k === y - 1 || +k === y + 1).map(([k, v]) => `<p class="note">${esc(v)}</p>`).join("")}
      <div class="stats">
        <div class="stat"><b>${ath.B.size}</b><span>Boys</span></div><div class="stat"><b>${ath.G.size}</b><span>Girls</span></div>
        <div class="stat"><b>${meets.size}</b><span>Meets</span></div><div class="stat"><b>${(res.length + rels.reduce((s, r) => s + r[6].length, 0)).toLocaleString()}</b><span>Performances</span></div>
      </div>
      ${jwrap("s-team", sTeam)}
      ${jwrap("s-post", sPost)}
      ${jwrap("s-pts", sPts)}
      <section class="section jump-target" id="s-new"><h2>On the all-time top 10</h2>${newTopTen(y, 10)}</section>
      ${["B", "G"].map((g) => `<section class="section jump-target" id="s-${g}"><h2>${G[g]} season leaders</h2>
        <div class="tbl-wrap stk"><table><thead><tr><th>Event</th><th>1st</th><th>2nd</th><th>3rd</th></tr></thead><tbody>${leaders(g)}</tbody></table></div></section>`).join("")}`);
    document.getElementById("sy").onchange = (ev) => { location.hash = "#/season/" + parseInt(ev.target.value, 10); };
  }

  function seasonPostseason(y) {
    const ps = postseasonIndex();
    const special = [["Champion", "State champions", (p) => p.champ], ["AllOhio", "All-Ohio", (p) => p.allOhio]].map(([k, label, get]) => {
      const hits = [];
      ps.forEach((p, a) => (get(p) || []).forEach((x) => { if (x.y === y) hits.push([a, x]); }));
      if (!hits.length) return "";
      return `<section class="panel ${k === "Champion" ? "panel-champ" : ""}"><h3>${k === "Champion" ? STAR : ""}${label} <span class="dim">(${hits.length})</span></h3>
        ${hits.map(([a, x]) => `<div class="leader" style="grid-template-columns:1fr auto"><span>${aLink(a)}<span class="s">${G[A[a][1]]} · ${esc(E[x.e].n)} · ${markHTML(x.mk, x.f, x.w)}</span></span><span class="v">${ordinal(x.pl)}</span></div>`).join("")}</section>`;
    });
    const blocks = special.concat(LEVELS.map((l) => {
      const byA = new Map();
      ps.forEach((p, a) => {
        if (!p.yrs[l.k] || !p.yrs[l.k].has(y)) return;
        let rows = p.rows.filter((x) => x.t === l.k && x.y === y);
        const q = (p.qual || []).filter((x) => x.t === l.k && x.y === y);
        if (!rows.length && !q.length) rows = p.rows.filter((x) => x.y === y && (x.t === "Regional" || x.t === "State")); // district final implied by a regional trip
        byA.set(a, new Set(rows.map((x) => E[x.e].n).concat(q.map((x) => `${E[x.e].n} (qualified, didn't compete)`))));
      });
      if (!byA.size) return "";
      const ids = [...byA.keys()].sort((p, q) => A[p][1].localeCompare(A[q][1]) || A[p][0].localeCompare(A[q][0]));
      return `<section class="panel"><h3>${l.label}s <span class="dim">(${ids.length})</span></h3>
        ${ids.map((a) => `<div class="leader" style="grid-template-columns:1fr"><span>${aLink(a)}<span class="s">${G[A[a][1]]} · ${esc([...byA.get(a)].join(", "))}</span></span></div>`).join("")}</section>`;
    })).filter(Boolean);
    if (!blocks.length) return "";
    return `<section class="section"><h2>Postseason</h2><div class="grid3">${blocks.join("")}</div></section>`;
  }

  // ---------- meets ----------
  const meetState = { y: "", q: "", t: "" };
  function pageMeets() {
    const st = meetState;
    const counts = M.map(() => 0);
    D.results.forEach((r) => counts[r[2]]++);
    D.relays.forEach((r) => (counts[r[1]] += r[6].length));
    const ids = M.map((_, i) => i).sort((a, b) => (M[a][0] < M[b][0] ? 1 : -1));
    const years = [...new Set(ids.map((i) => M[i][0].slice(0, 4)))].sort((a, b) => b - a);
    if (!st.y) st.y = years[0];
    const TYPES = [["", "All"], ["Dual/Tri", "Duals"], ["Invitational", "Invitationals"], ["post", "League & postseason"]];
    const typeOk = (i) => !st.t || (st.t === "post" ? ["League", "District", "Regional", "State"].includes(M[i][2]) : M[i][2] === st.t);
    html(`<section class="page-head"><span class="eyebrow">Meets</span><h1>Meet results</h1><p class="lede">Every meet with Bulldog results on file, newest first.</p></section>
      <div class="controls">
        <div class="ctl" style="flex:1 1 220px"><label for="mq">Meet name</label><input id="mq" class="plain" type="search" value="${esc(st.q)}" placeholder="e.g. Twilight, Revere, District"></div>
        <div class="ctl"><label for="my">Season</label><select id="my"><option value="all"${st.y === "all" ? " selected" : ""}>All seasons</option>${years.map((y) => `<option${y === st.y ? " selected" : ""}>${y}</option>`).join("")}</select></div>
        <div class="ctl"><span class="lbl">Type</span>${seg("mt", TYPES, st.t)}</div>
      </div>
      <div id="mlist"></div>`);
    const draw = () => {
      const q = st.q.trim().toLowerCase();
      // a search looks across every season; otherwise show the chosen season
      const pick = ids.filter((i) => typeOk(i) && (q ? M[i][1].toLowerCase().includes(q) || M[i][0].includes(q) : st.y === "all" || M[i][0].startsWith(st.y)));
      const byYear = {};
      pick.forEach((i) => (byYear[M[i][0].slice(0, 4)] = byYear[M[i][0].slice(0, 4)] || []).push(i));
      const ys = Object.keys(byYear).sort((a, b) => b - a);
      document.getElementById("mlist").innerHTML = `<p class="note" style="margin-bottom:10px">${pick.length} ${pick.length === 1 ? "meet" : "meets"}${q ? ` matching “${esc(st.q.trim())}” in every season` : ""}</p>
        ${ys.length ? ys.map((y) => `<section class="section"><h3>${y}</h3><div class="cards">
        ${byYear[y].map((i) => `<a class="card" href="#/meet/${i}"><span class="t">${esc(M[i][1])}</span><span class="m">${fmtDate(M[i][0])}${M[i][2] ? " · " + esc(M[i][2]) : ""} · ${counts[i]} performances</span></a>`).join("")}
        </div></section>`).join("") : `<p class="empty">No meets match.</p>`}`;
    };
    draw();
    document.getElementById("mq").oninput = (ev) => { st.q = ev.target.value; draw(); };
    document.getElementById("my").onchange = (ev) => { st.y = ev.target.value; st.q = ""; document.getElementById("mq").value = ""; draw(); };
    onSeg("mt", (v) => { st.t = v; document.querySelectorAll("#mt button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v))); draw(); });
  }
  function pageMeet(id) {
    const m = +id;
    if (!M[m]) return html(`<p class="empty">Meet not found. <a href="#/meets">All meets</a>.</p>`);
    const res = D.results.filter((r) => r[2] === m);
    const rels = D.relays.filter((r) => r[1] === m);
    const blocks = [];
    const plOf = (r) => (typeof r[6] === "number" && r[6] > 0 ? r[6] : 0);
    const hasPl = res.some(plOf) || rels.some((r) => r[7] > 0);
    const plTd = (p) => (hasPl ? `<td class="nowrap dim pl">${p ? ordinal(p) : ""}</td>` : "");
    for (const g of ["B", "G"]) {
      const evs = [...new Set(res.filter((r) => A[r[0]][1] === g).map((r) => r[1]))].sort((a, b) => E[a].o - E[b].o);
      for (const e of evs) {
        const rows = res.filter((r) => r[1] === e && A[r[0]][1] === g).sort((x, y) => (valid(x) && valid(y) ? cmp(e)(x[3], y[3]) : valid(x) ? -1 : 1));
        const rm = rankMap(e, g);
        blocks.push(`<tr class="ev-head${e === evs[0] ? " jump-target" : ""}"${e === evs[0] ? ` id="m-${g}"` : ""}><th colspan="${hasPl ? 4 : 3}">${G[g]} ${esc(E[e].n)}</th></tr>` + rows.map((r) => {
          const pr = isPR(r); const at = ranking(e, g).find((x) => x.r === r);
          return `<tr class="${valid(r) ? "" : "flag"}">${plTd(plOf(r))}<td class="mark">${r[5] & NOMARK ? nmHTML(r[4]) : markHTML(r[4], r[5], r)}${seriesBtn(r)}</td><td>${aLink(r[0])}</td>
          <td>${pr ? '<span class="chip is-pr">PR</span> ' : ""}${at && at.rank <= 10 ? `<span class="chip ${at.rank === 1 ? "sr" : "top"}">${at.rank === 1 ? "School record" : "#" + at.rank + " all-time"}</span>` : ""}${r[5] & PRELIM ? ' <span class="chip">Prelim</span>' : ""}</td></tr>${seriesRow(r, hasPl ? 4 : 3)}`;
        }).join(""));
      }
    }
    const relRows = rels.sort((a, b) => a[2].localeCompare(b[2]) || E[a[0]].o - E[b[0]].o).map((r) =>
      `<tr><td class="nowrap grow">${G[r[2]]} ${esc(E[r[0]].n)}</td>${plTd(r[7])}<td class="mark">${markHTML(r[4], r[5], r)}</td><td class="legs full">${relayLegs(r)}</td></tr>`).join("");
    const note = M[m][3] || "";
    const score = note.match(/Final score:\s*(.+?)(?=\s*\(|\.\s+[A-Z(]|\.?$)/);
    const yr = M[m][0].slice(0, 4);
    html(`<section class="page-head"><span class="eyebrow">${fmtDate(M[m][0])}${M[m][2] ? " · " + esc(M[m][2]) : ""}</span><h1>${esc(M[m][1])}</h1>
        ${note ? `<p class="meet-note">${score ? `<b>Final score: ${esc(score[1].trim())}</b>. ` + esc(note.replace(score[0], "").replace(/\s*\.\s*\./g, ".").replace(/^[\s.]+/, "")) : esc(note)}</p>` : ""}
        <p class="note"><a href="#/season/${yr}">${yr} season</a> · <a href="#/meets">All meets</a></p>
        ${res.length + rels.length > 25 ? jumpNav([res.some((r) => A[r[0]][1] === "B") ? ["m-B", "Boys events"] : null, res.some((r) => A[r[0]][1] === "G") ? ["m-G", "Girls events"] : null, rels.length ? ["m-rel", "Relays"] : null]) : ""}</section>
      ${blocks.length ? `<section class="section"><h2>Individual events</h2><div class="tbl-wrap"><table>${hasPl ? "<thead><tr><th>Place</th><th>Mark</th><th>Athlete</th><th></th></tr></thead>" : ""}<tbody>${blocks.join("")}</tbody></table></div></section>` : ""}
      ${relRows ? `<section class="section jump-target" id="m-rel"><h2>Relays</h2><div class="tbl-wrap stk"><table><thead><tr><th>Event</th>${hasPl ? "<th>Place</th>" : ""}<th>Mark</th><th>Team</th></tr></thead><tbody>${relRows}</tbody></table></div></section>` : ""}`);
  }
  function isPR(r) { // was this mark a PR at the time it was set?
    if (!valid(r)) return false;
    const e = r[1], d = dateOf(r[2]);
    for (const i of aRes[r[0]]) {
      const o = D.results[i];
      if (o === r || o[1] !== e || !valid(o)) continue;
      const od = dateOf(o[2]);
      if (od < d && !better(e, r[3], o[3])) return false;
      if (od === d && better(e, o[3], r[3])) return false;
    }
    return aRes[r[0]].some((i) => D.results[i] !== r && D.results[i][1] === e && dateOf(D.results[i][2]) < d && valid(D.results[i]));
  }

  // ---------- fun stats ----------
  const funState = { imp: null, impG: "B" };
  function pageFun() {
    const ys = seasons().slice().reverse();
    // roster size by season
    const roster = { B: ys.map(() => new Set()), G: ys.map(() => new Set()) };
    const yi = Object.fromEntries(ys.map((y, i) => [y, i]));
    const addTo = (a, y) => { const k = yi[y]; if (k !== undefined) roster[A[a][1]][k].add(a); };
    D.results.forEach((r) => addTo(r[0], yearOf(r[2])));
    D.relays.forEach((r) => r[6].forEach((l) => addTo(l[0], yearOf(r[1]))));
    // top-10 marks by season
    const t10 = ys.map(() => 0);
    const topCount = new Map();
    for (const g of ["B", "G"]) for (const e of eventsFor(g)) {
      for (const x of ranking(e, g)) { if (x.rank > 10) break; if (yi[yearOf(x.r[2])] !== undefined) t10[yi[yearOf(x.r[2])]]++; topCount.set(x.r[0], (topCount.get(x.r[0]) || 0) + 1); }
    }
    // records by age
    const recs = [];
    for (const g of ["B", "G"]) for (const e of eventsFor(g)) {
      const top = ranking(e, g); if (top.length) recs.push({ g, e, r: top[0].r });
    }
    recs.sort((a, b) => (dateOf(a.r[2]) < dateOf(b.r[2]) ? -1 : 1));
    // career counts
    const perf = A.map((_, a) => aRes[a].filter((i) => valid(D.results[i])).length + aRel[a].length);
    const evCount = A.map((_, a) => new Set(aRes[a].map((i) => D.results[i][1]).concat(aRel[a].map((i) => D.relays[i][0]))).size);
    const prs = A.map((_, a) => {
      const best = {}; let n = 0;
      aRes[a].map((i) => D.results[i]).filter(valid).sort((x, y) => (dateOf(x[2]) < dateOf(y[2]) ? -1 : 1)).forEach((r) => {
        if (best[r[1]] === undefined) best[r[1]] = r[3]; else if (better(r[1], r[3], best[r[1]])) { best[r[1]] = r[3]; n++; }
      });
      return n;
    });
    // biggest single-meet workload
    const day = new Map();
    D.results.forEach((r) => { const k = r[0] + "|" + r[2]; day.set(k, (day.get(k) || 0) + 1); });
    D.relays.forEach((r) => r[6].forEach((l) => { const k = l[0] + "|" + r[1]; day.set(k, (day.get(k) || 0) + 1); }));
    const busyDays = [...day.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    // meets
    const mc = M.map(() => 0);
    D.results.forEach((r) => mc[r[2]]++); D.relays.forEach((r) => (mc[r[1]] += r[6].length));
    const busyMeets = M.map((_, i) => i).sort((a, b) => mc[b] - mc[a]).slice(0, 8);

    const top = (arr, n, filt) => A.map((_, a) => a).filter((a) => !A[a][3] && (!filt || filt(a))).sort((x, y) => arr[y] - arr[x]).slice(0, n);
    const leaderList = (ids, val, sub) => ids.map((a, i) => `<div class="leader"><span class="n">${i + 1}</span><span>${aLink(a)}<span class="s">${sub(a)}</span></span><span class="v">${val(a)}</span></div>`).join("");
    const psTop = postseasonIndex().map((p, a) => {
      const ys = new Set([...(p.yrs.Regional || []), ...(p.yrs.State || [])]);
      return [a, ys.size, (p.yrs.State || new Set()).size];
    }).filter((x) => x[1] && !A[x[0]][3]).sort((x, y) => y[1] - x[1] || y[2] - x[2]).slice(0, 8);
    const topT = [...topCount.entries()].filter(([a]) => !A[a][3]).sort((a, b) => b[1] - a[1]).slice(0, 8);

    html(`
      <section class="page-head"><span class="eyebrow">Fun stats</span><h1>By the numbers</h1><p class="lede">Streaks, workhorses and golden eras pulled from every result on file.</p>
        ${jumpNav([["f-pts", "Point scorers"], ["f-old", "Oldest records"], ["f-t10", "Top-10 regulars"], ["f-work", "Workhorses"], ["f-pr", "PR machines"],
          ["f-busy", "Busiest days"], ["f-relay", "Relay regulars"], ["f-post", "Postseason regulars"], ["improvers", "Biggest improvers"]])}</section>
      <div class="grid2">
        ${barChart(ys.map(String), [{ name: "Boys", color: "var(--s-boys)", values: roster.B.map((s) => s.size) }, { name: "Girls", color: "var(--s-girls)", values: roster.G.map((s) => s.size) }],
          { title: "Athletes with a mark, by season", cap: "Anyone who recorded at least one result or relay leg.", short: (c) => "’" + c.slice(2) })}
        ${barChart(ys.map(String), [{ name: "Top-10 marks", color: "var(--s-boys)", values: t10 }],
          { title: "Golden eras", cap: "How many of today's all-time top-10 marks (boys + girls, individual events) were set each season.", short: (c) => "’" + c.slice(2) })}
      </div>
      ${(D.notes && Object.keys(D.notes).length) ? `<p class="note">${Object.values(D.notes).map(esc).join(" ")}</p>` : ""}
      ${jwrap("f-pts", pointsPanels())}
      <div class="grid3">
        <section class="panel jump-target" id="f-old"><h3>Oldest standing records</h3><p class="note">School records that have survived the longest.</p>
          ${recs.slice(0, 8).map((x, i) => `<div class="leader"><span class="n">${i + 1}</span><span><a href="#/top/${encodeURIComponent(E[x.e].k)}/${x.g}">${G[x.g]} ${esc(E[x.e].n)}</a><span class="s">${esc(nameOf(x.r[0]))} · ${fmtDate(dateOf(x.r[2]))}</span></span><span class="v">${markHTML(x.r[4], x.r[5], x.r)}</span></div>`).join("")}</section>
        <section class="panel jump-target" id="f-t10"><h3>Top-10 regulars</h3><p class="note">Most events where the athlete sits in the all-time top 10.</p>
          ${topT.map(([a, n], i) => `<div class="leader"><span class="n">${i + 1}</span><span>${aLink(a)}<span class="s">${G[A[a][1]]} · ${yearsLabel(a)}</span></span><span class="v">${n}</span></div>`).join("")}</section>
        <section class="panel jump-target" id="f-work"><h3>Workhorses</h3><p class="note">Most career performances, relay legs included.</p>
          ${leaderList(top(perf, 8), (a) => perf[a], (a) => `${G[A[a][1]]} · ${yearsLabel(a)}`)}</section>
        <section class="panel jump-target" id="f-pr"><h3>PR machines</h3><p class="note">Most times an athlete beat their own best.</p>
          ${leaderList(top(prs, 8), (a) => prs[a], (a) => `${G[A[a][1]]} · ${yearsLabel(a)}`)}</section>
        <section class="panel"><h3>Jack of all trades</h3><p class="note">Most different events contested, relays included.</p>
          ${leaderList(top(evCount, 8), (a) => evCount[a], (a) => `${G[A[a][1]]} · ${yearsLabel(a)}`)}</section>
        <section class="panel jump-target" id="f-busy"><h3>Busiest days</h3><p class="note">Most events by one athlete at a single meet.</p>
          ${busyDays.filter(([k]) => !A[+k.split("|")[0]][3]).map(([k, n], i) => { const [a, m] = k.split("|").map(Number);
            return `<div class="leader"><span class="n">${i + 1}</span><span>${aLink(a)}<span class="s"><a href="#/meet/${m}">${esc(M[m][1])}</a> · ${fmtDate(M[m][0])}</span></span><span class="v">${n}</span></div>`; }).join("")}</section>
        <section class="panel jump-target" id="f-relay"><h3>Relay regulars</h3><p class="note">Most relay legs run, field relays included.</p>
          ${leaderList(top(aRel.map((x) => x.length), 8), (a) => aRel[a].length, (a) => `${G[A[a][1]]} · ${yearsLabel(a)}`)}</section>
        <section class="panel"><h3>Biggest meets</h3><p class="note">Most Bulldog performances at one meet.</p>
          ${busyMeets.map((m, i) => `<div class="leader"><span class="n">${i + 1}</span><span><a href="#/meet/${m}">${esc(M[m][1])}</a><span class="s">${fmtDate(M[m][0])}</span></span><span class="v">${mc[m]}</span></div>`).join("")}</section>
        <section class="panel jump-target" id="f-post"><h3>Postseason regulars</h3><p class="note">Most seasons reaching regionals or state.</p>
          ${psTop.map(([a, n, st], i) => `<div class="leader"><span class="n">${i + 1}</span><span>${aLink(a)}<span class="s">${G[A[a][1]]} · ${st ? st + " at state" : "regionals"}</span></span><span class="v">${n}</span></div>`).join("")}</section>
      </div>
      <section class="section jump-target" id="improvers"></section>`);
    bindCharts();
    drawImprovers();
  }
  function pointsPanels() {
    const P = pointsIndex();
    if (!P.ys.length) return "";
    const row = (a, v, i, sub) => `<div class="leader"><span class="n">${i + 1}</span><span>${aLink(a)}<span class="s">${sub}</span></span><span class="v">${fmtPts(v)}</span></div>`;
    const career = (g) => [...P.career.entries()].filter(([a]) => A[a][1] === g && !A[a][3]).sort((x, y) => y[1] - x[1]).slice(0, 10)
      .map(([a, v]) => row(a, v, P.rank.get(a) - 1, `${yearsLabel(a)}`)).join("");
    const best = Object.entries(P.bySeason).flatMap(([y, l]) => l.map(([a, v]) => [a, +y, v])).filter(([a]) => !A[a][3])
      .sort((x, y) => y[2] - x[2]).slice(0, 10).map(([a, y, v], i) => row(a, v, i, `${G[A[a][1]]} · ${y} season`)).join("");
    return `<section class="section points-sec">
      <div class="section-head"><h2>Top point scorers</h2><span class="dim">Seasons with points on file: ${ptsYearsLabel(P.ys)}</span></div>
      <p class="note">Points each athlete scored for the team, from Track Central's scoring reports. Relay points are split evenly the same way every year: each runner gets a quarter of a 4-person relay's points (a third or half for 3- and 2-person field relays). JV meets, like the JV league meet, don't count. Career totals only count seasons on file, so they grow as more reports are added.</p>
      <div class="grid3">
        <section class="panel"><h3>Boys</h3><p class="note">Most points on file.</p>${career("B")}</section>
        <section class="panel"><h3>Girls</h3><p class="note">Most points on file.</p>${career("G")}</section>
        <section class="panel"><h3>Best single seasons</h3><p class="note">Most points in one season, boys and girls.</p>${best}</section>
      </div></section>`;
  }
  function drawImprovers() {
    const st = funState, g = st.impG;
    const evs = eventsFor(g);
    if (st.imp === null || !evs.includes(st.imp)) st.imp = evs.includes(eventByKey("1600M")) ? eventByKey("1600M") : evs[0];
    const e = st.imp;
    const rows = [];
    A.forEach((at, a) => {
      if (at[1] !== g || at[3]) return;
      const marks = aRes[a].map((i) => D.results[i]).filter((r) => r[1] === e && valid(r));
      if (marks.length < 2) return;
      const yrs = [...new Set(marks.map((r) => yearOf(r[2])))].sort();
      if (yrs.length < 2) return;
      const firstY = marks.filter((r) => yearOf(r[2]) === yrs[0]);
      const pick = (list) => list.reduce((b, r) => (b === null || better(e, r[3], b[3]) ? r : b), null);
      const f = pick(firstY), b = pick(marks);
      const gain = lower(e) ? (f[3] - b[3]) / f[3] : (b[3] - f[3]) / f[3];
      if (gain > 0) rows.push({ a, f, b, gain });
    });
    rows.sort((x, y) => y.gain - x.gain);
    const el = document.getElementById("improvers");
    el.innerHTML = `<div class="section-head"><h2>Most improved</h2><span class="note">First-season best compared with career best. Athletes with marks in two or more seasons.</span></div>
      <div class="controls"><div class="ctl"><span class="lbl">Team</span>${seg("ig", [["B", "Boys"], ["G", "Girls"]], g)}</div>
      <div class="ctl"><label for="ie">Event</label>${eventSelect("ie", evs, e)}</div></div>
      ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Athlete</th><th>First season</th><th>Career best</th><th>Improvement</th></tr></thead><tbody>
      ${rows.slice(0, 15).map((x, i) => `<tr><td class="rank">${i + 1}</td><td>${aLink(x.a)}</td><td class="nowrap"><span class="mark">${markHTML(x.f[4], x.f[5], x.f)}</span> <span class="dim">${yearOf(x.f[2])}</span></td>
        <td class="nowrap"><b class="mark">${markHTML(x.b[4], x.b[5], x.b)}</b> <span class="dim">${yearOf(x.b[2])}</span></td>
        <td class="nowrap"><b>${(x.gain * 100).toFixed(1)}%</b> <span class="dim">${lower(e) ? "−" : "+"}${fmtVal(e, Math.abs(x.f[3] - x.b[3]))}${lower(e) && Math.abs(x.f[3] - x.b[3]) < 60 ? "s" : ""}</span></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">Not enough multi-season athletes in this event yet.</p>`}`;
    onSeg("ig", (v) => { st.impG = v; drawImprovers(); });
    document.getElementById("ie").onchange = (ev) => { st.imp = eventByKey(ev.target.value); drawImprovers(); };
  }

  // ---------- data check ----------
  function pageCheck() {
    const R = D.review || {};
    const tbl = (head, rows) => rows.length ? `<div class="tbl-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : `<p class="empty">Nothing to check here.</p>`;
    const missing = R.relay_missing || [], marks = R.marks || [], splits = R.splits || [], dupes = R.dupes || [], names = R.names || [], legs = R.relay_legs || [], unk = R.unknown_event || [], bad = R.bad_row || [];
    html(`
      <section class="page-head"><span class="eyebrow">For coaches</span><h1>Data check</h1>
        <p class="lede">Things the website noticed while reading the Google Sheet. Fix them in the sheet and they disappear after the next update.</p>
        ${jumpNav([["c-cov", "What's on file"], missing.length ? ["c-miss", "Relays missing runners"] : null, ["c-marks", "Marks held back"], ["c-dupes", "Possible duplicates"],
          (R.first_names || []).length ? ["c-first", "Missing first names"] : null, ["c-names", "Name questions"], ["c-relay", "Relay questions"]])}</section>
      <div class="stats">
        <div class="stat"><b>${marks.length}</b><span>Marks held back</span></div><div class="stat"><b>${dupes.length}</b><span>Possible duplicates</span></div>
        <div class="stat"><b>${names.length + (R.first_names || []).length}</b><span>Name questions</span></div><div class="stat"><b>${splits.length + legs.length}</b><span>Relay questions</span></div>
      </div>
      ${jwrap("c-cov", coverageHTML())}
      ${jwrap("c-miss", missingRelaysHTML(missing))}
      <section class="section jump-target" id="c-marks"><h2>Marks held back from the lists</h2>
        <p class="note">Better than looks possible for the event, so they stay off the top lists. Fix the mark or event in the Results tab, or set Status to <b>OK</b> if it's real, or <b>Exclude</b> to hide it.</p>
        ${tbl(["Sheet row", "Athlete", "Event", "Mark", "Meet", "Date", "Why"], marks.map((x) => `<tr><td class="num">${x.row}</td><td>${esc(x.athlete)}</td><td>${esc(x.event)}</td><td class="mark">${esc(x.mark)}</td><td>${esc(x.meet)}</td><td class="nowrap dim">${esc(x.date)}</td><td class="dim">${esc(x.why)}</td></tr>`))}</section>
      <section class="section jump-target" id="c-dupes"><h2>Possibly the same athlete</h2>
        <p class="note">Similar first names, same last name, overlapping seasons. If they are one person, type the correct name in <b>Merge Into</b> on the Athletes tab for the other spelling.</p>
        ${tbl(["Team", "Name", "Seasons", "Name", "Seasons"], dupes.map((x) => `<tr><td>${G[x.gender]}</td><td>${esc(x.a)}</td><td class="dim">${esc(x.years_a)}</td><td>${esc(x.b)}</td><td class="dim">${esc(x.years_b)}</td></tr>`))}</section>
      ${jwrap("c-first", firstNamesHTML(R.first_names || []))}
      <section class="section jump-target" id="c-names"><h2>Name questions</h2>
        ${tbl(["Name", "Team", "Question"], names.map((x) => `<tr><td>${esc(x.athlete)}</td><td>${esc(x.gender === "B+G" ? "Both" : G[x.gender] || x.gender)}</td><td class="dim">${esc(x.why)}</td></tr>`))}</section>
      <section class="section jump-target" id="c-relay"><h2>Relay questions</h2>
        <p class="note">Relays list more runners than the event allows (often two teams with the same time, or a runner on the wrong roster), or a split that can't be right. Splits that look wrong are hidden.</p>
        ${tbl(["Event", "Meet", "Date", "Mark", "Issue"], legs.map((x) => `<tr><td>${esc(x.event)}</td><td>${esc(x.meet)}</td><td class="dim nowrap">${esc(x.date)}</td><td class="mark">${esc(x.mark)}</td><td class="dim">${x.legs} runners listed: ${esc(x.names.join("; "))}</td></tr>`)
          .concat(splits.map((x) => `<tr><td>${esc(x.event)}</td><td>${esc(x.meet)}</td><td class="dim nowrap">${esc(x.date)}</td><td class="mark">${esc(x.mark)}</td><td class="dim">Row ${x.row}, ${esc(x.athlete)}: split looks wrong</td></tr>`)))}</section>
      ${unk.length || bad.length ? `<section class="section"><h2>Rows the site couldn't read</h2>
        ${tbl(["Sheet row", "Athlete", "Event", "Meet", "Date", "Problem"], unk.map((x) => `<tr><td>${x.row}</td><td>${esc(x.athlete)}</td><td>${esc(x.event)}</td><td>${esc(x.meet)}</td><td>${esc(x.date)}</td><td class="dim">Event not in the Events tab</td></tr>`)
          .concat(bad.map((x) => `<tr><td>${x.row}</td><td>${esc(x.athlete)}</td><td>${esc(x.event)}</td><td>${esc(x.meet)}</td><td>${esc(x.date)}</td><td class="dim">${esc(x.why)}</td></tr>`)))}</section>` : ""}
      ${D.excluded ? `<p class="note">${D.excluded} rows are marked Exclude in the sheet and are not shown anywhere.</p>` : ""}`);
    wireCoverage();
  }

  // Athletes typed with a last name only (or first initial + last name), e.g. from old dual-meet score sheets
  function firstNamesHTML(list) {
    if (!list.length) return "";
    const rows = list.slice().sort((x, y) => (y.years || "").localeCompare(x.years || "") || x.athlete.localeCompare(y.athlete));
    return `<section class="section"><h2>Missing first names <span class="dim">(${list.length})</span></h2>
      <p class="note">These athletes are on file with only a last name, or an initial and last name, usually because the score sheet only listed that much. When you know who it is, go to the Athletes tab, find the name in the first column, and type the full name (Last, First) in <b>Merge Into</b>. If the person is already on the roster, their marks combine.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Name on file</th><th>Team</th><th>Seasons</th><th>Marks</th><th>Meets</th><th>Could be</th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td><b>${esc(x.athlete)}</b></td><td>${esc(G[x.gender] || x.gender)}</td><td class="nowrap">${esc(x.years)}</td><td class="num">${x.n}</td>
        <td class="dim">${esc(x.meets.join("; "))}</td><td>${x.maybe.length ? esc(x.maybe.join(", ")) : '<span class="dim">No one on the roster with that name nearby</span>'}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  // Relays on file with fewer runners than the event needs: a to-do list, newest first
  function missingRelaysHTML(list) {
    if (!list.length) return "";
    const rows = list.slice().sort((p, q) => q.date.localeCompare(p.date) || p.event.localeCompare(q.event)).map((x) => {
      const short = x.want - x.names.length;
      const ord = x.place ? `${x.place}${["th", "st", "nd", "rd"][(x.place % 100 > 10 && x.place % 100 < 14) ? 0 : x.place % 10] || "th"}` : "";
      const known = x.names.length ? x.names.map((n) => esc(n.split(",").reverse().join(" ").trim())).join(", ") : "";
      return `<tr><td class="nowrap">${G[x.g]} ${esc(x.event)}${x.prelim ? ' <span class="dim">prelim</span>' : ""}</td><td class="mark">${esc(x.mark)}</td>
        <td>${esc(x.meet)}</td><td class="dim nowrap">${esc(fmtDate(x.date))}</td><td class="num">${ord}</td>
        <td class="dim miss-who">${known ? `${known} <b class="miss-n">+${short} missing</b>` : `<b class="miss-n">All ${x.want} missing</b>`}</td></tr>`;
    }).join("");
    const runners = list.reduce((s, x) => s + x.want - x.names.length, 0);
    return `<section class="section"><h2>Relays missing runners (${list.length})</h2>
      <p class="note">These teams are on file with fewer runners than the relay needs (${runners} runners in all). They still count on the lists. To fill one in, add a row on the Results tab for each runner with the same Gender, Event, Meet, Date and Relay Total. Once all the runners are in, delete any row whose Athlete is <b>Unknown</b>.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Relay</th><th>Time</th><th>Meet</th><th>Date</th><th>Place</th><th>Runners on file</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  // Coverage checklist: which seasons and postseason meets are on file, per team.
  const COV = {
    complete: ["✓", "Complete", "Official results on file (or the season's Track Central history)"],
    none: ["–", "No Green athletes", "Results checked: no Green athletes in them"],
    partial: ["½", "Partial", "Some results on file, some still missing or TBD"],
    tc: ["TC", "Track Central only", "Only Track Central rows. Official results would add places and prelims"],
    missing: ["✗", "Missing", "Green competed but the results aren't on file"],
    unknown: ["?", "Not on file", "Not on file. There may have been nothing to find"],
    notyet: ["○", "Points not imported", "Track Central scoring report for this season not imported yet"],
  };
  const COV_LEVELS = ["Season", "League", "District", "Regional", "State", "Points"];
  const covChip = (st, note) => `<span class="cv cv-${st}" data-st="${st}" title="${esc(COV[st][1] + (note ? ": " + note : ""))}" data-note="${esc(note || "")}">${COV[st][0]}</span>`;

  function coverageHTML() {
    const C = D.coverage;
    if (!C || !C.seasons || !C.seasons.length) return "";
    const cell = (y, g, l) => (C.cells || {})[`${y}|${g}|${l}`];
    const counts = {};
    Object.values(C.cells || {}).forEach(([st]) => { counts[st] = (counts[st] || 0) + 1; });
    const linkable = new Set(seasons().map(String));
    const rows = C.seasons.slice().reverse().map(([y, note]) => {
      const yr = linkable.has(String(y)) ? `<a href="#/season/${y}">${y}</a>` : y;
      if (note) return `<tr><th class="yr" scope="row">${yr}</th><td class="off" colspan="${COV_LEVELS.length * 2}">${esc(note)}</td></tr>`;
      return `<tr><th class="yr" scope="row">${yr}</th>${["B", "G"].map((g) => COV_LEVELS.map((l, k) => {
        const c = cell(y, g, l);
        return `<td${k === 0 ? ' class="gsep"' : ""}>${c ? covChip(c[0], c[1]) : ""}</td>`;
      }).join("")).join("")}</tr>`;
    }).join("");

    // To-do list: one line per season + level, combining boys and girls when they match.
    const groups = [
      ["missing", "Missing: Green competed, results not on file", (l) => true],
      ["partial", "Partial: some results still to fill in", (l) => l !== "League"],
      ["tc", "Track Central only: official results would add places and prelims", (l) => l !== "Season"],
      ["unknown", "Not on file: check whether Green had qualifiers", (l) => l === "Regional" || l === "State"],
    ];
    const todo = groups.map(([st, label, want]) => {
      const items = [];
      C.seasons.slice().reverse().forEach(([y, note]) => {
        if (note) return;
        COV_LEVELS.filter(want).forEach((l) => {
          const b = cell(y, "B", l), g = cell(y, "G", l);
          const teams = [b && b[0] === st ? ["Boys", b[1]] : null, g && g[0] === st ? ["Girls", g[1]] : null].filter(Boolean);
          if (!teams.length) return;
          const same = teams.length === 2 && teams[0][1] === teams[1][1];
          const notes = same || teams.length === 1 ? esc(teams[0][1]) : teams.map(([t, n]) => `${t}: ${esc(n)}`).join("<br>");
          items.push(`<li class="p-${st}"><span class="box" aria-hidden="true"></span><b>${y} ${l === "Season" ? "regular season" : l.toLowerCase()} · ${teams.map((t) => t[0]).join(" & ")}</b><small>${notes}</small></li>`);
        });
      });
      return items.length ? `<h3 class="todo-group">${esc(label)} (${items.length})</h3><ul class="todo">${items.join("")}</ul>` : "";
    }).join("");

    // Scoring reports: one line per team listing the seasons still to import
    const ptsMiss = ["B", "G"].map((g) => [g, C.seasons.filter(([y, n]) => !n && (cell(y, g, "Points") || [])[0] === "notyet").map(([y]) => y)]).filter(([, ys]) => ys.length);
    const ptsTodo = ptsMiss.length ? `<h3 class="todo-group">Points: Track Central scoring reports to import</h3><ul class="todo">${ptsMiss.map(([g, ys]) =>
      `<li class="p-partial"><span class="box" aria-hidden="true"></span><b>${G[g]} · ${ys.length} ${ys.length === 1 ? "season" : "seasons"}</b><small>${ptsYearsLabel(ys)}. In Track Central, print <i>Scoring Performances</i> for each season and import it.</small></li>`).join("")}</ul>` : "";
    // League: one line per team listing the seasons that still need the team place
    const lgNeed = ["B", "G"].map((g) => [g, C.seasons.filter(([y, n]) => !n && (cell(y, g, "League") || [])[0] === "partial").map(([y]) => y)]).filter(([, ys]) => ys.length);
    const lgOdd = [];
    C.seasons.slice().reverse().forEach(([y, n]) => { if (n) return; ["B", "G"].forEach((g) => { const c = cell(y, g, "League"); if (c && c[0] === "partial" && /Few results|points not on file/.test(c[1])) lgOdd.push(`${y} ${G[g].toLowerCase()}: ${esc(c[1].replace(/\. Need:.*?\(Team Results tab\)/, ""))}`); }); });
    const lgTodo = lgNeed.length ? `<h3 class="todo-group">League: team places to add</h3><ul class="todo">${lgNeed.map(([g, ys]) =>
      `<li class="p-partial"><span class="box" aria-hidden="true"></span><b>${G[g]} · ${ys.length} ${ys.length === 1 ? "season" : "seasons"}</b><small>${ptsYearsLabel(ys)}. Green's league meet results are on file; add Green's place, the number of teams and the winner in the Team Results tab (Level: League).</small></li>`).join("")}
      ${lgOdd.length ? `<li class="p-partial"><span class="box" aria-hidden="true"></span><b>League meet results to double-check</b><small>${lgOdd.join("<br>")}</small></li>` : ""}</ul>` : "";
    return `<section class="section"><h2>What's on file</h2>
      <p class="note">Every season's results for each team: the regular season, the varsity league meet (JV league meets don't count), district, regional and state, plus whether its points (Track Central scoring report) are in. League is only complete once Green's team place is in the Team Results tab. The website fills this in from the Results tab and from each results file a coach has imported; use the <b>Coverage</b> tab in the sheet to mark something Partial or Missing, or to add a note. Hover over or tap a box for details, and tap a status above the grid to highlight it.</p>
      <div class="cov-sum" id="covsum">${Object.keys(COV).filter((k) => counts[k]).map((k) =>
        `<button type="button" data-st="${k}" aria-pressed="false">${covChip(k, "")}${esc(COV[k][1])} <span class="dim">${counts[k]}</span></button>`).join("")}</div>
      <div class="cov-wrap"><table class="cov" id="covt"><thead>
        <tr><th rowspan="2"></th><th colspan="${COV_LEVELS.length}" class="gsep">Boys</th><th colspan="${COV_LEVELS.length}" class="gsep">Girls</th></tr>
        <tr>${["B", "G"].map(() => COV_LEVELS.map((l, k) => `<th${k === 0 ? ' class="gsep"' : ""}><span class="full">${l}</span><span class="abbr" aria-hidden="true">${{ Season: "Szn", League: "Lg", District: "Dist", Regional: "Reg", State: "St", Points: "Pts" }[l]}</span></th>`).join("")).join("")}</tr>
      </thead><tbody>${rows}</tbody></table></div></section>
      <section class="section"><h2>Still to find</h2>
        <p class="note">Newest first. Check off a line by importing the results file (or entering the results); it drops off this list after the next update.</p>
        ${todo || lgTodo || ptsTodo ? todo + lgTodo + ptsTodo : `<p class="empty">Nothing missing. Every season is on file.</p>`}</section>`;
  }

  function wireCoverage() {
    const t = document.getElementById("covt"), sum = document.getElementById("covsum");
    if (!t) return;
    t.querySelectorAll(".cv").forEach((el) => {
      const st = el.dataset.st, note = el.dataset.note;
      el.removeAttribute("title");
      tipOn(el, `<b>${esc(COV[st][1])}</b>${note ? "<br>" + esc(note) : ""}`);
    });
    let on = "";
    sum.addEventListener("click", (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      on = on === b.dataset.st ? "" : b.dataset.st;
      sum.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.st === on)));
      t.classList.toggle("dimmed", !!on);
      t.querySelectorAll(".cv").forEach((el) => el.classList.toggle("hl", el.dataset.st === on));
    });
  }

  function pageAbout() {
    const ys = seasons(), first = ys[ys.length - 1], last = ys[0];
    const oldest = Math.min(...M.map((m) => +m[0].slice(0, 4)));
    html(`<section class="page-head"><span class="eyebrow">About</span><h1>About the record book</h1></section>
      <div class="prose">
        <p>This site collects every Green High School track and field result we have on file: full seasons from ${first} to ${last}${partialSeasons().length ? `, partial seasons from ${spanTxt(partialSeasons())} rebuilt from the team's scorebooks` : ""}${oldest < first ? `, plus district, regional and state meet results back to ${oldest}` : ""}. It started from the team's Track Central history, adds official OHSAA tournament results, and is kept up to date by the coaching staff.</p>
        <h3>How the lists work</h3>
        <ul>
          <li><b>School records</b> are the best mark on file for each event. Regular-season results from before ${partialSeasons()[0] || first} aren't in the database yet${partialSeasons().length ? `, and ${spanTxt(partialSeasons())} are only partly there` : ""}, so an older record may still be out there. Coaches add them as they turn up.</li>
          <li><b>Former school record holders</b> are athletes who set or tied the standing record and were later passed.</li>
          <li><b>Postseason badges</b> on athlete pages come from district, regional and state meets: district finalist, regional and state qualifier, All-Ohio (top 8 at state) and state champion.</li>
          <li><b>Hand times</b> are marked with an “h”. On the top lists you can show them as recorded, convert them (+0.24s for sprints and hurdles, +0.14s for 400m and longer), or leave them out.</li>
          <li><b>Prelims</b> count toward the lists and are labeled.</li>
          <li><b>Relays</b> are grouped from each runner's entry: same event, meet, date and team time.</li>
          <li>Marks that look impossible for the event are held back until a coach checks them on the <a href="#/check">Data check</a> page, which also tracks which seasons' results are still missing.</li>
        </ul>
        <h3>For coaches</h3>
        <p>The <a href="#/check">Data check</a> page lists marks held back for a second look, possible duplicates, missing first names and which seasons' results are still missing.</p>
        <h3>Something wrong or missing?</h3>
        <p>Tell a Green track coach. Corrections go into the team's records sheet, and the site picks them up on its next update.</p>
      </div>`);
  }

  // ---------- quick search ----------
  function setupSearch() {
    const q = document.getElementById("q"), box = document.getElementById("qres");
    let sel = 0, links = [];
    // Words people type for events, mapped onto the words in our event names.
    const ALIAS = { mile: "1600", "1600m": "1600", "2mile": "3200", "two-mile": "3200", "3200m": "3200", "half": "800", "880": "800",
      quarter: "400", "440": "400", dash: "", meter: "", meters: "", m: "", run: "", hurdle: "hurdles", hh: "hurdles", ih: "hurdles",
      shot: "shot", sp: "shot", disc: "discus", dt: "discus", pv: "pole", vault: "vault", hj: "high", lj: "long", jump: "jump",
      "4x1": "4x100", "4x2": "4x200", "4x4": "4x400", "4x8": "4x800", relays: "relay", smr: "sprint", dmr: "distance", shuttle: "shuttle" };
    const GENDER = { boys: "B", boy: "B", men: "B", mens: "B", girls: "G", girl: "G", women: "G", womens: "G", mixed: "X" };
    const PAGES = [["Records board", "#/", "records school board"], ["Top lists", "#/top", "top lists all-time rankings"], ["Relays", "#/relays", "relays"],
      ["All athletes", "#/athletes", "athletes roster"], ["Seasons", "#/season", "seasons season year"], ["Team finishes", "#/team", "team titles championships district regional state team scores"], ["Meet results", "#/meets", "meets results"],
      ["Fun stats", "#/fun", "fun stats numbers"], ["What if", "#/whatif", "what if compare postseason district regional state another year"], ["Data check", "#/check", "data check coverage missing coaches"], ["About", "#/about", "about help"]];
    let evText = null;
    const eventText = () => evText || (evText = E.map((e) => {
      const n = e.n.toLowerCase(), k = e.k.toLowerCase();
      const extra = /^(1600)/.test(n) ? " mile" : /^3200/.test(n) ? " two mile 2mile" : /^800m$/.test(n) ? " half" : "";
      return `${n} ${k} ${n.replace(/m\b/g, "")}${extra}`.replace(/\s+/g, " ");
    }));
    const norm = (str) => str.toLowerCase().replace(/[’']/g, "").replace(/(\d)\s*x\s*(\d)/g, "$1x$2").replace(/\b2 mile\b|\btwo mile\b/g, "2mile").trim();
    const yearTok = (w) => (/^(19|20)\d\d$/.test(w) ? +w : /^’?'?\d\d$/.test(w) && w.length <= 3 ? 2000 + +w.replace(/\D/g, "") : 0);
    const has = (text, w) => text.includes(w) || (w.length > 3 && w.endsWith("s") && text.includes(w.slice(0, -1)));

    function search(raw) {
      const words = norm(raw).split(/[\s,]+/).filter(Boolean);
      let g = "", year = 0;
      const rest = [];
      words.forEach((w) => { if (GENDER[w]) g = GENDER[w]; else if (yearTok(w) && !year && words.length > 1 || /^(19|20)\d\d$/.test(w)) year = yearTok(w); else rest.push(w); });
      const groups = [];
      // athletes
      if (rest.length) {
        const ath = [];
        A.forEach((at, i) => {
          if (at[3] || (g && g !== "X" && at[1] !== g)) return;
          const full = nameOf(i).toLowerCase(), last = at[0].split(",")[0].toLowerCase();
          if (!rest.every((w) => full.includes(w))) return;
          if (year && !athleteYears(i).includes(year)) return;
          const starts = rest.every((w) => full.split(/[\s-]+/).some((p) => p.startsWith(w)));
          ath.push([i, (last.startsWith(rest[0]) ? 4 : 0) + (starts ? 2 : 0), aRes[i].length + aRel[i].length]);
        });
        ath.sort((x, y) => y[1] - x[1] || y[2] - x[2]);
        if (ath.length) groups.push(["Athletes", ath.length, ath.map(([i]) => {
          const ch = postseasonIndex()[i].champ;
          return { href: `#/a/${slugOf[i]}`, t: nameOf(i), s: `${G[A[i][1]]} · ${yearsLabel(i)}${ch && ch.length ? " · State champion" : ""}` };
        })]);
      }
      // events (top lists) — every typed word must be in the event name, after aliases
      const evWords = rest.map((w) => (w in ALIAS ? ALIAS[w] : w)).filter(Boolean);
      if (evWords.length) {
        const txt = eventText(), ev = [];
        E.forEach((e, i) => {
          if (!evWords.every((w) => txt[i].includes(w))) return;
          const relay = e.t === "relay" || e.t === "frelay";
          for (const gg of g ? [g] : ["B", "G", "X"]) {
            const top = relay ? relayRanking(i, gg) : gg === "X" ? [] : ranking(i, gg);
            if (!top.length) continue;
            const r = top[0].r;
            const who = relay ? relayWho(r) : nameOf(r[0]);
            ev.push({ href: `#/${relay ? "relays" : "top"}/${encodeURIComponent(e.k)}/${gg}`,
              t: `${G[gg]} ${gg === "X" ? e.n.replace(/^Mixed /, "") : e.n}`, s: `Record ${r[4]}${r[5] & HAND ? "h" : ""} · ${who} · ${yearOf(relay ? r[1] : r[2])}` });
          }
        });
        if (ev.length) groups.push(["Events & records", ev.length, ev]);
      }
      // meets — newest first; a year narrows it down ("district 2024")
      if (rest.length || year) {
        const mt = [];
        for (let i = M.length - 1; i >= 0; i--) {
          const m = M[i], text = `${m[1]} ${m[2] || ""}`.toLowerCase();
          if (year && +m[0].slice(0, 4) !== year) continue;
          if (!rest.every((w) => has(text, w))) continue;
          mt.push(i);
        }
        mt.sort((x, y) => (M[x][0] < M[y][0] ? 1 : -1));
        if (mt.length) groups.push(["Meets", mt.length, mt.map((i) => ({ href: `#/meet/${i}`, t: M[i][1], s: `${fmtDate(M[i][0])}${M[i][2] ? " · " + M[i][2] : ""}` }))]);
      }
      // seasons
      if (year && seasons().includes(year)) groups.unshift(["Season", 1, [{ href: `#/season/${year}`, t: `${year} season`, s: "Every Bulldog mark that year" }]]);
      // pages
      if (rest.length && !year) {
        const pg = PAGES.filter(([, , k]) => rest.every((w) => k.includes(w)));
        if (pg.length) groups.push(["Pages", pg.length, pg.map(([t, href]) => ({ href, t, s: "" }))]);
      }
      const order = ["Season", "Events & records", "Athletes", "Meets", "Pages"];
      return groups.sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]));
    }

    const draw = () => {
      const raw = q.value.trim();
      if (raw.length < 2 && !/^\d$/.test(raw)) {
        box.innerHTML = `<div class="qhint">Search athletes, events and meets. Try <button type="button">mile</button> <button type="button">pole vault</button> <button type="button">district 2024</button> <button type="button">girls 4x400</button>.</div>`;
        links = []; box.hidden = document.activeElement !== q; return;
      }
      const groups = search(raw);
      const per = groups.length > 1 ? 5 : 12;
      links = [];
      box.innerHTML = groups.length ? groups.map(([label, total, items]) => {
        const shown = items.slice(0, per);
        return `<div class="qgroup"><div class="qlabel">${esc(label)}${total > shown.length ? ` <span>${shown.length} of ${total}</span>` : ""}</div>${shown.map((x) => {
          links.push(x.href);
          return `<a href="${x.href}"><span>${esc(x.t)}</span>${x.s ? `<small>${esc(x.s)}</small>` : ""}</a>`;
        }).join("")}</div>`;
      }).join("") : `<div class="empty">Nothing matches “${esc(raw)}”. Try a last name, an event like <b>1600</b> or <b>shot put</b>, or a meet like <b>district 2024</b>.</div>`;
      sel = 0; mark();
      box.hidden = false;
    };
    const mark = () => box.querySelectorAll("a").forEach((a, k) => { a.classList.toggle("on", k === sel); if (k === sel) a.scrollIntoView({ block: "nearest" }); });
    const close = () => { box.hidden = true; };
    q.addEventListener("input", draw);
    q.addEventListener("focus", draw);
    q.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { close(); q.blur(); return; }
      if (box.hidden || !links.length) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault(); sel = (sel + (ev.key === "ArrowDown" ? 1 : links.length - 1)) % links.length; mark();
      } else if (ev.key === "Enter") { ev.preventDefault(); location.hash = links[sel]; close(); q.value = ""; q.blur(); }
    });
    box.addEventListener("mousedown", (ev) => { if (ev.target.closest(".qhint button")) ev.preventDefault(); });
    box.addEventListener("click", (ev) => {
      const b = ev.target.closest(".qhint button");
      if (b) { q.value = b.textContent; q.focus(); draw(); return; }
      if (ev.target.closest("a")) { close(); q.value = ""; }
    });
    document.addEventListener("click", (ev) => { if (!ev.target.closest(".search")) close(); });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { ev.preventDefault(); q.focus(); }
    });
  }

  // ---------- team results ----------
  const TEAM_LV = ["District", "Regional", "State"];
  const TROPHY = `<svg class="trophy" viewBox="0 0 64 64" aria-hidden="true"><path d="M18 6h28v8h10v6c0 8-6 14-13 15-2 6-6 9-9 10v7h9v6H21v-6h9v-7c-3-1-7-4-9-10C14 34 8 28 8 20v-6h10V6zm-4 14c0 4 3 8 6 9-1-3-2-6-2-9v-1h-4v1zm32 0c0 3-1 6-2 9 3-1 6-5 6-9v-1h-4v1z" fill="currentColor"/></svg>`;
  const teamPlace = (t) => t.pl ? `${t.tie ? "T-" : ""}${ordinal(t.pl)}` : "";
  const teamLvName = (t) => (TEAM_LV.includes(t.lv) || t.lv === "League" ? t.lv : t.m || t.lv);
  // Team championships: league and OHSAA tournament titles only (invitational wins still show on the Team page)
  const CHAMP_LV = new Set(["League", "District", "Regional", "State", "Indoor State"]);
  function teamTitles() { return (D.team || []).filter((t) => t.pl === 1 && CHAMP_LV.has(t.lv)); }
  function teamTitlesHTML() {
    const titles = teamTitles();
    const best = {};
    (D.team || []).forEach((t) => { if (t.pl > 1 && CHAMP_LV.has(t.lv)) { const k = t.g + t.lv; if (!best[k] || t.pl < best[k].pl) best[k] = t; } });
    const top = Object.values(best).filter((t) => t.pl <= 3).sort((a, b) => a.pl - b.pl || b.y - a.y).slice(0, 4);
    if (!titles.length && !top.length) return "";
    return `<section class="section"><div class="section-head"><h2>${TROPHY}Team championships</h2><a href="#/team">Every team finish →</a></div>
      <div class="team-roll">${titles.map((t) => `<a class="team-card" href="#/team">${TROPHY}
        <span><span class="tc-year">${t.y}</span><span class="tc-name">${G[t.g]} ${esc(teamLvName(t))} Champions</span>
        <span class="tc-ev">${t.pts != null ? `${fmtPts(t.pts)} points` : ""}${t.note ? ` · ${esc(t.note)}` : ""}</span></span></a>`).join("")}
        ${top.map((t) => `<a class="team-card runner" href="#/team"><span class="tc-pl">${teamPlace(t)}</span>
        <span><span class="tc-year">${t.y}</span><span class="tc-name">${G[t.g]} ${esc(teamLvName(t))}${t.pl === 2 && !t.tie ? " runner-up" : ""}</span>
        <span class="tc-ev">${t.pts != null ? `${fmtPts(t.pts)} points` : ""}${t.n ? ` · ${t.n} teams` : ""}${t.win ? ` · won by ${esc(t.win)}${t.wp != null ? ` (${fmtPts(t.wp)})` : ""}` : ""}</span></span></a>`).join("")}</div></section>`;
  }
  function teamCell(t, lv) {
    const dl = lv ? ` data-l="${esc(lv)}"` : "";
    if (!t) return `<td class="tm-cell none"${dl}></td>`;
    const tip = [t.win && t.pl !== 1 ? `Won by ${t.win}${t.wp != null ? ` (${fmtPts(t.wp)})` : ""}` : "", t.note, t.src].filter(Boolean).join(" · ");
    if (!t.pl && t.pts != null) return `<td class="tm-cell"${dl} title="${esc(tip)}"><b>${fmtPts(t.pts)} ${t.pts === 1 ? "pt" : "pts"}</b><span class="tm-ref">${esc(t.m || "")}${t.m ? " · " : ""}place not on file</span></td>`;
    if (!t.pl) return `<td class="tm-cell zero"${dl} title="${esc(tip)}"><span class="dim">No points</span>${t.n ? `<span class="tm-ref">${t.n} teams scored</span>` : ""}</td>`;
    return `<td class="tm-cell${t.pl === 1 ? " win" : t.pl <= 3 ? " pod" : ""}"${dl} title="${esc(tip)}"><b>${t.pl === 1 ? `${TROPHY}Champions` : teamPlace(t)}</b>${t.n ? ` <span class="dim">of ${t.n}</span>` : ""}
      <span class="tm-ref">${t.pts != null ? `${fmtPts(t.pts)} ${t.pts === 1 ? "pt" : "pts"}` : ""}${t.pl !== 1 && t.win ? ` · won by ${esc(t.win)}` : ""}</span></td>`;
  }
  function pageTeam() {
    const T = D.team || [];
    const lvls = TEAM_LV.concat([...new Set(T.map((t) => t.lv).filter((l) => !TEAM_LV.includes(l)))]);
    const titles = teamTitles();
    const scored = (g, lv) => T.filter((t) => t.g === g && t.lv === lv && t.pl);
    const bestOf = (g, lv) => scored(g, lv).sort((a, b) => a.pl - b.pl || b.y - a.y)[0];
    const table = (g) => {
      const rows = T.filter((t) => t.g === g);
      if (!rows.length) return "";
      const ys = [...new Set(rows.map((t) => t.y))].sort((a, b) => b - a);
      // district / regional / state get a column; league and invitational finishes are too sparse for one, so they're listed underneath
      const COLS = ["League"].concat(TEAM_LV);
      const cols = COLS.filter((lv) => rows.some((t) => t.lv === lv));
      const other = rows.filter((t) => !COLS.includes(t.lv) && (t.pl || t.n)).sort((a, b) => b.y - a.y);
      const tys = [...new Set(rows.filter((t) => COLS.includes(t.lv)).map((t) => t.y))].sort((a, b) => b - a);
      const at = (y, lv) => rows.find((t) => t.y === y && t.lv === lv);
      return `<section class="section jump-target" id="t-${g}"><h2>${G[g]}</h2><div class="tbl-wrap stk"><table class="tm-table"><thead><tr><th>Season</th>${cols.map((lv) => `<th>${esc(lv)}</th>`).join("")}</tr></thead><tbody>
        ${tys.map((y) => `<tr><td class="nowrap full"><b>${y}</b></td>${cols.map((lv) => teamCell(at(y, lv), lv)).join("")}</tr>`).join("")}</tbody></table></div>
        ${other.length ? `<div class="section-head"><h3>Other team finishes</h3></div><div class="team-chips">${other.map((t) => `<span class="team-chip${t.pl === 1 ? " win" : ""}" title="${esc([t.win && t.pl !== 1 ? "Won by " + t.win : "", t.note, t.src].filter(Boolean).join(" · "))}"><b>${t.y} ${esc(teamLvName(t))}</b> ${t.pl ? `${t.pl === 1 ? "Champions" : teamPlace(t)}${t.n ? ` of ${t.n}` : ""}${t.pts != null ? ` · ${fmtPts(t.pts)} pts` : ""}` : "no points"}</span>`).join("")}</div>` : ""}</section>`;
    };
    html(`
      <section class="page-head"><span class="eyebrow">Team results</span><h1>Team finishes</h1>
        <p class="lede">Where the Bulldogs finished as a team at the league meet, district, regional and state, season by season.</p>
        ${jumpNav([T.some((t) => t.g === "B") ? ["t-B", "Boys"] : null, T.some((t) => t.g === "G") ? ["t-G", "Girls"] : null])}</section>
      <div class="stats">
        <div class="stat"><b>${titles.length}</b><span>Team ${titles.length === 1 ? "title" : "titles"}</span></div>
        ${["B", "G"].map((g) => TEAM_LV.map((lv) => { const b = bestOf(g, lv); return b ? `<div class="stat"><b>${teamPlace(b)}</b><span>Best ${G[g].toLowerCase()} ${lv.toLowerCase()} · ${b.y}</span></div>` : ""; }).join("")).join("")}
      </div>
      ${titles.length ? `<section class="section"><div class="team-roll">${titles.map((t) => `<div class="team-card">${TROPHY}<span><span class="tc-year">${t.y}</span><span class="tc-name">${G[t.g]} ${esc(teamLvName(t))} Champions</span><span class="tc-ev">${t.pts != null ? `${fmtPts(t.pts)} points` : ""}${t.note ? ` · ${esc(t.note)}` : ""}</span></span></div>`).join("")}</div></section>` : ""}
      ${table("B")}${table("G")}
      <p class="note">District, regional and state finishes from 2001 on come from the team scores printed in the official results, or are worked out from the finals (10-8-6-5-4-3-2-1 for the top eight) where the results copy has no team scores. Older seasons, and league or invitational titles, come from the Team Results tab in the sheet. Invitational wins are listed here but don't count as team championships. League: Green's points at the varsity league meet (Suburban League through 2015, Federal League since), from the Track Central scoring reports; JV league meets don't count. Only a few league places are on file so far; coaches can add the rest in the Team Results tab. Hover over or tap a box for the winner and source. A blank box means that meet isn't on file.</p>`);
  }
  function seasonTeam(y) {
    const T = (D.team || []).filter((t) => t.y === y && (t.pl || t.n || t.pts != null));
    const LV_ORDER = ["League"].concat(TEAM_LV);
    if (!T.length) return "";
    return `<section class="section"><div class="section-head"><h2>Team finishes</h2><a href="#/team">All seasons →</a></div>
      <div class="team-chips">${["B", "G"].map((g) => T.filter((t) => t.g === g).sort((a, b) => LV_ORDER.indexOf(a.lv) - LV_ORDER.indexOf(b.lv)).map((t) =>
        `<span class="team-chip${t.pl === 1 ? " win" : ""}" title="${esc([t.win && t.pl !== 1 ? "Won by " + t.win : "", t.note].filter(Boolean).join(" · "))}"><b>${G[g]} ${esc(teamLvName(t))}</b> ${t.pl ? `${t.pl === 1 ? "Champions" : teamPlace(t)}${t.n ? ` of ${t.n}` : ""}${t.pts != null ? ` · ${fmtPts(t.pts)} pts` : ""}` : t.pts != null ? `${fmtPts(t.pts)} pts` : "no points"}</span>`).join("")).join("")}</div></section>`;
  }

  // ---------- what if ----------
  // fields.json: every school's district / regional / state marks by year (reference only, not Bulldog results)
  let FIELDS = null, fieldsLoading = null;
  function loadFields() {
    if (!fieldsLoading) fieldsLoading = fetch("data/fields.json", { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((j) => (FIELDS = j));
    return fieldsLoading;
  }
  const FIELD_KEYS = new Set(["100M", "200M", "400M", "800M", "1600M", "3200M", "100HH", "110HH", "300IH", "4X100M", "4X200M", "4X400M", "4X800M", "High Jump", "Pole Vault", "Long Jump", "Shot Put", "Discus"]);
  const WI_LEVELS = [["District", "di"], ["Regional", "rg"], ["State", "st"]];
  function parseMark(e, s) {
    s = String(s || "").trim().replace(/[″"]/g, "").replace(/\s+/g, " ");
    if (!s) return null;
    if (!lower(e)) {
      let m = s.match(/^(\d+)\s*[-' ]\s*(\d+(?:\.\d+)?)$/);
      if (m) return +m[1] * 12 + +m[2];
      m = s.match(/^(\d+(?:\.\d+)?)\s*m$/i);
      return m ? +m[1] / 0.0254 : null;
    }
    const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    return m ? (m[1] ? +m[1] * 60 : 0) + +m[2] : null;
  }
  // Where mark value v would finish in one meet's field. fd = {f: finals marks, r: [{q, o}, ...]}
  function placeIn(e, fd, v) {
    const val = (x) => parseMark(e, x), bt = (a, b) => (lower(e) ? a < b - 1e-9 : a > b + 1e-9);
    const fin = fd.f.map(val), rounds = fd.r || [];
    let k = 0;
    while (k < rounds.length && rounds[k].o.length && !bt(v, val(rounds[k].o[0]))) k++;
    if (k === 0) {
      const ahead = fin.filter((x) => bt(x, v)).length, tie = fin.some((x) => !bt(x, v) && !bt(v, x));
      const out = !rounds.length && ahead === fin.length && (fd.only || (fin.length <= 9 && PRELIM_EVENTS.has(E[e].k)));
      return { pl: ahead + 1, tie, fin: true, out, n: fin.length };
    }
    let base = fin.length;
    for (let j = 0; j < k - 1; j++) base += rounds[j].o.length;
    const o = rounds[k - 1].o.map(val);
    return { pl: base + 1 + o.filter((x) => bt(x, v)).length, fin: false, round: k - 1 === 0 && rounds.length > 1 ? "semis" : "prelims", n: fin.length };
  }
  // Every Bulldog season best in event e, by year: year -> [{a or r, v}] best first
  function teamSeasonBests(e, g) {
    const key = "tsb|" + e + "|" + g;
    if (cache[key]) return cache[key];
    const c = cmp(e), by = {};
    if (E[e].t === "relay") {
      D.relays.forEach((r) => { if (r[0] === e && r[2] === g && !(r[5] & FLAGGED)) (by[yearOf(r[1])] = by[yearOf(r[1])] || []).push({ rel: r, v: r[3] }); });
      Object.values(by).forEach((l) => l.sort((x, y) => c(x.v, y.v)));
    } else {
      const best = {};
      D.results.forEach((r) => {
        if (r[1] !== e || A[r[0]][1] !== g || !valid(r)) return;
        const k2 = yearOf(r[2]) + "|" + r[0];
        if (!best[k2] || better(e, r[3], best[k2].v)) best[k2] = { a: r[0], v: r[3], r };
      });
      Object.entries(best).forEach(([k2, x]) => { const y = +k2.split("|")[0]; (by[y] = by[y] || []).push(x); });
      Object.values(by).forEach((l) => l.sort((x, y) => c(x.v, y.v)));
    }
    return (cache[key] = by);
  }
  const wiState = { g: "B", e: null };
  // Athlete search box on the What If page: any Bulldog with a mark in an event that has postseason fields
  function wiAthletes() {
    if (cache.wiA) return cache.wiA;
    const evOk = E.map((x) => FIELD_KEYS.has(x.k) && x.t !== "relay");
    const best = new Map(); // athlete -> {e, rank} best all-time rank among What If events
    D.results.forEach((r) => {
      if (!evOk[r[1]] || !valid(r) || A[r[0]][3]) return;
      const rk = rankMap(r[1], A[r[0]][1]).get(r[0]) || 9999, cur = best.get(r[0]);
      if (!cur || rk < cur.rank) best.set(r[0], { e: r[1], rank: rk });
    });
    return (cache.wiA = best);
  }
  function wireAthleteSearch(input, e, g, ranks) {
    const box = document.getElementById("wares"), orig = input.value;
    const mine = new Map(ranks.map((x) => [x.r[0], x]));
    let items = [], on = -1;
    const pick = (a) => {
      const t = mine.has(a) ? e : wiAthletes().get(a).e;
      location.hash = `#/whatif/${encodeURIComponent(E[t].k)}/${A[a][1]}/${slugOf[a]}`;
    };
    const close = () => { box.hidden = true; input.setAttribute("aria-expanded", "false"); on = -1; };
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      if (!q || q === orig.toLowerCase()) {
        items = ranks.slice(0, 8).map((x) => x.r[0]);
      } else {
        items = [...wiAthletes().keys()].filter((a) => matches(a, q))
          .sort((x, y) => (A[y][1] === g) - (A[x][1] === g) || mine.has(y) - mine.has(x) || nameOf(x).localeCompare(nameOf(y))).slice(0, 10);
      }
      on = items.length ? 0 : -1;
      const label = !q || q === orig.toLowerCase() ? `Top ${esc(G[g].toLowerCase())} in the ${esc(E[e].n)}` : "Athletes";
      box.innerHTML = items.length ? `<div class="qgroup"><div class="qlabel">${label}</div>${items.map((a, i) => {
        const x = mine.get(a), alt = wiAthletes().get(a), r2 = x ? x.r : null;
        const sub = `${G[A[a][1]]} · ${yearsLabel(a)} · ${r2 ? `${esc(E[e].n)} ${esc(r2[4])}${r2[5] & HAND ? "h" : ""}` : `best in the ${esc(E[alt.e].n)}`}`;
        return `<a role="option" data-a="${a}" class="${i === on ? "on" : ""}" aria-selected="${i === on}"><span>${esc(nameOf(a))}</span><small>${sub}</small></a>`; }).join("")}</div>`
        : `<p class="empty">No Bulldog by that name has a mark in a What If event.</p>`;
      box.hidden = false; input.setAttribute("aria-expanded", "true");
    };
    const hi = () => box.querySelectorAll("a").forEach((el, i) => { el.classList.toggle("on", i === on); el.setAttribute("aria-selected", String(i === on)); if (i === on) el.scrollIntoView({ block: "nearest" }); });
    input.addEventListener("focus", () => { input.select(); draw(); });
    input.addEventListener("input", draw);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (box.hidden) draw();
        if (items.length) { on = (on + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length; hi(); }
        ev.preventDefault();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (on >= 0 && items[on] !== undefined) pick(items[on]);
      } else if (ev.key === "Escape") { input.value = orig; close(); input.blur(); }
    });
    box.addEventListener("mousedown", (ev) => ev.preventDefault()); // keep focus in the box
    box.addEventListener("click", (ev) => { const el = ev.target.closest("a[data-a]"); if (el) { ev.preventDefault(); pick(+el.dataset.a); } });
    input.addEventListener("blur", () => setTimeout(() => { close(); if (!input.value.trim()) input.value = orig; }, 120));
  }
  function pageWhatIf(ek, g, who, which) {
    if (!FIELDS) {
      html(`<section class="page-head"><span class="eyebrow">What if</span><h1>What if…</h1></section><p class="note">Loading every year's postseason fields…</p>`);
      loadFields().then(() => { if (location.hash.startsWith("#/whatif")) pageWhatIf(ek, g, who, which); })
        .catch((err) => html(`<p class="empty">The postseason fields didn't load (${esc(err.message)}). Refresh the page to try again.</p>`));
      return;
    }
    const st = wiState;
    if (g === "B" || g === "G") st.g = g;
    const LV = FIELDS.levels, AD = typeof FIELDS.advance === "object" ? FIELDS.advance : {};
    // how many advance from a level that year (top 4; regional to state is top 5 from 2026)
    const advAt = (lv, y) => (AD[lv] || [[0, 4]]).reduce((n, [from, k]) => (y >= from ? k : n), 4);
    // events with postseason fields for this team
    const keys = new Set();
    Object.values(LV).forEach((yrs) => Object.values(yrs).forEach((gs) => Object.keys(gs[st.g] || {}).forEach((k) => keys.add(k))));
    const evs = E.map((x, i) => i).filter((i) => keys.has(E[i].k) && (E[i].t === "relay" ? D.relays.some((r) => r[0] === i && r[2] === st.g) : D.results.some((r) => r[1] === i && A[r[0]][1] === st.g)))
      .sort((x, y) => E[x].o - E[y].o);
    let e = ek ? eventByKey(ek) : -1;
    if (!evs.includes(e)) e = evs.includes(st.e) ? st.e : evs[0];
    st.e = e;
    const relay = E[e].t === "relay";

    // who: athlete slug, "r<relay index>", or "m<typed mark>"
    let subject = null;
    const ranks = relay ? relayRanking(e, st.g, { per: true }) : ranking(e, st.g);
    if (who && who[0] === "m" && who.length > 1 && parseMark(e, who.slice(1)) !== null) {
      subject = { kind: "mark", v: parseMark(e, who.slice(1)), mk: who.slice(1) };
    } else if (relay && who && /^r\d+$/.test(who) && D.relays[+who.slice(1)] && D.relays[+who.slice(1)][0] === e) {
      const r = D.relays[+who.slice(1)];
      subject = { kind: "relay", r, v: r[3], mk: r[4], y: yearOf(r[1]) };
    } else if (!relay && who && bySlug[who] !== undefined && ranks.some((x) => x.r[0] === bySlug[who])) {
      subject = { kind: "ath", a: bySlug[who] };
    }
    if (!subject && ranks.length) subject = relay ? { kind: "relay", r: ranks[0].r, v: ranks[0].r[3], mk: ranks[0].r[4], y: yearOf(ranks[0].r[1]) } : { kind: "ath", a: ranks[0].r[0] };
    let markOpts = [];
    if (subject && subject.kind === "ath") {
      const a = subject.a, mine = D.results.filter((r) => r[0] === a && r[1] === e && valid(r)), c = cmp(e), sb = {};
      mine.forEach((r) => { const y = yearOf(r[2]); if (!sb[y] || better(e, r[3], sb[y][3])) sb[y] = r; });
      const pr = mine.slice().sort((x, y) => c(x[3], y[3]))[0];
      markOpts = [["pr", pr, `PR · ${pr[4]} (${yearOf(pr[2])})`]].concat(Object.keys(sb).sort((x, y) => y - x).map((y) => [y, sb[y], `${y} best · ${sb[y][4]}${gradeLabel(a, +y) ? ` (${gradeLabel(a, +y)})` : ""}`]));
      const pick = markOpts.find((o) => o[0] === which) || markOpts[0];
      Object.assign(subject, { r: pick[1], v: pick[1][3], mk: pick[1][4], y: yearOf(pick[1][2]), which: pick[0] });
    }
    // hand times are converted before comparing with fully automatic fields
    if (subject && subject.r && (subject.r[5] & HAND) && E[e].h) { subject.hand = subject.v; subject.v = Math.round((subject.v + convAmt(e)) * 100) / 100; }
    const whoVal = !subject ? "" : subject.kind === "ath" ? slugOf[subject.a] : subject.kind === "relay" ? "r" + D.relays.indexOf(subject.r) : "";
    const go = (w, m) => { location.hash = `#/whatif/${encodeURIComponent(E[e].k)}/${st.g}/${encodeURIComponent(w)}${m ? "/" + m : ""}`; };

    // year by year
    const years = new Set();
    Object.values(LV).forEach((yrs) => Object.keys(yrs).forEach((y) => { if (yrs[y][st.g] && yrs[y][st.g][E[e].k]) years.add(+y); }));
    seasons().forEach((y) => { if (teamSeasonBests(e, st.g)[y]) years.add(y); });
    const yl = [...years].sort((x, y) => y - x);
    const tsb = teamSeasonBests(e, st.g);
    const tally = { di: [0, 0], rg: [0, 0], st: [0, 0], champ: [], ao: 0, team1: [0, 0], best: null, deep: { State: 0, Regional: 0, District: 0 }, chainN: 0 };
    const rows = subject ? yl.map((y) => {
      const cells = {};
      WI_LEVELS.forEach(([lv]) => {
        const fd = LV[lv] && LV[lv][y] && LV[lv][y][st.g] && LV[lv][y][st.g][E[e].k];
        cells[lv] = fd ? { ...placeIn(e, fd, subject.v), fd, adv: lv === "State" ? 8 : advAt(lv, y) } : null;
      });
      // team rank among that season's Bulldogs (leaving out the athlete's own marks)
      let team = null;
      const others = (tsb[y] || []).filter((x) => subject.kind === "ath" ? x.a !== subject.a : subject.kind === "relay" ? x.rel !== subject.r : true);
      if (relay) {
        if (others.length) team = { relay: true, rank: better(e, others[0].v, subject.v) ? 2 : 1, top: others[0] };
      } else if (others.length || (subject.kind === "ath" && tsb[y])) {
        const ahead = others.filter((x) => better(e, x.v, subject.v)).length;
        team = { rank: ahead + 1, n: others.length + 1, top: others[0] };
      }
      // how far the mark goes when each level has to be earned
      let reach = null;
      for (const [lv] of WI_LEVELS) {
        const c2 = cells[lv];
        if (!c2) { reach = null; break; } // can't follow the path past a meet that isn't on file
        reach = { lv, c: c2 };
        const through = lv === "State" ? false : c2.fin && !c2.out && c2.pl <= c2.adv;
        if (!through) break;
      }
      // tallies
      if (cells.District) { tally.di[1]++; if (cells.District.fin && !cells.District.out && cells.District.pl <= cells.District.adv) tally.di[0]++; }
      if (cells.Regional) { tally.rg[1]++; if (cells.Regional.fin && !cells.Regional.out && cells.Regional.pl <= cells.Regional.adv) tally.rg[0]++; }
      if (cells.State) {
        tally.st[1]++;
        const s2 = cells.State;
        if (s2.fin && !s2.out && s2.pl <= 8) tally.ao++;
        if (s2.fin && s2.pl === 1) tally.champ.push(y);
        if (s2.out) { /* no prelim results: place unknown */ } else if (!tally.best || s2.pl < tally.best.pl) tally.best = { pl: s2.pl, fin: s2.fin, ys: [y] };
        else if (s2.pl === tally.best.pl) tally.best.ys.push(y);
      }
      if (reach && cells.District && cells.Regional && cells.State) { tally.chainN++; tally.deep[reach.lv]++; }
      if (team) { tally.team1[1]++; if (team.rank === 1) tally.team1[0]++; }
      return { y, cells, team, reach };
    }) : [];

    // only show the columns that have data for this event
    const show = { team: rows.some((x) => x.team), reach: rows.some((x) => x.reach) };
    WI_LEVELS.forEach(([lv]) => { show[lv] = rows.some((x) => x.cells[lv]); });
    const plTxt = (c2) => c2.out ? (c2.fd.only ? `Outside top ${c2.n}` : `Out of final`) : !c2.fin ? `${ordinal(c2.pl)}` : `${c2.tie ? "T-" : ""}${ordinal(c2.pl)}`;
    const cellHTML = (lv, c2) => {
      if (!c2) return `<td class="wi-cell none" data-l="${lv}"></td>`;
      const f = c2.fd.f, isState = lv === "State", adv = c2.adv;
      const cls = c2.out ? "out" : c2.fin && c2.pl === 1 ? "win" : c2.fin && c2.pl <= (isState ? 8 : adv) ? "adv" : c2.fin && !c2.out ? "fin" : "out";
      const tag = !c2.fin || c2.out ? (c2.out ? "" : `Out in ${c2.round}`) : isState ? (c2.pl === 1 ? "State champ" : c2.pl <= 8 ? "All-Ohio" : "") : c2.pl <= adv ? (lv === "District" ? "To regional" : "To state") : "";
      const ref = isState ? (f.length >= 8 ? `8th: ${f[7]}` : c2.fd.only && f.length > 1 ? `${ordinal(f.length)}: ${f[f.length - 1]}` : "") : f.length >= adv ? `${ordinal(adv)}: ${f[adv - 1]}` : "";
      return `<td class="wi-cell ${cls}" data-l="${lv}"><b>${plTxt(c2)}</b>${tag ? ` <span class="wi-tag">${tag}</span>` : ""}<span class="wi-ref">Won in ${esc(f[0])}${ref ? " · " + esc(ref) : ""}</span></td>`;
    };
    const teamHTML = (t) => {
      if (!t) return `<td class="wi-cell none" data-l="On the team"></td>`;
      if (t.relay) return `<td class="wi-cell ${t.rank === 1 ? "adv" : "fin"}" data-l="On the team"><b>${t.rank === 1 ? "Season best" : "Behind"}</b><span class="wi-ref">${t.rank === 1 ? "Beats" : "Best"}: ${esc(t.top.rel[4])}${t.top.rel[6].length ? " · " + esc(relayWho(t.top.rel)) : ""}</span></td>`;
      const top = t.top ? (relay ? `${esc(t.top.rel[4])}` : `${esc(t.top.r[4])} ${esc(lastName(t.top.a))}`) : "";
      return `<td class="wi-cell ${t.rank === 1 ? "adv" : "fin"}" data-l="On the team"><b>#${t.rank}</b> <span class="dim">of ${t.n}</span>${top && t.rank > 1 ? `<span class="wi-ref">Best: ${top}</span>` : t.top ? `<span class="wi-ref">Next: ${top}</span>` : `<span class="wi-ref">Only one on file</span>`}</td>`;
    };
    const reachHTML = (x) => {
      if (!x.reach) return `<td class="wi-cell none" data-l="How far"></td>`;
      const { lv, c: c2 } = x.reach;
      const lbl = lv === "State" ? (c2.fin && c2.pl === 1 ? `${STAR} State champion` : `State · ${plTxt(c2)}`) : `${lv} · ${plTxt(c2)}`;
      return `<td class="wi-cell" data-l="How far"><span class="honor sm ${lv === "State" ? (c2.fin && c2.pl === 1 ? "champ" : "st") : lv === "Regional" ? "rg" : "di"}">${lbl}</span></td>`;
    };

    const who2 = !subject ? "" : subject.kind === "ath" ? aLink(subject.a) : subject.kind === "relay" ? `${subject.y} ${esc(G[st.g])} ${esc(E[e].n)}` : "This mark";
    const shownMark = subject ? (subject.kind === "mark" ? esc(subject.mk) : markHTML(subject.mk, subject.r[5], subject.r)) : "";
    const pick = relay
      ? `<div class="ctl wi-pick"><label for="wr">Relay team</label><select id="wr">${ranks.slice(0, 60).map((x) => `<option value="r${D.relays.indexOf(x.r)}"${x.r === (subject && subject.r) ? " selected" : ""}>${yearOf(x.r[1])} · ${esc(x.r[4])}${relayWho(x.r) ? " · " + esc(relayWho(x.r)) : ""}</option>`).join("")}</select></div>`
      : `<div class="ctl wi-pick"><label for="wa">Athlete</label><div class="wi-search"><input id="wa" type="search" class="plain" role="combobox" autocomplete="off" spellcheck="false"
           placeholder="Search for an athlete…" aria-autocomplete="list" aria-controls="wares" aria-expanded="false" value="${subject && subject.kind === "ath" ? esc(nameOf(subject.a)) : ""}">
           <div class="qres" id="wares" role="listbox" hidden></div></div></div>
         ${markOpts.length > 1 ? `<div class="ctl"><label for="wm">Mark</label><select id="wm">${markOpts.map((o) => `<option value="${o[0]}"${subject.which === o[0] ? " selected" : ""}>${esc(o[2])}</option>`).join("")}</select></div>` : ""}`;
    const dl = tally.deep, chain = tally.chainN;
    html(`
      <section class="page-head"><span class="eyebrow">What if</span><h1>What if they competed in another year?</h1>
        <p class="lede">Take a Bulldog mark and drop it into every year's district, regional and state meet: where would it have finished, and how far would it have gone?</p></section>
      <div class="controls">
        <div class="ctl"><span class="lbl">Team</span>${seg("wg", [["B", "Boys"], ["G", "Girls"]], st.g)}</div>
        <div class="ctl"><label for="we">Event</label>${eventSelect("we", evs, e)}</div>
        ${pick}
        <form class="ctl" id="wmf"><label for="wmi">Or try any mark</label><span class="wi-try"><input id="wmi" type="text" inputmode="decimal" placeholder="${lower(e) ? (E[e].k.match(/800|1600|3200|4X4|4X2/) ? "e.g. 2:01.50" : "e.g. 11.20") : "e.g. 45-6.5"}" value="${subject && subject.kind === "mark" ? esc(subject.mk) : ""}" autocomplete="off"><button type="submit">Go</button></span></form>
      </div>
      ${subject ? `
      <section class="wi-hero">
        <div class="wi-who"><span class="eyebrow">${subject.kind === "mark" ? "Your mark" : subject.kind === "relay" ? "Relay" : subject.which === "pr" ? "Personal record" : subject.y + " season best"}</span>
          <div class="wi-name">${who2}</div>
          <div class="wi-mark">${shownMark} <span class="dim">${esc(E[e].n)}</span></div>
          ${subject.hand !== undefined ? `<div class="note">Hand time: compared as ${fmtVal(e, subject.v)} (adds ${convAmt(e).toFixed(2)}s to match automatic timing)</div>` : ""}
          ${subject.kind !== "mark" ? `<div class="note">${subject.kind === "relay" ? esc(relayWho(subject.r)) + " · " : ""}<a href="#/meet/${subject.kind === "relay" ? subject.r[1] : subject.r[2]}">${esc(M[subject.kind === "relay" ? subject.r[1] : subject.r[2]][1])}</a>, ${fmtDate(dateOf(subject.kind === "relay" ? subject.r[1] : subject.r[2]))}</div>` : ""}
        </div>
        <div class="stats wi-stats">
          ${tally.di[1] ? `<div class="stat"><b>${tally.di[0]}</b><span>Times it advances from district</span><em>out of ${tally.di[1]} district meets on file</em></div>` : ""}
          ${tally.rg[1] ? `<div class="stat"><b>${tally.rg[0]}</b><span>Times it advances from regional</span><em>out of ${tally.rg[1]} regional meets on file</em></div>` : ""}
          ${tally.st[1] ? `<div class="stat"><b>${tally.ao}</b><span>Times it makes All-Ohio</span><em>out of ${tally.st[1]} state meets on file</em></div>
          <div class="stat"><b>${tally.best ? (tally.best.fin ? ordinal(tally.best.pl) : "—") : "—"}</b><span>Best state finish${tally.best && tally.best.fin ? ` · ${tally.best.ys.slice(0, 3).join(", ")}${tally.best.ys.length > 3 ? "…" : ""}` : ""}</span></div>` : ""}
          ${tally.team1[1] ? `<div class="stat"><b>${tally.team1[0]}</b><span>${relay ? "Beats the season's best team" : "Seasons it would lead the team"}</span><em>out of ${tally.team1[1]} Bulldog seasons on file</em></div>` : ""}
        </div>
      </section>
      ${chain ? `<p class="wi-sum">In the ${chain} ${chain === 1 ? "year" : "years"} with all three meets on file, this mark ${dl.State ? `reaches <b>state ${dl.State} ${dl.State === 1 ? "time" : "times"}</b>` : "never reaches state"}${dl.Regional ? `, stops at <b>regionals ${dl.Regional}</b>` : ""}${dl.District ? `, and stops at <b>districts ${dl.District}</b>` : ""}${tally.champ.length ? `, and wins state in ${andList(tally.champ.map(String))}` : ""}.</p>` : ""}
      <div class="tbl-wrap stk"><table class="wi-table"><thead><tr><th>Year</th>${show.team ? "<th>On the team</th>" : ""}${WI_LEVELS.filter(([lv]) => show[lv]).map(([lv]) => `<th>${lv}</th>`).join("")}${show.reach ? "<th>How far</th>" : ""}</tr></thead><tbody>
        ${rows.map((x) => `<tr${subject.y === x.y ? ' class="wi-own"' : ""}><td class="nowrap full"><b>${x.y}</b>${subject.y === x.y && subject.kind !== "mark" ? ' <span class="chip">Actual year</span>' : ""}</td>${show.team ? teamHTML(x.team) : ""}${WI_LEVELS.filter(([lv]) => show[lv]).map(([lv]) => cellHTML(lv, x.cells[lv])).join("")}${show.reach ? reachHTML(x) : ""}</tr>`).join("")}
      </tbody></table></div>
      <p class="note">How it works: the mark is compared with every finishing mark from that year's meet (all schools, from the full results). A place comes from the final; a mark that wouldn't have beaten the fastest non-qualifier is shown as going out in the prelims or semis, ranked among those who did. The top 4 at district advance to regional; the top 4 at regional advance to state (top 5 starting in 2026); the top 8 at state are All-Ohio. “How far” follows the path a qualifier would have to earn, district first. It's an estimate: weather, wind, heats and head-to-head racing all change real results. ${relay ? "“On the team” compares the time with the best Bulldog relay that season." : "“On the team” ranks the mark against every other Bulldog's season best that year."} A blank cell means that meet's results for that year aren't on file yet; state results before 2001 list only the placers (top 6 or 8).</p>`
      : `<p class="empty">No ${esc(G[st.g].toLowerCase())} marks on file for this event yet.</p>`}`);
    onSeg("wg", (v) => { location.hash = `#/whatif/${encodeURIComponent(E[e].k)}/${v}`; });
    document.getElementById("we").onchange = (ev) => { location.hash = `#/whatif/${encodeURIComponent(ev.target.value)}/${st.g}`; };
    const wa = document.getElementById("wa"), wr = document.getElementById("wr"), wm = document.getElementById("wm");
    if (wa) wireAthleteSearch(wa, e, st.g, ranks);
    if (wr) wr.onchange = (ev) => go(ev.target.value);
    if (wm) wm.onchange = (ev) => go(whoVal, ev.target.value);
    document.getElementById("wmf").onsubmit = (ev) => {
      ev.preventDefault();
      const raw = document.getElementById("wmi").value.trim().replace(/[″"]/g, "").replace(/\s*'\s*/g, "-");
      if (parseMark(e, raw) === null) { document.getElementById("wmi").setCustomValidity(lower(e) ? "Use a time like 11.20 or 2:01.50" : "Use feet-inches like 45-6.5"); document.getElementById("wmi").reportValidity(); return; }
      go("m" + raw);
    };
    document.getElementById("wmi").oninput = (ev) => ev.target.setCustomValidity("");
  }

  // ---------- router ----------
  function route() {
    $tip.hidden = true;
    const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    const [p, x, y] = parts;
    const tab = { "": "home", top: "top", relays: "relays", athletes: "athletes", a: "athletes", season: "season", meets: "meets", meet: "meets", fun: "fun", whatif: "whatif", team: "team", check: "about", about: "about" }[p || ""] || "home";
    document.querySelectorAll(".tabs a").forEach((a) => { a.classList.toggle("on", a.dataset.tab === tab); if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    const onTab = document.querySelector(".tabs a.on"); // keep the current tab in view in the scrolling tab row on phones
    if (onTab) { const t = onTab.parentElement; t.scrollLeft = onTab.offsetLeft - (t.clientWidth - onTab.offsetWidth) / 2; }
    chartBindings = [];
    switch (p) {
      case "top": return pageTop(x, y);
      case "relays": return pageRelays(x, y);
      case "athletes": return pageAthletes();
      case "a": return pageAthlete(x);
      case "season": return pageSeason(x);
      case "meets": return pageMeets();
      case "meet": return pageMeet(x);
      case "fun": return pageFun();
      case "whatif": return pageWhatIf(x, y, parts[3], parts[4]);
      case "team": return pageTeam();
      case "check": return pageCheck();
      case "about": return pageAbout();
      default: return pageHome();
    }
  }

  fetch("data/db.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((db) => {
      prep(db);
      setupSearch();
      const updated = new Date(db.generated.replace("Z", ":00Z"));
      document.getElementById("foot").innerHTML = `<span>${esc(db.school)} Track &amp; Field · ${A.length.toLocaleString()} athletes · ${(D.results.length).toLocaleString()} individual marks · ${D.relays.length.toLocaleString()} relays</span>
        <span>Updated ${isNaN(updated) ? esc(db.generated) : updated.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · <a href="#/about">About</a> · <a href="#/check">Data check (coaches)</a></span>`;
      const top = document.getElementById("totop");
      if (top) {
        let ticking = false;
        window.addEventListener("scroll", () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { top.hidden = window.scrollY < 1400; ticking = false; }); }, { passive: true });
        top.onclick = () => { window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); document.getElementById("app").focus({ preventScroll: true }); };
      }
      window.addEventListener("hashchange", route);
      route();
    })
    .catch((err) => { $app.innerHTML = `<p class="empty">The results file didn't load (${esc(err.message)}). Refresh the page to try again.</p>`; });
})();
