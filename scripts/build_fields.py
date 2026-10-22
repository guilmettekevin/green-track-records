"""Build site/data/fields.json: every school's finishing marks at the district, regional and state meets, used by
the site's "What if" page to show where a Bulldog mark would have placed in other years.

Reads the full results printouts listed in data/sources/manifest.csv (Hy-Tek, MileSplit and Athletic.net copies).
Nothing here goes into the Green record book: these are reference fields only.

Output: {"levels": {"District": {"2012": {"B": {"100M": {"f": [...], "q": "11.42", "p": [...]}}}}}}
  f  finals marks in place order (marks only, no names)
  q  slowest mark that made the final from the prelims (when the meet ran prelims)
  p  prelim marks that did not make the final, best first
"""
import csv
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from marks import parse_time, parse_field  # noqa: E402
from import_hytek import EVENT_RE, std_event, MS_EVENTS, is_athletic_net, is_milesplit, parse_athletic_net  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "data", "sources")
OUT = os.path.join(ROOT, "site", "data", "fields.json")

FIELD_EVENTS = {"High Jump", "Pole Vault", "Long Jump", "Shot Put", "Discus"}
NOMARK = r"NT|NH|NM|ND|FS|DQ|DNF|DNS|FOUL|SCR|FALL|DQ\w*"
TOK = re.compile(rf"^[J*#@%$&!]?(\d{{1,2}}:\d{{2}}(?:\.\d{{1,3}})?|\d{{1,3}}\.\d{{1,3}}|\d{{1,3}}-\d{{1,2}}(?:\.\d{{1,2}})?|{NOMARK})([QqJ@%#*$&RrhSs!]*)(?:(?<=[Qq])[-+]?\d{{1,2}}\.\d)?$")


def value(event, mark):
    if not mark:
        return None
    return parse_field(mark) if event in FIELD_EVENTS else parse_time(mark)


def tidy(event, mark):
    """'47-07.50' -> '47-7.5', '12-06.00' -> '12-6'; times unchanged."""
    m = re.match(r"^(\d+)-(\d+)(?:\.(\d+))?$", mark)
    if m and event in FIELD_EVENTS:
        frac = (m.group(3) or "").rstrip("0")
        return f"{int(m.group(1))}-{int(m.group(2))}" + (f".{frac}" if frac else "")
    return mark


RANGE = {"100M": ("9.8", "16"), "200M": ("20", "35"), "400M": ("44", "1:30"), "800M": ("1:45", "3:30"),
         "1600M": ("3:55", "8:00"), "3200M": ("8:30", "16:00"), "100HH": ("12.5", "25"), "110HH": ("13", "25"),
         "300IH": ("35", "1:10"), "4X100M": ("40", "1:10"), "4X200M": ("1:24", "2:30"), "4X400M": ("3:10", "5:30"),
         "4X800M": ("7:35", "13:00"), "High Jump": ("3-0", "7-6"), "Pole Vault": ("5-0", "19-0"),
         "Long Jump": ("10-0", "26-6"), "Shot Put": ("20-0", "72-0"), "Discus": ("50-0", "230-0")}
ROUND_LINE = re.compile(r"^\s*(?:(?:Heat|Section|Flight)\s+\d+\s+)?(Finals|Preliminaries|Prelims|Semi-?Finals|Semis)\b(?!\s*-\s*\w)")


def rnd_of(word):
    w = word.lower()
    return "Prelims" if w.startswith("prelim") else "Semis" if w.startswith("semi") else "Finals"


def wide(ln):  # printout still has its column spacing (not a copy pasted from a web page)
    return len(re.findall(r"\S\s{3,}\S", ln)) >= 2


