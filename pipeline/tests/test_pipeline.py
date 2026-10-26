import math
import shutil
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from rocis_pipeline.dylos import identify, read_log
from rocis_pipeline.process import average_15, build_from_raw
from rocis_pipeline.published import import_cohort
from rocis_pipeline.registry import PIPELINE_DIR, RawCohort, Registry, load_neighborhoods, load_settings


class FileNames(unittest.TestCase):
    def test_variants_seen_in_past_cohorts(self):
        cases = {
            "XQA_O_D223_10-08-26_PROXY.txt": ("XQA", "O", "223"),
            "XQB_OUT-O-D010_8.12.26.log": ("XQB", "O", "010"),
            "XQB_OUT_O_D010.log": ("XQB", "O", "010"),
            "XQC-R-D034-Bedroom.log": ("XQC", "R", "034"),
            "XQD_I_D085_07-23-26_LivingRoom": ("XQD", "I", "085"),
            "XQE_O_D283_10-09-12_Back Porch": ("XQE", "O", "283"),
        }
        for name, expected in cases.items():
            info = identify(Path(name))
            self.assertIsNotNone(info, name)
            self.assertEqual((info.site, info.location, info.monitor), expected, name)

    def test_unrecognised_name(self):
        self.assertIsNone(identify(Path("readings from tuesday.txt")))


class ReadingLogs(unittest.TestCase):
    def test_junk_lines_and_repeats(self):
        text = ("=~=~= PuTTY log 2026.10.09 =~=~=\r\nDylos DC1700\r\n337,23\r\n"
                "10/01/26 19:50,301,25\r\n10/01/26 19:51,304,19\r\n10/01/26 19:51,304,19\r\n"
                "*** DISCONNECT\r\n110/04/26 09:15,702,93\r\n")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "X_O_D001_log"
            path.write_text(text, encoding="latin-1")
            log = read_log(path)
        self.assertEqual(len(log.readings), 2)
        self.assertEqual(log.repeated, 1)
        self.assertEqual(log.conflicting, 0)
        self.assertEqual(log.rejected_lines, 5)


class Averaging(unittest.TestCase):
    def test_bins_are_labelled_by_their_start(self):
        readings = {datetime(2026, 10, 1, 14, 59): (680, 57),
                    datetime(2026, 10, 1, 15, 0): (600, 40), datetime(2026, 10, 1, 15, 14): (500, 50)}
        total, large = average_15(readings)
        self.assertEqual(total[datetime(2026, 10, 1, 14, 45)], 680)
        self.assertEqual(total[datetime(2026, 10, 1, 15, 0)], 550)
        self.assertEqual(large[datetime(2026, 10, 1, 15, 0)], 45)


class MatchesPublishedCohort69(unittest.TestCase):
    """Rebuild cohort 69 from its raw files and compare with the published values."""

    def test_rebuild_matches(self):
        settings = load_settings()
        raw = settings.published_data.parent / "cohort 69 raw outdoor data"
        published = settings.published_data / "small_69.csv"
        if not raw.exists() or not published.exists():
            self.skipTest("cohort 69 raw folder or published file not available")
        with tempfile.TemporaryDirectory() as tmp:
            registry_copy = Path(tmp) / "sites.csv"
            shutil.copy(settings.registry, registry_copy)
            neighborhoods = load_neighborhoods()
            built, _ = build_from_raw(RawCohort(69, raw, None, None), Registry(registry_copy), neighborhoods, set())
        reference = import_cohort(69, published, settings.published_data / "large_69.csv", neighborhoods)
        by_column = {m.column: m for m in reference.monitors}
        compared = same = 0
        for monitor in built.monitors:
            self.assertIn(monitor.column, by_column)
            for stamp, value in monitor.total.items():
                if stamp in by_column[monitor.column].total:
                    compared += 1
                    same += math.isclose(value, by_column[monitor.column].total[stamp], rel_tol=1e-9)
        self.assertGreater(compared, 10000)
        self.assertGreaterEqual(same / compared, 0.999)


if __name__ == "__main__":
    unittest.main()
