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

# Service names — the single source of truth for the domain's registered services.
# These MUST match the keys of the SERVICES dict in services.py.
SERVICE_SET_MANUAL_OVERRIDE = "set_manual_override"
