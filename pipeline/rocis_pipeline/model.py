from dataclasses import dataclass, field
from datetime import datetime, timedelta

STEP = timedelta(minutes=15)


@dataclass
class Issue:
    level: str  # "error" blocks a release, "warning" needs a look, "note" is informational
    message: str
    public: bool = True  # False when the message names a site ID; kept out of the website data

    def as_dict(self):
        return {"level": self.level, "message": self.message}


@dataclass
class Monitor:
    column: str
    hash_id: str
    location: str
    code: str
    total: dict = field(default_factory=dict)  # bin start -> 15-minute average
    large: dict = field(default_factory=dict)


@dataclass
class Cohort:
    number: int
    source: str  # "published" or "raw"
    monitors: list
    issues: list = field(default_factory=list)

    def bins(self):
        stamps = set()
        for m in self.monitors:
            stamps.update(m.total)
            stamps.update(m.large)
        return stamps

    def span(self):
        stamps = self.bins()
        return (min(stamps), max(stamps)) if stamps else (None, None)


def floor_15(stamp: datetime) -> datetime:
    return stamp.replace(minute=stamp.minute - stamp.minute % 15, second=0, microsecond=0)
