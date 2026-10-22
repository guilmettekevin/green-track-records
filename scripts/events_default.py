"""Default Events tab: maps each event name used in Track Central to a standard event.

Columns: Event, Standard Event, Display Name, Type, Leg, Round, Hand Timed,
         Mark Min, Mark Max, Total Min, Total Max, Order
Min/Max are sanity ranges: marks outside them are flagged for review and left
out of the rankings until a coach fixes them (or sets Status = OK).
"""

HEADER = ["Event", "Standard Event", "Display Name", "Type", "Leg", "Round",
          "Hand Timed", "Mark Min", "Mark Max", "Total Min", "Total Max", "Order"]

# Standard events: key -> (display, type, hand timed, mark min, mark max, total min, total max, order)
STANDARD = {
    "60M":      ("60m", "Running", "Y", "6.5", "12.0", "", "", 5),
    "100M":     ("100m", "Running", "Y", "10.0", "20.0", "", "", 10),
    "200M":     ("200m", "Running", "Y", "20.5", "40.0", "", "", 20),
    "400M":     ("400m", "Running", "Y", "46.0", "1:40", "", "", 30),
    "800M":     ("800m", "Running", "", "1:50", "4:20", "", "", 40),
    "1600M":    ("1600m", "Running", "", "4:00", "10:00", "", "", 50),
    "3200M":    ("3200m", "Running", "", "8:45", "21:00", "", "", 60),
    "60M HH":   ("60m Hurdles", "Running", "Y", "7.5", "14.0", "", "", 65),
    "100HH":    ("100m Hurdles", "Running", "Y", "13.0", "30.0", "", "", 70),
    "110HH":    ("110m Hurdles", "Running", "Y", "13.5", "30.0", "", "", 71),
    "300IH":    ("300m Hurdles", "Running", "Y", "36.0", "1:15", "", "", 80),
    "High Jump":  ("High Jump", "Field", "", "3-0", "7-0", "", "", 100),
    "Pole Vault": ("Pole Vault", "Field", "", "5-0", "18-6", "", "", 110),
    "Long Jump":  ("Long Jump", "Field", "", "8-0", "25-0", "", "", 120),
    "Shot Put":   ("Shot Put", "Field", "", "10-0", "65-0", "", "", 130),
    "Discus":     ("Discus", "Field", "", "30-0", "200-0", "", "", 140),
    "4X100M":   ("4x100m Relay", "Relay", "Y", "9.5", "20.0", "41.0", "1:15", 200),
    "4X200M":   ("4x200m Relay", "Relay", "Y", "20.5", "40.0", "1:26", "2:30", 210),
    "4X400M":   ("4x400m Relay", "Relay", "Y", "46.0", "1:40", "3:15", "6:30", 220),
    "4X800M":   ("4x800m Relay", "Relay", "", "1:50", "4:20", "7:40", "16:00", 230),
    "4X1200M":  ("4x1200m Relay", "Relay", "", "3:00", "6:30", "13:00", "25:00", 235),
    "4X1600M":  ("4x1600m Relay", "Relay", "", "4:00", "10:00", "17:00", "36:00", 240),
    "SMR":      ("Sprint Medley Relay", "Relay", "Y", "9.5", "1:40", "1:30", "3:20", 250),
    "DMR":      ("Distance Medley Relay", "Relay", "", "46.0", "10:00", "10:00", "20:00", 260),
    "4X100M Shuttle Hurdle": ("4x100m Shuttle Hurdle Relay", "Relay", "Y", "13.0", "30.0", "52.0", "1:50", 270),
    "4X110M Shuttle Hurdle": ("4x110m Shuttle Hurdle Relay", "Relay", "Y", "13.5", "30.0", "54.0", "1:50", 271),
    "4X100M Throwers": ("4x100m Throwers Relay", "Relay", "Y", "9.5", "20.0", "41.0", "1:30", 272),
    "4X200M Mixed": ("Mixed 4x200m Relay", "Relay", "Y", "20.5", "40.0", "1:26", "2:30", 280),
    "4X400M Mixed": ("Mixed 4x400m Relay", "Relay", "Y", "46.0", "1:40", "3:15", "6:30", 281),
    "4X800M Mixed": ("Mixed 4x800m Relay", "Relay", "", "1:50", "4:20", "7:40", "16:00", 282),
    "3 x HJ Relay": ("High Jump Relay (3)", "Field Relay", "", "3-0", "7-0", "9-0", "21-0", 300),
    "3 x PV Relay": ("Pole Vault Relay (3)", "Field Relay", "", "5-0", "17-0", "15-0", "51-0", 310),
    "3 x LJ Relay": ("Long Jump Relay (3)", "Field Relay", "", "8-0", "25-0", "24-0", "75-0", 320),
    "3 x SP Relay": ("Shot Put Relay (3)", "Field Relay", "", "10-0", "65-0", "30-0", "195-0", 330),
    "3 x DT Relay": ("Discus Relay (3)", "Field Relay", "", "30-0", "200-0", "90-0", "600-0", 340),
    "2 x HJ Relay": ("High Jump Relay (2)", "Field Relay", "", "3-0", "7-0", "6-0", "14-0", 350),
    "2 x PV Relay": ("Pole Vault Relay (2)", "Field Relay", "", "5-0", "17-0", "10-0", "34-0", 360),
    "2 x LJ Relay": ("Long Jump Relay (2)", "Field Relay", "", "8-0", "25-0", "16-0", "50-0", 370),
    "2 x SP Relay": ("Shot Put Relay (2)", "Field Relay", "", "10-0", "65-0", "20-0", "130-0", 380),
    "2 x DT Relay": ("Discus Relay (2)", "Field Relay", "", "30-0", "200-0", "60-0", "400-0", 390),
    "100Y": ("100 Yard Dash", "Running", "Y", "9.0", "16.0", "", "", 900),  # legacy (yards)
    "220Y": ("220 Yard Dash", "Running", "Y", "20.0", "35.0", "", "", 905),  # legacy (yards)
    "440Y": ("440 Yard Dash", "Running", "Y", "46.0", "1:30", "", "", 910),  # legacy (yards)
    "880Y": ("880 Yard Run", "Running", "", "1:50", "3:30", "", "", 915),  # legacy (yards)
    "Mile": ("Mile Run", "Running", "", "4:00", "8:00", "", "", 920),  # legacy (yards)
    "2 Mile": ("Two Mile Run", "Running", "", "8:40", "16:00", "", "", 925),  # legacy (yards)
    "80YH": ("80 Yard Hurdles", "Running", "Y", "10.0", "18.0", "", "", 930),  # legacy (yards)
    "120YHH": ("120 Yard High Hurdles", "Running", "Y", "13.0", "25.0", "", "", 935),  # legacy (yards)
    "180YLH": ("180 Yard Low Hurdles", "Running", "Y", "18.0", "30.0", "", "", 940),  # legacy (yards)
    "330YIH": ("330 Yard Intermediate Hurdles", "Running", "Y", "36.0", "1:10", "", "", 945),  # legacy (yards)
    "440Y Relay": ("440 Yard Relay", "Relay", "Y", "9.0", "16.0", "42.0", "1:10", 950),  # legacy (yards)
    "880Y Relay": ("880 Yard Relay", "Relay", "Y", "20.0", "35.0", "1:28", "2:30", 955),  # legacy (yards)
    "Mile Relay": ("Mile Relay", "Relay", "Y", "46.0", "1:30", "3:15", "6:00", 960),  # legacy (yards)
    "2 Mile Relay": ("Two Mile Relay", "Relay", "", "1:50", "3:30", "7:45", "14:00", 965),  # legacy (yards)
    "880Y Medley Relay": ("880 Yard Medley Relay", "Relay", "Y", "9.0", "1:30", "1:40", "2:40", 970),  # legacy (yards)
}
LEGACY_FROM = 900  # Order 900 and up: events run in yards before Ohio went metric (shown in their own legacy section)

