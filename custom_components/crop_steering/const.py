"""Constants for the PHASE Control integration."""

DOMAIN = "crop_steering"

# The product's name wherever Home Assistant shows it: the sidebar, the room's device, the zones'
# entity names and the setup wizard's default name. PHASE: Precision Hydration And Steering Engine.
# Nothing is found by it: the domain, every entity id and the controller app's slug stay as they were.
PRODUCT_NAME = "PHASE Control"

# Where a Repairs card's "Learn more" link goes: every card carries a CS code, explained there.
REPAIRS_DOCS_URL = (
    "https://github.com/Chill-Division/PHASE-Control/blob/main/docs/ERROR_CODES.md"
)

# Configuration keys
CONF_NUM_ZONES = "num_zones"

# Zone configuration
MIN_ZONES = 1
MAX_ZONES = 24  # No practical limit — env parser auto-detects zones
DEFAULT_NUM_ZONES = 1

# Calculation constants
SECONDS_PER_HOUR = 3600
PERCENTAGE_TO_RATIO = 0.01
DEFAULT_EC_RATIO = 1.0
DEFAULT_EC_FALLBACK = 3.0
VWC_ADJUSTMENT_PERCENT = 5.0

# The four moisture levels, (lowest, highest) %: each setting accepts exactly this, and grow plans,
# Auto Setpoints and the engine (crop-steering-engine _PARAM_BOUNDS) use the same range, so the
# engine never clips a value its setting accepted (tests_ha/test_moisture_ranges.py). The tops are
# 100 because the order between the levels bounds the water: the ramp stops at field capacity, the
# P2 trigger stays at least 1 point under the peak and 3 over the rescue level. The floors are the
# engine's long-standing ones: they catch a slipped digit (6.5 for 65) and keep rooms steering low
# (a peak of 20 and a trigger of 15, on dry-rooted crops or coarse substrates) watering as set.
MOISTURE_RANGES = {
    "p1_target_vwc": (20.0, 100.0),
    "p2_vwc_threshold": (10.0, 100.0),
    "field_capacity": (40.0, 100.0),
    "p3_emergency_vwc_threshold": (10.0, 65.0),
}


# Software version - single source of truth
SOFTWARE_VERSION = "1.2.0"

# Crop steering phases (P0-P3 only, Manual removed)
PHASES = ["P0", "P1", "P2", "P3"]
# A zone's Set Phase select: Keep (no request), or the phase the controller moves the zone to once
SET_PHASE_OPTIONS = ["Keep", *PHASES]
# How Water today reads, in the dashboard and the controller's vitals notification: each zone's
# total, or what each of its plants got. The controller matches "Per plant" by these words.
WATER_TODAY_VIEWS = ["Zone total", "Per plant"]
# How a zone's probes become its one moisture reading, and separately its one EC reading
# (select.crop_steering_<prefix>zone_N_vwc_method / _ec_method): Average until someone chooses.
PROBE_METHODS = ["Average", "Median", "Lowest", "Highest"]
STEERING_MODES = ["Vegetative", "Generative"]

# Growth stages (for growth_stage select entity)
GROWTH_STAGES = ["Vegetative", "Generative", "Transition"]

# ---------------------------------------------------------------------------
# Named-stage recipes
# ---------------------------------------------------------------------------
# A recipe is a small DATA table (growth stage -> the handful of setpoints that
# actually change by stage). Selecting a stage *applies* its row into the
# existing per-zone `number.crop_steering_*` entities the engine already reads —
# no new per-stage entities (that sprawl is what produced fat-finger setpoints),
# no engine change. Stored server-side per room via the HA Store helper.
RECIPE_STORAGE_VERSION = 1
RECIPE_STAGES = ["Veg", "Transition", "Bulk", "Ripen", "Custom"]

# The curated knobs a stage drives. Each exists both globally
# (`number.crop_steering_<param>`) and per zone
# (`number.crop_steering_zone_N_<param>`); apply writes whichever exist.
RECIPE_PARAMS = [
    "p1_target_vwc",
    "p2_vwc_threshold",
    "generative_dryback_target",
    "p0_dryback_drop_percent",
    "ec_target_gen_p1",
    "ec_target_gen_p2",
    "maximum_ec",
    "p2_shot_size",
]

# Sane cannabis starting defaults: veg -> ripen drops VWC targets, deepens the
# dryback, and climbs EC + the EC ceiling (the generative push). Starting points
# the grower tunes — never claimed as optimal. The P0 additional dryback stays in
# Athena's 1-5% (p. 39).
DEFAULT_RECIPE = {
    "version": RECIPE_STORAGE_VERSION,
    "active_stage": "Veg",
    "stages": {
        "Veg": {
            "p1_target_vwc": 70.0,
            "p2_vwc_threshold": 60.0,
            "generative_dryback_target": 15.0,
            "p0_dryback_drop_percent": 2.0,
            "ec_target_gen_p1": 2.0,
            "ec_target_gen_p2": 2.5,
            "maximum_ec": 7.0,
            "p2_shot_size": 5.0,
        },
        "Transition": {
            "p1_target_vwc": 66.0,
            "p2_vwc_threshold": 56.0,
            "generative_dryback_target": 22.0,
            "p0_dryback_drop_percent": 3.0,
            "ec_target_gen_p1": 2.6,
            "ec_target_gen_p2": 3.0,
            "maximum_ec": 8.0,
            "p2_shot_size": 5.0,
        },
        "Bulk": {
            "p1_target_vwc": 62.0,
            "p2_vwc_threshold": 50.0,
            "generative_dryback_target": 32.0,
            "p0_dryback_drop_percent": 3.0,
            "ec_target_gen_p1": 3.0,
            "ec_target_gen_p2": 3.5,
            "maximum_ec": 9.0,
            "p2_shot_size": 6.0,
        },
        "Ripen": {
            "p1_target_vwc": 58.0,
            "p2_vwc_threshold": 46.0,
            "generative_dryback_target": 42.0,
            "p0_dryback_drop_percent": 5.0,
            "ec_target_gen_p1": 3.4,
            "ec_target_gen_p2": 4.0,
            "maximum_ec": 10.0,
            "p2_shot_size": 6.0,
        },
        # Custom starts as a copy of Bulk; the operator edits it freely.
        "Custom": {
            "p1_target_vwc": 62.0,
            "p2_vwc_threshold": 50.0,
            "generative_dryback_target": 32.0,
            "p0_dryback_drop_percent": 3.0,
            "ec_target_gen_p1": 3.0,
            "ec_target_gen_p2": 3.5,
            "maximum_ec": 9.0,
            "p2_shot_size": 6.0,
        },
    },
}

# Service names — the single source of truth for the domain's registered services.
# These MUST match the keys of the SERVICES dict in services.py.
SERVICE_SET_MANUAL_OVERRIDE = "set_manual_override"
SERVICE_APPLY_RECIPE = "apply_recipe"
SERVICE_SAVE_RECIPE = "save_recipe"
