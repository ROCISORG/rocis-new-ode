"""Reading raw Dylos DC1700 downloads and identifying files from their names."""
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

READING = re.compile(
    r"^(\d{1,2})/(\d{1,2})/(\d{2}) (\d{2}):(\d{2}), *(\d{1,12}), *(\d{1,6})$"
)
# Volunteers name files by hand, so allow the variants seen in past cohorts:
# "XQA_O_D223_10-08-26_PROXY.txt", "XQB_OUT-O-D010_8.12.26.log", "XQC-R-D034-Bedroom.log".
FILE_NAME = re.compile(
    r"^_?(?P<site>[A-Za-z]{2,4})[ _-]+(?:OUT[ _-]+)?(?P<loc>[OIR0])(?=[ _-])"
    r"(?:[ _-]+D(?P<monitor>\d{2,4}))?",
    re.IGNORECASE,
)


@dataclass
class FileInfo:
    path: Path
    site: str
    location: str  # O outdoor, I indoor, R roamer
    monitor: str | None


@dataclass
class LogContents:
    readings: dict  # timestamp -> (small, large)
    rejected_lines: int
    repeated: int
    conflicting: int


def identify(path: Path) -> FileInfo | None:
    match = FILE_NAME.match(path.name)
    if not match:
        return None
    location = match.group("loc").upper().replace("0", "O")
    return FileInfo(path, match.group("site").upper(), location, match.group("monitor"))


def read_log(path: Path) -> LogContents:
    readings, rejected, repeated, conflicting = {}, 0, 0, 0
    text = path.read_bytes().decode("latin-1")
    for line in re.split(r"\r\n|\r|\n", text):
        if not line.strip():
            continue
        match = READING.match(line)
        if not match:
            rejected += 1
            continue
        month, day, year, hour, minute, small, large = map(int, match.groups())
        try:
            stamp = datetime(2000 + year, month, day, hour, minute)
        except ValueError:
            rejected += 1
            continue
        if stamp in readings:
            repeated += 1
            if readings[stamp] != (small, large):
                conflicting += 1
        readings[stamp] = (small, large)
    return LogContents(readings, rejected, repeated, conflicting)
