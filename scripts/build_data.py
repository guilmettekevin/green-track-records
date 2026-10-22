"""Turn the four data tabs (data/*.csv) into the website's data file (site/data/db.json).

Usage:  python scripts/build_data.py
Also prints a short data-quality summary (the full list is on the site's Data Check page).
"""
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from marks import parse_time, parse_field, parse_date, decimals, fmt_field, guess_meet_type  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "site", "data", "db.json")

HAND, PRELIM, FLAGGED, NOMARK, WINDY, ASTER = 1, 2, 4, 8, 16, 32  # WINDY: tailwind over +2.0 m/s; ASTER: "*" = uncertain, see note
LEGS_EXPECTED = {"SMR": 4, "DMR": 4}
# A relay row whose Athlete is one of these is a placeholder: the team time is known, the runners aren't (yet).
UNKNOWN_RUNNER = {"unknown", "unknown runner", "?", "tbd"}


def rows(name):
    p = os.path.join(DATA, name)
    with open(p, newline="", encoding="utf-8-sig") as f:
        out = [{k.strip(): (v or "").strip() for k, v in r.items() if k} for r in csv.DictReader(f)]
    return out  # blank rows are kept so row numbers still match the sheet


def show(spec, raw, v):
    """Consistent display: 5-06 -> 5-6, 104.2 -> 1:44.2, keeping the precision that was entered."""
    if v is None or v <= 0:
        return raw
    if spec["typ"] in ("Field", "Field Relay"):
        return fmt_field(v)
    dp = min(decimals(raw), 2)
    if v >= 60:
        m = int(v // 60)
        sec = v - m * 60
        w = 3 + dp if dp else 2
        return f"{m}:{sec:0{w}.{dp}f}"
    return f"{v:.{dp}f}"


NO_MARK_CODES = {"tbd", "pending", "nm", "nh", "nt", "dnf", "dns", "dq", "foul", "f", "scr", "q"}


def no_mark_code(raw):
    """TBD / NM / DNF / DQ / DNS etc.: the athlete was there, but there's no mark to rank."""
    t = (raw or "").strip().lower().rstrip(".")
    return t.upper() if t in NO_MARK_CODES else None


VERTICAL = {"High Jump", "Pole Vault"}


def parse_series(raw, spec):
    """'Series' column -> (tidy text, best mark value or None, problem or None).
    Horizontal: '17-10, F, 16-7.25, P'.  Vertical: '5-8 XO, 5-10 O, 6-0 XXX' (O make, X miss, P pass)."""
    toks = [t.strip() for t in re.split(r"[,;]", raw or "") if t.strip()]
    if not toks:
        return "", None, None
    out, best = [], None
    if spec["std"] in VERTICAL:
        for t in toks:
            m = re.match(r"^(\S+)\s+([XOP\-–/]{1,3})$", t, re.I)
            h = spec["parse"](m.group(1)) if m else None
            if not h:
                return raw, None, f"can't read '{t}' (use height then attempts, like 5-8 XO)"
            att = m.group(2).upper().replace("–", "-").replace("/", "P")
            out.append(f"{m.group(1)} {att}")
            if "O" in att:
                best = max(best or 0, h)
    else:
        for t in toks:
            u = t.upper().rstrip(".")
            if u in ("F", "X", "P", "-", "FOUL", "PASS", "–"):
                out.append({"FOUL": "F", "X": "F", "PASS": "P", "–": "-"}.get(u, u))
                continue
            v = spec["parse"](t)
            if not v:
                return raw, None, f"can't read '{t}'"
            out.append(t)
            best = max(best or 0, v)
    return ", ".join(out), best, None


def too_good(spec, v, total):
    """Faster (or farther) than the Events-tab limit. Slow/short marks are left alone:
    they can never reach a top list, so they are not worth a coach's time."""
    if spec["typ"] in ("Field", "Field Relay"):
        lim = spec["tmax"] if total else spec["max"]
        return bool(lim) and v > lim
    lim = spec["tmin"] if total else spec["min"]
    return bool(lim) and v < lim


def load_config():
    p = os.path.join(ROOT, "config.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    return {}


def wind_text(raw):
    """'1.4', '+1.4', '-0.3' -> '+1.4' / '-0.3'; blank or NWI -> ''."""
    try:
        v = float(str(raw).strip().replace("+", ""))
    except ValueError:
        return ""
    return f"{v:+.1f}" if abs(v) >= 0.05 else "0.0"


def main():
    cfg = load_config()
    review = defaultdict(list)

    # ---- Events ---------------------------------------------------------
    raw_events, std_events = {}, {}
    for r in rows("events.csv"):
        if not r.get("Event") or not r.get("Standard Event"):
            continue
        typ = r["Type"]
        is_field = typ in ("Field", "Field Relay")
        parse = parse_field if is_field else parse_time
        spec = {
            "std": r["Standard Event"], "typ": typ, "leg": r["Leg"],
            "prelim": r["Round"].lower().startswith("prelim"),
            "hand": r["Hand Timed"].upper().startswith("Y"),
            "parse": parse,
            "min": parse(r["Mark Min"]), "max": parse(r["Mark Max"]),
            "tmin": parse(r["Total Min"]), "tmax": parse(r["Total Max"]),
        }
        raw_events[r["Event"].lower()] = spec
        s = std_events.setdefault(r["Standard Event"], {
            "k": r["Standard Event"], "n": r["Display Name"] or r["Standard Event"],
            "t": {"Running": "run", "Field": "field", "Relay": "relay", "Field Relay": "frelay"}.get(typ, "run"),
            "h": 1 if spec["hand"] else 0, "o": int(r["Order"] or 999),
        })
        if s["o"] >= 900 and s["o"] < 999:
            s["l"] = 1  # legacy event in yards (Order 900-998)
        if r["Leg"]:
            s.setdefault("legs", [])
            if r["Leg"] not in s["legs"]:
                s["legs"].append(r["Leg"])
    events = sorted(std_events.values(), key=lambda e: (e["o"], e["n"]))
    eidx = {e["k"]: i for i, e in enumerate(events)}

    # ---- Athletes -------------------------------------------------------
    ath_rows = {(r["Gender"], r["Athlete"]): r for r in rows("athletes.csv") if r.get("Athlete")}

    def resolve(g, name):
        seen = set()
        while True:
            r = ath_rows.get((g, name))
            if not r or not r["Merge Into"] or name in seen:
                return name
            seen.add(name)
            name = r["Merge Into"]

    athletes, aidx = [], {}

    def athlete_id(g, name):
        name = resolve(g, name)
        k = (g, name)
        if k not in aidx:
            r = ath_rows.get(k, {})
            gy = r.get("Grad Year", "")
            aidx[k] = len(athletes)
            athletes.append([name, "B" if g.lower().startswith("b") else "G",
                             int(gy) if gy.isdigit() else 0,
                             1 if r.get("Hide", "").upper().startswith("Y") else 0])
        return aidx[k]

    # ---- Meets ----------------------------------------------------------
    meet_map = {}
    for r in rows("meets.csv"):
        d = parse_date(r["Date"])
        if d:
            disp = r["Display Name"] or r["Meet"]
            meet_map[(d.isoformat(), r["Meet"].lower())] = (disp, r["Meet Type"] or guess_meet_type(disp) or guess_meet_type(r["Meet"]), (r.get("Notes") or "").strip())
    meets, midx = [], {}

    def meet_id(d, name):
        disp, typ, note = meet_map.get((d, name.lower()), (name, guess_meet_type(name), ""))
        k = (d, disp.lower())
        if k not in midx:
            midx[k] = len(meets)
            meets.append([d, disp, typ])
        elif typ and not meets[midx[k]][2]:
            meets[midx[k]][2] = typ
        if note and len(meets[midx[k]]) < 4:
            meets[midx[k]].append(note)  # [date, name, type, note]: the meet page shows the note (final scores etc.)
        return midx[k]

    # ---- Results --------------------------------------------------------
    all_rows = rows("results.csv")
    # Track Central has no mixed roster, so mixed-relay runners get added to the other team's roster
    # too. When a name is on both rosters but has individual results on only one, that's their team.
    ind_g, all_g, nonmixed_g = defaultdict(set), defaultdict(set), defaultdict(Counter)
    for r in all_rows:
        sp = raw_events.get(r["Event"].lower())
        if not sp or not r["Athlete"] or r["Athlete"].strip().lower() in UNKNOWN_RUNNER:
            continue
        all_g[r["Athlete"]].add(r["Gender"])
        if sp["typ"] in ("Running", "Field"):
            ind_g[r["Athlete"]].add(r["Gender"])
        elif "Mixed" not in sp["std"]:
            nonmixed_g[r["Athlete"]][r["Gender"]] += 1
    fix_gender = {}
    for name, gs in all_g.items():
        if len(gs) < 2:
            continue
        if len(ind_g[name]) == 1:
            keep = next(iter(ind_g[name]))
        elif not ind_g[name]:  # relays only, on both rosters
            keep = (nonmixed_g[name].most_common(1) or [(sorted(gs)[0], 0)])[0][0]
            review["names"].append({"athlete": name, "gender": keep[0],
                                    "why": f"only ran relays and is on both rosters; counted as {keep}"})
        else:
            continue  # individual results on both rosters: flagged below as a name question
        for g in gs - {keep}:
            fix_gender[(g, name)] = keep

    results, relay_groups, relay_notes = [], {}, {}
    excluded = 0
    for n, r in enumerate(all_rows, start=2):
        if not any(r.values()):
            continue
        status = r.get("Status", "").lower()
        if status.startswith("ex"):
            excluded += 1
            continue
        g, name, ev = r["Gender"], r["Athlete"], r["Event"]
        g = fix_gender.get((g, name), g)
        where = {"row": n, "athlete": name, "gender": g, "event": ev, "meet": r["Meet"], "date": r["Date"]}
        spec = raw_events.get(ev.lower())
        if not spec:
            review["unknown_event"].append(where)
            continue
        d = parse_date(r["Date"])
        if not d or not name or not g:
            review["bad_row"].append({**where, "why": "missing or unreadable date/name/gender"})
            continue
        unknown = name.strip().lower() in UNKNOWN_RUNNER
        if unknown and spec["typ"] in ("Running", "Field"):
            review["bad_row"].append({**where, "why": "'Unknown' only works for relay runners"})
            continue
        a = None if unknown else athlete_id(g, name)
        m = meet_id(d.isoformat(), r["Meet"] or "Unknown meet")
        trust = status == "ok"
        flags = PRELIM if spec["prelim"] else 0
        pl = r.get("Place", "")
        place = int(pl) if pl.isdigit() else 0
        wind = wind_text(r.get("Wind") or "")
        tail = ([place, wind] if wind else [place] if place else [])
        series = ""
        if spec["typ"] == "Running" and (r.get("Series") or "").strip():
            laps = [t.strip() for t in re.split(r"[,;]", r["Series"]) if t.strip()]
            lv = [spec["parse"](t) for t in laps]
            mv = spec["parse"](re.sub(r"\s*h$", "", r["Mark"].strip(), flags=re.I)) if not no_mark_code(r["Mark"]) else None
            if None in lv or not mv or abs(sum(lv) - mv) > 0.2:
                review["marks"].append({**where, "mark": r["Series"], "why": "lap splits don't add up to the mark (splits hidden)"})
            else:
                series = "|" + ", ".join(laps)  # leading | marks lap splits
                tail = [place, wind or None, series]
        elif spec["typ"] == "Field" and (r.get("Series") or "").strip():
            series, s_best, s_bad = parse_series(r["Series"], spec)
            if s_bad:
                review["marks"].append({**where, "mark": r["Series"], "why": "series: " + s_bad + " (series hidden)"})
                series = ""
            else:
                mv = spec["parse"](r["Mark"]) if not no_mark_code(r["Mark"]) else 0
                if abs((s_best or 0) - (mv or 0)) > 0.01:
                    review["marks"].append({**where, "mark": r["Mark"], "why": f"best in the series ({series}) doesn't match the mark (series hidden)"})
                    series = ""
        if series:
            tail = [place, wind or None, series]

        if spec["typ"] in ("Running", "Field"):
            mark = r["Mark"]
            aster = mark.strip().endswith("*")
            if aster:
                mark = mark.strip()[:-1].strip()
                flags |= ASTER
            forced_hand = spec["typ"] == "Running" and bool(re.match(r"^[\d:.]+\s*h$", mark.strip(), re.I))
            if forced_hand:  # "4:38h": hand timed, typed with an h (dual meets and old results)
                mark = mark.strip()[:-1].strip()
            code = no_mark_code(mark)
            if code:
                results.append([a, eidx[spec["std"]], m, 0, code, flags | NOMARK] + (tail if series else [place] if place else []))
                continue
            v = spec["parse"](mark)
            if v is None:
                review["marks"].append({**where, "mark": mark, "why": "unreadable mark"})
                continue
            if (spec["hand"] and decimals(mark) <= 1) or forced_hand:
                flags |= HAND
            if v <= 0:
                flags |= NOMARK
            elif not trust and too_good(spec, v, False):
                flags |= FLAGGED
                review["marks"].append({**where, "mark": mark, "why": "better than looks possible"})
            if wind and float(wind) > 2.0:
                flags |= WINDY
            if aster:  # note shown with the asterisk: [.., place, wind, series, note]
                tail = (tail + [None, None, None])[:3]
                tail[0] = tail[0] or 0
                tail.append((r.get("Notes") or "").strip())
            results.append([a, eidx[spec["std"]], m, round(v, 3), show(spec, mark, v), flags] + tail)
        else:
            total = (r["Relay Total"] or r["Mark"]).strip()
            r_aster = total.endswith("*")
            if r_aster:
                total = total[:-1].strip()
            leg_aster = bool(r["Relay Total"]) and r["Mark"].strip().endswith("*")
            forced_hand = bool(re.match(r"^[\d:.]+\s*h$", (total or "").strip(), re.I))
            if forced_hand:
                total = total.strip()[:-1].strip()
            tv = spec["parse"](total)
            if tv is None:
                review["marks"].append({**where, "mark": total, "why": "unreadable relay total"})
                continue
            split = r["Mark"].strip().rstrip("*").strip() if r["Relay Total"] else ""
            sv = spec["parse"](split) if split else None
            if split and (sv is None or sv <= 0 or (not trust and too_good(spec, sv, False))):
                if sv:
                    review["splits"].append({**where, "mark": split, "why": "relay split looks wrong (hidden)"})
                split = ""
            if tv <= 0:
                continue
            roster = r["Gender"]
            gk = "X" if "Mixed" in spec["std"] else ("B" if roster.lower().startswith("b") else "G")
            key = (spec["std"], gk, m, round(tv, 2))
            grp = relay_groups.get(key)
            if not grp:
                f = flags
                if (spec["hand"] and decimals(total) <= 1) or forced_hand:
                    f |= HAND
                if not trust and too_good(spec, tv, True):
                    f |= FLAGGED
                    review["marks"].append({**where, "mark": total, "why": "relay total better than looks possible"})
                grp = relay_groups[key] = [eidx[spec["std"]], m, gk, round(tv, 3), show(spec, total, tv), f, [], place]
            elif trust:
                grp[5] &= ~FLAGGED
            if place and not grp[7]:
                grp[7] = place
            if r_aster or leg_aster:
                if r_aster:
                    grp[5] |= ASTER
                nt = (r.get("Notes") or "").strip()
                if nt and nt not in relay_notes.setdefault(id(grp), []):
                    relay_notes[id(grp)].append(nt)
            if unknown:
                continue  # placeholder: the team is on file, this runner isn't
            leg = [a, show(spec, split, sv) if split else ""]
            if spec["leg"] or leg_aster:
                leg.append(spec["leg"] or "")
            if leg_aster:
                leg.append("*")
            if not any(x[0] == a and x[2:] == leg[2:] for x in grp[6]):
                grp[6].append(leg)
    # A "boys" or "girls" relay whose runners include both teams was really a mixed relay
    std_by_idx = {i: e["k"] for i, e in enumerate(events)}
    fixed = {}
    for key, grp in relay_groups.items():
        teams = {athletes[leg[0]][1] for leg in grp[6]}
        if grp[2] != "X" and len(teams) > 1:
            mixed_k = std_by_idx[grp[0]] + " Mixed"
            if mixed_k in eidx:
                grp[0], grp[2] = eidx[mixed_k], "X"
                key = (mixed_k, "X", grp[1], round(grp[3], 2))
        if key in fixed:  # same team entered on both rosters
            for leg in grp[6]:
                if not any(x[0] == leg[0] and x[2:] == leg[2:] for x in fixed[key][6]):
                    fixed[key][6].append(leg)
        else:
            fixed[key] = grp
    relays = list(fixed.values())

    # ---- Relay points: every runner gets an equal share (1/4 of a 4x relay) ----
    # Track Central meets are set up differently: some give each relay runner 1/4 of the relay's points,
    # others 1/2 (or 2/3 for a 3-person field relay, or "half each" regardless of size). To be consistent,
    # work out the points the relay itself earned (P) and give each runner P / runners.
    def pts_parts(raw):
        """'5' -> [5.0]; '1.25+1.25' (a double-dual: one entry per opponent) -> [1.25, 1.25]."""
        try:
            return [float(x) for x in raw.split("+") if x.strip()]
        except ValueError:
            return []

    def relay_share_points():
        def legs_of(spec):
            k = spec["std"].replace(" Mixed", "")
            return LEGS_EXPECTED.get(k) or (int(k[0]) if k[0].isdigit() else 4)
        groups = defaultdict(lambda: {"ind": defaultdict(Counter), "rel": {}})
        for n, r in enumerate(all_rows):
            raw = (r.get("Points") or "").strip()
            pl = (r.get("Place") or "").strip()
            spec = raw_events.get((r.get("Event") or "").lower())
            if not raw or not pl.isdigit() or not spec:
                continue
            parts = pts_parts(raw)
            if not parts:
                continue
            pv = parts[0]
            gk = (r["Date"], r["Meet"].lower(), r["Gender"])
            if spec["typ"] in ("Running", "Field"):
                groups[gk]["ind"][int(pl)][pv] += 1
            else:
                ek = (spec["std"], r["Relay Total"] or r["Mark"])
                e = groups[gk]["rel"].setdefault(ek, {"n": legs_of(spec), "pl": int(pl), "p": pv, "parts": parts, "rows": []})
                e["rows"].append(n)
        out, log = {}, Counter()
        season_mode = defaultdict(Counter)

        def near(a, b):
            return abs(a - b) < 0.02

        # Standard place-points tables, used to fill in places nobody from Green scored in an individual event
        STD = [[5, 3, 1], [10, 8, 6, 5, 4, 3, 2, 1], [10, 8, 6, 4, 2, 1], [8, 6, 4, 2, 1], [6, 4, 3, 2, 1]]

        def fill(table):
            fits = [t for t in STD if any(pl <= len(t) and near(t[pl - 1], v) for pl, v in table.items())
                    and all(pl <= len(t) and near(t[pl - 1], v) for pl, v in table.items() if v == int(v))]
            full = dict(table)
            if fits:
                for pl in range(1, max(len(t) for t in fits) + 1):
                    vals = {t[pl - 1] if pl <= len(t) else 0 for t in fits}
                    if len(vals) == 1:  # standard value wins over an odd one (a tie splits points)
                        full[pl] = vals.pop()
            return full

        # How a meet shared a relay's points (P) between its n runners, i.e. what each runner was given:
        #   q = P/n (a quarter each)   d = 2P/n (half each on a 4x)   h = P/2 regardless of size   f = all of P each
        def cands(e):
            p, n = e["p"], e["n"]
            out_ = []
            for k, P in (("q", p * n), ("d", p * n / 2), ("h", p * 2), ("f", p)):
                if not any(near(P, Q) for _, Q in out_):
                    out_.append((k, P))
            return out_

        def label(k):
            return "d" if k == "h" else k

        def choose(e, table, top):
            want = table.get(e["pl"])
            if want is None:
                return None
            for k, P in cands(e):
                if P <= top + 0.01 and near(P, want):
                    return (k, P)
            return None

        def by_mode(e, m):
            p, n = e["p"], e["n"]
            if m == "q":
                return ("q", p * n)
            if m == "f":
                return ("f", p)
            if n == 4:
                return ("d", p * 2)
            P2 = p * n / 2  # 3- or 2-person field relay in a "half points" meet
            return ("d", P2) if abs(P2 * 2 - round(P2 * 2)) < 0.05 else ("h", p * 2)

        resolved = {}
        for gk, G in groups.items():
            # Individual-event scoring at this meet. Relay meets sometimes list field relays as individual events
            # (points like 1.66), so only trust a table that looks like a standard one.
            raw = {pl: c.most_common(1)[0][0] for pl, c in G["ind"].items()}
            raw = {pl: v for pl, v in raw.items() if near(v * 2, round(v * 2))}
            T = fill(raw)
            if not any(all(pl <= len(t) and near(t[pl - 1], v) for pl, v in raw.items() if v == int(v)) and raw for t in STD):
                T = {}
            if "relay" in gk[1]:
                # Relay carnivals score their few open events their own way (and often list field relays as
                # individual events), so work these meets out from the relays themselves.
                T = {}
            top = max(T.values()) if T else 10
            G["T"], G["top"] = T, top
            for ek, e in G["rel"].items():
                if e["n"] != 4:
                    continue
                hit = choose(e, T, top)
                if not hit:  # a relay can't be worth more than the meet's 1st place
                    ok = [(k, P) for k, P in cands(e) if P <= top + 0.01]
                    if len(ok) == 1:
                        hit = ok[0]
                if hit:
                    resolved[(gk, ek)] = hit
                    season_mode[(gk[0][:4], gk[2])][label(hit[0])] += 1

        def group_mode(gk):
            return Counter(label(resolved[(gk, ek)][0]) for ek in groups[gk]["rel"] if (gk, ek) in resolved)

        for gk, G in groups.items():
            mode = group_mode(gk)
            other = Counter()
            for g2 in ("Boys", "Girls"):
                if g2 != gk[2] and (gk[0], gk[1], g2) in groups:
                    other += group_mode((gk[0], gk[1], g2))
            sm = (season_mode[(gk[0][:4], gk[2])].most_common(1) or [("", 0)])[0][0]
            m = (mode.most_common(1) or [("", 0)])[0][0]
            if not m:
                # No relay here could be checked against a table. Pick the reading that gives whole-number relay
                # points sitting where a standard table puts them (and no more than 10); the way the rest of this
                # team's season was scored counts too. Ties go to the other team at the meet, then the season.
                def score(k):
                    sc = 2 * (sm == k)
                    for e in G["rel"].values():
                        if e["n"] != 4:
                            continue
                        P = by_mode(e, k)[1]
                        if P > G["top"] + 0.01:
                            sc -= 5
                            continue
                        sc += near(P, round(P)) + any(e["pl"] <= len(t) and near(t[e["pl"] - 1], P) for t in STD)
                    return sc
                sc = {k: score(k) for k in ("q", "d", "f")}
                best = max(sc.values())
                tied = [k for k in ("q", "d", "f") if sc[k] == best]
                m = tied[0] if len(tied) == 1 else next(
                    (k for k, _ in other.most_common() if k in tied), sm if sm in tied else tied[0])
            T = dict(G["T"])
            for ek, e in G["rel"].items():
                if (gk, ek) in resolved:
                    T.setdefault(e["pl"], resolved[(gk, ek)][1])
            T = fill(T)
            top = max(T.values()) if T else 10
            # 4-person relays first: what they scored tells us what each place was worth for the field relays
            for ek, e in sorted(G["rel"].items(), key=lambda kv: kv[1]["n"] != 4):
                hit = resolved.get((gk, ek)) or choose(e, T, top)
                how = "table" if hit else "mode"
                if not hit:
                    hit = by_mode(e, m)
                    if hit[1] > top + 0.01:  # worth more than first place: it must have been a bigger share
                        hit = max(((k, P) for k, P in cands(e) if P <= top + 0.01), key=lambda kp: kp[1], default=hit)
                P = hit[1]
                if e["n"] == 4:
                    T.setdefault(e["pl"], P)
                log[(hit[0], how)] += 1
                # a double-dual scores the relay once per opponent, shared the same way each time
                total = sum(P * x / e["p"] for x in e["parts"]) if e["p"] else 0
                for n in e["rows"]:
                    out[n] = round(total / e["n"], 3)
        return out, log

    relay_pts, relay_log = relay_share_points()

    # ---- Points (Track Central "Scoring Performances" reports) ------------
    # Relay points are already split between runners. A mixed-relay runner can be on both rosters,
    # so each athlete's performance counts once: same athlete, date and mark.
    # JV meets (JV league meet, last-chance meet) don't count toward points. The varsity league meet's
    # points (both days, whatever Track Central called it) make up the season's league finish.
    def meet_info(r):
        d0 = parse_date(r["Date"])
        disp, typ, _ = meet_map.get((d0.isoformat() if d0 else "", r["Meet"].lower()), (r["Meet"], guess_meet_type(r["Meet"]), ""))
        return disp, typ or ""
    def is_jv(name):
        return bool(re.search(r"\bJV\b|last chance", name, re.I))
    pts_seen, pts_by = set(), defaultdict(float)
    league_pts, league_meets = defaultdict(float), defaultdict(set)
    for n, r in enumerate(all_rows):
        raw = (r.get("Points") or "").strip()
        if not raw:
            continue
        disp, mtyp = meet_info(r)
        if is_jv(disp) or is_jv(r["Meet"]):
            continue
        pv = relay_pts.get(n, sum(pts_parts(raw)))
        if not pv and not pts_parts(raw):
            continue
        g = fix_gender.get((r["Gender"], r["Athlete"]), r["Gender"])
        k = (g, resolve(g, r["Athlete"]))
        d = parse_date(r["Date"])
        if k not in aidx or not d:
            continue
        a = aidx[k]
        spec = raw_events.get(r["Event"].lower())
        mk = r["Relay Total"] or r["Mark"]
        v = spec["parse"](mk) if spec else None
        key = (a, d.isoformat(), round(v, 2) if v is not None else mk)
        if key in pts_seen:
            continue
        pts_seen.add(key)
        pts_by[(a, d.year)] += pv
        if mtyp == "League":
            league_pts[(d.year, athletes[a][1])] += pv
            league_meets[(d.year, athletes[a][1])].add(disp)
    pts_seasons = defaultdict(set)
    for c in (rows("coverage.csv") if os.path.exists(os.path.join(DATA, "coverage.csv")) else []):
        if c.get("Level") == "Points" and c.get("Status") == "Complete" and c.get("Season", "").isdigit():
            pts_seasons[int(c["Season"])].add(c.get("Team", "")[:1])
    if not pts_seasons:  # points typed in by hand, no report recorded
        for (a, y) in pts_by:
            pts_seasons[y].add(athletes[a][1])
    print("  relay points (q = runners already got 1/n, d = 2/n, h = half each, f = full points each):", dict(sorted(relay_log.items())))
    points = {"seasons": {str(y): sorted(gs) for y, gs in sorted(pts_seasons.items())},
              "by": [[a, y, round(v, 3)] for (a, y), v in sorted(pts_by.items())]}

    # ---- Relay sanity: legs listed ---------------------------------------
    for rl in relays:
        e = events[rl[0]]
        k = e["k"]
        want = LEGS_EXPECTED.get(k) or (int(k[0]) if k[0].isdigit() else 4)
        if len(rl[6]) < want:
            # runners still to find: shown as "+N not on file" on the site and listed on the Data Check page
            rl.append(want - len(rl[6]))
            review["relay_missing"].append({"event": e["n"], "g": rl[2], "meet": meets[rl[1]][1], "date": meets[rl[1]][0],
                                            "mark": rl[4], "place": rl[7], "want": want, "prelim": 1 if rl[5] & PRELIM else 0,
                                            "names": [athletes[x[0]][0] for x in rl[6]]})
        if len(rl[6]) > want and not any(len(x) > 3 for x in rl[6]):  # extra runners marked * are deliberate
            review["relay_legs"].append({"event": e["n"], "meet": meets[rl[1]][1], "date": meets[rl[1]][0],
                                         "mark": rl[4], "legs": len(rl[6]), "want": want,
                                         "names": [athletes[x[0]][0] for x in rl[6]]})

    # ---- Notes behind an asterisk: [.., place, unknown runners, note] -------
    for rl in relays:
        nt = relay_notes.get(id(rl))
        if nt:
            while len(rl) < 9:
                rl.append(0)
            rl.append("; ".join(nt))

    # ---- Athlete-name checks --------------------------------------------
    years = defaultdict(set)
    for res in results:
        years[res[0]].add(meets[res[2]][0][:4])
    for rl in relays:
        for leg in rl[6]:
            years[leg[0]].add(meets[rl[1]][0][:4])

    def split_name(n):
        last, _, first = n.partition(",")
        return last.strip(), first.strip()

    no_first = []  # athletes typed as a last name only, or first initial + last name
    firsts = {split_name(a[0])[1].lower() for a in athletes}
    lasts = {split_name(a[0])[0].lower() for a in athletes}
    by_last = defaultdict(list)
    for i, a in enumerate(athletes):
        last, first = split_name(a[0])
        by_last[(a[1], last.lower())].append(i)
        fl = first.lower()
        placeholder = re.search(r"\b(unknown|tbd|no ?body|no ?name|relay|team)\b", f"{fl} {last.lower()}")
        if placeholder:
            review["names"].append({"athlete": a[0], "gender": a[1], "why": "incomplete or placeholder name"})
        elif not first or len(first.rstrip(".")) <= 1:
            no_first.append(i)
        elif last.lower() in firsts and fl not in firsts and fl in lasts:
            review["names"].append({"athlete": a[0], "gender": a[1], "why": "first and last name may be reversed"})

    if no_first:
        a_years, a_count, a_meets = defaultdict(set), defaultdict(int), defaultdict(list)
        for res in results:
            if res[0] is None:
                continue
            a_years[res[0]].add(int(meets[res[2]][0][:4]))
            a_count[res[0]] += 1
            if len(a_meets[res[0]]) < 3 and meets[res[2]][1] not in a_meets[res[0]]:
                a_meets[res[0]].append(meets[res[2]][1])
        for rl in relays:
            for leg in rl[6]:
                a_years[leg[0]].add(int(meets[rl[1]][0][:4]))
                a_count[leg[0]] += 1
                if len(a_meets[leg[0]]) < 3 and meets[rl[1]][1] not in a_meets[leg[0]]:
                    a_meets[leg[0]].append(meets[rl[1]][1])
        for i in no_first:
            last, first = split_name(athletes[i][0])
            ys = a_years.get(i, set())
            cands = []
            for j in by_last.get((athletes[i][1], last.lower()), []):
                lj, fj = split_name(athletes[j][0])
                if j == i or not fj or len(fj.rstrip(".")) <= 1:
                    continue
                if first and not fj.lower().startswith(first.rstrip(".").lower()):
                    continue
                yj = a_years.get(j, set())
                if ys and yj and (min(yj) > max(ys) + 3 or max(yj) < min(ys) - 3):
                    continue
                cands.append(f"{athletes[j][0]} ({min(yj)}–{max(yj)})" if yj else athletes[j][0])
            review["first_names"].append({"athlete": athletes[i][0], "gender": athletes[i][1], "n": a_count.get(i, 0),
                                          "years": f"{min(ys)}–{max(ys)}" if len(ys) > 1 else (str(min(ys)) if ys else ""),
                                          "meets": a_meets.get(i, []), "maybe": cands})

    def similar(x, y):
        x, y = x.lower().rstrip("."), y.lower().rstrip(".")
        if x == y:
            return False
        if len(x) >= 3 and len(y) >= 3 and (x.startswith(y) or y.startswith(x)):
            return True
        if abs(len(x) - len(y)) <= 1 and len(x) >= 4:
            # one substitution / insertion
            if len(x) == len(y):
                return sum(c1 != c2 for c1, c2 in zip(x, y)) == 1
            s, l = (x, y) if len(x) < len(y) else (y, x)
            return any(l[:i] + l[i + 1:] == s for i in range(len(l)))
        return False

    for (_g, _last), ids in by_last.items():
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a, b = athletes[ids[i]], athletes[ids[j]]
                if similar(split_name(a[0])[1], split_name(b[0])[1]):
                    ya, yb = years[ids[i]], years[ids[j]]
                    if ya and yb and (min(map(int, ya)) <= max(map(int, yb)) + 1 and min(map(int, yb)) <= max(map(int, ya)) + 1):
                        review["dupes"].append({"gender": a[1], "a": a[0], "b": b[0],
                                                "years_a": f"{min(ya)}–{max(ya)}", "years_b": f"{min(yb)}–{max(yb)}"})
    names_by_gender = defaultdict(set)
    for a in athletes:
        names_by_gender[a[0]].add(a[1])
    for n, gs in names_by_gender.items():
        if len(gs) > 1:
            review["names"].append({"athlete": n, "gender": "B+G", "why": "listed on both the boys' and girls' rosters"})

    # ---- Coverage checklist ----------------------------------------------
    def plural(n, word):
        return f"{n} {word}" + ("" if n == 1 else "s")

    cov_rows = rows("coverage.csv") if os.path.exists(os.path.join(DATA, "coverage.csv")) else []
    level_of = {}
    for mi, mt in enumerate(meets):
        level_of[mi] = mt[2]
    found = defaultdict(lambda: {"n": 0, "tbd": 0, "official": set(), "tc": 0})
    for r in all_rows:
        if not any(r.values()) or r.get("Status", "").lower().startswith("ex"):
            continue
        d = parse_date(r["Date"])
        if not d:
            continue
        g = fix_gender.get((r["Gender"], r["Athlete"]), r["Gender"])
        mt = meet_map.get((d.isoformat(), r["Meet"].lower()), (r["Meet"], guess_meet_type(r["Meet"])))[1]
        lvl = mt if mt in ("District", "Regional", "State") else "Season"
        f = found[(d.year, g, lvl)]
        f["n"] += 1
        if (r.get("Mark") or "").upper() == "TBD":
            f["tbd"] += 1
        src = r.get("Source", "")
        if src and src != "Track Central":
            f["official"].add(src)
        else:
            f["tc"] += 1
    years = sorted({k[0] for k in found} | {int(c["Season"]) for c in cov_rows if c.get("Season", "").isdigit()})
    full_from = int(cfg.get("complete_from", 0) or 0)
    # Before the first season with any district results on file, a season with no Green results at all is just
    # "older, not collected" rather than a gap to chase
    dist_years = [k[0] for k in found if k[2] == "District"] + [int(c["Season"]) for c in cov_rows
                  if c.get("Level") == "District" and c.get("Season", "").isdigit()]
    first_dist = min(dist_years) if dist_years else 0
    coverage = {"seasons": [], "cells": {}}
    if years:
        for y in range(years[0], years[-1] + 1):
            if str(y) in (cfg.get("notes") or {}):
                coverage["seasons"].append([y, (cfg.get("notes") or {})[str(y)]])
                continue
            coverage["seasons"].append([y, ""])
            for g in ("Boys", "Girls"):
                for lvl in ("Season", "District", "Regional", "State"):
                    f = found.get((y, g, lvl), {"n": 0, "tbd": 0, "official": set(), "tc": 0})
                    cv = [c for c in cov_rows if c.get("Season") == str(y) and c.get("Team") == g and c.get("Level") == lvl]
                    manual = [c for c in cv if c.get("Status") in ("Partial", "Missing")]
                    notes = "; ".join(c.get("Notes", "") for c in cv if c.get("Notes"))
                    if lvl == "Season":
                        if f["n"] and y >= full_from:
                            st, note = "complete", f"{plural(f['n'], 'result')} from Track Central"
                        elif f["n"]:
                            st, note = "unknown", f"Only {plural(f['n'], 'regular-season result')} on file"
                        else:
                            st, note = "unknown", "No regular-season results on file"
                    elif manual:
                        st, note = manual[0]["Status"].lower(), notes or manual[0]["Status"]
                    elif cv:
                        st = "complete" if any(c.get("Status") == "Complete" for c in cv) else "none"
                        note = (f"{plural(f['n'], 'Green result')} from {', '.join(sorted({c.get('Source', '') for c in cv}))}"
                                if st == "complete" else "Results checked: no Green athletes")
                        if f["tbd"]:
                            st, note = "partial", f"{plural(f['tbd'], 'result')} still TBD"
                        if notes:
                            note += f" ({notes})"
                    elif f["n"]:
                        if f["official"]:
                            st = "partial"
                            note = f"{plural(f['n'], 'result')} from {', '.join(sorted(f['official']))}" + (f", {f['tbd']} still TBD" if f["tbd"] else "")
                        else:
                            st, note = "tc", f"{plural(f['n'], 'result')} from Track Central"
                    else:
                        nxt = {"District": ("Regional", "State"), "Regional": ("State",), "State": ()}[lvl]
                        went_on = any(found.get((y, g, x), {}).get("n") for x in nxt) or any(
                            c.get("Status") == "Complete" for c in cov_rows
                            if c.get("Season") == str(y) and c.get("Team") == g and c.get("Level") in nxt)
                        if not went_on and y < first_dist:
                            st, note = "unknown", "Older season: no results from this meet on file"
                        elif went_on or lvl == "District":
                            st, note = "missing", ("Green athletes went on to " + " / ".join(nxt).lower() + " this season, so these results exist"
                                                   if went_on else "Every team runs at district, so these results exist")
                        else:
                            st, note = "unknown", "Not on file. There may have been no Green qualifiers"
                    coverage["cells"][f"{y}|{g[0]}|{lvl}"] = [st, note]
                # Points: Track Central "Scoring Performances" report for the season
                pv = [c for c in cov_rows if c.get("Season") == str(y) and c.get("Team") == g and c.get("Level") == "Points"]
                pnote = "; ".join(c.get("Notes", "") for c in pv if c.get("Notes"))
                if pv and pv[0].get("Status") in ("Partial", "Missing"):
                    coverage["cells"][f"{y}|{g[0]}|Points"] = [pv[0]["Status"].lower(), pnote or pv[0]["Status"]]
                elif pv:
                    coverage["cells"][f"{y}|{g[0]}|Points"] = ["complete", f"{plural(int(pv[0].get('Green Results') or 0), 'scoring performance')} from the Track Central scoring report" + (f" ({pnote})" if pnote else "")]
                elif y >= full_from:
                    coverage["cells"][f"{y}|{g[0]}|Points"] = ["notyet", "Scoring report not imported yet. In Track Central, print Scoring Performances for this season"]

    # Team finishes: worked out from the results files (data/sources/team_scores.csv, built by build_team_scores.py),
    # then the Team Results tab, which adds older or other meets and replaces an automatic row for the same
    # season, team and level.
    team = {}
    auto = os.path.join(DATA, "sources", "team_scores.csv")
    for src, rws in (("auto", rows(os.path.join("sources", "team_scores.csv")) if os.path.exists(auto) else []),
                     ("sheet", rows("team.csv") if os.path.exists(os.path.join(DATA, "team.csv")) else [])):
        for r in rws:
            y, g, lvl = r.get("Season", ""), r.get("Team", ""), r.get("Level", "")
            if not (y.isdigit() and g in ("Boys", "Girls") and lvl):
                continue
            place = r.get("Place", "")
            if src == "auto" and not place:  # a meet where Green didn't score: keep only the winner for context
                pass
            num = lambda v: float(v) if re.match(r"^\d+(\.\d+)?$", v or "") else None  # noqa: E731
            team[(int(y), g[0], lvl)] = {
                "y": int(y), "g": g[0], "lv": lvl, "m": r.get("Meet", ""),
                "pl": int(place) if place.isdigit() else 0, "tie": 1 if r.get("Tied", "").upper().startswith("Y") else 0,
                "pts": num(r.get("Points")), "n": int(r["Teams"]) if r.get("Teams", "").isdigit() else 0,
                "win": r.get("Champion", ""), "wp": num(r.get("Champion Points")),
                "note": r.get("Notes", ""), "src": r.get("Source", "") or ("Team Results tab" if src == "sheet" else "")}
    # League: Green's points at the varsity league meet every season; the place comes from the Team Results tab when known
    for (y, g), pv in league_pts.items():
        k = (y, g, "League")
        if k in team:
            if team[k]["pts"] is None:
                team[k]["pts"] = round(pv, 2)
            continue
        team[k] = {"y": y, "g": g, "lv": "League", "m": " / ".join(sorted(league_meets[(y, g)])), "pl": 0, "tie": 0,
                   "pts": round(pv, 2), "n": 0, "win": "", "wp": None, "note": "Place not on file: add it in the Team Results tab",
                   "src": "Green's points from the Track Central scoring report"}
    # Data check, League column: the varsity league meet's results, and the team place, for each season
    league_n, league_nm = Counter(), defaultdict(set)
    for r in all_rows:
        if not any(r.values()) or r.get("Status", "").lower().startswith("ex"):
            continue
        disp, mtyp = meet_info(r)
        d0 = parse_date(r["Date"])
        if d0 and mtyp == "League" and not (is_jv(disp) or is_jv(r["Meet"])):
            g0 = fix_gender.get((r["Gender"], r["Athlete"]), r["Gender"])
            league_n[(d0.year, g0[:1])] += 1
            league_nm[(d0.year, g0[:1])].add(disp)
    for y, note0 in coverage["seasons"]:
        if note0:
            continue
        for g in ("B", "G"):
            cv = [c for c in cov_rows if c.get("Season") == str(y) and c.get("Team", "")[:1] == g and c.get("Level") == "League"]
            cnote = "; ".join(c.get("Notes", "") for c in cv if c.get("Notes"))
            t = team.get((y, g, "League"))
            n = league_n.get((y, g), 0)
            meet = " / ".join(sorted(league_nm.get((y, g), []))) or "league meet"
            if cv and cv[0].get("Status") in ("Complete", "Partial", "Missing", "No Green athletes"):
                st = {"No Green athletes": "none"}.get(cv[0]["Status"], cv[0]["Status"].lower())
                note = cnote or cv[0]["Status"]
            elif t and t.get("pl"):
                st = "complete" if n else "partial"
                note = (f"{t['pl']}{'th' if 10 <= t['pl'] % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(t['pl'] % 10, 'th')}"
                        f"{' of ' + str(t['n']) if t.get('n') else ''}{', ' + str(t['pts']).rstrip('0').rstrip('.') + ' pts' if t.get('pts') is not None else ''}"
                        + (f" ({meet}, {plural(n, 'Green result')})" if n else ". Results from the league meet not on file"))
            elif n:
                st = "partial"
                pts = t.get("pts") if t else None
                ptxt = str(pts).rstrip("0").rstrip(".") if pts is not None else ""
                note = (f"{plural(n, 'Green result')} from the {meet}" + (f" ({ptxt} {'pt' if ptxt == '1' else 'pts'})" if pts is not None else " (points not on file)")
                        + ". Need: Green's team place and how many teams (Team Results tab)"
                        + (". Few results on file, so some events may be missing too" if n < 15 else ""))
            elif not found.get((y, "Boys" if g == "B" else "Girls", "Season"), {}).get("n"):
                st, note = "unknown", "Older season: no regular-season results collected yet"
            else:
                st, note = "missing", "League meet results not on file"
            if cnote and not cv:
                note += f" ({cnote})"
            coverage["cells"][f"{y}|{g}|League"] = [st, note]
    team = sorted(team.values(), key=lambda t: (-t["y"], t["g"], {"State": 0, "Regional": 1, "District": 2}.get(t["lv"], 3)))

    out = {
        "school": cfg.get("school", "Green High School"),
        "team": cfg.get("team_name", "Bulldogs"),
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "notes": cfg.get("notes", {}),
        "events": events,
        "meets": meets,
        "athletes": athletes,
        "results": results,
        "relays": relays,
        "review": review,
        "excluded": excluded,
        "complete_from": int(cfg.get("complete_from", 0) or 0),
        "coverage": coverage,
        "team": team,
        "points": points,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # "Updated" on the site means the data changed, not that the nightly build ran:
    # when nothing but the timestamp would change, keep the old file's date.
    try:
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
        if {**old, "generated": ""} == json.loads(json.dumps({**out, "generated": ""}, ensure_ascii=False)):
            out["generated"] = old["generated"]
    except (OSError, ValueError, KeyError):
        pass
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

    print(f"Built {OUT}: {len(results)} individual marks, {len(relays)} relay teams, "
          f"{len(athletes)} athletes, {len(meets)} meets ({os.path.getsize(OUT) // 1024} KB)")
    for k, v in review.items():
        print(f"  check: {k}: {len(v)}")
    if excluded:
        print(f"  {excluded} rows excluded by Status")


if __name__ == "__main__":
    main()
