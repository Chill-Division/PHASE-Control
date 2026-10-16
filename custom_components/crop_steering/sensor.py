"""PHASE Control sensors."""

from __future__ import annotations

import logging
import math
import re
from datetime import timedelta
from typing import Any

from homeassistant.components.sensor import (
    SensorEntity,
    SensorEntityDescription,
    SensorDeviceClass,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    PERCENTAGE,
    UnitOfTime,
    UnitOfVolume,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.util import dt as dt_util
from homeassistant.helpers.entity import DeviceInfo

from .const import (
    PROBE_METHODS,
    DOMAIN,
    CONF_NUM_ZONES,
    PRODUCT_NAME,
    SOFTWARE_VERSION,
)
from .room import room_prefix, build_engine_config
from . import stock
from .calculations import ShotCalculator, combine_probes, combined_readings
from .units import to_native
from .zone_status import mirrored_status, status_app_entity

_LOGGER = logging.getLogger(__name__)

# The configured shot each shot-duration sensor times: P1's first ramp shot, P2's maintenance shot,
# and P3's emergency (rescue) shot.
SHOT_SIZE_KEYS = {
    "p1_shot_duration_seconds": "p1_initial_shot_size",
    "p2_shot_duration_seconds": "p2_shot_size",
    "p3_shot_duration_seconds": "p3_emergency_shot_size",
}


# Base sensor descriptions (non-zone specific)
BASE_SENSOR_DESCRIPTIONS = [
    # dryback_percentage is OWNED BY THE ENGINE (the add-on set_state from
    # _update_dryback_entities — computed per-zone from peak vs current VWC). It was a
    # coordinator-backed descriptor here whose native_value was always None, so it
    # perpetually re-asserted `unknown` and clobbered the engine's publish. Removed so
    # the engine owns it (same pattern as the fused_vwc/fused_ec sensors).
    # Critical Template Calculations - Ported from packages
    SensorEntityDescription(
        key="p1_shot_duration_seconds",
        name="P1 Shot Duration",
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        icon="mdi:timer-sand",
    ),
    SensorEntityDescription(
        key="p2_shot_duration_seconds",
        name="P2 Shot Duration",
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        icon="mdi:timer-sand",
    ),
    SensorEntityDescription(
        key="p3_shot_duration_seconds",
        name="P3 Emergency Shot Duration",
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        icon="mdi:timer-sand",
    ),
    SensorEntityDescription(
        key="configured_avg_vwc",
        name="Average VWC All Zones",
        device_class=SensorDeviceClass.MOISTURE,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=PERCENTAGE,
        icon="mdi:water-percent",
    ),
    SensorEntityDescription(
        key="configured_avg_ec",
        name="Average EC All Zones",
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement="mS/cm",
        icon="mdi:flash",
    ),
]


def create_zone_sensor_descriptions(num_zones: int) -> list[SensorEntityDescription]:
    """Create sensor descriptions for configured zones."""
    zone_sensors = []

    for zone_num in range(1, num_zones + 1):
        # VWC sensor for each zone
        zone_sensors.append(
            SensorEntityDescription(
                key=f"vwc_zone_{zone_num}",
                name=f"Zone {zone_num} VWC",
                device_class=SensorDeviceClass.MOISTURE,
                state_class=SensorStateClass.MEASUREMENT,
                native_unit_of_measurement=PERCENTAGE,
                icon="mdi:water-percent",
            )
        )

        # EC sensor for each zone
        zone_sensors.append(
            SensorEntityDescription(
                key=f"ec_zone_{zone_num}",
                name=f"Zone {zone_num} EC",
                state_class=SensorStateClass.MEASUREMENT,
                native_unit_of_measurement="mS/cm",
                icon="mdi:lightning-bolt",
            )
        )

        # Zone status sensor
        zone_sensors.append(
            SensorEntityDescription(
                key=f"zone_{zone_num}_status",
                name=f"Zone {zone_num} Status",
                icon="mdi:information",
            )
        )

        # Zone last irrigation time
        zone_sensors.append(
            SensorEntityDescription(
                key=f"zone_{zone_num}_last_irrigation",
                name=f"Zone {zone_num} Last Irrigation",
                device_class=SensorDeviceClass.TIMESTAMP,
                icon="mdi:history",
            )
        )

        # Zone water usage tracking
        zone_sensors.append(
            SensorEntityDescription(
                key=f"zone_{zone_num}_daily_water_usage",
                name=f"Zone {zone_num} Daily Water Usage",
                device_class=SensorDeviceClass.VOLUME,
                state_class=SensorStateClass.TOTAL_INCREASING,
                native_unit_of_measurement=UnitOfVolume.LITERS,
                icon="mdi:water",
            )
        )

        zone_sensors.append(
            SensorEntityDescription(
                key=f"zone_{zone_num}_weekly_water_usage",
                name=f"Zone {zone_num} Weekly Water Usage",
                device_class=SensorDeviceClass.VOLUME,
                # Rolling windows decrease when old grow-days leave the total.
                state_class=SensorStateClass.TOTAL,
                native_unit_of_measurement=UnitOfVolume.LITERS,
                icon="mdi:water-outline",
            )
        )

        zone_sensors.append(
            SensorEntityDescription(
                key=f"zone_{zone_num}_irrigation_count_today",
                name=f"Zone {zone_num} Irrigations Today",
                state_class=SensorStateClass.TOTAL_INCREASING,
                icon="mdi:counter",
            )
        )

    return zone_sensors


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up PHASE Control sensors."""
    sensors = []

    # Get number of zones from config
    config_data = hass.data[DOMAIN][entry.entry_id]
    num_zones = config_data.get(CONF_NUM_ZONES, 1)
    zones_config = config_data.get("zones", {})
    hardware_config = config_data.get("hardware", {})

    # Use base sensors - no duplication needed
    sensor_descriptions = BASE_SENSOR_DESCRIPTIONS.copy()

    # Add zone-specific sensors
    zone_sensors = create_zone_sensor_descriptions(num_zones)
    sensor_descriptions.extend(zone_sensors)

    # Create sensor entities
    for description in sensor_descriptions:
        cls = (
            CropSteeringZoneStatusSensor
            if re.fullmatch(r"zone_\d+_status", description.key)
            else CropSteeringSensor
        )
        sensors.append(cls(entry, description, zones_config, hardware_config))

    # Publish this room's engine config (hardware map + kill switch + zones) so the
    # f2-control add-on can discover and drive it — multi-room Stage 2.
    sensors.append(
        CropSteeringEngineConfigSensor(entry, num_zones, zones_config, hardware_config)
    )
    sensors.append(CropSteeringStockSensor(entry))
    # What the controller runs for the room's next nutrient batch (feed_api.py).
    sensors.append(CropSteeringFeedPlanSensor(entry))

    async_add_entities(sensors)


class CropSteeringEngineConfigSensor(SensorEntity):
    """Publishes this room's config (pump/mainline/valves, kill switch, feed probes, zones)
    as attributes so the f2-control add-on can DISCOVER and drive the room — the add-on
    cannot read the integration's config entry directly. Since add-on 0.11.0 the DEFAULT
    room's hardware map comes from the prefix-"" descriptor too (explicit add-on options
    still take precedence), so this sensor is what makes a fresh install actuate at all.
    """

    _attr_should_poll = False
    _attr_icon = "mdi:cog-transfer-outline"

    def __init__(self, entry, num_zones, zones_config, hardware_config):
        self._entry = entry
        self._num_zones = num_zones
        self._zones = zones_config or {}
        self._hw = hardware_config or {}
        self._prefix = room_prefix(entry)
        self._slug = entry.data.get("room_slug", "default")
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_engine_config"
        self._attr_name = "Engine config"
        self._attr_object_id = f"{DOMAIN}_{self._prefix}engine_config"
        # Home Assistant ignores _attr_object_id; the controller finds a room by THIS id.
        self.entity_id = f"sensor.{self._attr_object_id}"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name=PRODUCT_NAME,
            manufacturer="Home Assistant Community",
            model="Professional Irrigation Controller",
            sw_version=SOFTWARE_VERSION,
        )

    @property
    def native_value(self) -> Any:
        return self._slug

    @property
    def extra_state_attributes(self) -> dict:
        return build_engine_config(
            self._prefix,
            self._slug,
            self._num_zones,
            self._zones,
            self._hw,
            {**self._entry.data, **self._entry.options},
            integration_version=SOFTWARE_VERSION,
            entry_id=self._entry.entry_id,
        )


class CropSteeringStockSensor(SensorEntity):
    """How many of the room's stock tanks are at or below their low mark (0 when none), with every
    tank's level as attributes, so an automation can push a phone alert. The tanks live in the
    integration's store (stock_api.py); this is rewritten whenever they change."""

    _attr_should_poll = False
    _attr_icon = "mdi:flask-outline"

    def __init__(self, entry):
        self._entry = entry
        self._prefix = room_prefix(entry)
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_stock_low"
        self._attr_name = "Stock tanks low"
        self._attr_object_id = f"{DOMAIN}_{self._prefix}stock_low"
        self.entity_id = f"sensor.{self._attr_object_id}"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name=PRODUCT_NAME,
            manufacturer="Home Assistant Community",
            model="Professional Irrigation Controller",
            sw_version=SOFTWARE_VERSION,
        )

    def _manager(self):
        return (
            self.hass.data.get(DOMAIN, {}).get("_stock", {}).get(self._entry.entry_id)
        )

    @property
    def native_value(self) -> Any:
        manager = self._manager()
        if manager is None or manager.error:
            return None
        return len(stock.low_tanks(manager.data))

    @property
    def extra_state_attributes(self) -> dict:
        manager = self._manager()
        if manager is None:
            return {}
        doses = manager.doses()
        return {
            "tanks": [
                {
                    "name": tank["name"],
                    "level_l": tank["level_l"],
                    "capacity_l": tank["capacity_l"],
                    "percent": round(tank["level_l"] / tank["capacity_l"] * 100, 1),
                    "low_l": tank["low_l"],
                    "dose_ml": doses.get(tank["id"]),
                    "doser": tank.get("doser"),
                    "batches_left": stock.batches_left(tank, doses.get(tank["id"], 0)),
                    "low": tank["level_l"] <= tank["low_l"],
                }
                for tank in manager.data["tanks"]
            ],
            # the newest batch counted
            "last_batch": (manager.data["history"] or [{}])[0].get("at"),
            "error": manager.error,
        }

    async def async_added_to_hass(self) -> None:
        from homeassistant.helpers.dispatcher import async_dispatcher_connect

        from .feed_api import SIGNAL as FEED_SIGNAL
        from .stock_api import SIGNAL

        # A tank on a doser takes what the feed stage in use doses from it: a new stage or recipe
        # changes its dose per batch and batches left.
        for signal in (SIGNAL, FEED_SIGNAL):
            self.async_on_remove(
                async_dispatcher_connect(
                    self.hass,
                    f"{signal}_{self._entry.entry_id}",
                    self.async_write_ha_state,
                )
            )


