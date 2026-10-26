"""Importing cohorts that are already published as large_N.csv / small_N.csv."""
import csv
import re
from datetime import datetime
from pathlib import Path

from .model import STEP, Cohort, Issue, Monitor

STAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2})$")
COLUMN = re.compile(r"^(\d{1,4})_([A-Z0-9])_(.+)$")


def parse_column(name: str):
    match = COLUMN.match(name)
    if not match:
        return None
    return match.group(1).zfill(4), match.group(2), match.group(3)


def _read(path: Path):
    with open(path, encoding="utf-8-sig", newline="") as file:
        reader = csv.reader(file)
        header = next(reader)
        rows = [r for r in reader if any(cell.strip() for cell in r)]
    return header, rows


def _load(path: Path, issues: list, label: str):
    """Return ({column: {time: value}}, header) for one published file."""
    header, rows = _read(path)
    raw_names = header[1:]
    names = [h.strip() for h in raw_names]
    if any(a != b for a, b in zip(raw_names, names)):
        issues.append(Issue("note", f"{label} file: spaces around column names were removed."))
    series = {n: {} for n in names}
    blank_time, blank_with_values, bad_values, duplicates, previous, backwards = 0, 0, 0, 0, None, 0
    for row in rows:
        stamp_text = row[0].strip() if row else ""
        if not stamp_text:
            blank_time += 1
            if any(cell.strip() for cell in row[1:]):
                blank_with_values += 1
            continue
        match = STAMP.match(stamp_text)
        if not match:
            blank_time += 1
            continue
        stamp = datetime(*map(int, match.groups()))
        if previous and stamp < previous:
            backwards += 1
        previous = stamp
        for name, cell in zip(names, row[1:]):
            cell = cell.strip()
            if not cell:
                continue
            try:
                value = float(cell)
            except ValueError:
                bad_values += 1
                continue
            if stamp in series[name]:
                duplicates += 1
            series[name][stamp] = value
    if blank_with_values:
        issues.append(Issue("warning", f"{label} file: {blank_with_values:,} rows have readings but no date and time, so they can't be shown."))
    elif blank_time:
        issues.append(Issue("note", f"{label} file: {blank_time:,} empty rows were skipped."))
    if bad_values:
        issues.append(Issue("warning", f"{label} file: {bad_values:,} values aren't numbers and were skipped."))
    if duplicates:
        issues.append(Issue("note", f"{label} file: {duplicates:,} repeated times; the last value was kept."))
    if backwards:
        issues.append(Issue("note", f"{label} file: rows are not in time order in {backwards:,} places."))
    return series, names


def import_cohort(number: int, small_path: Path, large_path: Path, neighborhoods: dict) -> Cohort:
    issues = []
    total, total_names = _load(small_path, issues, "Total")
    large, large_names = _load(large_path, issues, "Large")

    only_total = [n for n in total_names if n not in large_names]
    only_large = [n for n in large_names if n not in total_names]
    if only_total or only_large:
        def codes(columns):
            return sorted(c.split("_", 2)[-1] for c in columns)
        if only_total and only_large and codes(only_total) == codes(only_large):
            issues.append(Issue("warning", "The total and large files give different hash IDs to the same neighborhoods, so one file's column names are probably shifted. Those monitors appear twice."))
        else:
            if only_total:
                issues.append(Issue("note", f"{len(only_total)} monitor(s) only have total particle data: {', '.join(only_total)}."))
            if only_large:
                issues.append(Issue("note", f"{len(only_large)} monitor(s) only have large particle data: {', '.join(only_large)}."))

    monitors = []
    for name in total_names + [n for n in only_large]:
        parsed = parse_column(name)
        if not parsed:
            issues.append(Issue("warning", f"Column '{name}' doesn't follow the ID_O_CODE pattern."))
            hash_id, location, code = "", "O", name
        else:
            hash_id, location, code = parsed
        monitor = Monitor(name, hash_id, location, code, total.get(name, {}), large.get(name, {}))
        if not monitor.total and not monitor.large:
            issues.append(Issue("note", f"{name} has a column but no readings."))
        monitors.append(monitor)

    unknown = sorted({m.code for m in monitors if m.code.split("_")[0] not in neighborhoods and m.code not in neighborhoods})
    if unknown:
        issues.append(Issue("note", f"Neighborhood code(s) not in the directory: {', '.join(unknown)}."))

    inverted = compared = 0
    for m in monitors:
        for stamp, value in m.large.items():
            if stamp in m.total:
                compared += 1
                inverted += value > m.total[stamp]
    if inverted:
        issues.append(Issue("note", f"Large count is higher than total count in {inverted:,} of {compared:,} values, which shouldn't happen."))

    stamps = sorted({s for m in monitors for s in m.total} | {s for m in monitors for s in m.large})
    gaps = [b - a for a, b in zip(stamps, stamps[1:]) if b - a > STEP]
    off_grid = [s for s in stamps if s.minute % 15 or s.second]
    if gaps:
        longest = max(gaps)
        issues.append(Issue("note", f"{len(gaps)} gap(s) in the time grid, the longest {longest.total_seconds() / 3600:.1f} hours."))
    if off_grid:
        issues.append(Issue("warning", f"{len(off_grid)} times are not on a 15-minute mark."))
    return Cohort(number, "published", monitors, issues)
