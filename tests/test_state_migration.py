"""In-place upgrade contract for the f2-control add-on (now multi-room aware).

The add-on persists per-zone runtime state to /data/state.json (non-ephemeral). It is
live-installed on many boxes, old and new, so a version bump MUST load an OLDER state
file transparently in place: a missing file, missing keys, unknown extra keys, a bad
timestamp, and zones not present in the file must all be tolerated — new fields fall
back to fresh defaults, never an error, never a wipe.

Stage 2 nests state by room slug ({"default": {"1": {...}}, "veg": {"1": {...}}}). An
OLD single-room file is FLAT ({"1": {...}, "2": {...}}) and MUST still load transparently
as the 'default' room. These tests lock both contracts so an upgrade can't wipe a live box.
"""

import json
import sys
import types
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADDON = ROOT / "addons" / "f2_control" / "f2_control"  # controller.py + vendored engine

# controller.py imports `requests` (only present inside the add-on container). Stub it so
# the module imports offline; we only exercise the pure state load/save logic here.
if "requests" not in sys.modules:
    _req = types.ModuleType("requests")
    _req.Session = lambda: types.SimpleNamespace(get=None, post=None, headers={})
    sys.modules["requests"] = _req

if str(ADDON) not in sys.path:
    sys.path.insert(0, str(ADDON))

import controller as C  # noqa: E402  (after sys.path / stub setup)


def _room(zones, slug="default", prefix=""):
    """A minimal Room for the given zone numbers."""
    z = {
        int(k): {"vwc": f"sensor.x_{prefix}vwc_{k}", "ec": f"sensor.x_{prefix}ec_{k}"}
        for k in zones
    }
    hw = {
        "pump": "switch.p",
        "mainline": "switch.m",
        "valves": {int(k): f"switch.v{k}" for k in zones},
    }
    return C.Room(slug, prefix, z, hw, "input_boolean.f2_control_enabled", 10.0, 22.0)


def _make(zones, state_path, rooms=None):
    """A Controller with just the attributes _load_state/_save_state need — no __init__,
    so no HA connection, signals, or option parsing."""
    c = C.Controller.__new__(C.Controller)
    c._state_path = str(state_path)
    c.rooms = rooms if rooms is not None else [_room(zones)]
    return c


def test_dripper_settings_drive_flow_without_plant_count(tmp_path):
    """The dripper flow rate + drippers/plant must drive shot length even if plant_count is
    unset (0) — not silently fall back to the flow_lps option. Regression for "it ignored my
    dripper flowrate and drippers per plant"."""
    c = _make([1], tmp_path / "s.json")
    c.flow_lps = 0.02  # the fallback that must NOT win
    room = c.rooms[0]
    c._zone_num = lambda room, zone, key, default: {
        "plant_count": 0,
        "drippers_per_plant": 2,
    }.get(key, default)
    c._num = lambda ent, default: 1.2 if "dripper_flow_rate" in ent else default
    flow = c._zone_flow_lps(room, 1)
    assert (
        abs(flow - (1 * 2 * 1.2 / 3600.0)) < 1e-9
    )  # plant_count defaults to 1 (it cancels)
    assert flow != 0.02  # did NOT fall back to the option


def test_missing_file_yields_fresh_state(tmp_path):
    c = _make([1, 2, 3], tmp_path / "does_not_exist.json")
    c._load_state()
    st = c.rooms[0].state
    assert set(st) == {1, 2, 3}
    assert all(st[z]["phase"] == "P2" for z in st)  # fresh-zone default


def test_corrupt_json_yields_fresh_state(tmp_path):
    p = tmp_path / "state.json"
    p.write_text("{ this is not valid json", encoding="utf-8")
    c = _make([1], p)
    c._load_state()  # must not raise
    assert c.rooms[0].state[1]["phase"] == "P2"