class CropSteeringSensor(SensorEntity):
    """PHASE Control sensor."""

    def __init__(
        self,
        entry: ConfigEntry,
        description: SensorEntityDescription,
        zones_config: dict,
        hardware_config: dict,
    ) -> None:
        """Initialize the sensor."""
        self.entity_description = description
        self._entry = entry
        self._zones_config = zones_config
        self._hardware_config = hardware_config
        # Room prefix ("" for the default room) — every cross-entity read below is
        # namespaced with it so a second room reads its OWN entities, not room 1's.
        self._prefix = room_prefix(entry)
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_{description.key}"
        self._attr_name = description.name
        # Set object_id to include crop_steering prefix for entity_id generation
        self._attr_object_id = f"{DOMAIN}_{self._prefix}{description.key}"
        # Home Assistant ignores _attr_object_id and would name a NEW entity from its friendly name
        # (number.p1_target_vwc). Existing installs keep the id the registry already holds.
        self.entity_id = f"sensor.{self._attr_object_id}"

        # Extract zone number from key if this is a zone sensor.
        # Regex matches BOTH `vwc_zone_3` and `zone_3_status`-style keys; the prior
        # `split("_zone_")` logic missed keys that *start* with `zone_` (e.g.
        # zone_N_status), leaving _zone_number=None so the zone branch never fired.
        self._zone_number = None
        m = re.search(r"zone_(\d+)", description.key)
        if m:
            try:
                self._zone_number = int(m.group(1))
            except (ValueError, IndexError):
                pass

    @property
    def device_info(self) -> DeviceInfo:
        """Return device information."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name=PRODUCT_NAME,
            manufacturer="Home Assistant Community",
            model="Professional Irrigation Controller",
            sw_version=SOFTWARE_VERSION,
        )

    @property
    def native_value(self) -> Any:
        """Return the state of the sensor."""
        # Handle zone-specific sensors
        if self._zone_number is not None:
            if f"vwc_zone_{self._zone_number}" == self.entity_description.key:
                return self._get_zone_vwc(self._zone_number)
            elif f"ec_zone_{self._zone_number}" == self.entity_description.key:
                return self._get_zone_ec(self._zone_number)
            elif (
                f"zone_{self._zone_number}_last_irrigation"
                == self.entity_description.key
            ):
                return self._get_zone_last_irrigation(self._zone_number)
            elif (
                f"zone_{self._zone_number}_daily_water_usage"
                == self.entity_description.key
            ):
                return self._get_zone_daily_water_usage(self._zone_number)
            elif (
                f"zone_{self._zone_number}_weekly_water_usage"
                == self.entity_description.key
            ):
                return self._get_zone_weekly_water_usage(self._zone_number)
            elif (
                f"zone_{self._zone_number}_irrigation_count_today"
                == self.entity_description.key
            ):
                return self._get_zone_irrigation_count_today(self._zone_number)

        # Implement critical calculations ported from template entities
        if self.entity_description.key in SHOT_SIZE_KEYS:
            seconds = self._shot_seconds_by_zone(self.entity_description.key)
            return max(seconds.values()) if seconds else None
        elif self.entity_description.key == "configured_avg_vwc":
            return self._calculate_avg_vwc()
        elif self.entity_description.key == "configured_avg_ec":
            return self._calculate_avg_ec()
        else:
            # Other sensors return None (placeholder)
            return None

    def _zone_setting(self, zone_num: int, key: str) -> float | None:
        """A zone's setting as the controller reads it: the zone's own number, else the room's.
        None when neither reads as a number."""
        for entity_id in (
            f"number.crop_steering_{self._prefix}zone_{zone_num}_{key}",
            f"number.crop_steering_{self._prefix}{key}",
        ):
            state = self.hass.states.get(entity_id)
            if state is None or state.state in ("unknown", "unavailable", "none", ""):
                continue
            try:
                value = float(state.state)
            except (TypeError, ValueError):
                return None
            return value if math.isfinite(value) else None
        return None

    def _shot_seconds_by_zone(self, key: str) -> dict[int, int]:
        """How long the controller runs the configured shot `key` times, in each of the room's
        active zones: the zone's pot size, drippers per plant and dripper flow, in whole seconds
        within the room's shot limits. A zone whose sizing doesn't give a flow is left out.
        """
        zones = sorted(
            int(zone)
            for zone, config in self._zones_config.items()
            if str(zone).isdigit() and (config or {}).get("active", True)
        ) or [1]
        # The room's maximum shot length, or its older entity's, as the controller reads it.
        cap = None
        for suffix in ("max_shot_duration", "maximum_shot_duration"):
            cap_state = self.hass.states.get(
                f"number.crop_steering_{self._prefix}{suffix}"
            )
            if cap_state is None:
                continue
            try:
                cap = float(cap_state.state)
            except (TypeError, ValueError):
                cap = None
            break
        seconds = {}
        for zone in zones:
            sizing = [
                self._zone_setting(zone, setting)
                for setting in (
                    "substrate_volume",
                    SHOT_SIZE_KEYS[key],
                    "drippers_per_plant",
                    "dripper_flow_rate",
                )
            ]
            if any(value is None or value <= 0 for value in sizing):
                continue
            substrate, size, drippers, flow = sizing
            raw = ShotCalculator.calculate_shot_duration(
                flow, substrate, size, drippers
            )
            seconds[zone] = ShotCalculator.capped_shot_seconds(raw, cap)
        return seconds

    def _zone_probe_ids(self, zone_num: int, metric: str) -> list[str]:
        """The probes mapped to a zone for `metric` ("vwc" or "ec"): the N-probe list, or the
        legacy front/back pair."""
        # _zones_config keys can be int OR str ('1','2','3') depending on how the config
        # entry was (re)loaded — JSON serialises dict keys as strings, so after a config
        # reload the int lookup misses and every zone reads None ('unknown'). Accept both.
        zone_config = (
            self._zones_config.get(zone_num)
            or self._zones_config.get(str(zone_num))
            or {}
        )
        sensors = list(zone_config.get(f"{metric}_sensors", []))
        if not sensors:
            for end in ("front", "back"):
                if zone_config.get(f"{metric}_{end}"):
                    sensors.append(zone_config[f"{metric}_{end}"])
        return sensors

    def _probe_method_entity(self, zone_num: int, metric: str) -> str:
        return f"select.{DOMAIN}_{self._prefix}zone_{zone_num}_{metric}_method"

    def _probe_method(self, zone_num: int, metric: str) -> str:
        """How the zone's probes become its one reading: the zone's select, Average without it."""
        state = self.hass.states.get(self._probe_method_entity(zone_num, metric))
        return (
            state.state
            if state is not None and state.state in PROBE_METHODS
            else "Average"
        )

    def _zone_reading(self, zone_num: int, metric: str) -> float | None:
        readings = self._probe_values(self._zone_probe_ids(zone_num, metric), metric)
        return combine_probes(readings.values(), self._probe_method(zone_num, metric))

    def _get_zone_vwc(self, zone_num: int) -> float | None:
        """The zone's moisture from its probes, combined as its select says (Average unless
        chosen otherwise)."""
        return self._zone_reading(zone_num, "vwc")

    def _get_zone_ec(self, zone_num: int) -> float | None:
        """The zone's EC from its probes, combined as its select says (Average unless chosen
        otherwise)."""
        return self._zone_reading(zone_num, "ec")

    def _get_zone_last_irrigation(self, zone_num: int):
        """Return zone last-irrigation as a tz-aware datetime (or None).

        device_class=TIMESTAMP requires a tz-aware datetime. A naive ISO string makes HA raise
        inside the platform's shared asyncio.gather, which freezes the other sensors too.
        """
        s = self.hass.states.get(
            f"sensor.crop_steering_{self._prefix}zone_{zone_num}_last_irrigation_app"
        )
        if not s or s.state in ("unknown", "unavailable", "", None):
            return None
        dt = dt_util.parse_datetime(s.state)
        if dt is None:
            return None
        # Legacy producer strings do not identify their timezone. Wait for an
        # explicit offset instead of assigning a potentially incorrect time.
        return dt if dt.tzinfo is not None and dt.utcoffset() is not None else None

    def _get_zone_daily_water_usage(self, zone_num: int) -> float | None:
        """Get finite non-negative daily usage, preserving an unavailable source."""
        usage_sensor = self.hass.states.get(
            f"sensor.crop_steering_{self._prefix}zone_{zone_num}_daily_water_app"
        )
        if usage_sensor and usage_sensor.state not in ["unknown", "unavailable"]:
            try:
                value = float(usage_sensor.state)
                return value if math.isfinite(value) and value >= 0 else None
            except (TypeError, ValueError):
                pass
        return None

    def _get_zone_weekly_water_usage(self, zone_num: int) -> float | None:
        """Get weekly water usage for zone."""
        # Check the engine sensor for weekly usage
        usage_sensor = self.hass.states.get(
            f"sensor.crop_steering_{self._prefix}zone_{zone_num}_weekly_water_app"
        )
        if usage_sensor and usage_sensor.state not in ["unknown", "unavailable"]:
            try:
                value = float(usage_sensor.state)
                return value if math.isfinite(value) and value >= 0 else None
            except (TypeError, ValueError):
                pass
        return None

    def _probe_metric(self) -> str | None:
        """ "vwc" or "ec" for a zone's moisture or EC sensor; None for any other sensor."""
        if self._zone_number is None:
            return None
        for metric in ("vwc", "ec"):
            if self.entity_description.key == f"{metric}_zone_{self._zone_number}":
                return metric
        return None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        metric = self._probe_metric()
        if metric is None:
            return

        @callback
        def _method_changed(_event) -> None:
            self.async_write_ha_state()

        # A new choice of method shows at once, not at the next poll.
        self.async_on_remove(
            async_track_state_change_event(
                self.hass,
                [self._probe_method_entity(self._zone_number, metric)],
                _method_changed,
            )
        )

    @property
    def extra_state_attributes(self) -> dict | None:
        """A zone's moisture or EC sensor: each probe's reading, what each method gives from them
        and the method in use. The weekly water sensor: its producer's coverage, so partial history
        stays visible. A shot-duration sensor: each zone's seconds, of which it shows the longest.
        """
        if self.entity_description.key in SHOT_SIZE_KEYS:
            seconds = self._shot_seconds_by_zone(self.entity_description.key)
            return {"zones": {str(zone): value for zone, value in seconds.items()}}
        metric = self._probe_metric()
        if metric is not None:
            readings = self._probe_values(
                self._zone_probe_ids(self._zone_number, metric), metric
            )
            return {
                "method": self._probe_method(self._zone_number, metric),
                "probes": {
                    entity: round(value, 2) for entity, value in readings.items()
                },
                "combined": combined_readings(readings.values()),
            }
        if self._zone_number and self.entity_description.key == (
            f"zone_{self._zone_number}_weekly_water_usage"
        ):
            source = self.hass.states.get(
                f"sensor.crop_steering_{self._prefix}zone_{self._zone_number}_weekly_water_app"
            )
            if (
                source is None
                or self._get_zone_weekly_water_usage(self._zone_number) is None
            ):
                return {"coverage": "unknown", "history_complete": False}
            keys = (
                "window_start_grow_day",
                "window_end_grow_day",
                "observed_grow_days",
                "complete_grow_days",
                "history_complete",
                "coverage",
                "legacy_volume_excluded_l",
                "measurement",
            )
            return {
                key: source.attributes[key] for key in keys if key in source.attributes
            }
        return None

    def _get_zone_irrigation_count_today(self, zone_num: int) -> int:
        """Get today's irrigation count for zone."""
        # Check the engine sensor for count
        count_sensor = self.hass.states.get(
            f"sensor.crop_steering_{self._prefix}zone_{zone_num}_irrigation_count_app"
        )
        if count_sensor and count_sensor.state not in ["unknown", "unavailable"]:
            try:
                return int(count_sensor.state)
            except ValueError:
                pass
        return 0

    def _average_sensor_values(
        self, sensor_ids: list[str], kind: str | None = None
    ) -> float | None:
        """Average values from multiple sensors (see _probe_values)."""
        return combine_probes(self._probe_values(sensor_ids, kind).values())

    def _probe_values(
        self, sensor_ids: list[str], kind: str | None = None
    ) -> dict[str, float]:
        """Each sensor's usable reading, by entity id, first converted to the unit the room steers
        in (`kind` "ec" -> mS/cm, "vwc" -> %). Mixed probes are common: one Atlas in uS/cm beside
        one TEROS in mS/cm would otherwise average to nonsense far over any EC target.
        """
        if not sensor_ids:
            _LOGGER.debug("No sensor IDs provided for averaging")
            return {}

        values = {}
        for sensor_id in sensor_ids:
            if not sensor_id:
                continue
            try:
                state = self.hass.states.get(sensor_id)
                if state is None:
                    _LOGGER.warning(f"Sensor entity not found: {sensor_id}")
                    continue
                if state.state not in ["unknown", "unavailable", "none", None]:
                    value = float(state.state)
                    if math.isfinite(value):
                        unit = (getattr(state, "attributes", None) or {}).get(
                            "unit_of_measurement"
                        )
                        values[sensor_id] = to_native(kind, unit, value)
            except (ValueError, TypeError) as e:
                _LOGGER.debug(f"Could not parse sensor value for {sensor_id}: {e}")
                continue

        if not values:
            _LOGGER.debug(
                f"No valid sensor values found from {len(sensor_ids)} sensors"
            )
        return values

    def _calculate_avg_vwc(self) -> float | None:
        """Calculate average VWC from all configured zone sensors."""
        all_sensors = []
        for zone_config in self._zones_config.values():
            sensors = list(zone_config.get("vwc_sensors", []))
            if sensors:
                all_sensors.extend(sensors)
            else:
                if zone_config.get("vwc_front"):
                    all_sensors.append(zone_config["vwc_front"])
                if zone_config.get("vwc_back"):
                    all_sensors.append(zone_config["vwc_back"])

        return self._average_sensor_values(all_sensors, "vwc")

    def _calculate_avg_ec(self) -> float | None:
        """Calculate average EC from all configured zone sensors."""
        all_sensors = []
        for zone_config in self._zones_config.values():
            sensors = list(zone_config.get("ec_sensors", []))
            if sensors:
                all_sensors.extend(sensors)
            else:
                if zone_config.get("ec_front"):
                    all_sensors.append(zone_config["ec_front"])
                if zone_config.get("ec_back"):
                    all_sensors.append(zone_config["ec_back"])

        return self._average_sensor_values(all_sensors, "ec")

    @property
    def available(self) -> bool:
        """Return if sensor is available."""
        return True


