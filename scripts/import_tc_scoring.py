"""Add places and points from a Track Central "Scoring Performances" report to data/results.csv.

Usage:  python3 scripts/import_tc_scoring.py "Girls 2026 scoring.txt" ["Boys 2026 scoring.txt" ...]

The report lists, for one team and season, every performance that scored: date, opponent,
event, performance, place and points (relay points are already split between the runners).
Each line is matched to the athlete's result on the same date with the same mark or relay time,
then Place (if still blank) and Points are filled in. Re-running is safe: Points are overwritten
with the same values. Lines that can't be matched are listed so a coach can check them.

The Google Sheet's Track Records > Import menu does the same thing (scoringImport_ in Code.gs).
"""
import csv
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from marks import parse_date, parse_field, parse_time  # noqa: E402
from import_hytek import record_coverage  # noqa: E402

DATA = os.path.join(os.path.dirname(__file__), "..", "data")


def value(s):
    """Seconds for times, inches for field marks, None if unreadable."""
    s = (s or "").strip().rstrip("hH").strip()
    if not s:
        return None
    if re.match(r"^\d+-\d", s):
        return parse_field(s)
    return parse_time(s)


def parse_report(text):
    """-> (team, season, [dict(athlete, date, opponent, event, perf, place, points)])"""
    lines = text.replace("\r", "").split("\n")
    head = next((l.strip() for l in lines[:12] if re.match(r"^(Boys|Girls)\b.*\b(19|20)\d\d$", l.strip())), "")
    team = head.split()[0] if head else ""
    season = int(head.split()[-1]) if head else 0
    out, athlete = [], None
    for i, ln in enumerate(lines):
        if "\t" not in ln:
            s = ln.strip()
            nxt = next((x.strip() for x in lines[i + 1:i + 3] if x.strip()), "")
            if s and s != "Top" and nxt == "Top":
                athlete = s
            continue
        p = [x.strip() for x in ln.split("\t")]
        if not athlete or len(p) < 6 or p[0] == "Date":
            continue
        d = parse_date(p[0])
        if not d:
            continue
        try:
            pts = float(p[5])
        except ValueError:
            continue
        out.append({"athlete": athlete, "date": d.isoformat(), "opponent": p[1], "event": p[2],
                    "perf": p[3], "place": p[4] if p[4].isdigit() else "", "points": pts})
    return team, season, out


def is_field(s):
    return bool(re.match(r"^\s*\d+-\d", s or ""))


def perf_values(perf):
    """-> (team total, leg mark) as raw strings; total is None unless the line reads 'leg (total)'."""
    m = re.match(r"^(.*?)\s*\(([^()]*)\)\s*$", perf)
    if m:
        return m.group(2).strip(), m.group(1).strip()
    return None, perf.strip()


def same(a, b):
    """Same mark: same kind (time or feet-inches) and same value. Keeps a 62-second 400 apart from a 5-02 high jump."""
    if not a or not b or is_field(a) != is_field(b):
        return False
    va, vb = value(a), value(b)
    return va is not None and vb is not None and abs(va - vb) < 0.006


def ev_key(e):
    """'4X400M - B' and '4X400M' -> '4x400m'; 'SMR 800M (1,1,2,4)' -> 'smr'; '300IH' -> '300ih'."""
    return re.sub(r"[^a-z0-9]", "", re.split(r"\s+-\s+|\s*\(|\s+800m", e.lower())[0])


def fmt_pts(p):
    return str(int(p)) if p == int(p) else f"{p:g}"


def main(paths):
    path = os.path.join(DATA, "results.csv")
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header = rows[0]
    for col in ("Place", "Points"):
        if col not in header:
            header.append(col)
    ix = {h: i for i, h in enumerate(header)}
    width = len(header)
    for r in rows[1:]:
        r.extend([""] * (width - len(r)))

    merge = {}
    with open(os.path.join(DATA, "athletes.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if (r.get("Merge Into") or "").strip():
                merge[r["Athlete"].lower()] = r["Merge Into"].strip().lower()

    def canon(n):
        n = n.lower().strip()
        seen = set()
        while n in merge and n not in seen:
            seen.add(n)
            n = merge[n]
        return n

    by_day = defaultdict(list)  # (athlete, date) -> rows
    for r in rows[1:]:
        d = parse_date(r[ix["Date"]])
        if d:
            by_day[(canon(r[ix["Athlete"]]), d.isoformat())].append(r)

    for p in paths:
        with open(p, encoding="utf-8", errors="replace") as f:
            team, season, lines = parse_report(f.read())
        matched, places, unmatched, used, acc = 0, 0, [], set(), {}
        for s in lines:
            total, mark = perf_values(s["perf"])
            cands = by_day.get((canon(s["athlete"]), s["date"]), [])
            if total is not None:
                # 'leg (total)': the team time decides; a split can repeat across relays the same day
                hits = [r for r in cands if same(r[ix["Relay Total"]], total)]
                if not hits:  # a metric entry shown as '0.25m (0-9.75)': the converted mark is in brackets
                    hits = [r for r in cands if not r[ix["Relay Total"]] and same(r[ix["Mark"]], total)]
            else:
                hits = [r for r in cands if same(r[ix["Mark"]], mark) or same(r[ix["Relay Total"]], mark)]
            if not hits:
                unmatched.append(f"{s['athlete']}  {s['date']}  {s['event']}  {s['perf']}")
                continue
            # Best row: same event, then this report's team (mixed-relay runners are on both rosters),
            # then not excluded, then not already used by another line of this report.
            ek = ev_key(s["event"])
            hits.sort(key=lambda r: (ev_key(r[ix["Event"]].replace(" (Trials)", "")) != ek,
                                     r[ix["Gender"]] != team, r[ix["Status"]].lower().startswith("ex"),
                                     (id(r), s["opponent"]) in used))
            r = hits[0]
            used.add((id(r), s["opponent"]))
            for other in hits[1:]:  # the same relay on the other roster: count it once
                if other[ix["Gender"]] != r[ix["Gender"]] and ev_key(other[ix["Event"]]) == ev_key(r[ix["Event"]]) \
                        and other[ix["Points"]] in (fmt_pts(s["points"]), r[ix["Points"]]):
                    other[ix["Points"]] = ""
            # A double-dual lists one performance once per opponent: keep each opponent's points ("5+3").
            acc.setdefault(id(r), []).append(s["points"])
            r[ix["Points"]] = "+".join(fmt_pts(x) for x in acc[id(r)])
            matched += 1
            if s["place"] and not r[ix["Place"]]:
                r[ix["Place"]] = s["place"]
                places += 1
        if team and season:
            # One "Points" row per team and season on the Coverage tab, so the Data Check page knows it's in.
            record_coverage(season, {team}, "Points", [[team]] * matched, "Track Central scoring report")
        total = sum(s["points"] for s in lines)
        print(f"{os.path.basename(p)}: {team} {season}, {len(lines)} scoring lines ({fmt_pts(total)} points), "
              f"{matched} matched, {places} places filled.")
        if unmatched:
            print("  Not found in Results (check the name, date or mark):")
            for u in unmatched:
                print("   ", u)

    with open(path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
