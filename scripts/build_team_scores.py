"""Build data/sources/team_scores.csv: where Green finished as a team at each district, regional and state meet.

Uses the team scores printed in the Hy-Tek results (district/regional 2002-2013, state 2001-2026). For the copies
that don't include team scores (MileSplit and Athletic.net pages), the scores are worked out from the finals:
10-8-6-5-4-3-2-1 for the top eight, ties split. The book years before 2000 come from the "Team Results" tab.

Output columns: Season, Team, Level, Place, Tied, Points, Teams, Champion, Champion Points, Source
"""
import csv
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from import_hytek import is_milesplit, is_athletic_net, parse_athletic_net, MS_EVENTS  # noqa: E402
from build_fields import is_anet_list, parse_anet_list, TOK  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "data", "sources")
OUT = os.path.join(SRC, "team_scores.csv")
HEADER = ["Season", "Team", "Level", "Place", "Tied", "Points", "Teams", "Champion", "Champion Points", "Source", "Notes"]
GREEN = re.compile(r"^(Greensburg |Uniontown )?Green$", re.I)
SCORING = [10, 8, 6, 5, 4, 3, 2, 1]


def gender_of(text, path):
    if re.search(r"\b(Women|Girls)\b", text, re.I):
        return "Girls"
    if re.search(r"\b(Men|Boys)\b", text, re.I):
        return "Boys"
    return "Girls" if "girls" in path else "Boys" if "boys" in path else None


def printed_scores(path, division=None):
    """Team scores printed in a Hy-Tek file -> {gender: (events_scored, [(place, team, points), ...])}."""
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    out = {}
    i = 0
    while i < len(lines):
        ln = lines[i]
        hm = re.search(r"Team (Rankings|Scores)", ln, re.I) or re.match(r"^\s*Rank\s+School\s+Score", ln)
        if not hm:
            i += 1
            continue
        dv = re.search(r"\bDiv(?:ision)?\.?\s*(\d)", ln)
        if division and dv and dv.group(1) != division:
            i += 1
            continue
        g = gender_of(ln, path) or gender_of(" ".join(lines[max(0, i - 3):i]), path)
        ev = re.search(r"(\d+) Events? Scored", ln)
        rows, seen_any = [], False
        if re.match(r"^\s*Rank\s+School", ln):  # 2001-2002 state: two side-by-side columns, ties unnumbered
            split = ln.index("Rank", 5)
            last = [None, None]
            j = i + 1
            while j < len(lines):
                t = lines[j]
                if t.strip().startswith("="):
                    j += 1
                    continue
                if not t.strip() or re.search(r"Event \d", t):
                    if seen_any:
                        break
                    j += 1
                    continue
                for c, half in enumerate((t[:split], t[split:])):
                    m = re.match(r"^\s*(?:(\d+)\.)?\s*(\S.*?)\s+(\d+(?:\.\d+)?)\s*$", half)
                    if m:
                        if m.group(1):
                            last[c] = int(m.group(1))
                        if last[c] is not None:
                            rows.append((last[c], m.group(2).strip(), float(m.group(3))))
                            seen_any = True
                j += 1
            i = j
        else:
            j = i + 1
            while j < len(lines):
                t = lines[j]
                found = re.findall(r"(\d+)\)\s+(.+?)\s+(\d+(?:\.\d+)?)(?=\s{2,}|\s*$|\s+\d+\))", t)
                if found:
                    rows += [(int(p), n.strip(), float(v)) for p, n, v in found]
                    seen_any = True
                elif seen_any and (re.search(r"Team (Rankings|Scores)|^\s*Event\s+\d|^\s*(Boys|Girls|Men|Women)\s+\S", t)):
                    break  # next table or the first event; page headers in between are skipped
                j += 1
            i = j
        if g and rows:
            n_ev = int(ev.group(1)) if ev else 99
            if g not in out or n_ev >= out[g][0]:  # keep the fullest table (day 2 over day 1)
                out[g] = (n_ev, rows)
    return out


def team_from_tokens(toks, known):
    """MileSplit line tokens (without place and mark) -> team name: after the grade if there is one, otherwise the
    longest known team name at the end."""
    for k, t in enumerate(toks):
        if t in ("FR", "SO", "JR", "SR"):
            return " ".join(toks[k + 1:])
    for n in range(len(toks), 0, -1):
        cand = " ".join(toks[-n:])
        if cand in known:
            return cand
    return " ".join(toks[-1:])