class CropSteeringZoneStatusSensor(CropSteeringSensor):
    """zone_N_status: what the CONTROLLER says about the zone, mirrored from its zone_N_status_app.

    Not polled. It is updated when zone_N_status_app changes, and checked once a minute for a
    controller that has stopped reporting, and it writes only when what it shows changes. A
    controller from before this, which still writes zone_N_status itself, is therefore left alone
    rather than fought every 30 seconds: the integration shows "Controller not reporting" once, and
    that controller's own label stands until it is updated.
    """

    _attr_should_poll = False

    def __init__(self, entry, description, zones_config, hardware_config) -> None:
        super().__init__(entry, description, zones_config, hardware_config)
        self._source = status_app_entity(self._prefix, self._zone_number)
        self._shown: tuple[str, dict] | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            async_track_state_change_event(
                self.hass, [self._source], self._source_changed
            )
        )
        self.async_on_remove(
            async_track_time_interval(self.hass, self._refresh, timedelta(minutes=1))
        )

    @callback
    def _source_changed(self, _event) -> None:
        self._refresh(dt_util.utcnow())

    @callback
    def _refresh(self, now) -> None:
        shown = mirrored_status(self.hass.states.get(self._source), now)
        if shown != self._shown:
            self._shown = shown
            self.async_write_ha_state()

    def _current(self) -> tuple[str, dict]:
        if self._shown is None:
            self._shown = mirrored_status(
                self.hass.states.get(self._source), dt_util.utcnow()
            )
        return self._shown

    @property
    def native_value(self) -> Any:
        return self._current()[0]

    @property
    def extra_state_attributes(self) -> dict | None:
        return dict(self._current()[1])


