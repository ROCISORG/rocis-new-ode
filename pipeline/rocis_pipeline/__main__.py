"""Command line: python -m rocis_pipeline <command>

  init-config   one-time: copy cohort dates and neighborhood codes from the old site
  run           build every cohort, run the checks, write the website data and reports
  run --only N  rebuild a single cohort and refresh the cohort list
  summary       add rows for new cohorts' downloads (every monitor) to the summary CSVs
"""
import argparse
import html
import json
import re
import sys
from datetime import datetime

from . import outputs, summary
from .process import build_from_raw
from .published import import_cohort, parse_column
from .registry import PIPELINE_DIR, Registry, load_cohorts, load_neighborhoods, load_settings, write_rows


def init_config(settings) -> None:
    page = settings.neighborhood_directory.read_text(encoding="utf-8")
    rows, region = [], ""
    pattern = re.compile(
        r'region-title">([^<]+)<|neighborhood-code">([^<]+)</span>\s*<span class="neighborhood-name">([^<]+)</span>'
        r'(\s*<span class="neighborhood-location">([^<]+)</span>)?')
    seen = set()
    for m in pattern.finditer(page):
        if m.group(1):
            region = html.unescape(m.group(1)).strip()
            continue
        code = m.group(2).strip()
        if code in seen:
            continue
        seen.add(code)
        place = html.unescape(m.group(5) or ("Allegheny County" if region.startswith("Allegheny") else region)).strip()
        # Locations are a county ("Beaver County", "Cambria County, PA") or a state code ("ME")
        county = place.removesuffix(", PA") if "County" in place else ""
        state = "PA" if county or place == "PA" else place
        rows.append({"code": code, "name": html.unescape(m.group(3)).strip(), "county": county, "state": state})
    write_rows(PIPELINE_DIR / "config" / "neighborhoods.csv", ["code", "name", "county", "state"], rows)

    explorer = settings.old_explorer.read_text(encoding="utf-8")
    block = re.search(r"const cohortDates = \{(.*?)\};", explorer, re.S).group(1)
    cohorts = []
    for number, label in re.findall(r"(\d+):\s*\"([^\"]+)\"", block):
        text = re.sub(r",\s*", ", ", label.strip())
        for fmt in ("%b %d, %Y", "%B %d, %Y"):
            try:
                day = datetime.strptime(text, fmt).strftime("%Y-%m-%d")
                break
            except ValueError:
                day = ""
        cohorts.append({"cohort": number, "label_date": day, "start": "", "end": "", "notes": ""})
    write_rows(PIPELINE_DIR / "config" / "cohorts.csv", ["cohort", "label_date", "start", "end", "notes"], cohorts)
    print(f"Wrote {len(rows)} neighborhood codes and {len(cohorts)} cohorts to config/.")


def published_pairs(settings) -> dict:
    pairs = {}
    for path in settings.published_data.glob("small_*.csv"):
        number = int(path.stem.split("_")[1])
        large = settings.published_data / f"large_{number}.csv"
        if large.exists():
            pairs[number] = (path, large)
    return pairs


def run(settings, only=None) -> int:
    neighborhoods = load_neighborhoods()
    cohort_meta = load_cohorts()
    if not neighborhoods or not cohort_meta:
        print("Run 'python -m rocis_pipeline init-config' first.")
        return 2
    if not settings.registry.exists():
        # without it every raw site would be given a new hash ID
        print(f"Site registry not found: {settings.registry}")
        return 2
    registry = Registry(settings.registry)
    raw_specs = {r.cohort: r for r in settings.raw_cohorts}
    pairs = published_pairs(settings)
    wanted = sorted(set(pairs) | set(raw_specs))
    if only is not None:
        wanted = [only]

    taken = set(registry.used_hashes())
    for small, _ in pairs.values():
        header = small.read_text(encoding="utf-8-sig").split("\n", 1)[0].strip().split(",")[1:]
        taken.update(p[0] for p in (parse_column(h.strip()) for h in header) if p)

    cohorts, entries, blocked = [], [], False
    for number in wanted:
        meta = cohort_meta.get(number, {})
        if number in raw_specs:
            cohort, summaries = build_from_raw(raw_specs[number], registry, neighborhoods, taken)
            folder = settings.output / f"cohort-{number}"
            outputs.write_explorer_csvs(cohort, folder)
            sheet = registry.for_cohort(number)
            report_rows = [{"site_id": s.site_id, "hash_id": s.column.split("_")[0]} for s in summaries]
            report_rows += [{"site_id": site, "hash_id": row["hash_id"]} for site, row in sheet.items()
                            if row["hash_id"] and site not in {r["site_id"] for r in report_rows}
                            and row.get("include", "").lower() not in {"no", "n", "false", "0"}]
            outputs.write_hash_report(number, report_rows, folder / f"hash-ids-cohort-{number}.md")
            outputs.write_summary_workbook(number, summaries, cohort.issues, folder / f"summary-cohort-{number}.xlsx")
            errors = [i for i in cohort.issues if i.level == "error"]
            blocked |= bool(errors)
            print(f"Cohort {number}: built from raw files, {len(cohort.monitors)} monitors, "
                  f"{len(errors)} error(s). Outputs in {folder}")
        else:
            small, large = pairs[number]
            cohort = import_cohort(number, small, large, neighborhoods)
        if not cohort.monitors:
            print(f"Cohort {number}: nothing to publish.")
            continue
        cohorts.append(cohort)
        entries.append(outputs.write_site_cohort(cohort, meta, neighborhoods, settings.site_data))

    if only is not None:
        manifest_path = settings.site_data / "cohorts.js"
        if manifest_path.exists():
            old = json.loads(manifest_path.read_text(encoding="utf-8")[len("ROCIS.manifest("):-3])
            entries += [e for e in old["cohorts"] if e["cohort"] != only]
    outputs.write_manifest(entries, neighborhoods, settings.site_data)
    report = outputs.write_checks_report(cohorts, settings.output / ("checks.md" if only is None else f"checks-cohort-{only}.md"))
    warnings = sum(1 for c in cohorts for i in c.issues if i.level == "warning")
    print(f"Website data for {len(entries)} cohorts in {settings.site_data}")
    print(f"Checks: {warnings} warning(s) across cohorts. Full list in {report}")
    if blocked:
        print("A raw cohort has errors, so it must not be published until they're fixed.")
        return 1
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m rocis_pipeline", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init-config")
    run_parser = sub.add_parser("run")
    run_parser.add_argument("--only", type=int, help="rebuild just this cohort")
    sub.add_parser("summary")
    args = parser.parse_args(argv)
    settings = load_settings()
    if args.command == "init-config":
        init_config(settings)
        return 0
    if args.command == "summary":
        return summary.run(settings)
    return run(settings, args.only)


if __name__ == "__main__":
    sys.exit(main())
