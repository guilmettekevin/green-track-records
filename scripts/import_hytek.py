"""Pull one school's results out of a Hy-Tek Meet Manager results printout (district, regional, state).

Usage:
    python scripts/import_hytek.py results.txt --meet "State Track Meet" [--school Green]
           [--prelims-date 2009-06-05 --finals-date 2009-06-06] [--dry-run]

- Dates come from the printout header ("6/5/2009 to 6/6/2009"): prelims on the first day, finals on the last.
  Pass --prelims-date/--finals-date when the header has no dates. Field events and distance races
  are put on the finals day; check the Notes column if the exact day matters.
- Names are matched to the Athletes tab ("First Last" -> "Last, First"). Unmatched names are listed
  so you can fix them (nicknames, maiden names) before or after importing.
- Rows already in data/results.csv are skipped, so re-running is safe.
"""
import argparse
import csv
from collections import Counter
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from marks import guess_meet_type, parse_time, parse_field, parse_date  # noqa: E402
from events_default import event_row  # noqa: E402

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
ROOT_CFG = os.path.join(os.path.dirname(__file__), "..", "config.json")

EVENT_MAP = [  # matched against a simplified event name: "boys 3200 - run" -> "3200 run"
    (r"\b100 (?:meter )?hurdles", "100HH"), (r"\b110 (?:meter )?hurdles", "110HH"), (r"\b300 (?:meter )?hurdles", "300IH"),
    (r"\b4x100\b", "4X100M"), (r"\b4x200\b", "4X200M"), (r"\b4x400\b", "4X400M"), (r"\b4x800\b", "4X800M"),
    (r"\b100 (?:meter )?dash", "100M"), (r"\b200 (?:meter )?dash", "200M"), (r"\b400 (?:meter )?dash", "400M"),
    (r"\b800 (?:meter )?run", "800M"), (r"\b1600 (?:meter )?run", "1600M"), (r"\b3200 (?:meter )?run", "3200M"),
    (r"high jump", "High Jump"), (r"pole vault", "Pole Vault"), (r"long jump", "Long Jump"),
    (r"shot put", "Shot Put"), (r"discus", "Discus"),
]
EVENT_RE = re.compile(r"^(\.*)(?:Event\s+\d+\s+)?(Boys|Girls|Men|Women)\s+(.*(?:Dash|Run|Hurdles|Relay|Jump|Vault|Put|Throw).*)$")
DATES_RE = re.compile(r"(\d{1,2}/\d{1,2}/(\d{4}))\s+to\s+(\d{1,2}/\d{1,2}/)\d*")
MARK_RE = re.compile(r"^[J*]?(\d{1,2}:\d{2}\.\d{1,2}|\d{1,3}\.\d{1,2}|\d{1,3}-\d{1,2}(?:\.\d{1,2})?|NH|NM|FS|DQ|DNF|DNS|FOUL|SCR)[QqJ@%#*$Rr]*$")


NICK = {"mike": "michael", "matt": "matthew", "zach": "zachary", "zack": "zachary", "nick": "nicholas", "chris": "christopher",
        "alex": "alexander", "jake": "jacob", "joe": "joseph", "tom": "thomas", "dan": "daniel", "dave": "david",
        "ben": "benjamin", "sam": "samuel", "will": "william", "bill": "william", "jon": "jonathan", "josh": "joshua",
        "tony": "anthony", "andy": "andrew", "drew": "andrew", "rob": "robert", "bob": "robert", "steve": "steven",
        "katie": "katherine", "kate": "katherine", "liz": "elizabeth", "beth": "elizabeth", "abby": "abigail",
        "maddie": "madison", "jen": "jennifer", "jess": "jessica", "becky": "rebecca", "ally": "allison"}


def close(a, b):
    """Same person, different spelling? Nickname, prefix, or one or two letters off."""
    a, b = a.lower().strip("."), b.lower().strip(".")
    if a == b or NICK.get(a) == b or NICK.get(b) == a or (NICK.get(a) and NICK.get(a) == NICK.get(b)):
        return True
    if len(a) >= 3 and len(b) >= 3 and (a.startswith(b) or b.startswith(a)):
        return True
    if abs(len(a) - len(b)) > 2 or min(len(a), len(b)) < 4:
        return False
    prev = list(range(len(b) + 1))  # edit distance
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] <= 2


def to_last_first(raw):
    """'Joe Gourley' or 'Gourley, Joe' -> 'Gourley, Joe'; drops a '(Nickname)' part."""
    name = re.sub(r"\s*\([^)]*\)", "", raw).strip()
    if "," in name:
        last, _, first = name.partition(",")
        return f"{last.strip()}, {first.strip()}".strip(", ")
    first, _, last = name.rpartition(" ")
    return f"{last}, {first}".strip(", ")


def iso(s):
    return datetime.strptime(s, "%m/%d/%Y").date().isoformat()


def std_event(desc):
    d = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", desc.lower().replace("meter", ""))).strip()
    d = re.sub(r"\b4 ?x ?(\d+)", r"4x\1", d)
    for pat, k in EVENT_MAP:
        if re.search(pat, d.replace("  ", " ")):
            return k
    return None