# ---------- Hy-Tek printouts (all schools) ----------
def parse_hytek(path, division=None):
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    out = []
    gender = event = None
    rnd, labels, ends, div, head_wide = "Finals", [], [], None, False
    for ln in lines:
        em = EVENT_RE.match(ln.strip())
        if em:
            g2 = "B" if em.group(2) in ("Boys", "Men") else "G"
            e2 = std_event(re.sub(r"\b(high|int|intermediate|low)\s+(?=hurdles)", "", em.group(3).replace(",", ""), flags=re.I))
            dv = re.search(r"\bDiv(?:ision)?\.?\s*(\d)", em.group(3))
            if not (g2 == gender and e2 == event and (dv.group(1) if dv else None) == div):
                gender, event = g2, e2
                rnd, labels, ends = "Finals", [], []
                div = dv.group(1) if dv else None
            continue
        if not event or (division and div != division):
            continue
        rl = ROUND_LINE.match(ln)
        if rl:
            rnd = rnd_of(rl.group(1))
            continue
        hr = re.search(r"\b(Finals|Preliminaries|Prelims|Semi-?Finals)\s*-\s*Results", ln)
        if hr:
            rnd = rnd_of(hr.group(1))
            continue
        if re.search(r"(Name|School|Team|RELAY|ATHLETE|PL)\b.*\b(Seed|Prelims|Semis|Finals|TIME|MARK)\b", ln, re.I) and not re.match(r"^\s*\d", ln):
            cols = list(re.finditer(r"\b(Seed|Prelims|Semis|Finals)\b", ln))
            labels = [c.group(1) for c in cols]
            ends = [c.end() for c in cols]
            head_wide = wide(ln)
            if labels:
                rnd = rnd_of(labels[-1])
            continue
        ln = re.sub(r"(\d+)'(\d+(?:\.\d+)?)\"", r"\1-\2", ln)  # 61'10.25" -> 61-10.25
        pm = re.match(r"^\s*(\d+|--|-+)\s+(\S+)", ln)
        if not pm or re.match(r"^\s*\d+[).]", ln) or pm.group(2).endswith(":"):
            continue
        place = int(pm.group(1)) if pm.group(1).isdigit() else None
        if place is not None and place > 300:
            continue
        toks = [(m.group(0), m.start(), m.end()) for m in re.finditer(r"\S+", ln)][1:]
        cand = [(t, a, b) for t, a, b in toks if TOK.match(t)]
        if not cand:
            continue
        n = max(len(labels), 1)
        pick = None
        if ends and head_wide and wide(ln):  # column layout kept: the token that ends under the result column
            near = [c for c in cand if abs(c[2] - ends[-1]) <= 3]
            pick = near[0] if near else None
        if pick is None:
            pick = cand[n - 1] if len(cand) >= n else cand[-1]
        tm = TOK.match(pick[0])
        out.append(dict(g=gender, e=event, rnd=rnd, place=place, mark=tm.group(1),
                        q=bool(re.search(r"[Qq]", tm.group(2))), line=ln.strip()))
        # "Prelims  Finals" tables: the finalists' prelim marks are in the first column
        if rnd == "Finals" and len(labels) >= 2 and len(cand) >= len(labels) and labels[-2] in ("Prelims", "Semis"):
            pm2 = TOK.match(cand[len(labels) - 2][0])
            out.append(dict(g=gender, e=event, rnd=rnd_of(labels[-2]), place=None, mark=pm2.group(1), q=True,
                            line="(from finals) " + ln.strip()))
    return out


# ---------- MileSplit copies ----------
def parse_ms(path):
    out, gender, event, rnd, has_wind = [], None, None, "Finals", False
    for raw in open(path, encoding="utf-8", errors="replace").read().splitlines():
        if re.match(r"^PLACE\b", raw.strip()):
            has_wind = "WIND" in raw.upper().split()
            continue
        ln = re.sub(r"^(?:Complete|Finals) Results(?:\s*-\s*\S+)?\s+", "", raw.strip())
        hm = re.match(r"^(Boys|Girls|Men|Women)\s+(.+?)(?:\s+(Finals|Prelims|Semi-?Finals))?$", ln)
        if hm and not ln[0].isdigit():
            e = next((k for pat, k in MS_EVENTS if re.search(pat, hm.group(2).lower())), None)
            if e:
                gender = "B" if hm.group(1) in ("Boys", "Men") else "G"
                event, rnd = e, rnd_of(hm.group(3) or "Finals")
                has_wind = False
            continue
        if not event:
            continue
        m = re.match(r"^(\d+|--)\s+(.+)$", ln)
        if not m:
            continue
        toks = m.group(2).split()
        if len(toks) > 1 and re.match(r"^\d+$", toks[-1]):  # heat / flight number
            toks.pop()
        if has_wind and len(toks) > 1 and re.match(r"^([-+]?\d+\.\d|NWI)$", toks[-1]):
            toks.pop()
        mk = toks[-1] if toks else ""
        mk = re.sub(r"^(\d+)'\s*(\d+(?:\.\d+)?)\"?$", r"\1-\2", mk)
        tm = TOK.match(mk)
        if not tm:
            continue
        out.append(dict(g=gender, e=event, rnd=rnd, place=int(m.group(1)) if m.group(1).isdigit() else None,
                        mark=tm.group(1), q=False, line=ln))
    return out


