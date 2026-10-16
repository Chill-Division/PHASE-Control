"""What a saved room setup change is recorded as: the words setup_api.setup_changes gives the
logbook and the log, from the room the setup page showed and the room saved."""

import json
from copy import deepcopy
from pathlib import Path

from custom_components.crop_steering.setup_api import setup_changes


def room():
    """A room as setup_room gives it: what Rooms & hardware shows and sends back."""
    return {
        "room_name": "Crop Steering System",
        "active": True,
        "plumbing": "pump_valves",
        "hardware": {
            "pump_switch": "switch.gr2_irrigation_relay",
            "fresh_water_switch": "",
        },
        "zones": [
            {
                "id": 1,
                "name": "GR2",
                "active": True,
                "valve": "switch.gr2_solenoid",
                "vwc_sensors": ["sensor.door_vwc", "sensor.ac_vwc"],
                "ec_sensors": ["sensor.door_ec", "sensor.ac_ec"],
                "plant_count": 40,
                "substrate_volume": 3.2,
                "drippers_per_plant": 1,
                "dripper_flow_rate": 4,
            }
        ],
    }


def test_a_rename_is_said_as_a_rename_and_nothing_else():
    new = room()
    new["room_name"] = "Growroom 2"
    assert setup_changes(room(), new) == ["renamed from “Crop Steering System”"]


def test_a_save_that_changes_nothing_says_nothing():
    same = room()
    # The page may send a whole number back as a float.
    same["zones"][0]["plant_count"] = 40.0
    assert setup_changes(room(), same) == []


def test_mappings_probes_and_sizing_say_what_they_were_and_are():
    new = room()
    new["hardware"] = {
        "pump_switch": "",
        "fresh_water_switch": "switch.gr2_fresh",
        "doser_2_switch": "switch.d2",
    }
    new["plumbing"] = "valves_only"
    zone = new["zones"][0]
    zone.update(
        valve="switch.gr2_valve_b",
        vwc_sensors=["sensor.door_vwc"],
        substrate_volume=3.3,
    )
    assert setup_changes(room(), new) == [
        "plumbing: zone valves only",
        "pump switch.gr2_irrigation_relay → none",
        "fresh-water solenoid none → switch.gr2_fresh",
        "doser 2 none → switch.d2",
        "zone 1 valve switch.gr2_solenoid → switch.gr2_valve_b",
        "zone 1 moisture probes sensor.door_vwc, sensor.ac_vwc → sensor.door_vwc",
        "zone 1 pot volume (L) 3.2 → 3.3",
    ]


def test_zones_added_renamed_archived_and_the_room_archived_and_restored():
    new = room()
    new["zones"][0].update(name="GR2 door end", active=False)
    new["zones"].append({**deepcopy(room()["zones"][0]), "id": 2, "name": "Zone 2"})
    assert setup_changes(room(), new) == [
        "zone 1 archived",
        "zone 1 renamed from “GR2” to “GR2 door end”",
        "zone 2 added",
    ]
    archived = {**room(), "active": False}
    assert setup_changes(room(), archived) == ["archived"]
    assert setup_changes(archived, room()) == ["restored"]


def built(base, patch):
    """A room from the shared cases: `base` with each top-level value replaced, and each zone's
    fields set by id (a new id is a copy of the first zone)."""
    made = deepcopy(base)
    for key, value in patch.items():
        if key != "zones":
            made[key] = value
            continue
        for zone_id, fields in value.items():
            zone = next((z for z in made["zones"] if z["id"] == int(zone_id)), None)
            if zone is None:
                zone = {**deepcopy(base["zones"][0]), "id": int(zone_id)}
                made["zones"].append(zone)
            zone.update(fields)
    return made


def test_the_review_before_a_save_says_what_the_logbook_will():
    """Rooms & hardware lists a save's changes before it is made (frontend/src/lib/setup-changes.ts),
    held to these same cases by setup-changes.test.ts."""
    cases = Path(__file__).parent / "fixtures" / "setup_changes.json"
    shared = json.loads(cases.read_text(encoding="utf-8"))
    for case in shared["cases"]:
        old = built(shared["room"], case.get("old", {}))
        new = built(shared["room"], case["change"])
        assert setup_changes(old, new) == case["said"], case["what"]