def parse(path, school, division=None):
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    head = "\n".join(lines[:6])
    m = DATES_RE.search(head)
    dates = (iso(m.group(1)), iso(m.group(3) + m.group(2))) if m else (None, None)
    out = []
    gender = event = None
    rnd = "Finals"
    ncols = 1
    div = None
    evdate = {}
    lineups = {}
    genders_seen = set()
    sch = "(?:" + "|".join(re.escape(x.strip()) for x in school.split("|")) + ")"
    ind_re = re.compile(rf"^\s*(\d+|--)\s+(?:\d+\s+)?(.+?)\s{{2,}}(\d{{1,2}}|FR|SO|JR|SR)\s+{sch}\s{{2,}}(.*)$")
    rel_re = re.compile(rf"^\s*(\d+|--)\s+(?:\d+\s+)?{sch}\s{{2,}}(?:[A-D]\s+)?(.*)$")

    # Copies pasted from web pages lose the column spacing: fall back to single spaces
    ind_loose = re.compile(rf"^\s*(\d+|--)\s+(?:\d+\s+)?(.+?)\s+(\d{{1,2}}|FR|SO|JR|SR)\s+{sch}\s+(.*)$")
    rel_loose = re.compile(rf"^\s*(\d+|--)\s+(?:\d+\s+)?{sch}\s+(?:[A-D]\s+)?(.*)$")

    # Newer layout: place, mark, [points], name, grade, school at the end of the line
    rel_tail = re.compile(rf"^\s*(\d+|-+)\s+[%#@$*]?\s*(\S+)\s+(?:\d+(?:\.\d+)?\s+)?{sch}\s*$")
    ind_tail = re.compile(rf"^\s*(\d+|-+)\s+(\S+)\s+(?:\d+(?:\.\d+)?\s+)?(.+?)\s+(\d{{1,2}}|FR|SO|JR|SR)\s+{sch}\s*$")

    def pick(rest):
        rest = re.sub(r"(\d+)'(\d+(?:\.\d+)?)\"", r"\1-\2", rest)
        toks = rest.replace("@ ", "@").split()
        return toks[ncols - 1] if len(toks) >= ncols else (toks[0] if toks else "")
    leg_re = re.compile(r"(\d)\)\s+(?:\d+\s+)?(.+?)\s+(\d{1,2}|FR|SO|JR|SR)?(?=\s+\d\)\s|\s*$)")
    has_wind = False
    i = 0
    while i < len(lines):
        ln = lines[i]
        em = EVENT_RE.match(ln.strip())
        if em:
            g2 = "Boys" if em.group(2) in ("Boys", "Men") else "Girls"
            e2 = std_event(em.group(3))
            if not (em.group(1) and g2 == gender and e2 == event):  # "....Event" = same event continued on a new page
                gender, event = g2, e2
                rnd, ncols, has_wind = "Finals", 1, False
                dv = re.search(r"\bDiv(?:ision)?\.?\s*(\d)", em.group(3))
                div = dv.group(1) if dv else None
                if event and (not division or not div or div == division):
                    genders_seen.add(gender)
        elif event and ln.strip() in ("Finals", "Preliminaries", "Prelims"):
            rnd = "Finals" if ln.strip() == "Finals" else "Prelims"
        elif event and re.search(r"\b(Finals|Preliminaries|Prelims|Semi-?Finals)\s*-\s*Results", ln):
            rnd = "Finals" if re.search(r"\bFinals\s*-", ln) and not re.search(r"Semi", ln) else "Prelims"
            ed = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", ln)
            if ed:
                yy = ed.group(3) if len(ed.group(3)) == 4 else "20" + ed.group(3)
                evdate[(gender, event, rnd)] = f"{yy}-{int(ed.group(1)):02d}-{int(ed.group(2)):02d}"
        elif event and re.search(r"(Name|School|Team)\b.*\b(Seed|Prelims|Finals)\b", ln):
            cols = re.findall(r"\b(Seed|Prelims|Finals)\b", ln)
            ncols = len(cols)  # mark columns; the result is the last one (Seed comes first)
            has_wind = bool(re.search(r"\bWind\b", ln))
            rnd = "Prelims" if cols[-1] == "Prelims" else "Finals"
        elif event:
            if division and div and div != division:
                i += 1
                continue
            mi = ind_re.match(ln) or ind_loose.match(ln)
            rt = None if mi else rel_tail.match(ln)
            if rt and "4X" in event:
                place, mark = rt.groups()
                mk = MARK_RE.match(mark)
                if mk:
                    legs, j = [], i + 1
                    while j < len(lines) and re.match(r"^\s*\d\)", lines[j]):
                        for lm in leg_re.finditer(lines[j]):
                            legs.append((to_last_first(lm.group(2)), lm.group(3)))
                        j += 1
                    out.append(dict(date=evdate.get((gender, event, rnd)), gender=gender, event=event, rnd=rnd, place=place if place.isdigit() else "--",
                                    name=None, year=None, mark=mk.group(1), legs=legs or lineups.get((gender, event)) or None))
                    if legs:
                        lineups[(gender, event)] = legs
                i += 1
                continue
            mt = None if mi else ind_tail.match(ln)
            if mt:
                place, mark, name, yr = mt.groups()
                mk = MARK_RE.match(mark)
                if mk:
                    out.append(dict(date=evdate.get((gender, event, rnd)), gender=gender, event=event, rnd=rnd, place=place if place.isdigit() else "--",
                                    name=to_last_first(name), year=yr, mark=mk.group(1), legs=None))
                i += 1
                continue
            mr = None if mi else (rel_re.match(ln) or rel_loose.match(ln))
            if mi:
                place, name, yr, rest = mi.groups()
                mark = pick(rest)
                mk = MARK_RE.match(mark)
                if mk:
                    toks = rest.split()
                    k = toks.index(mark) + 1 if mark in toks else len(toks)
                    wind = toks[k] if has_wind and k < len(toks) and re.match(r"^[-+]?\d+\.\d$", toks[k]) else ""
                    out.append(dict(date=evdate.get((gender, event, rnd)), gender=gender, event=event, rnd=rnd, place=place, name=to_last_first(name),
                                    year=yr, mark=mk.group(1), legs=None, wind=wind))
            elif mr and "4X" in event:
                place, rest = mr.groups()
                mark = pick(rest)
                mk = MARK_RE.match(mark)
                if mk:
                    legs = []
                    j = i + 1
                    while j < len(lines) and re.match(r"^\s+\d\)", lines[j]):
                        for lm in leg_re.finditer(lines[j]):
                            legs.append((to_last_first(lm.group(2)), lm.group(3)))
                        j += 1
                    out.append(dict(date=evdate.get((gender, event, rnd)), gender=gender, event=event, rnd=rnd, place=place, name=None, year=None,
                                    mark=mk.group(1), legs=legs or lineups.get((gender, event)) or None))
                    if legs:
                        lineups[(gender, event)] = legs
        i += 1
    if not dates[1] and evdate:
        ds = sorted(evdate.values())
        dates = (ds[0], ds[-1])
    return out, dates, genders_seen