# ---------- Athletic.net copies ----------
def parse_anet(path):
    rows, _, _ = parse_athletic_net(path, "*")
    return [dict(g="B" if r["gender"] == "Boys" else "G", e=r["event"], rnd=r["rnd"],
                 place=int(r["place"]) if str(r["place"]).isdigit() else None, mark=r["mark"], q=False,
                 line=f"{r.get('num')}|{r['place']}|{r['name'] or ''}|{r['mark']}") for r in rows]


def is_anet_list(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        first = next((l.strip() for l in f if l.strip()), "")
    return bool(re.match(r"^(Mens|Womens|Boys|Girls) Results$", first))


def parse_anet_list(path):
    """Athletic.net 'results list' copy: 'Mens Results', '100 Meters Varsity - Finals', then entries that start with
    '1.' and run until the next one; the mark is the first token like 10.74a / 59-11.50PB."""
    ANET_EVENTS = {"100 meters": "100M", "200 meters": "200M", "400 meters": "400M", "800 meters": "800M",
                   "1600 meters": "1600M", "3200 meters": "3200M", "100m hurdles": "100HH", "110m hurdles": "110HH",
                   "300m hurdles": "300IH", "4x100 relay": "4X100M", "4x200 relay": "4X200M", "4x400 relay": "4X400M",
                   "4x800 relay": "4X800M", "high jump": "High Jump", "pole vault": "Pole Vault", "long jump": "Long Jump",
                   "shot put": "Shot Put", "discus": "Discus"}
    out, gender, event, rnd, ent = [], None, None, "Finals", None

    def flush():
        if ent and event:
            mk = next((m.group(1) for t in ent[1] for m in [re.match(r"^(\d{1,2}:\d{2}\.\d{1,2}|\d{1,3}\.\d{2}|\d{1,3}-\d{2}(?:\.\d{2})?)[a-zA-Z]*(?:\s.*)?$", t)] if m), None)
            if mk:
                out.append(dict(g=gender, e=event, rnd=rnd, place=ent[0], mark=mk, q=False, line="|".join(ent[1])))
    for raw in open(path, encoding="utf-8", errors="replace").read().splitlines():
        s = raw.strip()
        gm = re.match(r"^(Mens|Womens|Boys|Girls) Results$", s)
        hm = re.match(r"^(.+?) Varsity - (Finals|Prelims)$", s)
        if gm or hm:
            flush()
            ent = None
            if gm:
                gender = "B" if gm.group(1) in ("Mens", "Boys") else "G"
            else:
                event = ANET_EVENTS.get(hm.group(1).split(" - ")[0].strip().lower())
                rnd = rnd_of(hm.group(2))
            continue
        pm = re.match(r"^(\d+)\.(?:\t(.*))?$", raw)
        if pm:
            flush()
            ent = (int(pm.group(1)), [t.strip() for t in (pm.group(2) or "").split("\t") if t.strip()])
        elif ent is not None:
            ent[1].extend(t.strip() for t in raw.split("\t") if t.strip())
    flush()
    return out


def parse_any(path, division=None):
    if is_anet_list(path):
        return parse_anet_list(path), "athletic.net list"
    if is_athletic_net(path):
        return parse_anet(path), "athletic.net"
    if is_milesplit(path):
        return parse_ms(path), "milesplit"
    return parse_hytek(path, division), "hytek"


def summarize(rows, bad):
    """rows for one meet/gender/event -> {"f": finals marks best first, "r": [{"q", "o"}, ...]} or None.
    r[0] is the round before the final (semis or prelims), r[1] the one before that: q is the slowest mark that went
    through, o the marks that didn't, best first."""
    e = rows[0]["e"]
    lo, hi = (value(e, x) for x in RANGE[e])
    sign = 1 if e not in FIELD_EVENTS else -1
    rounds = {}
    for rnd in ("Prelims", "Semis", "Finals"):
        seen, res = set(), []
        for r in rows:
            if r["rnd"] != rnd or r["line"] in seen:
                continue
            seen.add(r["line"])
            v = value(e, r["mark"])
            if v is not None and (v < lo if sign > 0 else v > hi):  # faster/farther than possible: a misread column
                bad.append(f"{e} {rnd} {r['mark']}: out of range ({r['line'][:70]})")
                v = None
            res.append(dict(v=v, m=tidy(e, r["mark"]), q=r["q"], fromf=r["line"].startswith("(from finals)")))
        if res:
            rounds[rnd] = res
    fin = [x for x in rounds.get("Finals", []) if x["v"] is not None]
    if not fin:
        return None
    srt = lambda xs: sorted(xs, key=lambda x: sign * x["v"])  # noqa: E731
    out = {"f": [x["m"] for x in srt(fin)]}
    order = [r for r in ("Semis", "Prelims") if r in rounds]
    nxt = len(rounds["Finals"])
    rs = []
    for rnd in order:
        ent = rounds[rnd]
        marked = [x for x in ent if x["v"] is not None]
        if any(x["q"] for x in ent):
            qual = [x for x in marked if x["q"]]
        else:
            qual = srt(marked)[:nxt]
        others = [x for x in marked if x not in qual and not x["fromf"]]
        rec = {}
        if qual:
            rec["q"] = srt(qual)[-1]["m"]
        rec["o"] = [x["m"] for x in srt(others)]
        rs.append(rec)
        nxt = len(ent)
    if rs:
        out["r"] = rs
    return out


# How many move on from each meet: [first season, number]. Top 4 from district to regional; top 4 from regional to
# state, top 5 starting in 2026.
ADVANCE = {"District": [[2000, 4]], "Regional": [[2000, 4], [2026, 5]]}


def main():
    verbose = "-v" in sys.argv
    levels = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
    problems = []
    with open(os.path.join(SRC, "manifest.csv"), newline="", encoding="utf-8") as f:
        manifest = list(csv.DictReader(f))
    grouped = defaultdict(list)
    placers_only = set()  # (level, season): typed from a results book that lists only the placers
    for m in manifest:
        path = os.path.join(SRC, m["File"])
        if not os.path.exists(path):
            problems.append(f"missing source file {m['File']}")
            continue
        rows, fmt = parse_any(path, m.get("Division") or None)
        with open(path, encoding="utf-8", errors="replace") as fh:
            head = "".join(fh.readline() for _ in range(3))
            if "results book" in head or "placers only" in head:
                placers_only.add((m["Level"], m["Season"]))
        if verbose:
            print(f"{m['File']:28} {fmt:12} {len(rows):5} rows")
        for r in rows:
            if r["e"]:
                grouped[(m["Level"], m["Season"], r["g"], r["e"])].append(r)
    for (lvl, yr, g, e), rows in sorted(grouped.items()):
        bad = []
        s = summarize(rows, bad)
        problems += [f"{lvl} {yr} {g} {b}" for b in bad]
        if s:
            if (lvl, yr) in placers_only:
                s["only"] = 1  # a mark behind the last placer can't be given an exact place
            levels[lvl][yr][g][e] = s
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"levels": levels, "advance": ADVANCE}, f, separators=(",", ":"))
    n = sum(len(ev) for lv in levels.values() for yr in lv.values() for ev in yr.values())
    print(f"fields.json: {n} event fields, {os.path.getsize(OUT) // 1024} KB")
    for p in problems:
        print("CHECK:", p)


if __name__ == "__main__":
    main()
