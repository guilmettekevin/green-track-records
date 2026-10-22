# Green High School Track & Field Record Book

A free website for Green's all-time track and field results: school records, all-time top lists, relay lists, athlete pages with PRs and progression charts, season and meet pages, fun stats, and a Data Check page for coaches.

**How it works**

```
Google Sheet (coaches edit)  →  GitHub Action (nightly, or on demand)  →  GitHub Pages website
```

- The **Google Sheet** is the master copy. Any coach you share it with can add or fix results.
- Every night a **GitHub Action** downloads the sheet, checks it, builds the site's data file, saves a dated copy of the data in this repo (a free backup), and publishes the site.
- The **website** is plain HTML/JavaScript on GitHub Pages. Nothing to pay for, no server to keep running.

Cost: $0. GitHub Pages and Actions are free for public repositories, and Google Sheets is free.

---

## One-time setup (about 30 minutes)

### 1. Put the Google Sheet in Drive
1. Upload `Green Track Records.xlsx` to Google Drive, right-click it, and choose **Open with › Google Sheets**. Then **File › Save as Google Sheets** so it becomes a real Google Sheet.
2. **Share** it:
   - Add each coach as an **Editor**.
   - Under General access choose **Anyone with the link › Viewer**. The website needs this to read it. (Everything in the sheet is public anyway, because it all ends up on the website. Don't put private notes in it.)

### 2. Add the sheet's menu (import + publish buttons)
1. In the sheet: **Extensions › Apps Script**.
2. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repo.
3. Click **+ › HTML**, name it `ImportDialog` (exactly), and paste in `apps-script/ImportDialog.html`.
4. Save, close the tab, and reload the sheet. A **Track Records** menu appears. The first time you use it, Google asks you to authorize the script. That's normal: it only touches this spreadsheet.
5. Run **Track Records › Format sheet for data entry** once.

### 3. Create the GitHub repository
1. Create a free account at github.com (a team or coach account is better than a personal one, so it outlives any one person).
2. Click **New repository**, name it `green-track-records`, make it **Public**, and create it.
3. Click **uploading an existing file** and drag in everything in this folder.
   - On a Mac, hidden folders like `.github` don't show up in Finder. If `.github/workflows/update.yml` didn't upload, use **Add file › Create new file**, type `.github/workflows/update.yml` as the name, and paste in the contents of that file.
4. **Settings › Pages › Build and deployment › Source: GitHub Actions**.
5. **Actions** tab: if asked, click to enable workflows. Open **Update website › Run workflow**.
6. After about 2 minutes the site is live at `https://YOUR-ACCOUNT.github.io/green-track-records/`. The address is also shown under Settings › Pages.

At this point the site runs on the data that ships in `data/`. It can stay that way as long as you like: steps 1, 2, 4 and 5 can wait until the sheet is ready to be the master copy.

**Running without the sheet.** While `config.json` has no `sheet_id`, every build uses the CSV files in `data/`. To change the site, replace or edit those files in GitHub (**Add file › Upload files** onto the same names, or the pencil on a file) and commit: each commit rebuilds the site in about 2 minutes. The nightly run still happens but changes nothing, and the site's "Updated" date only moves when the data actually changes. When you connect the sheet later, make the Google Sheet from the newest `.xlsx` (run `python3 scripts/make_sheet.py` to rebuild it from `data/`), so nothing added in the meantime is lost.

### 4. Connect the site to the sheet
1. In the sheet: **Track Records › Website setup info**. Copy the lines it shows.
2. In GitHub, open `config.json`, click the pencil, replace the `sheet_id` and `tabs` lines with what you copied, and **Commit changes**.
3. That commit starts a rebuild. From now on the site reads the sheet every night.

### 5. Optional: a "Publish website now" button
Without this the site still updates every night. To update on demand:
1. GitHub: **Settings (your profile) › Developer settings › Fine-grained tokens › Generate new token**. Repository access: only `green-track-records`. Permissions: **Actions: Read and write**. Copy the token.
2. Sheet: **Extensions › Apps Script › Project Settings (gear) › Script Properties**. Add:
   - `GITHUB_REPO` = `your-account/green-track-records`
   - `GITHUB_TOKEN` = the token
3. **Track Records › Publish website now** now rebuilds the site in about 2 minutes. Tokens expire, so set a reminder to renew it.

---

## Everyday use

**After a meet (easiest):** in Track Central, print **All Career Performances** for boys and save it as a text file. Do the same for girls. In the sheet, **Track Records › Import Track Central export…**, pick the team and the file. Only new results are added, so you can import the whole history every time. New athletes and meet names are added to their tabs automatically.

**Points (for the Top point scorers lists):** in Track Central, print **Scoring Performances** for one team and season, save it as text, and import it with the same menu. It fills in Place and Points on that season's results (import the season's results first). The Data Check page shows which seasons' points are still to import.

**By hand:** add rows at the bottom of **Results**. See the sheet's Read Me tab for formats. Relays are one row per runner, with the same Event, Meet, Date and Relay Total. If the runners aren't known (MileSplit lists relay teams without names), use one row with Athlete `Unknown`; the team still counts on the lists and appears under **Relays missing runners** on the Data Check page until the runners are filled in.