# Medley-relay legs have their own split ranges
LEG_RANGES = {
    ("SMR", "100M"): ("9.5", "20.0"), ("SMR", "200M"): ("20.5", "40.0"), ("SMR", "400M"): ("46.0", "1:40"),
    ("DMR", "400M"): ("46.0", "1:40"), ("DMR", "800M"): ("1:50", "4:20"),
    ("DMR", "1200M"): ("3:00", "6:30"), ("DMR", "1600M"): ("4:00", "10:00"),
}


def event_row(raw):
    """Build an Events-tab row for a raw Track Central event name (None if unknown)."""
    name = raw.strip()
    rnd, leg = "Final", ""
    if name.endswith("(Trials)"):
        name, rnd = name[: -len("(Trials)")].strip(), "Prelim"
    std = name
    if name.upper() == "4X1200M":
        std = "4X1200M"
    m = None
    for pre in ("SMR", "DMR"):
        if name.startswith(pre + " - "):
            std, leg = pre, name.split(" - ", 1)[1]
            m = LEG_RANGES.get((pre, leg))
    if std not in STANDARD:
        return None
    disp, typ, hand, mn, mx, tmn, tmx, order = STANDARD[std]
    if m:
        mn, mx = m
    return [raw, std, disp, typ, leg, rnd, hand, mn, mx, tmn, tmx, order]