def test_old_flat_partial_state_loads_as_default(tmp_path):
    """An OLD flat file (top-level zone keys) loads as the default room, keeping known keys,
    dropping unknown ones, and seeding absent zones fresh."""
    p = tmp_path / "state.json"
    p.write_text(
        json.dumps({"1": {"phase": "P1", "peak": 55.0, "legacy_removed_field": 7}}),
        encoding="utf-8",
    )
    c = _make([1, 2], p)
    c._load_state()
    st = c.rooms[0].state
    assert st[1]["phase"] == "P1"  # known key restored
    assert st[1]["peak"] == 55.0
    assert "legacy_removed_field" not in st[1]  # unknown key ignored
    assert "shots" in st[1]  # a key absent from the file -> fresh default present
    assert st[2]["phase"] == "P2"  # a zone absent from the file -> seeded fresh


def test_a_state_file_from_the_ec_pid_era_loads_without_it(tmp_path):
    """The EC PID loop is gone, and with it the integral and previous error it kept per zone. A
    file an older controller wrote still loads: the zone's EC offset is kept, the two are dropped,
    and they are not written back."""
    zone = {"phase": "P2", "ec_offset": -1.0, "ec_integral": 4.2, "ec_prev_err": 0.3}
    p = tmp_path / "state.json"
    p.write_text(json.dumps({"1": zone}), encoding="utf-8")
    c = _make([1], p)
    c._load_state()
    st = c.rooms[0].state[1]
    assert (st["phase"], st["ec_offset"]) == ("P2", -1.0)
    assert "ec_integral" not in st and "ec_prev_err" not in st
    c._save_state()
    written = p.read_text(encoding="utf-8")
    assert "ec_integral" not in written and "ec_prev_err" not in written


def test_bad_timestamp_is_tolerated(tmp_path):
    p = tmp_path / "state.json"
    p.write_text(
        json.dumps({"1": {"phase": "P3", "last_shot": "not-a-date"}}), encoding="utf-8"
    )
    c = _make([1], p)
    c._load_state()  # must not raise
    st = c.rooms[0].state
    assert st[1]["phase"] == "P3"
    assert st[1]["last_shot"] is None  # unparseable value rejected, default kept


def test_save_then_load_roundtrip(tmp_path):
    p = tmp_path / "state.json"
    c = _make([1], p)
    c._load_state()  # seed fresh (no file yet)
    c.rooms[0].state[1].update(
        {
            "phase": "P1",
            "peak": 61.0,
            "shots": 3,
            "last_shot": datetime(2026, 6, 27, 10, 5),
            "last_daily_reset": date(2026, 6, 27),
        }
    )
    c._save_state()
    c2 = _make([1], p)
    c2._load_state()
    st = c2.rooms[0].state
    assert st[1]["phase"] == "P1"
    assert st[1]["peak"] == 61.0
    assert st[1]["shots"] == 3
    assert st[1]["last_shot"] == datetime(2026, 6, 27, 10, 5)
    assert st[1]["last_daily_reset"] == date(2026, 6, 27)


# ----------------------------------------------------------------------- multi-room (Stage 2)


def test_two_rooms_keep_independent_state(tmp_path):
    """Default and a named room have overlapping zone numbers; their state must not clobber."""
    p = tmp_path / "state.json"
    rooms = [_room([1, 2], "default", ""), _room([1], "veg", "veg_")]
    c = _make(None, p, rooms=rooms)
    c._load_state()  # seed fresh
    c.rooms[0].state[1]["phase"] = "P1"
    c.rooms[1].state[1]["phase"] = "P3"
    c._save_state()
    # the file is nested by slug, with both rooms present
    saved = json.loads(p.read_text(encoding="utf-8"))
    assert set(saved) == {"default", "veg"}
    assert saved["default"]["1"]["phase"] == "P1"
    assert saved["veg"]["1"]["phase"] == "P3"
    # reload into fresh rooms -> each keeps its own
    c2 = _make(None, p, rooms=[_room([1, 2], "default", ""), _room([1], "veg", "veg_")])
    c2._load_state()
    assert c2.rooms[0].state[1]["phase"] == "P1"
    assert c2.rooms[1].state[1]["phase"] == "P3"
    assert c2.rooms[0].state[2]["phase"] == "P2"  # untouched default zone stays fresh