**Results from Athletic.net, MileSplit or Baumspage:** enter them in the Results tab the same way and put the site name in **Source**. Before adding a meet, check it isn't already in the sheet under a different meet name, so it isn't counted twice.

**Tidying up** (the website's **Data Check** page lists what needs attention, and shows a checklist of which district, regional and state results are on file for every season):

| To do this | Do this in the sheet |
|---|---|
| Hide a bad result | Results › Status = `Exclude` |
| Confirm a mark the site held back | Results › Status = `OK` |
| Combine two spellings of a name | Athletes › Merge Into = the correct name |
| Add a graduation year (turns on Fr/So/Jr/Sr labels) | Athletes › Grad Year |
| Hide an athlete's name (family request) | Athletes › Hide = `Y` |
| Clean up meet names | Meets › Display Name |
| Record a finishing place (state 1st = State champion, 1st–8th = All-Ohio) | Results › Place |
| Fix a meet's level (drives the postseason badges) | Meets › Meet Type = District, Regional, State or Indoor State |
| Mark a district/regional prelim | Add ` (Trials)` to the event name, e.g. `100M (Trials)` |
| Add a new event | Add a row to Events (copy a similar event's row) |
| Track which meets' results are still missing | Coverage › Status = `Complete`, `No Green athletes`, `Partial` or `Missing`, plus Notes. The Data Check page shows a season-by-season checklist and a "Still to find" list |

Don't rename tabs or column headers. The website finds columns by name.

**Undoing a mistake:** the sheet has **File › Version history**, and every nightly update saves a copy of the data in this repo's history (the `data/` folder).

---

## What's in this folder

| Path | What it is |
|---|---|
| `site/` | The website (`index.html`, `app.js`, `style.css`) and its data file `site/data/db.json` |
| `data/` | Copies of the sheet's tabs as CSV (Results, Athletes, Meets, Events, Coverage), refreshed nightly |
| `scripts/fetch_sheet.py` | Downloads the sheet tabs into `data/` |
| `scripts/build_data.py` | Checks the data and builds `site/data/db.json` |
| `scripts/import_trackcentral.py` | Imports Track Central text exports straight into `data/` (the command-line version of the sheet's Import menu) |
| `scripts/import_tc_scoring.py` | Fills in Place and Points from Track Central "Scoring Performances" reports (the command-line version of the sheet's Import menu for those reports) |
| `scripts/import_hytek.py` | Pulls Green's results out of a Hy-Tek results printout (district, regional, state). Only rows for Green are used (also printed "Greensburg Green" or "Uniontown Green" in older results: the school's names before Green became a city). Also records the meet in `data/coverage.csv` (the Coverage tab) |
| `data/sources/` | Full district, regional and state results printouts (every school), listed in `manifest.csv`. Used only for the What If page; they never go into the record book |
| `scripts/build_fields.py` | Reads `data/sources/` and builds `site/data/fields.json`: each year's finishing marks at district, regional and state, without names |
| `scripts/build_team_scores.py` | Works out Green's team finish at each district, regional and state meet from `data/sources/` (the team scores printed in the results, or the finals scored 10-8-6-5-4-3-2-1) into `data/sources/team_scores.csv`. The sheet's Team Results tab adds older seasons and other titles and wins over an automatic row |
| `scripts/make_sheet.py` | Rebuilds the starter `.xlsx` from `data/` |
| `apps-script/` | The sheet's Track Records menu |
| `.github/workflows/update.yml` | The nightly update |
| `config.json` | School name, sheet ID and tab IDs, and season notes shown on the site |

**Preview on your own computer** (needs Python 3):

```
python3 scripts/build_team_scores.py
python3 scripts/build_data.py
python3 scripts/build_fields.py
python3 -m http.server --directory site 8000
```

Then open http://localhost:8000.

## How the numbers are calculated

- **Records and top lists** use each athlete's best valid mark. Ties share a rank.
- **What If** compares a Bulldog mark with every finishing mark from each year's district, regional and state meet. A place comes from the final; a mark that wouldn't have beaten the fastest non-qualifier counts as going out in the prelims (or semis). The top 4 at district advance to regional and the top 4 at regional advance to state (top 5 starting in 2026; set in `ADVANCE` at the top of `scripts/build_fields.py`). The top 8 at state are All-Ohio. Hand times get the same conversion as below before comparing. To add a year, put the full results text in `data/sources/`, add a line to `manifest.csv` (File, Season, Level, Division) and run `scripts/build_fields.py`.
- **Team finishes** (Team page): district, regional and state places from 2001 on come from the official team scores, or are worked out from the finals when the results copy has none. Rows in the Team Results tab (older seasons, league or invitational titles) are added on top and replace an automatic row for the same season, team and level. Place 1 shows as a team championship on the Records page.
- **Legacy (yards) events**: 100 Yard Dash, 880 Yard Run, Mile Relay and the other pre-metric events are separate events (Order 900+ on the Events tab). They have their own Legacy records section and are grouped under "Legacy (yards)" in the event menus.
- **Top lists by grade** use each athlete's Grad Year. Athletes without one are left out of the grade filter.
- **Hand times** are shown with an "h". Top lists can show them as recorded, converted (+0.24s for events under 400m, +0.14s for 400m and up), or leave them out (FAT only).
- **Marking a hand time:** sprints, hurdles and sprint relays typed to tenths are treated as hand times automatically. For anything else that was hand timed (a dual-meet 1600, say), or a hand time typed to hundredths, add an "h" to the end of the Mark or Relay Total: `4:38h`.
- **Asterisks:** add a `*` to the end of a Mark or Relay Total (`1:02.3h*`) when the sources disagree or something about the mark is uncertain. The site shows an orange asterisk, and hovering or tapping it shows the row's Notes. For a relay leg nobody is sure of, put `*` in that runner's Mark (after the split, if any) and add a row for each possible runner; each gets an asterisk and the relay's note explains.
- **Field series:** the Results tab has a **Series** column for every attempt in a field event, when the score sheet has them. Throws and long/triple jump: the marks in order, F for a foul, P for a pass (`17-10, F, 16-7.25, 17-2.5`). High jump and pole vault: each height with its attempts, O = make, X = miss, P = pass (`5-8 XO, 5-10 O, 6-0 XXX`). On the site a small **Series** button next to the mark opens the attempts underneath, with the best one outlined. If the best attempt doesn't match the Mark, the series is held back and listed on Data Check.
- **Lap splits:** for running events, the Series column holds lap splits instead (`1:22.43, 1:23.88, 1:25.96, 1:28.62`). They have to add up to the Mark. The site shows them under a **Splits** button with the running total. Relay leg splits stay in each runner's Mark.
- **Missing first names:** athletes typed as a last name only ("Wheeler") or an initial ("J. Wheeler") are listed on the Data Check page with likely matches. Fix them with **Merge Into** on the Athletes tab.
- **Prelim** marks count and are labeled.
- **Relays** are built from the per-runner rows: same event, meet, date and team time make one team. Track Central has no mixed roster, so mixed-relay runners also appear on the other team's roster. An athlete on both rosters is counted on the team where they have individual results, and a boys or girls relay that turns out to have both boys and girls on it is moved to the matching mixed relay.
- **No marks** (`0-0`, fouls) appear on athlete pages as NM and never count.
- **Sanity limits** in the Events tab hold back marks better than looks possible, such as a relay total entered as an individual long jump. Slow marks are never held back, since they can't reach a top list.
- **Postseason badges** on athlete pages come from each meet's Meet Type. *State qualifier* and *Regional qualifier* = any result at that meet. *District finalist* = a district mark that isn't a prelim (`(Trials)`); when a team's district results are spread over two days, events that run prelims (100–1600m, hurdles, 4x100/4x200/4x400) only count on the last day. A regional or state trip also counts as a district final that season. Meet Type is guessed from the meet name when it's blank.
- **State champion and All-Ohio** come from the Place column on State-meet finals rows: 1 = State champion (gold badge, a banner on the athlete page and a spot in the State Champions honor roll on the home page), 1–8 = All-Ohio. Prelim rows never count. `scripts/import_hytek.py` fills Place automatically, including on matching rows already in the sheet.
- **Former school record holders** come from each event's record progression: anyone who set or tied the standing record and was later passed (relay records count for every runner on the team). The first season on file is the starting point, so until older records are added to the Results tab, some early "records" may not have been the real school record at the time.
- **Old records and partial results:** results from before `complete_from` in config.json (2007) are treated as known school records, so they count fully in the record history. A mark of `TBD`, `NM`, `DNF`, `DQ` or `DNS` records that an athlete competed (it counts toward postseason badges) without a mark to rank. Replace `TBD` with the mark when you have it.
- **Points** come from Track Central's Scoring Performances reports, matched to each result by athlete, date and mark. Relay points are re-split the same way for every meet: each runner gets the relay's place points divided by the number of runners (1/4 for a 4x relay, 1/3 or 1/2 for 3- and 2-person field relays). Track Central meets aren't set up the same way (some give each relay runner half of the relay's points), so the build works out what each relay actually scored from the meet's individual-event scoring (5-3-1, 10-8-6-5-4-3-2-1 and so on) and divides that evenly. The sheet's Points column keeps Track Central's numbers as reported; when a double-dual lists one performance once per opponent, the points are kept per opponent, like `5+3`. A mixed-relay runner listed on both rosters is only counted once. Career totals only include seasons whose report has been imported.
- **PRs** count each time an athlete beat their own previous best in an event.
- **Coverage checklist** (Data Check page): for each season and team, Season is the regular-season history; District, Regional and State show ✓ when official results were imported (or a coach set Complete), – when the results were checked and had no Green athletes, TC when only Track Central rows exist (official results would add places and prelims), ½ for Partial or TBD marks, ✗ when Green must have been there (every team runs at district; a regional or state trip means the earlier rounds happened) but nothing is on file, and ? when nothing is on file and there may have been no qualifiers.
- **Data starts in 2007**, the first season in Track Central. Older records (for example the 1986 state champion team) can be added as rows whenever someone digs them up.
