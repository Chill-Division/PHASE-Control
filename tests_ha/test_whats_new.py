"""What's new, in a real Home Assistant: the release highlights the dashboard shows once after an
update, and the one record of the last release it showed, kept for the whole installation.

A new installation starts at its own version and shows nothing. One that was already running before
this existed has missed an unknown number of releases, and so has one whose record is numbered above
the installed release (the numbers started again at 1.0.0 after 2.37.1). Marking only ever moves
forward, never past the installed version, and survives a restart.

The releases these say were shown before are numbered 0.x, under every real one, so they hold
whatever the installed release is.

The first-run tour starts by itself once, on a new installation; one that was already running has
used the dashboard and starts it from Help.
"""

import json
from pathlib import Path

import pytest
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import HomeAssistantError
from test_setup_entry import _install
from test_upgrade_in_place import _upgrade

DOMAIN = "crop_steering"
STORE = "crop_steering.whats_new"
TOUR = "crop_steering.tour"
MANIFEST = Path(__file__).resolve().parents[1] / "custom_components" / DOMAIN / "manifest.json"
VERSION = json.loads(MANIFEST.read_text(encoding="utf-8"))["version"]


async def _get(hass):
    return await hass.services.async_call(
        DOMAIN, "whats_new_get", {}, blocking=True, return_response=True
    )


async def _seen(hass, version):
    return await hass.services.async_call(
        DOMAIN, "whats_new_seen", {"version": version}, blocking=True, return_response=True
    )


async def _toured(hass):
    return await hass.services.async_call(
        DOMAIN, "whats_new_tour_seen", {}, blocking=True, return_response=True
    )


def _stored(seen):
    return {"version": 1, "minor_version": 1, "key": STORE, "data": {"seen": seen}}


async def test_a_new_installation_has_nothing_to_catch_up_on(hass, hass_storage):
    await _install(hass)
    shown = await _get(hass)
    assert (shown["version"], shown["seen"]) == (VERSION, VERSION)
    assert hass_storage[STORE]["data"] == {"seen": VERSION}
    # The highlights shipped with the integration, newest first: this release's on top.
    newest = shown["releases"][0]
    assert newest["version"] == VERSION and newest["date"] and newest["items"]


async def test_an_installation_that_was_already_running_has_missed_an_unknown_number(hass):
    await _upgrade(
        hass,
        "entry_2_17_wizard.json",
        registry_ids={"sensor.crop_steering_engine_config": "engine_config"},
    )
    assert (await _get(hass))["seen"] is None  # the dashboard shows the last 30 days


async def test_marking_moves_forward_only_and_survives_a_restart(hass, hass_storage):
    hass_storage[STORE] = _stored("0.22.0")  # the window last showed 0.22.0 here
    entry = await _install(hass)
    assert (await _get(hass))["seen"] == "0.22.0"

    assert await _seen(hass, "0.23.0") == {"seen": "0.23.0"}
    assert await _seen(hass, "0.22.0") == {"seen": "0.23.0"}  # never back
    assert await _seen(hass, "99.0.0") == {"seen": "0.23.0"}  # never past what is installed
    with pytest.raises(HomeAssistantError):
        await _seen(hass, "latest")

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert (await _get(hass))["seen"] == "0.23.0"
    assert hass_storage[STORE]["data"] == {"seen": "0.23.0"}


async def test_a_record_numbered_above_the_installed_release_is_unknown(hass, hass_storage):
    """The numbers started again at 1.0.0 after 2.37.1: a dashboard that last showed 2.37.1 shows
    what came since (the last 30 days), then carries on from the installed release."""
    hass_storage[STORE] = _stored("99.0.0")
    await _install(hass)
    assert (await _get(hass))["seen"] is None
    assert await _seen(hass, VERSION) == {"seen": VERSION}
    await hass.async_block_till_done()
    assert hass_storage[STORE]["data"] == {"seen": VERSION}


async def test_a_room_added_later_does_not_reset_what_the_installation_has_seen(
    hass, hass_storage
):
    hass_storage[STORE] = _stored("0.22.0")
    await _upgrade(
        hass,
        "entry_2_17_wizard.json",
        registry_ids={"sensor.crop_steering_engine_config": "engine_config"},
    )
    # A second room, set up just now, as test_upgrade_in_place adds one.
    hass.states.async_set("switch.veg_tent", "off")
    hass.states.async_set("sensor.veg_vwc", "50", {"unit_of_measurement": "%"})
    flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    flow = await hass.config_entries.flow.async_configure(
        flow["flow_id"], {"room_name": "Veg tent"}
    )
    flow = await hass.config_entries.flow.async_configure(flow["flow_id"], {"num_zones": 1})
    flow = await hass.config_entries.flow.async_configure(
        flow["flow_id"],
        {
            "zone_1_switch": "switch.veg_tent",
            "zone_1_vwc": ["sensor.veg_vwc"],
        },
    )
    done = await hass.config_entries.flow.async_configure(
        flow["flow_id"], {"plumbing": "valves_only"}
    )
    assert done["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert (await _get(hass))["seen"] == "0.22.0"


async def test_a_new_installation_starts_the_tour_once(hass, hass_storage):
    entry = await _install(hass)
    assert (await _get(hass))["tour"] is True
    assert hass_storage[TOUR]["data"] == {"toured": False}
    assert await _toured(hass) == {"tour": False}
    assert (await _get(hass))["tour"] is False
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert (await _get(hass))["tour"] is False  # not again after a restart
    assert hass_storage[TOUR]["data"] == {"toured": True}
    assert hass_storage[STORE]["data"] == {"seen": VERSION}  # the window's record is its own


async def test_an_installation_that_was_already_running_does_not_start_the_tour(hass, hass_storage):
    hass_storage[STORE] = _stored("0.36.0")  # updated in place from 0.36.0
    await _upgrade(
        hass,
        "entry_2_17_wizard.json",
        registry_ids={"sensor.crop_steering_engine_config": "engine_config"},
    )
    shown = await _get(hass)
    assert (shown["tour"], shown["seen"]) == (False, "0.36.0")
    assert hass_storage[TOUR]["data"] == {"toured": True}