def test_old_flat_file_loads_default_only_named_rooms_seed_fresh(tmp_path):
    """Upgrading a live single-room box that now has a second room: the old flat file becomes
    the default room's state; the new room seeds fresh (never errors)."""
    p = tmp_path / "state.json"
    p.write_text(json.dumps({"1": {"phase": "P1", "peak": 60.0}}), encoding="utf-8")
    c = _make(None, p, rooms=[_room([1], "default", ""), _room([1], "veg", "veg_")])
    c._load_state()
    assert c.rooms[0].state[1]["phase"] == "P1"  # old flat -> default room
    assert c.rooms[0].state[1]["peak"] == 60.0
    assert c.rooms[1].state[1]["phase"] == "P2"  # named room seeded fresh


def test_nested_file_loads_per_room(tmp_path):
    p = tmp_path / "state.json"
    p.write_text(
        json.dumps({"default": {"1": {"phase": "P3"}}, "veg": {"1": {"phase": "P1"}}}),
        encoding="utf-8",
    )
    c = _make(None, p, rooms=[_room([1], "default", ""), _room([1], "veg", "veg_")])
    c._load_state()
    assert c.rooms[0].state[1]["phase"] == "P3"
    assert c.rooms[1].state[1]["phase"] == "P1"


# --------------------------------------------------------------------------- options compat
# An old /data/options.json may carry the old facility-specific substrate_l / flow_lps numbers,
# and, up to 2.25.0, the feed_ec_sensor / feed_ph_sensor of the source-water gate that is gone.
# Loading it must still work and must NOT resurrect any F2-specific default entity id.


def _init(opts, monkeypatch):
    """Full Controller() with load_options() stubbed to `opts` and no HA reachable (the
    module-level requests stub makes every ha_get/ha_call a caught no-op). Returns the
    default room and the controller."""
    monkeypatch.setattr(C, "load_options", lambda: dict(opts))
    c = C.Controller()
    return c, c.rooms[0]


def test_old_options_with_the_feed_sensors_still_load(monkeypatch):
    """Up to 2.25.0 the source-water gate had two options. Supervisor drops an option its schema no
    longer has; the controller must not need them, and never reads a feed probe again.
    """
    opts = {
        "num_zones": 2,
        "feed_ec_sensor": "sensor.tank_probe_1_ec",
        "feed_ph_sensor": "sensor.my_ph",
    }
    c, room = _init(opts, monkeypatch)
    assert room.slug == "default" and not hasattr(room, "feed_ec_sensor")


def test_substrate_flow_defaults_are_generic_not_f2(monkeypatch):
    # empty options -> code fallbacks; must be generic placeholders, not F2's real numbers
    c, room = _init({}, monkeypatch)
    assert c.substrate_l == 5.0
    assert c.flow_lps == 0.02  # NOT F2's real 0.04


def test_old_options_with_the_cloudflare_judge_still_load(monkeypatch):
    """2.24.0 had three options for the Cloudflare judge. Supervisor drops an option its schema no
    longer has; the controller must not need them either."""
    opts = {
        "num_zones": 1,
        "cf_account_id": "acc",
        "cf_api_token": "tok",
        "cf_gateway_id": "gw",
    }
    c, room = _init(opts, monkeypatch)
    assert room.slug == "default" and len(c.rooms) == 1


def test_default_room_is_unprefixed(monkeypatch):
    """The default room must stay un-prefixed so a single-room install's entity ids are unchanged."""
    c, room = _init({"num_zones": 1}, monkeypatch)
    assert room.slug == "default" and room.prefix == ""
    assert c._cs(room, "sensor", "vwc_zone_1") == "sensor.crop_steering_vwc_zone_1"
    assert len(c.rooms) == 1  # no extra rooms discovered offline