def computed_scores(path):
    """Team scores worked out from the finals of a MileSplit / Athletic.net copy."""
    finals = defaultdict(list)  # (gender, event) -> [(place, team)]
    if is_anet_list(path):
        for r in parse_anet_list(path):
            if r["rnd"] != "Finals" or not r["place"]:
                continue
            toks = r["line"].split("|")
            k = next((i for i, t in enumerate(toks) if t.startswith(r["mark"])), None)
            team = toks[k + 1] if k is not None and k + 1 < len(toks) else ""
            finals[(r["g"], r["e"])].append((r["place"], re.sub(r"\s+-\s+[A-Z]$", "", team)))
    elif is_athletic_net(path):
        rows, _, _ = parse_athletic_net(path, "*")
        for r in rows:
            if r["rnd"] == "Finals" and str(r["place"]).isdigit():
                finals[("B" if r["gender"] == "Boys" else "G", r["event"])].append((int(r["place"]), r.get("team", "")))
    else:
        known, pending = set(), []
        gender = event = None
        rnd, has_wind = "Finals", False
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
                    event, rnd, has_wind = e, (hm.group(3) or "Finals"), False
                continue
            m = re.match(r"^(\d+)\s+(.+)$", ln)
            if not event or not m or not rnd.startswith("Final"):
                continue
            toks = m.group(2).split()
            if len(toks) > 1 and re.match(r"^\d+$", toks[-1]):
                toks.pop()
            if has_wind and len(toks) > 1 and re.match(r"^([-+]?\d+\.\d|NWI)$", toks[-1]):
                toks.pop()
            if not toks or not TOK.match(toks[-1]):
                continue
            body = toks[:-1]
            if event.startswith("4X"):
                team = " ".join(body)
                known.add(team)
            elif any(t in ("FR", "SO", "JR", "SR") for t in body):
                team = team_from_tokens(body, known)
                known.add(team)
            else:
                team = None
            pending.append((gender, event, int(m.group(1)), body, team))
        for gender, event, place, body, team in pending:
            finals[(gender, event)].append((place, team or team_from_tokens(body, known)))
    totals = {"B": defaultdict(float), "G": defaultdict(float)}
    n_ev = {"B": 0, "G": 0}
    for (g, e), entries in finals.items():
        n_ev[g] += 1
        by_place = defaultdict(list)
        for p, t in entries:
            by_place[p].append(t)
        for p, teams in by_place.items():
            pts = SCORING[p - 1:p - 1 + len(teams)]
            if not pts:
                continue
            share = sum(pts) / len(teams)
            for t in teams:
                totals[g][t] += share
    out = {}
    for g, tot in totals.items():
        if not tot:
            continue
        ranked = sorted(tot.items(), key=lambda kv: -kv[1])
        rows, prev, place = [], None, 0
        for k, (t, v) in enumerate(ranked):
            if prev is None or abs(v - prev) > 1e-9:
                place = k + 1
            prev = v
            rows.append((place, t, round(v, 2)))
        out["Boys" if g == "B" else "Girls"] = (n_ev[g], rows)
    return out


def main():
    with open(os.path.join(SRC, "manifest.csv"), newline="", encoding="utf-8") as f:
        manifest = [m for m in csv.DictReader(f) if not m["File"].startswith("state-19") and m["File"] != "state-2000-boys.txt"
                    and m["File"] != "state-2000-girls.txt"]
    best = {}  # (season, gender, level) -> (events, rows, source)
    for m in manifest:
        path = os.path.join(SRC, m["File"])
        if not os.path.exists(path):
            continue
        div = m.get("Division") or None
        if is_milesplit(path) or is_anet_list(path) or is_athletic_net(path):
            got, src = computed_scores(path), "Worked out from the finals"
        else:
            got, src = printed_scores(path, div), "Team scores in the results"
        for g, (n_ev, rows) in got.items():
            k = (m["Season"], g, m["Level"])
            if k not in best or n_ev > best[k][0]:
                best[k] = (n_ev, rows, src, f"Division {div}" if div else "")
    out = []
    for (y, g, lvl), (n_ev, rows, src, note) in sorted(best.items()):
        mine = [r for r in rows if GREEN.match(r[1])]
        champ = [r for r in rows if r[0] == 1]
        if mine:
            p, _, pts = mine[0]
            tied = sum(1 for r in rows if r[0] == p) > 1
        else:
            p, pts, tied = "", "", False
        champ = [(c[0], c[1].title() if c[1].isupper() else c[1], c[2]) for c in champ]
        out.append([y, g, lvl, p, "Y" if tied else "", pts if pts == "" else f"{pts:g}", len(rows),
                    " / ".join(r[1] for r in champ), f"{champ[0][2]:g}" if champ else "", src, note])
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(HEADER)
        w.writerows(out)
    print(f"team_scores.csv: {len(out)} meets, Green scored at {sum(1 for r in out if r[3] != '')}")


if __name__ == "__main__":
    main()
