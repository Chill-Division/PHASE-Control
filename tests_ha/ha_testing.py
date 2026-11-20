"""Home Assistant's own test helpers, from the plugin that brings the Home Assistant under test.

From 2026.11 Home Assistant publishes them itself, as pytest-homeassistant. The plugin the older
legs of CI install, pytest-homeassistant-custom-component, stopped at 2026.10: none of its releases
loads on 2026.11 (docs/TESTING.md). The tests import the helpers from here, so one suite runs on
every leg.
"""

from __future__ import annotations

from importlib.util import find_spec

if find_spec("pytest_homeassistant"):
    from pytest_homeassistant.common import (
        MockConfigEntry,
        MockUser,
        async_fire_time_changed,
        mock_restore_cache,
        setup_test_component_platform,
    )
    from pytest_homeassistant.components.recorder.common import (
        async_wait_recording_done,
    )
else:  # Home Assistant before 2026.11
    from pytest_homeassistant_custom_component.common import (
        MockConfigEntry,
        MockUser,
        async_fire_time_changed,
        mock_restore_cache,
        setup_test_component_platform,
    )
    from pytest_homeassistant_custom_component.components.recorder.common import (
        async_wait_recording_done,
    )

__all__ = [
    "MockConfigEntry",
    "MockUser",
    "async_fire_time_changed",
    "async_wait_recording_done",
    "mock_restore_cache",
    "setup_test_component_platform",
]
