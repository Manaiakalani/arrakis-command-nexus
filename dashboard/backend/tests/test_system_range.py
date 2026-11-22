import unittest
from datetime import timedelta

from routers.system import _parse_range_to_duration, _RANGE_TO_DURATION


class ParseRangeToDurationTests(unittest.TestCase):
    def test_named_ranges_are_unchanged(self):
        for label, expected in _RANGE_TO_DURATION.items():
            with self.subTest(label=label):
                self.assertEqual(_parse_range_to_duration(label), expected)
                self.assertEqual(_parse_range_to_duration(label.upper()), expected)

    def test_custom_quantities_still_parse(self):
        self.assertEqual(_parse_range_to_duration("45m"), timedelta(minutes=45))
        self.assertEqual(_parse_range_to_duration("48h"), timedelta(hours=48))
        self.assertEqual(_parse_range_to_duration("90d"), timedelta(days=90))
        self.assertEqual(_parse_range_to_duration(" 2H "), timedelta(hours=2))

    def test_zero_quantity_is_at_least_one(self):
        self.assertEqual(_parse_range_to_duration("0h"), timedelta(hours=1))

    def test_unknown_value_falls_back_to_24h(self):
        self.assertEqual(_parse_range_to_duration("bogus"), timedelta(hours=24))
        self.assertEqual(_parse_range_to_duration(""), timedelta(hours=24))

    def test_long_digit_string_is_rejected(self):
        many_nines = "9" * 20 + "h"
        self.assertEqual(_parse_range_to_duration(many_nines), timedelta(hours=24))

    def test_unbounded_nines_without_unit_are_rejected(self):
        many_nines = "9" * 10000
        self.assertEqual(_parse_range_to_duration(many_nines), timedelta(hours=24))


if __name__ == "__main__":
    unittest.main()