# ---------------------------------------------------------------------------
# `last_shot_is_anchor` (added after 0.16.1): an OLD file has no such key and must still load.
# ---------------------------------------------------------------------------
def test_an_old_file_without_the_anchor_flag_loads_and_gets_a_sane_value(tmp_path):
    """Old timestamps keep their existing meaning: zero counters or missing/expired history
    cannot prove whether an unmarked timestamp was a switch-on or an actual irrigation.
    """
    p = tmp_path / "state.json"
    p.write_text(
        json.dumps(
            {
                "default": {
                    # ambiguous old timestamp: could be switch-on or an older irrigation
                    "1": {"phase": "P3", "shots": 0, "daily_vol": 0.0,
                          "last_shot": "2026-09-21T18:19:37.355321",
                          "water_history": [{"grow_day": "2026-09-21", "litres": 0.0}]},
                    # a zone with a real irrigation history
                    "2": {"phase": "P2", "shots": 0, "daily_vol": 0.0,
                          "last_shot": "2026-09-20T21:40:00",
                          "water_history": [{"grow_day": "2026-09-20", "litres": 3.5}]},
                    # nothing at all
                    "3": {"phase": "P2"},
                }
            }
        ),
        encoding="utf-8",
    )  # fmt: skip
    c = _make([1, 2, 3], p)
    c._load_state()
    st = c.rooms[0].state
    assert st[1]["last_shot_is_anchor"] is False and st[1]["last_shot"] is not None
    assert st[2]["last_shot_is_anchor"] is False and st[2]["last_shot"] is not None
    assert st[3]["last_shot_is_anchor"] is False and st[3]["last_shot"] is None


def test_the_anchor_flag_round_trips_and_junk_is_tolerated(tmp_path):
    p = tmp_path / "state.json"
    c = _make([1, 2], p)
    c._load_state()
    c.rooms[0].state[1].update(
        last_shot=datetime(2026, 9, 21, 18, 19, 37), last_shot_is_anchor=True
    )
    c._save_state()
    saved = json.loads(p.read_text(encoding="utf-8"))["default"]
    assert (
        saved["1"]["last_shot_is_anchor"] is True
        and saved["2"]["last_shot_is_anchor"] is False
    )
    again = _make([1, 2], p)
    again._load_state()
    assert again.rooms[0].state[1]["last_shot_is_anchor"] is True
    saved["1"]["last_shot_is_anchor"] = "yes please"  # hand-edited nonsense
    p.write_text(json.dumps({"default": saved}), encoding="utf-8")
    third = _make([1, 2], p)
    third._load_state()
    assert (
        third.rooms[0].state[1]["last_shot_is_anchor"] is False
    )  # invalid metadata cannot establish that an old timestamp was an anchor


def test_a_file_from_before_each_zones_own_peak_loads_without_it(tmp_path):
    """A one-valve room's zones keep their own peaks (_group_peak). An older file has
    none: each zone loads with None, which the first pass fills with the room's peak.
    Junk loads as None too."""
    p = tmp_path / "state.json"
    zones = {str(z): {"phase": "P3", "peak": 88.0} for z in (1, 2)}
    p.write_text(json.dumps({"default": zones}), encoding="utf-8")
    c = _make([1, 2], p)
    c._load_state()
    st = c.rooms[0].state
    assert [st[z]["own_peak"] for z in (1, 2)] == [None, None] and st[1]["peak"] == 88.0
    st[1]["own_peak"], st[2]["own_peak"] = 100.0, 87.0
    c._save_state()
    again = _make([1, 2], p)
    again._load_state()
    assert [again.rooms[0].state[z]["own_peak"] for z in (1, 2)] == [100.0, 87.0]
    saved = json.loads(p.read_text(encoding="utf-8"))["default"]
    saved["1"]["own_peak"], saved["2"]["own_peak"] = "lots", float("nan")
    p.write_text(json.dumps({"default": saved}), encoding="utf-8")
    third = _make([1, 2], p)
    third._load_state()
    assert [third.rooms[0].state[z]["own_peak"] for z in (1, 2)] == [None, None]


