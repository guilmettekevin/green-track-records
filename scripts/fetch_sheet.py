"""Download the tabs of the Google Sheet into data/*.csv.

Reads sheet_id and tab IDs (gids) from config.json. The sheet must be shared as
"Anyone with the link: Viewer". If no sheet_id is set, the CSVs already in data/ are used.
Each download is checked before it replaces the old file, so a bad download never wipes data.
"""
import csv
import io
import json
import os
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data")
NEEDED = {
    "results": ["Gender", "Athlete", "Event", "Meet", "Date", "Mark", "Relay Total"],
    "athletes": ["Gender", "Athlete", "Grad Year", "Merge Into", "Hide"],
    "meets": ["Date", "Meet", "Display Name", "Meet Type"],
    "events": ["Event", "Standard Event", "Display Name", "Type"],
}
# Tabs the site can do without (older sheets may not have them yet).
OPTIONAL = {
    "coverage": ["Season", "Team", "Level", "Status"],
    "team": ["Season", "Team", "Level", "Place"],
}


def main():
    with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    sheet = (cfg.get("sheet_id") or "").strip()
    if not sheet:
        print("No sheet_id in config.json: building from the CSVs already in data/.")
        return
    problems = []
    for tab, cols in list(NEEDED.items()) + list(OPTIONAL.items()):
        gid = str(cfg.get("tabs", {}).get(tab, "")).strip()
        if not gid or gid == "MISSING":
            if tab in OPTIONAL:
                print(f"{tab}: no tab id in config.json, keeping data/{tab}.csv as it is")
            else:
                problems.append(f"config.json has no tab id for '{tab}'")
            continue
        url = f"https://docs.google.com/spreadsheets/d/{sheet}/export?format=csv&gid={gid}"
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                text = r.read().decode("utf-8-sig")
        except Exception as e:  # noqa: BLE001
            problems.append(f"{tab}: download failed ({e}). Is the sheet shared as 'Anyone with the link: Viewer'?")
            continue
        if text.lstrip().startswith("<"):
            problems.append(f"{tab}: Google returned a web page instead of CSV. Check sharing and the tab id.")
            continue
        rows = list(csv.reader(io.StringIO(text)))
        header = [h.strip() for h in rows[0]] if rows else []
        missing = [c for c in cols if c not in header]
        if missing:
            problems.append(f"{tab}: missing columns {missing}. Wrong tab id, or a header was renamed?")
            continue
        if tab == "results" and len(rows) < 100:
            problems.append(f"results: only {len(rows) - 1} rows downloaded, refusing to replace the saved data.")
            continue
        with open(os.path.join(DATA, f"{tab}.csv"), "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerows(rows)
        print(f"{tab}: {len(rows) - 1} rows")
    if problems:
        print("\n".join("ERROR " + p for p in problems))
        sys.exit(1)


if __name__ == "__main__":
    main()
