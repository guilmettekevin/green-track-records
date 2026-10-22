"""Shared helpers for reading track & field marks.

Times are stored as seconds, field marks as inches.
"""
import re
from datetime import date, datetime

TIME_RE = re.compile(r"^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$")
FIELD_RE = re.compile(r"^(\d+)-(\d+(?:\.\d+)?)$")
METRIC_RE = re.compile(r"^(\d+(?:\.\d+)?)m$")


def parse_time(s):
    """'11.24' -> 11.24, '4:35.2' -> 275.2, '1:02:03' -> 3723. None if unreadable."""
    s = (s or "").strip()
    if not s:
        return None
    m = TIME_RE.match(s)
    if not m:
        return None
    a, b, c = m.groups()
    if a is not None and b is not None:  # h:m:s
        return int(a) * 3600 + int(b) * 60 + float(c)
    if a is not None:  # m:s
        return int(a) * 60 + float(c)
    return float(c)


def parse_field(s):
    """'126-2' -> 1514.0 inches, '47-6.5' -> 570.5, '3.20m' -> metres converted."""
    s = (s or "").strip()
    if not s:
        return None
    m = FIELD_RE.match(s)
    if m:
        ft, inch = m.groups()
        return int(ft) * 12 + float(inch)
    m = METRIC_RE.match(s)
    if m:
        return float(m.group(1)) / 0.0254
    return None


def decimals(s):
    s = (s or "").strip()
    return len(s.split(".")[1]) if "." in s else 0


def fmt_time(sec):
    if sec is None:
        return ""
    if sec >= 60:
        m = int(sec // 60)
        rest = sec - m * 60
        return f"{m}:{rest:05.2f}"
    return f"{sec:.2f}"


def fmt_field(inches):
    if inches is None:
        return ""
    ft = int(inches // 12)
    rest = inches - ft * 12
    r = f"{rest:.2f}".rstrip("0").rstrip(".")
    return f"{ft}-{r}"


def parse_date(s):
    """Accepts 2019-04-09, 4/9/2019, 4/9/19 and Sheets' 'April 9, 2019'."""
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def iso(d: date):
    return d.isoformat() if d else ""


def guess_meet_type(name):
    """Best guess at the meet level from its name. Coaches can correct it in the Meets tab."""
    n = (name or "").lower()
    if "indoor" in n:
        return "Indoor State" if "state" in n else "Indoor"
    for word, t in (("state", "State"), ("regional", "Regional"), ("district", "District"),
                    ("league", "League"), ("federal", "League"), ("conference", "League")):
        if word in n:
            return t
    if "relays" in n or "invit" in n or "invt" in n or "classic" in n:
        return "Invitational"
    if "dual" in n or " vs" in n or "tri" in n.split():
        return "Dual/Tri"
    return ""
