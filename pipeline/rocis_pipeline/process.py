"""Building a cohort from raw monitor downloads: identify, clean, join, trim, average."""
import hashlib
import statistics
from collections import defaultdict
from dataclasses import dataclass

from .dylos import identify, read_log
from .model import Cohort, Issue, Monitor, floor_15
from .registry import RawCohort, Registry


@dataclass
class SiteSummary:
    site_id: str
    column: str
    files: int
    readings: int
    kept: int
    first: object
    last: object
    dropped_lines: int
    repeated: int
    median_total: float | None
    p90_total: float | None
    max_total: float | None
    coverage: float


def average_15(readings: dict) -> tuple:
    """Average one-minute readings into 15-minute bins labelled by their start."""
    sums = defaultdict(lambda: [0, 0, 0])
    for stamp, (small, large) in readings.items():
        bucket = sums[floor_15(stamp)]
        bucket[0] += small
        bucket[1] += large
        bucket[2] += 1
    total = {b: s[0] / s[2] for b, s in sums.items()}
    large = {b: s[1] / s[2] for b, s in sums.items()}
    return total, large


def build_from_raw(spec: RawCohort, registry: Registry, neighborhoods: dict, taken_ids: set):
    issues, summaries = [], []
    sheet = registry.for_cohort(spec.cohort)
    if not sheet:
        issues.append(Issue("error", f"Cohort {spec.cohort} has no sites in the cohort sheet yet."))

    files_by_site, skipped_other = defaultdict(list), 0
    for path in sorted(p for p in spec.raw.rglob("*") if p.is_file()):
        info = identify(path)
        if info is None:
            issues.append(Issue("error", f"File name not recognised: {path.name}. Rename it to SITE_O_Dnnn_date.", public=False))
            continue
        if info.location != "O":
            skipped_other += 1
            continue
        files_by_site[info.site].append(info)
    if skipped_other:
        issues.append(Issue("note", f"{skipped_other} indoor or roamer file(s) were set aside; this explorer shows outdoor data."))

    def left_out(site):
        return sheet.get(site, {}).get("include", "").lower() in {"no", "n", "false", "0"}

    digests = defaultdict(list)
    for site, infos in files_by_site.items():
        if left_out(site):
            continue
        for info in infos:
            digests[hashlib.sha256(info.path.read_bytes()).hexdigest()].append(f"{site} ({info.path.name})")
    for names in digests.values():
        if len({n.split(" ")[0] for n in names}) > 1:
            issues.append(Issue("warning", "These files are identical: " + "; ".join(names) + ". Only include one of these sites.", public=False))

    monitors = []
    for site in sorted(files_by_site):
        row = sheet.get(site)
        if row is None:
            issues.append(Issue("error", f"Site {site} has files but isn't in the cohort {spec.cohort} sheet.", public=False))
            continue
        if row.get("include", "").lower() in {"no", "n", "false", "0"}:
            issues.append(Issue("note", f"{site} is marked 'include = no' in the cohort sheet and was left out.", public=False))
            continue
        code = row.get("neighborhood", "")
        if not code:
            issues.append(Issue("error", f"{site} has no neighborhood code in the cohort sheet.", public=False))
            continue
        if code.split("_")[0] not in neighborhoods and code not in neighborhoods:
            issues.append(Issue("error", f"{site}: neighborhood code {code} isn't in the neighborhood directory.", public=False))
        hash_id, is_new = registry.assign(spec.cohort, site, taken_ids)
        taken_ids.add(hash_id)
        if is_new:
            issues.append(Issue("note", f"{site} is a new site and was given hash ID {hash_id}.", public=False))

        readings, rejected, repeated, conflicting, file_conflicts = {}, 0, 0, 0, 0
        for info in infos_sorted(files_by_site[site]):
            log = read_log(info.path)
            rejected += log.rejected_lines
            repeated += log.repeated
            conflicting += log.conflicting
            for stamp, values in log.readings.items():
                if stamp in readings and readings[stamp] != values:
                    file_conflicts += 1
                readings.setdefault(stamp, values)
        if conflicting or file_conflicts:
            issues.append(Issue("warning", f"{hash_id}_O_{code}: {conflicting + file_conflicts:,} readings appear twice with different values."))
        kept = {s: v for s, v in readings.items()
                if (spec.start is None or s > spec.start) and (spec.end is None or s < spec.end)}
        if not kept:
            issues.append(Issue("warning", f"{site} has no readings inside the cohort dates.", public=False))
            continue
        total, large = average_15(kept)
        column = f"{hash_id}_O_{code}"
        monitors.append(Monitor(column, hash_id, "O", code, total, large))

        smalls = sorted(v[0] for v in kept.values())
        span_bins = (floor_15(max(kept)) - floor_15(min(kept))).total_seconds() / 900 + 1
        summaries.append(SiteSummary(
            site, column, len(files_by_site[site]), len(readings), len(kept), min(kept), max(kept),
            rejected, repeated, statistics.median(smalls),
            smalls[int(0.9 * (len(smalls) - 1))], smalls[-1], len(total) / span_bins))
        inverted = sum(1 for s, l in kept.values() if l > s)
        if inverted:
            issues.append(Issue("note", f"{column}: large count above total count in {inverted} readings."))

    for site, row in sheet.items():
        if site not in files_by_site and row.get("include", "").lower() not in {"no", "n", "false", "0"}:
            issues.append(Issue("note", f"{site} is in the cohort sheet but no outdoor files have arrived yet.", public=False))
    columns = [m.column for m in monitors]
    if len(set(columns)) != len(columns):
        issues.append(Issue("error", "Two sites produce the same column name. Check hash IDs in the cohort sheet."))
    registry.save()
    return Cohort(spec.cohort, "raw", monitors, issues), summaries


def infos_sorted(infos):
    return sorted(infos, key=lambda i: i.path.name)