COVERAGE_HEADER = ["Season", "Team", "Level", "Status", "Green Results", "Source", "Notes"]


ANET_EVENTS = {"100 meters": "100M", "200 meters": "200M", "400 meters": "400M", "800 meters": "800M",
               "1600 meters": "1600M", "3200 meters": "3200M", "100m hurdles": "100HH", "110m hurdles": "110HH",
               "300m hurdles": "300IH", "4x100 relay": "4X100M", "4x200 relay": "4X200M", "4x400 relay": "4X400M",
               "4x800 relay": "4X800M", "high jump": "High Jump", "pole vault": "Pole Vault", "long jump": "Long Jump",
               "shot put": "Shot Put", "discus": "Discus"}
ANET_MARK = re.compile(r"^(\d{1,2}:\d{2}(?:\.\d{1,2})?|\d{1,3}\.\d{2}|\d{1,3}-\d{2}(?:\.\d{1,2})?)$")
ANET_NOMARK = {"DQ", "DNF", "DNS", "SCR", "FS", "NH", "NM", "ND", "FOUL"}


def is_athletic_net(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        first = next((l.strip() for l in f if l.strip()), "")
    return bool(re.match(r"^#\d+$", first))


def parse_athletic_net(path, school):
    """Athletic.net results copied from the web page: one field per line, events headed '#5 / Girls' / 100m Hurdles /
    Varsity / Prelims', then the column titles, then the entries. The per-heat lists after 'Heat 1' repeat the
    entries and are skipped. Returns the same rows as parse()."""
    lines = [l.strip() for l in open(path, encoding="utf-8", errors="replace").read().splitlines()]
    schools = {x.strip().upper() for x in school.split("|")}
    every = school == "*"  # all schools (reference fields for the What if page)
    out, genders_seen = [], set()
    i = 0
    while i < len(lines):
        if not re.match(r"^#\d+$", lines[i]):
            i += 1
            continue
        num = int(lines[i][1:])
        gender = "Boys" if lines[i + 1].lower().startswith("boy") else "Girls"
        event = ANET_EVENTS.get(lines[i + 2].lower())
        rnd = "Prelims" if lines[i + 4].lower().startswith("prelim") else "Finals"
        genders_seen.add(gender)
        relay = "relay" in lines[i + 2].lower()
        # body: up to the next event, minus the heat/flight lists
        j = i + 5
        end = j
        while end < len(lines) and not re.match(r"^#\d+$", lines[end]):
            end += 1
        body = lines[j:end]
        for k, l in enumerate(body):
            if re.match(r"^(Heat|Flight|Section)\s+\d+$", l):
                body = body[:k]
                break
        i = end
        if not event:
            continue

        def starts(k):
            if not re.match(r"^(\d+|--)$", body[k]) or k + 1 >= len(body):
                return False
            nxt = body[k + 1]
            return bool(re.match(r"^[A-Z0-9 .&'/-]+$", nxt)) and not nxt.isdigit() if relay else ", " in nxt
        starts_at = [k for k in range(len(body)) if starts(k)]
        for n, k in enumerate(starts_at):
            ent = body[k:(starts_at[n + 1] if n + 1 < len(starts_at) else len(body))]
            place = ent[0] if ent[0].isdigit() else ""
            if relay:
                team = ent[1]
                if not every and team.upper() not in schools:
                    continue
                rest, legs = [], []
                m = 2
                while m < len(ent):
                    if re.match(r"^\d\)$", ent[m]) and m + 1 < len(ent):
                        nm = re.match(r"^(.*?)(?:\s+(\d{1,2}|Jr|Sr|So|Fr))?$", ent[m + 1])
                        legs.append((nm.group(1).strip(), nm.group(2) or ""))
                        m += 2
                        continue
                    rest.append(ent[m])
                    m += 1
                name, year = None, ""
            else:
                name = ent[1]
                yr = ent[2] if len(ent) > 2 and re.match(r"^\d{1,2}$", ent[2]) else ""
                tix = 3 if yr else 2
                team = ent[tix] if len(ent) > tix else ""
                if not every and team.upper() not in schools:
                    continue
                rest, legs, year = ent[tix + 1:], None, yr
            marks = [t for t in rest if ANET_MARK.match(t)]
            nomark = next((t for t in rest if t.upper() in ANET_NOMARK), None)
            if nomark and len(marks) <= 1:
                mark = nomark.upper()  # only a seed time, then DQ/SCR
            elif marks:
                mark = marks[1] if len(marks) >= 2 else marks[0]
            else:
                continue
            if mark in ("SCR", "DNS"):
                continue
            if mark in ("ND", "NH"):
                mark = "NM"
            fm = re.match(r"^(\d+)-(\d\d)(?:\.(\d+))?$", mark)
            if fm:  # 47-07.50 -> 47-7.5, 12-06.00 -> 12-6
                frac = (fm.group(3) or "").rstrip("0")
                mark = f"{int(fm.group(1))}-{int(fm.group(2))}" + (f".{frac}" if frac else "")
            out.append({"gender": gender, "event": event, "rnd": rnd, "place": place, "mark": mark,
                        "name": to_last_first(name) if name else None, "year": year, "legs": legs, "num": num,
                        "team": team})
    return out, (None, None), genders_seen


MS_EVENTS = [(r"100 meter hurdles", "100HH"), (r"110 meter hurdles", "110HH"), (r"300 meter hurdles", "300IH"),
             (r"4x100", "4X100M"), (r"4x200", "4X200M"), (r"4x400", "4X400M"), (r"4x800", "4X800M"),
             (r"\b100 meter", "100M"), (r"\b200 meter", "200M"), (r"\b400 meter", "400M"), (r"\b800 meter", "800M"),
             (r"1600 meter", "1600M"), (r"3200 meter", "3200M"), (r"high jump", "High Jump"), (r"pole vault", "Pole Vault"),
             (r"long jump", "Long Jump"), (r"shot put", "Shot Put"), (r"discus", "Discus")]
GRADES = {"FR": "9", "SO": "10", "JR": "11", "SR": "12"}


def is_milesplit(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        head = f.read(3000)
    return bool(re.search(r"^PLACE\s+(ATHLETE\s+)?TEAM\s+MARK", head, re.M))


def same_or_cut(kept, v):
    """True when the time kept on file is the official time v, or v cut short (Track Central keeps relay
    times to the second or the tenth: 4:10 or 4:07.7 for 4:07.77)."""
    kv = parse_time(kept)
    if kv is None or v is None:
        return False
    if abs(kv - v) < 0.005:
        return True
    dec = len(kept.split(".")[1]) if "." in kept else 0
    return dec < 2 and 0 <= v - kv < 10 ** -dec - 1e-9


def parse_milesplit(path, school):
    """MileSplit results copied from the web page: 'Boys 100 Meter Dash Prelims', then 'PLACE ATHLETE TEAM MARK [HEAT]'
    and one line per entry: '12 Cade McCann SO Green 11.47 2'. Relays list the team only, without runners."""
    names = "|".join(re.escape(x.strip()) for x in school.split("|"))
    ind = re.compile(rf"^(\d+|--)\s+(.+?)\s+(?:(FR|SO|JR|SR|\d{{1,2}})\s+)?(?:{names})\s+(\S+)((?:\s+(?:[-+]?\d+(?:\.\d+)?|NWI)){{0,2}})\s*$")  # mark [wind] [heat/flight]
    rel = re.compile(rf"^(\d+|--)\s+(?:{names})\s+(\S+)(?:\s+\d+)?\s*$")
    out, genders, gender, event, rnd, has_wind = [], set(), None, None, "Finals", False
    for ln in open(path, encoding="utf-8", errors="replace").read().splitlines():
        if re.match(r"^PLACE\b", ln.strip()):  # column titles: is there a WIND column in this event?
            has_wind = "WIND" in ln.upper().split()
            continue
        ln = re.sub(r"^Complete Results(?:\s*-\s*\S+)?\s+", "", ln.strip())  # older pages prefix each event heading
        hm = re.match(r"^(Boys|Girls|Men|Women)\s+(.+?)(?:\s+(Finals|Prelims|Semi-?Finals))?$", ln)
        if hm and not ln[0].isdigit():
            e = next((k for pat, k in MS_EVENTS if re.search(pat, hm.group(2).lower())), None)
            if e:
                gender = "Boys" if hm.group(1) in ("Boys", "Men") else "Girls"
                event, rnd = e, ("Prelims" if (hm.group(3) or "").lower().startswith(("prelim", "semi")) else "Finals")
                genders.add(gender)
                has_wind = False
                continue
        if not event:
            continue
        relay = event.startswith("4X")
        m = rel.match(ln) if relay else ind.match(ln)
        if not m:
            continue
        if not relay and (re.search(r"\s(FR|SO|JR|SR|\d{1,2})\s", " " + m.group(2) + " ")
                          or re.search(r"\s(Bowling|Furnace)$", m.group(2))):
            continue  # the school only ends in the name: "Catie Hollinger SR Bowling Green"
        place = m.group(1) if m.group(1).isdigit() else ""
        if relay:
            out.append({"gender": gender, "event": event, "rnd": rnd, "place": place, "mark": m.group(2),
                        "name": None, "year": "", "legs": []})
        else:
            extra = m.group(5).split()
            wind = extra[0] if has_wind and extra and re.match(r"^[-+]?\d+\.\d$", extra[0]) else ""  # "2" alone is a heat
            out.append({"gender": gender, "event": event, "rnd": rnd, "place": place, "mark": m.group(4),
                        "name": to_last_first(m.group(2)), "year": GRADES.get(m.group(3) or "", m.group(3) or ""),
                        "legs": None, "wind": wind})
    return out, (None, None), genders


def record_coverage(season, genders, level, rows, source):
    """Remember that this results file was checked, even when no Green athlete was in it."""
    path = os.path.join(DATA, "coverage.csv")
    cov = []
    if os.path.exists(path):
        with open(path, newline="", encoding="utf-8") as f:
            cov = list(csv.reader(f))[1:]
    for g in sorted(genders):
        n = sum(1 for r in rows if r[0] == g)
        status = "Complete" if n else "No Green athletes"
        old = next((c for c in cov if c[0] == str(season) and c[1] == g and c[2] == level and c[5] == source), None)
        note = old[6] if old and len(old) > 6 else ""
        if old and old[3] in ("Partial", "Missing"):
            status = old[3]  # set by a coach: keep it
        cov = [c for c in cov if c is not old]
        cov.append([str(season), g, level, status, str(n), source, note])
    cov.sort(key=lambda c: (c[0], c[1], c[2]))
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(COVERAGE_HEADER)
        w.writerows(cov)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--meet", required=True, help='Meet name to use, e.g. "State Track Meet"')
    ap.add_argument("--school", default="Greensburg Green|Uniontown Green|Green")
    ap.add_argument("--division", help="Only read this division (files that cover several divisions), e.g. 2")
    ap.add_argument("--prelims-date")
    ap.add_argument("--finals-date")
    ap.add_argument("--source", default="")
    ap.add_argument("--finals-meet", help="Meet name for finals-day results when the two days are separate meets "
                    "in the sheet, e.g. 'District Track Meet (Finals)'; --meet is then the first day")
    ap.add_argument("--event-dates", help='JSON of dates for events not on file, e.g. {"Boys|Discus": "2025-05-21"}')
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if is_milesplit(a.file):
        found, (d1, d2), genders_seen = parse_milesplit(a.file, a.school)
    elif is_athletic_net(a.file):
        found, (d1, d2), genders_seen = parse_athletic_net(a.file, a.school)
    else:
        found, (d1, d2), genders_seen = parse(a.file, a.school, a.division)
    d1, d2 = a.prelims_date or d1, a.finals_date or d2 or d1
    d1 = d1 or d2
    if not d2:
        sys.exit("No dates in the printout header. Pass --prelims-date and --finals-date (YYYY-MM-DD).")
    source = a.source or os.path.basename(a.file)

    known, by_last = {}, {}
    with open(os.path.join(DATA, "athletes.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            known[(r["Gender"], r["Athlete"].lower())] = r["Merge Into"].strip() or r["Athlete"]
            last, _, first = r["Athlete"].partition(",")
            if not r["Merge Into"].strip():
                by_last.setdefault((r["Gender"], last.strip().lower()), []).append((first.strip(), r["Athlete"]))
                bare = re.sub(r"\s+(jr\.?|sr\.?|ii|iii|iv)$", "", last.strip().lower())
                if bare != last.strip().lower():  # "McMichael III" is also found as "McMichael"
                    by_last.setdefault((r["Gender"], bare), []).append((first.strip(), r["Athlete"]))
    matched = {}

    # seasons each roster athlete competed, to break ties between same-last-name athletes
    active = {}
    with open(os.path.join(DATA, "results.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            active.setdefault((r["Gender"], r["Athlete"]), set()).add(r["Date"][:4])
    season_year = (d2 or d1 or "")[:4]

    def lookup(g, nm):
        if (g, nm.lower()) in known:
            return known[(g, nm.lower())], ""
        last, _, first = nm.partition(",")
        words = first.split()
        if len(words) > 1:  # two-word last names: "Edgar San Jose" was read as "Jose, Edgar San"
            alt = f"{words[-1]} {last.strip()}, {' '.join(words[:-1])}"
            if (g, alt.lower()) in known:
                return known[(g, alt.lower())], ""
        same_last = by_last.get((g, last.strip().lower()), [])
        cands = [full for f, full in same_last if close(f, first.strip())]
        if len(cands) != 1:  # e.g. "Earliyah" vs "Liyah": the only athlete with that last name that season
            cands = [full for f, full in same_last if season_year in active.get((g, full), set())]
        if len(cands) == 1:
            matched[nm] = cands[0]
            return cands[0], f"Listed as {nm.split(', ')[1]} {nm.split(', ')[0]}. "
        return None, ""

    # When the file has no per-event dates (Athletic.net copies), use the day this meet's event is already on file
    # (from Track Central), so results land on the same day; otherwise prelims on the first day, finals on the last.
    on_file = {}
    with open(os.path.join(DATA, "results.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["Meet"] in (a.meet, a.finals_meet) and d1 and d2 and d1 <= r["Date"] <= d2:
                on_file.setdefault((r["Gender"], r["Event"]), Counter())[r["Date"]] += 1

    event_dates = json.loads(a.event_dates) if a.event_dates else {}
    # relays the file lists without runners (MileSplit): take the lineup from the same relay already on file
    lineup_on_file = {}
    with open(os.path.join(DATA, "results.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            # same days, any meet name (Track Central's name for the meet can differ)
            if r["Relay Total"] and d1 <= r["Date"] <= d2 and not r["Status"].lower().startswith("ex") \
                    and r["Athlete"].strip().lower() != "unknown":
                lineup_on_file.setdefault((r["Gender"], r["Event"].replace(" (Trials)", ""), r["Relay Total"]), []).append(r["Athlete"])
    no_lineup = []
    for x in found:
        if x["legs"] == [] and x["name"] is None:
            legs = lineup_on_file.get((x["gender"], x["event"], x["mark"]))
            if not legs:  # same time written differently (45.7 / 45.70), or kept to the second (4:10 for 4:10.09)
                v = parse_time(x["mark"])
                for (g, e, t), names in lineup_on_file.items():
                    tv = parse_time(t)
                    if g == x["gender"] and e == x["event"] and v is not None and tv is not None \
                            and same_or_cut(t, v):
                        legs = names
                        break
            if legs:
                x["legs"] = [(n, "") for n in dict.fromkeys(legs)]
            else:
                no_lineup.append(f'{x["gender"]} {x["event"]} {x["rnd"].lower()} {x["mark"]} ({x["place"] or "no"} place)')
                x["legs"] = None

    rows, unmatched, grades = [], [], {}
    for x in found:
        ev = x["event"] + (" (Trials)" if x["rnd"] == "Prelims" else "")
        seen_day = on_file.get((x["gender"], ev))
        # a round can sit on two days in Track Central (its relay prelims are often labelled as finals):
        # finals take the later day, prelims the earlier
        date = x.get("date") or ((max(seen_day) if x["rnd"] == "Finals" else min(seen_day)) if seen_day else None) \
            or event_dates.get(f'{x["gender"]}|{x["event"]}') or (d1 if x["rnd"] == "Prelims" else d2)
        meet = a.finals_meet if a.finals_meet and date == d2 else a.meet
        n = x["place"]
        suf = "th" if n.isdigit() and 10 <= int(n) % 100 <= 20 else {"1": "st", "2": "nd", "3": "rd"}.get(n[-1:], "th")
        place = f"{n}{suf} place" if n.isdigit() else "no place"
        pl = n if n.isdigit() and x["rnd"] == "Finals" else ""
        mark = x["mark"].upper() if x["mark"].isalpha() else x["mark"]
        if mark == "FS":
            mark = "DQ"
        note = f"Prelims: {place}" if x["rnd"] == "Prelims" else ""
        if x["name"] is None and x["legs"] is None:
            # relay with no runners listed in the file or on file: keep the team with an "Unknown" placeholder
            # runner, so it still counts on the lists and shows on the Data Check page until someone fills it in
            rows.append([x["gender"], "Unknown", ev, meet, date, "", mark, "",
                         (note + ". " if note else "") + "Runners not listed in the results: add a row for each runner.", source, pl])
            continue
        if x["name"] is None and not x["legs"]:
            continue
        if x["legs"] is not None and parse_time(mark) is None:
            continue  # a relay that didn't finish (DNF/DQ): nothing to record for the runners
        if x["legs"] is not None:
            for nm, yr in x["legs"]:
                canon, extra = lookup(x["gender"], nm)
                grades[(x["gender"], canon or nm)] = yr
                if not canon:
                    unmatched.append((x["gender"], nm))
                rows.append([x["gender"], canon or nm, ev, meet, date, "", mark, "", (extra + note).strip(), source, pl])
        else:
            canon, extra = lookup(x["gender"], x["name"])
            grades[(x["gender"], canon or x["name"])] = x["year"]
            if not canon:
                unmatched.append((x["gender"], x["name"]))
            rows.append([x["gender"], canon or x["name"], ev, meet, date, mark, "", "", (extra + note).strip(), source, pl,
                         "", x.get("wind", "")])

    for r in rows:
        print("  " + " | ".join(r[:7]) + (f"   place {r[10]}" if r[10] else "") + (f"   ({r[8]})" if r[8] else ""))
    for k, v in matched.items():
        print(f"Matched {k!r} to roster name {v!r}")
    if no_lineup:
        print("Relays with no runners in the file or on file (added with an 'Unknown' runner to fill in):", "; ".join(no_lineup))
    if unmatched:
        print("NOT MATCHED to the roster (check spelling; added as written):", sorted(set(unmatched)))
    if False:
        print("Names not on the Athletes tab (nickname? check before trusting):", sorted(set(unmatched)))
    if not a.dry_run:
        record_coverage(int(d2[:4]), genders_seen, guess_meet_type(a.meet) or a.meet, rows, source)
    if a.dry_run or not rows:
        print(f"{len(rows)} rows found{' (dry run, nothing written)' if a.dry_run else ''}.")
        return

    path = os.path.join(DATA, "results.csv")
    with open(path, newline="", encoding="utf-8") as f:
        allrows = list(csv.reader(f))
    for col in ("Place", "Points", "Wind", "Series"):
        if col not in allrows[0]:
            allrows[0].append(col)
    for r0 in allrows[1:]:
        r0.extend([""] * (len(allrows[0]) - len(r0)))
    have = {tuple(c.strip().lower() for c in r[:7]) for r in allrows[1:]}

    def val(r):
        m = r[5] or r[6]
        return parse_field(m) if re.match(r"^\d+-", m) else parse_time(m)

    def base(e):  # prelims only match prelims, finals only finals
        return e.lower()

    # Same athlete, event and mark within a few days = already entered (maybe under another meet name or date)
    near = {}
    for r in allrows[1:]:
        d = parse_date(r[4])
        if d:
            near.setdefault((r[0], r[1].lower(), base(r[2])), []).append((d, val(r), r))
    add, dupes, filled_places = [], [], []
    seen_batch = set()
    for r in rows:
        kb = tuple(c.strip().lower() for c in r[:7])
        if kb in seen_batch:
            continue
        seen_batch.add(kb)
        if tuple(c.strip().lower() for c in r[:7]) in have:
            for old in allrows[1:]:
                if tuple(c.strip().lower() for c in old[:7]) == tuple(c.strip().lower() for c in r[:7]):
                    while len(old) < 11:
                        old.append("")
                    if r[10] and not old[10]:
                        old[10] = r[10]
                        filled_places.append(f"{old[1]} {old[2]} {old[4]}: place {r[10]}")
                    if len(r) > 12 and r[12] and not old[12]:
                        old[12] = r[12]
            continue
        d, v = parse_date(r[4]), val(r)
        if r[6] and not r[5]:
            # A relay with no split: the same team time for this runner a few days either side is the same
            # relay (Track Central rows carry the runner's split in Mark). Keep that row, which has the split,
            # and take the official round label and place.
            rb = r[2].lower().replace(" (trials)", "")
            old = next((o for o in allrows[1:] if o[0] == r[0] and o[1].lower() == r[1].lower()
                        and o[2].lower().replace(" (trials)", "") == rb and o[6]
                        and not (o[7] or "").lower().startswith("ex") and parse_date(o[4])
                        and abs((parse_date(o[4]) - d).days) <= 3 and v is not None
                        and parse_time(o[6]) is not None and same_or_cut(o[6], v)), None)
            if old:
                while len(old) < 11:
                    old.append("")
                if old[2] != r[2]:
                    old[2] = r[2]
                    filled_places.append(f"{old[1]} {old[2]} {old[4]}: round label set from the official results")
                    if "(Trials)" in r[2]:  # a prelim keeps its place in Notes, not the Place column
                        old[10] = ""
                        if r[8] and r[8] not in old[8]:
                            old[8] = (old[8] + " " if old[8] else "") + r[8]
                if r[10] and old[10] != r[10]:  # the official place wins
                    old[10] = r[10]
                    filled_places.append(f"{old[1]} {old[2]} {old[4]}: place {r[10]}")
                if r[6].count(".") and len(r[6].split(".")[1]) > len((old[6].split(".") + [""])[1]):  # official time to the hundredth
                    old[6] = r[6]
                dupes.append(f"{r[1]} {r[2]} {r[6]} (already on file: {old[3]}, {old[4]})")
                continue
        def same(x):
            if v is None or x[1] is None or abs((x[0] - d).days) > 3:
                return False
            if abs(x[1] - v) < 0.005:
                return True
            # Track Central sometimes rounds times to the second (5:17 vs 5:17.84)
            old_mark = x[2][5] or x[2][6]
            return ":" in old_mark and "." not in old_mark and 0 <= v - x[1] < 1.0
        hit = next((x for x in near.get((r[0], r[1].lower(), base(r[2])), []) if same(x)), None)
        if hit:
            old = hit[2]
            while len(old) < 11:
                old.append("")
            if r[10] and not old[10]:
                old[10] = r[10]
                filled_places.append(f"{old[1]} {old[2]} {old[4]}: place {r[10]}")
            if len(r) > 12 and r[12] and not old[12]:
                old[12] = r[12]
            dupes.append(f"{r[1]} {r[2]} {r[5] or r[6]} (already on file: {hit[2][3]}, {hit[2][4]})")
        else:
            add.append(r)
    for x in dupes:
        print("Already on file, skipped:", x)
    # Official results win: a Track Central row for the same athlete, event and round a few days
    # either side with a different mark is a typo or a mislabeled prelim. Hide it (Status = Exclude).
    replaced = []
    for r in rows:
        if r[6] and not r[5]:
            continue  # relays: team times are checked by hand
        d, v = parse_date(r[4]), val(r)
        for old in allrows[1:]:
            if old[0] != r[0] or old[1].lower() != r[1].lower() or old[2].lower() != r[2].lower():
                continue
            if (old[9] if len(old) > 9 else "") != "Track Central" or (old[7] or "").lower().startswith("ex"):
                continue
            od = parse_date(old[4])
            ov = val(old)
            if od and v is not None and ov is not None and abs((od - d).days) <= 3 and abs(ov - v) >= 0.005 \
                    and not (":" in old[5] and "." not in old[5] and 0 <= v - ov < 1.0):
                old[7] = "Exclude"
                old[8] = (old[8] + " " if old[8] else "") + f"Official result is {r[5]} ({source})."
                if len(old) > 11 and old[11]:  # keep the Track Central points with the corrected mark
                    r.extend([""] * (12 - len(r)))
                    r[11] = r[11] or old[11]
                    old[11] = ""  # counted once, on the official row
                replaced.append(f"{old[1]} {old[2]} {old[4]}: Track Central {old[5]} -> official {r[5]}")
    # A Track Central row that matches an official result from the *other* round (a prelim saved as a final,
    # or the reverse) is the same performance under the wrong label: hide the copy.
    for r in rows:
        d, v = parse_date(r[4]), val(r)
        rb = r[2].lower().replace(" (trials)", "")
        for old in allrows[1:]:
            if old[0] != r[0] or old[1].lower() != r[1].lower() or old[2].lower() == r[2].lower():
                continue
            if old[2].lower().replace(" (trials)", "") != rb:
                continue
            if (old[9] if len(old) > 9 else "") != "Track Central" or (old[7] or "").lower().startswith("ex"):
                continue
            od, ov = parse_date(old[4]), val(old)
            if od and v is not None and ov is not None and abs((od - d).days) <= 3 and abs(ov - v) < 0.005:
                if any(x[1].lower() == old[1].lower() and x[2].lower() == old[2].lower() and abs((val(x) or -1) - ov) < 0.005 for x in rows):
                    continue  # the official file has this mark in the same round too
                old[7] = "Exclude"
                old[8] = (old[8] + " " if old[8] else "") + f"Same as the official {'prelim' if '(Trials)' in r[2] else 'final'} ({source})."
                replaced.append(f"{old[1]} {old[2]} {old[4]}: Track Central round label fixed ({r[2]})")
    for x in replaced:
        print("Replaced:", x)
    with open(path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(allrows + [r + [""] * (len(allrows[0]) - len(r)) for r in add])
    for x in filled_places:
        print("Place filled in:", x)

    mpath = os.path.join(DATA, "meets.csv")
    with open(mpath, newline="", encoding="utf-8") as f:
        meets = list(csv.reader(f))
    mhave = {(r[0], r[1]) for r in meets[1:]}
    for d, m in sorted({(r[4], r[3]) for r in add}):
        if (d, m) not in mhave:
            mhave.add((d, m))
            meets.append([d, m, "", guess_meet_type(m), ""])
    meets = [meets[0]] + sorted(meets[1:], key=lambda r: (r[0], r[1]))
    with open(mpath, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(meets)
    # Grad years from the grade column (only fills blanks)
    season = int(d2[:4])
    with open(os.path.join(ROOT_CFG), encoding="utf-8") as f:
        complete_from = int(json.load(f).get("complete_from", 0) or 0)
    apath = os.path.join(DATA, "athletes.csv")
    with open(apath, newline="", encoding="utf-8") as f:
        ath = list(csv.reader(f))
    filled = []
    for r in ath[1:]:
        yr = grades.get((r[0], r[1]))
        g = {"FR": 9, "SO": 10, "JR": 11, "SR": 12}.get(str(yr).upper(), int(yr) if str(yr).isdigit() else 0)
        if 9 <= g <= 12 and not r[2].strip():
            r[2] = str(season + 12 - g)
            filled.append(f"{r[1]} ({r[2]})")
    # Athletes who aren't on the roster yet (older seasons): add them
    have_ath = {(r[0], r[1]) for r in ath[1:]}
    for r in add:
        if (r[0], r[1]) not in have_ath and not r[1].startswith("(") and r[1] != "Unknown" and season < complete_from:
            yr = grades.get((r[0], r[1]))
            g = {"FR": 9, "SO": 10, "JR": 11, "SR": 12}.get(str(yr).upper(), int(yr) if str(yr).isdigit() else 0)
            ath.append([r[0], r[1], str(season + 12 - g) if 9 <= g <= 12 else "", "", "", "Added from " + source])
            have_ath.add((r[0], r[1]))
            filled.append(f"{r[1]} (new athlete)")
    with open(apath, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(ath)
    if filled:
        print("Grad years filled in:", ", ".join(filled))

    epath = os.path.join(DATA, "events.csv")
    with open(epath, newline="", encoding="utf-8") as f:
        evs = list(csv.reader(f))
    known_ev = {r[0].lower() for r in evs[1:]}
    for e in sorted({r[2] for r in add}):
        if e.lower() not in known_ev and event_row(e):
            evs.append(event_row(e))
    evs = [evs[0]] + sorted(evs[1:], key=lambda r: (int(r[11] or 999), r[5] != "Final", r[0]))
    with open(epath, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(evs)
    print(f"Added {len(add)} new rows ({len(rows) - len(add)} already there).")


if __name__ == "__main__":
    main()
