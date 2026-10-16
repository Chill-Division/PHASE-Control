"""Unit tests for PHASE Control calculations."""

import pytest
from custom_components.crop_steering.calculations import (
    ShotCalculator,
    combine_probes,
    combined_readings,
)
from custom_components.crop_steering.const import (
    SECONDS_PER_HOUR,
    PERCENTAGE_TO_RATIO,
)


class TestShotCalculator:
    """Test shot duration calculations."""

    def test_basic_shot_calculation(self):
        """Test basic shot duration calculation."""
        # 10L pot, 2 L/hr flow, 5% shot size
        # Expected: (10 * 0.05) / 2 * 3600 = 900 seconds
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=2.0, substrate_vol=10.0, shot_size=5.0
        )
        assert result == 900.0

    def test_p1_initial_shot(self):
        """Test P1 initial shot calculation (2%)."""
        # 10L pot, 2 L/hr flow, 2% shot size
        # Expected: (10 * 0.02) / 2 * 3600 = 360 seconds
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=2.0, substrate_vol=10.0, shot_size=2.0
        )
        assert result == 360.0

    def test_p2_maintenance_shot(self):
        """Test P2 maintenance shot calculation (5%)."""
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=2.0, substrate_vol=10.0, shot_size=5.0
        )
        assert result == 900.0

    def test_p3_emergency_shot(self):
        """Test P3 emergency shot calculation (3%)."""
        # 10L pot, 2 L/hr flow, 3% shot size
        # Expected: (10 * 0.03) / 2 * 3600 = 540 seconds
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=2.0, substrate_vol=10.0, shot_size=3.0
        )
        assert result == 540.0

    def test_different_flow_rate(self):
        """Test calculation with different flow rate."""
        # 15L pot, 3 L/hr flow, 5% shot size
        # Expected: (15 * 0.05) / 3 * 3600 = 900 seconds
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=3.0, substrate_vol=15.0, shot_size=5.0
        )
        assert result == 900.0

    def test_large_pot_volume(self):
        """Test calculation with large pot."""
        # 50L pot, 5 L/hr flow, 5% shot size
        # Expected: (50 * 0.05) / 5 * 3600 = 1800 seconds
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=5.0, substrate_vol=50.0, shot_size=5.0
        )
        assert result == 1800.0

    def test_zero_flow_rate(self):
        """Test calculation with zero flow rate returns 0."""
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=0.0, substrate_vol=10.0, shot_size=5.0
        )
        assert result == 0.0

    def test_negative_flow_rate(self):
        """Test calculation with negative flow rate."""
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=-2.0, substrate_vol=10.0, shot_size=5.0
        )
        # Should handle gracefully
        assert result == 0.0

    def test_small_shot_size(self):
        """Test calculation with very small shot size (0.5%)."""
        # 10L pot, 2 L/hr flow, 0.5% shot size
        # Expected: (10 * 0.005) / 2 * 3600 = 90 seconds
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=2.0, substrate_vol=10.0, shot_size=0.5
        )
        assert result == 90.0

    def test_large_shot_size(self):
        """Test calculation with large shot size (15%)."""
        # 10L pot, 2 L/hr flow, 15% shot size
        # Expected: (10 * 0.15) / 2 * 3600 = 2700 seconds
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=2.0, substrate_vol=10.0, shot_size=15.0
        )
        assert result == 2700.0

    def test_rounding(self):
        """Test that results are rounded to 1 decimal place."""
        # Should produce a value that tests rounding
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=2.3, substrate_vol=10.0, shot_size=5.0
        )
        # Expected: (10 * 0.05) / 2.3 * 3600 = 782.6086...
        assert result == 782.6

    def test_error_handling(self):
        """Test error handling with invalid inputs."""
        # Should not raise exception
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=None, substrate_vol=10.0, shot_size=5.0
        )
        assert result == 0.0


class TestAveragingCalculations:
    """Test sensor averaging."""

    def test_two_sensor_average(self):
        """Test averaging two sensor values."""
        values = [65.5, 68.5]
        average = round(sum(values) / len(values), 2)
        assert average == 67.0

    def test_four_sensor_average(self):
        """Test averaging four sensors (2 zones, front/back each)."""
        values = [64.0, 66.0, 65.0, 67.0]
        average = round(sum(values) / len(values), 2)
        assert average == 65.5

    def test_uneven_average(self):
        """Test averaging with uneven numbers."""
        values = [60.3, 65.7, 62.1]
        average = round(sum(values) / len(values), 2)
        assert average == 62.7

    def test_empty_list(self):
        """Test averaging with no values."""
        values = []
        if values:
            average = round(sum(values) / len(values), 2)
        else:
            average = None
        assert average is None


class TestConstants:
    """Test that constants have expected values."""

    def test_seconds_per_hour(self):
        """Test SECONDS_PER_HOUR constant."""
        assert SECONDS_PER_HOUR == 3600

    def test_percentage_to_ratio(self):
        """Test PERCENTAGE_TO_RATIO constant."""
        assert PERCENTAGE_TO_RATIO == 0.01


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_very_small_values(self):
        """Test calculation with very small values."""
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=0.1, substrate_vol=1.0, shot_size=1.0
        )
        # Expected: (1 * 0.01) / 0.1 * 3600 = 360 seconds
        assert result == 360.0

    def test_very_large_values(self):
        """Test calculation with very large values."""
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=50.0, substrate_vol=200.0, shot_size=20.0
        )
        # Expected: (200 * 0.20) / 50 * 3600 = 2880 seconds
        assert result == 2880.0

    def test_precision_rounding(self):
        """Test that rounding works correctly."""
        result = ShotCalculator.calculate_shot_duration(
            dripper_flow=2.7, substrate_vol=11.3, shot_size=4.8
        )
        # Expected: (11.3 * 0.048) / 2.7 * 3600 = 723.2
        assert isinstance(result, float)
        assert result == 723.2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


def test_probes_combine_by_average_median_lowest_or_highest():
    assert combine_probes([83.5, 87.7]) == 85.6  # the default, as before
    assert combine_probes([83.5, 87.7], "Lowest") == 83.5
    assert combine_probes([83.5, 87.7], "Highest") == 87.7
    # Median differs from the average only with three probes or more: one odd probe is ignored.
    assert combine_probes([60, 61, 90], "Median") == 61
    assert combine_probes([60, 61, 90], "Average") == 70.33
    assert combine_probes([60, 61, 90], "Something else") == 70.33
    assert combine_probes([], "Lowest") is None
    assert combined_readings([83.5, 87.7]) == {
        "Average": 85.6,
        "Median": 85.6,
        "Lowest": 83.5,
        "Highest": 87.7,
    }
