"""Settings, cohort list, neighborhood codes and the private site registry."""
import csv
import random
import tomllib
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent
TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


@dataclass
class RawCohort:
    cohort: int
    raw: Path
    start: datetime | None
    end: datetime | None


@dataclass
class Settings:
    published_data: Path
    site_data: Path
    output: Path
    registry: Path
    neighborhood_directory: Path
    old_explorer: Path
    raw_cohorts: list = field(default_factory=list)
    summary: dict | None = None  # existing files, corrections file and [(cohort, raw folder)] for the summary CSV


def _resolve(value: str) -> Path:
    return (PIPELINE_DIR / value).resolve()


def _when(value):
    return datetime.strptime(value, TIME_FORMAT) if value else None


def load_settings(path: Path = PIPELINE_DIR / "pipeline.toml") -> Settings:
    with open(path, "rb") as file:
        config = tomllib.load(file)
    paths = config["paths"]
    return Settings(
        published_data=_resolve(paths["published_data"]),
        site_data=_resolve(paths["site_data"]),
        output=_resolve(paths["output"]),
        registry=_resolve(paths["registry"]),
        neighborhood_directory=_resolve(paths["neighborhood_directory"]),
        old_explorer=_resolve(paths["old_explorer"]),
        raw_cohorts=[
            RawCohort(int(c["cohort"]), _resolve(c["raw"]), _when(c.get("start")), _when(c.get("end")))
            for c in config.get("raw_cohorts", [])
        ],
        summary=_summary(config.get("summary")),
    )


def _summary(conf):
    if not conf:
        return None
    return {"existing": _resolve(conf["existing"]), "corrections": _resolve(conf["corrections"]),
            "cohorts": [(int(c["cohort"]), _resolve(c["raw"])) for c in conf.get("cohorts", [])]}


def read_rows(path: Path) -> list:
    if not path.exists():
        return []
    with open(path, encoding="utf-8-sig", newline="") as file:
        return [{k: (v or "").strip() for k, v in row.items()} for row in csv.DictReader(file)]


def write_rows(path: Path, fieldnames: list, rows: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def load_cohorts() -> dict:
    """Cohort number -> {"label_date", "start", "end", "notes"} from config/cohorts.csv."""
    return {int(r["cohort"]): r for r in read_rows(PIPELINE_DIR / "config" / "cohorts.csv")}


def load_neighborhoods() -> dict:
    """Neighborhood code -> {"name", "county", "state"} from config/neighborhoods.csv."""
    return {r["code"]: r for r in read_rows(PIPELINE_DIR / "config" / "neighborhoods.csv")}


class Registry:
    """The private list linking each site (home) to its public hash ID.

    It lives outside this repository (see `registry` in pipeline.toml) and must never be published. A site keeps the
    same hash ID in every cohort it joins; new sites get a random unused number.
    """

    FIELDS = ["cohort", "site_id", "hash_id", "neighborhood", "include", "source"]

    def __init__(self, path: Path):
        self.path = path
        self.rows = read_rows(path)

    def for_cohort(self, cohort: int) -> dict:
        return {r["site_id"]: r for r in self.rows if r["cohort"] == str(cohort)}

    def previous_hash(self, site_id: str) -> str | None:
        earlier = [r for r in self.rows if r["site_id"] == site_id and r["hash_id"]]
        if not earlier:
            return None
        return max(earlier, key=lambda r: int(r["cohort"]) if r["cohort"].isdigit() else -1)["hash_id"]

    def used_hashes(self) -> set:
        return {r["hash_id"] for r in self.rows if r["hash_id"]}

    def assign(self, cohort: int, site_id: str, taken: set) -> tuple:
        """Return (hash_id, is_new) for a site in a cohort, adding it to the registry."""
        row = self.for_cohort(cohort).get(site_id)
        if row and row["hash_id"]:
            return row["hash_id"], False
        hash_id = self.previous_hash(site_id)
        is_new = hash_id is None
        if is_new:
            free = [str(n) for n in range(1000, 10000) if str(n) not in taken | self.used_hashes()]
            hash_id = random.SystemRandom().choice(free)
        if row:
            row["hash_id"] = hash_id
        else:
            self.rows.append({"cohort": str(cohort), "site_id": site_id, "hash_id": hash_id,
                              "neighborhood": "", "include": "", "source": "assigned by pipeline"})
        return hash_id, is_new

    def save(self) -> None:
        for row in self.rows:
            for key in self.FIELDS:
                row.setdefault(key, "")
        write_rows(self.path, self.FIELDS, self.rows)
