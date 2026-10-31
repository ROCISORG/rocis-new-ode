"""The summary CSV: one row per raw Dylos download, for every monitor (indoor, outdoor, roamer).

There are two files with the same rows, one with statistics of the small (total) channel and one with the large
channel. Greg's by-site Data Explorer uses them as its directory of files, so new rows copy the existing files'
columns and number formats exactly. Rows already in the existing files are never changed; new rows are appended.

File names are typed by hand, so the parts of a name (site, location, monitor, date, room) are read leniently and
anything that needed a guess is reported. Fixes that need a person go in the corrections file, which is re-applied
on every run so they survive a rebuild.
"""
import csv
import hashlib
import io
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

from .dylos import READING
from .registry import load_cohorts

KINDS = {"Small": 0, "Large": 1}
FILE_NAME = "{kind}_round_all_unique_mark_intervention.csv"
COLUMNS = ["filename", "filename_standard", "home_id_standard", "general_location_standard",
           "specific_location_standard", "floor", "equip_id_standard", "round", "Raw Start Time", "Raw End Time",
           "count", "Raw duration/[min]", "missing data count", "min", "25%", "50%", "75%", "max", "mean", "std",
           "intervention"]
CORRECTABLE = {"site", "location", "monitor", "date", "room", "floor", "round", "intervention"}

# Words people add to a file name to describe the file rather than the room it was in.
NOTES = re.compile(
    r"data is duplicated|time date error|time out|bad[ _]?data|bad[ _]?date|some bad|possible err+or|do not use"
    r"|corrected|confirm|redo|skip|tbd|test|(?<![A-Za-z])(?:rev|new|all)(?![A-Za-z])", re.IGNORECASE)
# "_" counts as a word character, so (?<![A-Za-z]) instead of \b to match "_2ndFl" and "_FirstFloor"
FLOORS = [(re.compile(r"(?<![A-Za-z])" + p, re.IGNORECASE), name) for p, name in [
    (r"(1st|first) ?fl(oor)?", "1STFLOOR"), (r"(2nd|second) ?fl(oor)?", "2NDFLOOR"),
    (r"(3rd|3nd|third) ?fl(oor)?", "3RDFLOOR"), (r"upstairs", "UPSTAIRS"), (r"downstairs", "DOWNSTAIRS"),
    (r"basement", "BASEMENT")]]
DATES = [  # (pattern, order of the groups)
    (re.compile(r"(?<!\d)(\d{1,2})[-_.](\d{1,2})[-_.=](\d{4}|\d{2})(?!\d)"), "mdy"),
    (re.compile(r"(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)"), "mdy"),
    (re.compile(r"(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)"), "mdy"),
]


@dataclass
class NameParts:
    site: str = ""
    location: str = "-"
    monitor: str = ""
    day: date | None = None  # the download date written in the name
    room: str = "-"
    floor: str = "-"
    notes: list = field(default_factory=list)
    problems: list = field(default_factory=list)


