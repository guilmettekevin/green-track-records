"""Import Track Central "All Career Performances" text exports into the data/ CSVs.

Usage:
    python scripts/import_trackcentral.py --boys Boys.txt --girls Girls.txt

Safe to re-run with newer exports: rows already present are skipped, so only
new results are added. New athletes, meets and events are appended to their tabs.
(Coaches can do the same thing from the Google Sheet menu: Track Records > Import.)
"""
import argparse
import csv
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from marks import parse_date, iso, guess_meet_type  # noqa: E402
from events_default import HEADER as EVENT_HEADER, event_row  # noqa: E402

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
RESULT_HEADER = ["Gender", "Athlete", "Event", "Meet", "Date", "Mark", "Relay Total", "Status", "Notes", "Source", "Place", "Points", "Wind", "Series"]
ATHLETE_HEADER = ["Gender", "Athlete", "Grad Year", "Merge Into", "Hide", "Notes"]
MEET_HEADER = ["Date", "Meet", "Display Name", "Meet Type", "Notes"]

MARK_RE = re.compile(r"^(.*?)\s*\(([^()]*)\)\s*$")


def is_relay(event):
    e = event.upper()
    return "4X" in e or " X " in e or e.startswith("SMR") or e.startswith("DMR")


def parse_export(path, gender):
    """Yield result rows from one Track Central export file."""
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = [ln.rstrip("\r\n") for ln in f]
    athlete = None
    for i, ln in enumerate(lines):
        if "\t" not in ln:
            s = ln.strip()
            nxt = next((x.strip() for x in lines[i + 1:i + 3] if x.strip()), "")
            if s and nxt == "Top" and s != "Top":
                athlete = s
            continue
        parts = ln.split("\t")
        if athlete is None or len(parts) < 4:
            continue
        event, meet, dt, mark = (p.strip() for p in parts[:4])
        d = parse_date(dt)
        main, total, note = mark, "", ""
        m = MARK_RE.match(mark)
        if is_relay(event):
            if m:
                main, total = m.group(1).strip(), m.group(2).strip()
            else:
                main, total = "", mark
        elif m:  # e.g. "3.20m (10-6)": keep the imperial mark, note the metric one
            main, note = m.group(2).strip(), "Entered as " + m.group(1).strip()
        yield [gender, athlete, event, meet, iso(d) if d else dt, main, total, "", note, "Track Central", ""]


def read_csv(name):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        return []
    with open(p, newline="", encoding="utf-8") as f:
        return list(csv.reader(f))[1:]


def write_csv(name, header, rows):
    with open(os.path.join(DATA, name), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def key(r):
    return "|".join(x.strip().lower() for x in r[:7])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boys")
    ap.add_argument("--girls")
    a = ap.parse_args()
    os.makedirs(DATA, exist_ok=True)

    results = read_csv("results.csv")
    seen = {key(r) for r in results}
    new, dupes_in_file = [], 0
    for path, g in ((a.boys, "Boys"), (a.girls, "Girls")):
        if not path:
            continue
        for r in parse_export(path, g):
            k = key(r)
            if k in seen:
                dupes_in_file += 1
                continue
            seen.add(k)
            new.append(r)
    results += new
    results.sort(key=lambda r: (r[0], r[1], r[4], r[2]))
    write_csv("results.csv", RESULT_HEADER, results)

    # Athletes tab: keep existing rows (coach edits), append new names
    athletes = read_csv("athletes.csv")
    have = {(r[0], r[1]) for r in athletes}
    for g, n in sorted({(r[0], r[1]) for r in results} - have):
        athletes.append([g, n, "", "", "", ""])
    athletes.sort(key=lambda r: (r[0], r[1].lower()))
    write_csv("athletes.csv", ATHLETE_HEADER, athletes)

    # Meets tab: one row per (date, name as entered); suggest a display name per date
    meets = read_csv("meets.csv")
    have = {(r[0], r[1]) for r in meets}
    count = Counter((r[4], r[3]) for r in results)
    by_date = defaultdict(list)
    for (d, n), c in count.items():
        by_date[d].append((c, n))
    for (d, n) in sorted(set(count) - have):
        best = max(by_date[d], key=lambda cn: (len(cn[1]), cn[0]))[1]
        meets.append([d, n, best if best != n else "", guess_meet_type(n) or guess_meet_type(best), ""])
    meets.sort(key=lambda r: (r[0], r[1]))
    write_csv("meets.csv", MEET_HEADER, meets)

    # Events tab
    events = read_csv("events.csv")
    have = {r[0] for r in events}
    unknown = []
    for e in sorted({r[2] for r in results} - have):
        row = event_row(e)
        if row:
            events.append(row)
        else:
            unknown.append(e)
    events.sort(key=lambda r: (int(r[11] or 999), r[5] != "Final", r[0]))
    write_csv("events.csv", EVENT_HEADER, events)

    print(f"Added {len(new)} new results ({dupes_in_file} already present/duplicate lines skipped).")
    print(f"Totals: {len(results)} results, {len(athletes)} athletes, {len(meets)} meet rows, {len(events)} events.")
    if unknown:
        print("Events not recognised (add them to the Events tab):", ", ".join(unknown))


if __name__ == "__main__":
    main()