class CropSteeringFeedPlanSensor(SensorEntity):
    """What the controller app runs for the room's next nutrient batch: the feed stage in use as the
    state ("none" when none is chosen), and as attributes the batch settings and, in the room's
    order, each doser's nutrient, mL and seconds (feed.plan), with `problem` saying why no batch can
    run. Rewritten whenever the room's feed settings change."""

    _attr_should_poll = False
    _attr_icon = "mdi:beaker-outline"

    def __init__(self, entry):
        self._entry = entry
        self._prefix = room_prefix(entry)
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_feed_plan"
        self._attr_name = "Feed plan"
        self._attr_object_id = f"{DOMAIN}_{self._prefix}feed_plan"
        self.entity_id = f"sensor.{self._attr_object_id}"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name=PRODUCT_NAME,
            manufacturer="Home Assistant Community",
            model="Professional Irrigation Controller",
            sw_version=SOFTWARE_VERSION,
        )

    def _manager(self):
        from .feed_api import get_feed

        return get_feed(self.hass, self._entry)

    @property
    def native_value(self) -> Any:
        manager = self._manager()
        if manager is None or manager.error:
            return None
        return manager.plan()["stage"] or "none"

    @property
    def extra_state_attributes(self) -> dict:
        manager = self._manager()
        if manager is None:
            return {}
        if manager.error:
            return {"error": manager.error}
        return {
            **manager.plan(),
            "revision": manager.data["revision"],
            # a test refill whose fill the person checked fits: the controller does not refuse it
            "mix_force_until": manager.forced(),
        }

    async def async_added_to_hass(self) -> None:
        from homeassistant.helpers.dispatcher import async_dispatcher_connect

        from .feed_api import SIGNAL

        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, f"{SIGNAL}_{self._entry.entry_id}", self.async_write_ha_state
            )
        )
