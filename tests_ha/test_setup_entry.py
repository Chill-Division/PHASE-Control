"""The config entry itself: does it load, and do the wizard's answers reach the entities?

Both failures here were invisible to every existing test. This tier used to replace the whole
panel registration with a no-op, so an entry that failed to set up there still passed; the
registration now runs against the real frontend.
"""

from pathlib import Path

from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Context
from homeassistant.data_entry_flow import FlowResultType

from custom_components.crop_steering.plumbing import infer
from test_real_flow import ZONES, _seed, _to_zones_step

PANEL = "crop-steering"


async def _install(hass, hardware=None):
    _seed(hass)
    answers = dict(hardware or {})
    # The wizard asks how the room is plumbed, with the zone count. Unless a test says otherwise,
    # answer truthfully for the switches it then chooses, as a person with a pump would.
    plumbing = answers.pop("plumbing", None) or infer(answers)
    flow_id = await _to_zones_step(hass, plumbing)
    result = await hass.config_entries.flow.async_configure(flow_id, dict(ZONES))
    assert result["step_id"] == "hardware", result.get("errors")
    result = await hass.config_entries.flow.async_configure(flow_id, answers)
    assert result["type"] is FlowResultType.CREATE_ENTRY, result
    await hass.async_block_till_done()
    return result["result"]


async def _save_zones(hass, admin, entry_id=None, **zones):
    """Change zones as Rooms & hardware does (`setup_read`, then `setup_save` with the changes):
    `_save_zones(hass, admin, zone_1={"name": "GT1", "plant_count": 6})`. A zone's name, plant
    count and sizing are set there, not in the setup wizard."""

    async def call(name, data=None):
        return await hass.services.async_call(
            "crop_steering",
            name,
            data or {},
            blocking=True,
            return_response=True,
            context=Context(user_id=admin.id),
        )

    rooms = (await call("setup_read"))["rooms"]
    room = next(r for r in rooms if entry_id in (None, r["entry_id"]))
    rows = []
    for zone in room["zones"]:
        rows.append({**zone, **zones.get(f"zone_{zone['id']}", {})})
    await call(
        "setup_save",
        {
            "entry_id": room["entry_id"],
            "expected_revision": room["revision"],
            "room_name": room["room_name"],
            "active": room["active"],
            **({"plumbing": room["plumbing"]} if room.get("plumbing") else {}),
            "hardware": dict(room["hardware"]),
            "zones": rows,
        },
    )
    await hass.async_block_till_done()


# ------------------------------------------------------------------ the sidebar panel
async def test_the_entry_registers_its_sidebar_panel_through_the_frontend(hass, monkeypatch):
    asked = []
    real = frontend.async_panel_exists

    def exists(hass_, path):
        asked.append(path)
        return real(hass_, path)

    monkeypatch.setattr(frontend, "async_panel_exists", exists)
    entry = await _install(hass)
    assert entry.state is ConfigEntryState.LOADED
    assert asked and set(asked) == {PANEL}
    assert PANEL in hass.data[frontend.DATA_PANELS]
    assert hass.http.async_register_static_paths.await_count == 1
    # A custom panel: Home Assistant draws no title bar above it, and its element (shipped in www/)
    # holds the dashboard.
    panel = hass.data[frontend.DATA_PANELS][PANEL]
    assert panel.component_name == "custom"
    custom = panel.config["_panel_custom"]
    assert (custom["name"], custom["embed_iframe"]) == ("crop-steering-panel", False)
    assert custom["module_url"].startswith("/crop_steering/panel.js?v=")
    assert panel.config["url"].startswith("/crop_steering/dashboard.html?v=")
    www = Path(__file__).parents[1] / "custom_components" / "crop_steering" / "www"
    assert (www / "panel.js").is_file() and (www / "dashboard.html").is_file()


async def test_a_sidebar_path_somebody_else_owns_is_left_alone(hass):
    theirs = object()
    hass.data.setdefault(frontend.DATA_PANELS, {})[PANEL] = theirs
    entry = await _install(hass)
    assert entry.state is ConfigEntryState.LOADED
    assert hass.data[frontend.DATA_PANELS][PANEL] is theirs  # neither replaced...
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert hass.data[frontend.DATA_PANELS][PANEL] is theirs  # ...nor removed on unload


# ------------------------------------------------------------------ what the wizard was told
async def test_the_lights_hours_the_wizard_asked_for_are_the_ones_that_run(hass):
    """They were stored on the entry and never reached the entities, which seeded to 12 and 0:
    the grow-day, the P3->P0 reset and the overnight dry-back all ran on the wrong clock."""
    entry = await _install(hass, {"lights_on_hour": 6, "lights_off_hour": 22})
    assert entry.data["parameters"]["lights_on_hour"] == 6
    assert float(hass.states.get("number.crop_steering_lights_on_hour").state) == 6
    assert float(hass.states.get("number.crop_steering_lights_off_hour").state) == 22


async def test_the_sizing_the_wizard_accepted_is_a_value_the_entity_can_hold(hass):
    """Setup accepts 0.1-200 L and 1-20 drippers; the room-wide entities allowed 1.0-200 and
    1-6, so a 0.65 L rockwool cube could be set up and then never adjusted."""
    await _install(hass)
    for entity_id, value in (
        ("number.crop_steering_substrate_volume", 0.65),
        ("number.crop_steering_drippers_per_plant", 12),
    ):
        await hass.services.async_call(
            "number", "set_value", {"entity_id": entity_id, "value": value}, blocking=True
        )
        assert float(hass.states.get(entity_id).state) == value