# ---------------------------------------------------------------------------
# The Cloudflare judge (removed after 2.24.0) kept its own keys in each zone's learned state.
# ---------------------------------------------------------------------------
def test_an_old_file_with_the_judges_keys_keeps_what_the_zone_learned(tmp_path):
    learned = {
        "peak": 33.8,
        "gain": 0.6,
        "day_rate": 0.7,
        "night_rate": 0.35,
        "day_n": 3,
        "night_n": 3,
        "day_acc": [4.2, 60],
        "night_acc": [2.1, 60],
        "hold_days": 2,
        "day": "2026-09-26T06:00:00",
        "ramp_start": 30.0,
        "ramp": [],
        "pending": None,
        "outcome": "plateau",
        "stalled_at": None,
        "last_change": "11:04 p1_target_vwc 34 -> 33.7",
        "prev_peak": 33.1,
        "prev_hold": 0,
    }
    judge = {
        "peak_adj": 1.5,
        "veto": None,
        "jev": {
            "day": "2026-09-26T06:00:00",
            "nudged": ["ec", "peak"],
            "asked": "2026-09-26T14",
            "last": "14:00 no change",
            "changed": "12:00 p2_shot_size 3 -> 4",
        },
    }
    p = tmp_path / "state.json"
    p.write_text(
        json.dumps({"default": {"1": {"phase": "P2", "learn": {**learned, **judge}}}}),
        encoding="utf-8",
    )  # fmt: skip
    c = _make([1], p)
    c._load_state()
    learn = c.rooms[0].state[1]["learn"]
    assert learn == learned  # every learned value kept, the judge's keys gone
    assert (
        C.auto_setpoints.working_peak(learn) == 33.8
    )  # the peak the zone learned, nothing added


def test_a_file_from_before_nutrient_batches_or_a_damaged_batch_loads_as_no_batch(
    tmp_path,
):
    """A room's `_batch` block (2.26.0) is absent from every older file. Missing or damaged, the room
    loads with no batch and nothing to switch off; a batch saved in progress is recognised.
    """
    p = tmp_path / "state.json"
    p.write_text(json.dumps({"default": {"1": {"phase": "P2", "peak": 60.0}}}))
    c = _make([1], p)
    c._load_state()
    room = c.rooms[0]
    assert room.batch == C.fresh_batch() and not getattr(room, "_batch_crashed", False)
    assert room.state[1]["phase"] == "P2"

    p.write_text(json.dumps({"default": {"1": {"phase": "P2"}, "_batch": "garbage"}}))
    c = _make([1], p)
    c._load_state()
    assert c.rooms[0].batch == C.fresh_batch()

    c.rooms[0].batch.update(step="dosing", index=1, switches={"fresh": "switch.fresh"})
    c._save_state()
    again = _make([1], p)
    again._load_state()
    assert again.rooms[0].batch["step"] == "dosing" and again.rooms[0]._batch_crashed


def test_a_batch_record_from_before_the_refill_reminder_loads_with_none_up(tmp_path):
    """2.36's `_batch` block has no `reminded_at`: it loads as it was saved, with no refill reminder
    (CS-706) up, so the first time the reservoir runs low after the update it reminds at once.
    """
    saved = {
        "step": "idle",
        "armed": False,
        "low_seen": 2,
        "litres_per_pct": 2.07,
        "last": {"at": "2026-10-01T10:00:00", "result": "done", "stage": "Flower"},
    }
    p = tmp_path / "state.json"
    p.write_text(json.dumps({"default": {"1": {"phase": "P2"}, "_batch": saved}}))
    c = _make([1], p)
    c._load_state()
    batch = c.rooms[0].batch
    assert (batch["armed"], batch["low_seen"], batch["litres_per_pct"]) == (
        False,
        2,
        2.07,
    )
    assert batch["last"]["stage"] == "Flower" and batch["reminded_at"] is None