def parse_name(name: str) -> NameParts:
    """Split a hand-typed download name like "XQA_I_D057_05-07-2026_Living Room.log" into its parts."""
    parts = NameParts()
    stem = re.sub(r"\.(log|txt)$", "", name, flags=re.IGNORECASE)
    site = re.match(r"^_?([A-Za-z]{2,4})(?=[ _-]|$)", stem)
    if not site:
        parts.problems.append("no site ID at the start of the name")
        return parts
    parts.site = site.group(1).upper()
    rest = stem[site.end():]

    # Location: a lone I, O, R or S (any case), also inside "OUT-O-D010" or "BED-R-D2228"; L is a typo seen once
    loc = re.match(r"^[ _-]+(?:(?:OUT|BED|KIT)[ _-]+)?([IORSLiorsl0])(?=[ _-]|$)", rest)
    if loc:
        letter = loc.group(1).upper().replace("0", "O")
        if letter == "L":
            parts.problems.append('location "L" isn\'t a location code')
        else:
            parts.location = letter
            if loc.group(1).islower():
                parts.problems.append("location code is lowercase")
        rest = rest[loc.end():]
    else:
        parts.problems.append("no location code (I, O, R or S) after the site ID")

    mon = re.search(r"(?<![A-Za-z])D[ _]?D?[ _]?(\d{2,4})(?!\d)", rest, re.IGNORECASE)
    if mon:
        digits = mon.group(1)
        if len(digits) == 4:
            parts.problems.append(f"monitor number D{digits} has 4 digits")
        elif len(digits) == 2:
            parts.problems.append(f"monitor number D{digits} has 2 digits")
        parts.monitor = "D" + digits.zfill(3)
        if re.search(r"D[ _]|DD", mon.group(0), re.IGNORECASE):
            parts.problems.append(f'monitor written as "{mon.group(0).strip()}"')
        rest = rest[:mon.start()] + " " + rest[mon.end():]
    else:
        parts.problems.append("no monitor number (Dnnn) in the name")

    for pattern, _ in DATES:
        found = pattern.search(rest)
        if not found:
            continue
        month, day, year = int(found.group(1)), int(found.group(2)), found.group(3)
        year = int(year) if len(year) == 4 else 2000 + int(year)
        try:
            parts.day = date(year, month, day)
        except ValueError:
            parts.problems.append(f'date "{found.group(0)}" isn\'t a real date')
        if "=" in found.group(0):
            parts.problems.append(f'date written as "{found.group(0)}"')
        rest = rest[:found.start()] + " " + rest[found.end():]
        break

    for found in NOTES.finditer(rest):
        parts.notes.append(found.group(0))
    rest = NOTES.sub(" ", rest)
    for pattern, floor in FLOORS:
        if pattern.search(rest):
            parts.floor = floor
            if floor != "BASEMENT":
                rest = pattern.sub(" ", rest)
            break
    room = re.sub(r"[^A-Za-z0-9]", "", rest).upper()
    parts.room = room or "-"
    return parts


def fmt(value: float, places: int) -> str:
    """Round like the existing files: 1384.4, 590 (not 590.0), 12.25."""
    text = f"{round(value, places):.{places}f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def when(stamp: datetime) -> str:
    return f"{stamp:%Y-%m-%d} {stamp.hour}:{stamp:%M:%S}"


def load_corrections(path: Path) -> dict:
    """(cohort, filename) -> {field: value} from the corrections CSV."""
    corrections = defaultdict(dict)
    if path.exists():
        with open(path, encoding="utf-8-sig", newline="") as file:
            for row in csv.DictReader(file):
                key = (row["cohort"].strip(), row["filename"].strip())
                if row["field"].strip() not in CORRECTABLE:
                    raise ValueError(f"Unknown field {row['field']!r} in {path.name}; use one of {sorted(CORRECTABLE)}")
                corrections[key][row["field"].strip()] = row["value"].strip()
    return corrections


def existing_rounds(rows: list) -> dict:
    """Site ID -> the round it already has in the summary (its first cohort; "0" marks a long-term site)."""
    rounds = defaultdict(set)
    for row in rows:
        if row["round"] not in ("", "-"):
            rounds[row["home_id_standard"]].add(row["round"])
    first = {}
    for site, values in rounds.items():
        numbers = sorted(int(v) for v in values if v.isdigit())
        first[site] = str(numbers[0]) if numbers else sorted(values)[0]
    return first


@dataclass
class Download:
    cohort: int
    path: Path
    parts: NameParts
    readings: list  # (stamp, small, large) for every valid line, repeats included
    rejected: int
    digest: str
    flags: list = field(default_factory=list)  # things a person should look at
    info: list = field(default_factory=list)  # how a field was worked out, nothing wrong
    round: str = ""
    intervention: str = "FALSE"


def read_lines(path: Path) -> tuple:
    """Every valid reading as (stamp, small, large), repeats included as the existing counts do, and the junk count."""
    readings, rejected = [], 0
    for line in re.split(r"\r\n|\r|\n", path.read_bytes().decode("latin-1")):
        if not line.strip():
            continue
        match = READING.match(line)
        try:
            month, day, year, hour, minute, small, large = map(int, match.groups())
            readings.append((datetime(2000 + year, month, day, hour, minute), small, large))
        except (AttributeError, ValueError):
            rejected += 1
    return readings, rejected


def build(cohorts: list, existing: list, corrections: dict, starts: dict) -> list:
    """Read every download of the given cohorts [(number, folder)] and work out its summary fields."""
    downloads = []
    for number, folder in cohorts:
        for path in sorted(p for p in folder.rglob("*") if p.is_file()):
            parts = parse_name(path.name)
            readings, rejected = read_lines(path)
            d = Download(number, path, parts, readings, rejected, hashlib.sha256(path.read_bytes()).hexdigest())
            fixes = corrections.get((str(number), path.name), {})
            for key, value in fixes.items():
                if key == "date":
                    parts.day = datetime.strptime(value, "%Y-%m-%d").date()
                elif key in ("round", "intervention"):
                    setattr(d, key, value.upper())
                else:
                    setattr(parts, key, value)
                # a hand fix answers the name problem it was about
                topic = {"site": "site", "location": "location", "monitor": "monitor", "date": "date"}.get(key)
                parts.problems = [p for p in parts.problems if not topic or topic not in p]
            if fixes:
                d.flags.append("corrected by hand: " + ", ".join(f"{k} = {v}" for k, v in fixes.items()))
            downloads.append(d)

    # A monitor missing from a name is filled in when that site and location used exactly one monitor that cohort
    used = defaultdict(set)
    for d in downloads:
        if d.parts.monitor:
            used[(d.cohort, d.parts.site, d.parts.location)].add(d.parts.monitor)
    for d in downloads:
        options = used[(d.cohort, d.parts.site, d.parts.location)]
        if not d.parts.monitor and len(options) == 1:
            d.parts.monitor = next(iter(options))
            d.info.append(f"monitor {d.parts.monitor} filled in from the site's other {d.parts.location} files")

    for d in downloads:
        if not d.readings:
            d.flags.append("no readings in the file")
            continue
        # A monitor whose clock reset logs from 01-01-2000. When the file also has real dates, those readings are left
        # out of the times and statistics; a file with nothing else keeps them, as the existing rows do.
        real = [r for r in d.readings if 2015 <= r[0].year and r[0] <= datetime.now()]
        if real and len(real) < len(d.readings):
            d.flags.append(f"{len(d.readings) - len(real)} readings dated {min(r[0] for r in d.readings):%m-%d-%Y} "
                           "(clock reset) left out of the times and statistics")
            d.readings = real
        elif not real:
            d.flags.append(f"every reading is dated {d.readings[0][0]:%m-%d-%Y} or so: the monitor's clock was wrong, "
                           "so the times in this row aren't real")
        first, last = min(r[0] for r in d.readings), max(r[0] for r in d.readings)
        stamps = [r[0] for r in d.readings]
        back = [i for i in range(1, len(stamps)) if stamps[i] < stamps[i - 1]]
        if back and real:
            twice = len(stamps) - len(set(stamps))
            d.flags.append(f"time jumps back {len(back)} time(s), first at {stamps[back[0] - 1]:%m-%d %H:%M}; "
                           f"{twice} minutes appear twice, so the file probably holds two downloads appended")
        name_date = d.parts.day
        # The name's date is the download day: it should fall between the last reading and a few weeks after
        if name_date is None:
            d.parts.day = last.date()
            d.info.append(f"no date in the name; used the last reading's date {last:%m-%d-%y}")
        elif real and not (last.date() - timedelta(days=2) <= name_date <= last.date() + timedelta(days=45)):
            fixed = date(last.year, name_date.month, name_date.day) if name_date.year != last.year else None
            if fixed and last.date() - timedelta(days=2) <= fixed <= last.date() + timedelta(days=45):
                d.parts.day = fixed
                d.info.append(f"year typo in the name ({name_date:%m-%d-%Y}); used {fixed:%m-%d-%y}")
            else:
                d.flags.append(f"name date {name_date:%m-%d-%y} doesn't match the readings "
                               f"({first:%m-%d-%y} to {last:%m-%d-%y})")
        if len(d.readings) < 60:
            d.flags.append(f"only {len(d.readings)} readings")
        # PuTTY headers, "*** DISCONNECT" and "Dylos DC1700" lines are normal; lots of broken lines aren't
        if d.rejected > max(25, len(d.readings) // 100):
            d.flags.append(f"{d.rejected} lines that aren't readings")
        if d.parts.notes:
            d.flags.append("note in the name: " + ", ".join(f'"{n}"' for n in d.parts.notes))

    # Round: a site keeps the first cohort it was in (existing summary first, then these cohorts)
    known = existing_rounds(existing)
    first_here = {}
    for d in downloads:
        first_here[d.parts.site] = min(first_here.get(d.parts.site, d.cohort), d.cohort)
    for d in downloads:
        if d.round:
            continue
        if d.parts.site in known:
            d.round = known[d.parts.site]
            if d.round != str(d.cohort):
                note = "a long-term site" if d.round == "0" else f"first in cohort {d.round}"
                d.info.append(f"returning site ({note}), so round stays {d.round}")
        else:
            d.round = str(first_here[d.parts.site])
            if d.round != str(d.cohort):
                d.info.append(f"site first appears in cohort {d.round}, so round is {d.round}")
    # Readings from before a new site's cohort start are stray data from the monitor's last home (Linda, Oct 2026)
    for d in downloads:
        start = starts.get(int(d.round)) if d.round.isdigit() and d.round != "0" else None
        early = sum(1 for r in d.readings if start and r[0] < start)
        if early:
            d.info.append(f"{early} readings from before the cohort {d.round} start ({start:%m-%d-%y}); "
                          "start-date clipping will leave them out")

    # Same bytes as another download
    by_digest = defaultdict(list)
    for d in downloads:
        by_digest[d.digest].append(d)
    for group in by_digest.values():
        for d in group[1:]:
            d.flags.append(f"identical to {group[0].path.name}")
    # The same monitor in two places, or one site/location switching monitors
    for d in downloads:
        # Lowercase codes and "D 277" style numbers are read without guessing, so they're only noted
        minor = [p for p in d.parts.problems if "lowercase" in p or p.startswith("monitor written as")]
        d.info = [f"name: {p}" for p in minor] + d.info
        d.flags = [f"name: {p}" for p in d.parts.problems if p not in minor] + d.flags
    return downloads


def rows_for(downloads: list, channel: int) -> list:
    rows = []
    for d in downloads:
        p = d.parts
        values = [r[1 + channel] for r in d.readings]
        row = {
            "filename": d.path.name,
            "filename_standard": f"{p.site or '-'}_{p.location}_{p.monitor or 'D'}_{p.day:%m-%d-%y}"
            if p.day else f"{p.site or '-'}_{p.location}_{p.monitor or 'D'}_-",
            "home_id_standard": p.site or "-",
            "general_location_standard": p.location,
            "specific_location_standard": p.room,
            "floor": p.floor,
            "equip_id_standard": p.monitor or "D",
            "round": d.round or "-",
            "intervention": d.intervention,
        }
        if values:
            first, last = min(r[0] for r in d.readings), max(r[0] for r in d.readings)
            duration = int((last - first).total_seconds() // 60) + 1
            q1, q2, q3 = statistics.quantiles(values, n=4, method="inclusive") if len(values) > 1 else [values[0]] * 3
            row.update({
                "Raw Start Time": when(first), "Raw End Time": when(last), "count": str(len(values)),
                "Raw duration/[min]": str(duration), "missing data count": str(max(0, duration - len(values))),
                "min": str(min(values)), "25%": fmt(q1, 2), "50%": fmt(q2, 2), "75%": fmt(q3, 2),
                "max": str(max(values)), "mean": fmt(statistics.fmean(values), 1),
                "std": fmt(statistics.stdev(values), 1) if len(values) > 1 else "0",
            })
        else:
            row.update({k: "-" for k in COLUMNS if k not in row})
        rows.append(row)
    return rows


def read_existing(folder: Path, kind: str) -> list:
    with open(folder / FILE_NAME.format(kind=kind), encoding="utf-8", errors="replace", newline="") as file:
        return list(csv.DictReader(file))


def write(path: Path, rows: list, append_to: Path | None = None) -> None:
    """Write rows with CRLF and no BOM like the existing files; with append_to, copy that file first, unchanged."""
    path.parent.mkdir(parents=True, exist_ok=True)
    old = append_to.read_bytes() if append_to else b""
    if old and not old.endswith((b"\n", b"\r")):
        old += b"\r\n"
    text = io.StringIO(newline="")
    writer = csv.DictWriter(text, fieldnames=COLUMNS, lineterminator="\r\n")
    if not append_to:
        writer.writeheader()
    writer.writerows(rows)
    path.write_bytes(old + text.getvalue().encode("utf-8"))


def report(downloads: list, path: Path) -> Path:
    """Markdown list of every new row that needed a guess or a person's attention. It names site IDs: keep it private."""
    lines = ["# Summary CSV checks", "",
             "Generated by `python -m rocis_pipeline summary`. Private: it names site IDs.", ""]
    by_cohort = defaultdict(list)
    for d in downloads:
        by_cohort[d.cohort].append(d)
    for cohort, items in sorted(by_cohort.items()):
        flagged = [d for d in items if d.flags]
        sites = sorted({d.parts.site for d in items})
        lines += [f"## Cohort {cohort}", "",
                  f"{len(items)} files from {len(sites)} sites. {len(flagged)} files need a look.", ""]
        locs = Counter(d.parts.location for d in items)
        lines += ["Files by location: " + ", ".join(f"{k} {v}" for k, v in sorted(locs.items())), "",
                  "### Needs a look", ""]
        for d in flagged:
            lines.append(f"- `{d.path.name}`")
            lines += [f"  - {f}" for f in d.flags]
        lines += ["", "### How fields were filled in", ""]
        for d in items:
            if d.info and not d.flags:
                lines.append(f"- `{d.path.name}`: " + "; ".join(d.info))
            elif d.info:
                lines.append(f"- `{d.path.name}` (also above): " + "; ".join(d.info))
        lines.append("")

    # Monitor moves within a site: the same monitor under two locations, or rooms that swap
    lines += ["## Same monitor, different location", "",
              "A monitor that shows up under two location codes at one site usually means one name has the wrong code.", ""]
    seen = defaultdict(lambda: defaultdict(list))
    for d in downloads:
        if d.parts.monitor:
            seen[(d.cohort, d.parts.site, d.parts.monitor)][d.parts.location].append(d.path.name)
    found = False
    for (cohort, site, monitor), locs in sorted(seen.items()):
        if len(locs) > 1:
            found = True
            lines.append(f"- Cohort {cohort}, {site} {monitor}: " +
                         "; ".join(f"{loc} in {', '.join(f'`{n}`' for n in names)}" for loc, names in sorted(locs.items())))
    lines += ([] if found else ["None."]) + [""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def run(settings) -> int:
    conf = settings.summary
    if not conf:
        print("No [summary] section in pipeline.toml.")
        return 1
    existing = read_existing(conf["existing"], "Small")
    corrections = load_corrections(conf["corrections"])
    starts = {n: datetime.strptime(c["label_date"], "%Y-%m-%d") for n, c in load_cohorts().items() if c["label_date"]}
    downloads = build(conf["cohorts"], existing, corrections, starts)
    out = settings.output / "summary"
    numbers = sorted({n for n, _ in conf["cohorts"]})
    tag = f"{numbers[0]}-{numbers[-1]}" if len(numbers) > 1 else str(numbers[0])
    for kind, channel in KINDS.items():
        rows = rows_for(downloads, channel)
        write(out / f"{kind}_new_rows_cohorts_{tag}.csv", rows)
        write(out / FILE_NAME.format(kind=kind), rows, append_to=conf["existing"] / FILE_NAME.format(kind=kind))
    checks = report(downloads, out / f"checks-summary-{tag}.md")
    flagged = sum(1 for d in downloads if d.flags)
    print(f"{len(downloads)} new rows (cohorts {tag}) added to the summary files in {out}")
    print(f"{flagged} files need a look. Full list in {checks}")
    return 0
