"""Buttons for PHASE Control: "Mix a Batch Now" for the room's reservoir, and a "Test Shot" and a
"Relearn Peak" for each zone.

Pressing one does nothing here. Home Assistant records when it was pressed as the button's state, and
the controller app, which reads that, acts the next time it looks: Mix a Batch Now refills, mixes and
doses the reservoir (feed.py); a zone's Test Shot waters that zone for 10 seconds, to check that
watering works. Each is a request, not a command: the controller only acts while the room's watering
switch is on and nothing else is in the way, and says so if it cannot. A zone's Relearn Peak has the
controller's Auto setpoints forget the peak it learned for the zone, which waters nothing.
"""

from __future__ import annotations

import logging

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_NUM_ZONES, DOMAIN, PRODUCT_NAME, SOFTWARE_VERSION
from .room import room_prefix, zone_device_name

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    config = hass.data.get(DOMAIN, {}).get(entry.entry_id, {})
    zones = config.get(CONF_NUM_ZONES, 1) if isinstance(config, dict) else 1
    async_add_entities(
        [
            CropSteeringMixBatchButton(entry),
            *(CropSteeringTestShotButton(entry, zone) for zone in range(1, zones + 1)),
            *(CropSteeringRelearnButton(entry, zone) for zone in range(1, zones + 1)),
        ]
    )


class CropSteeringMixBatchButton(ButtonEntity):
    _attr_icon = "mdi:beaker-plus-outline"

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_mix_batch"
        self._attr_name = "Mix a Batch Now"
        self._attr_object_id = f"{DOMAIN}_{room_prefix(entry)}mix_batch"
        # An explicit entity_id is the suggestion Home Assistant uses at first registration.
        self.entity_id = f"button.{self._attr_object_id}"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name=PRODUCT_NAME,
            manufacturer="Home Assistant Community",
            model="Professional Irrigation Controller",
            sw_version=SOFTWARE_VERSION,
        )

    async def async_press(self) -> None:
        _LOGGER.info(
            "Nutrient batch requested for %s", room_prefix(self._entry) or "the room"
        )


class CropSteeringTestShotButton(ButtonEntity):
    """A zone's Test Shot: the controller app waters the zone for 10 seconds, through every check a
    shot passes but a held grow plan's. Its water counts toward the day's; it is not a ramp shot.
    """

    _attr_icon = "mdi:water-check-outline"

    def __init__(self, entry: ConfigEntry, zone: int) -> None:
        self._entry, self._zone = entry, zone
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_zone_{zone}_test_shot"
        self._attr_name = f"Zone {zone} Test Shot"
        self._attr_object_id = f"{DOMAIN}_{room_prefix(entry)}zone_{zone}_test_shot"
        self.entity_id = f"button.{self._attr_object_id}"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, f"{self._entry.entry_id}_zone_{self._zone}")},
            name=zone_device_name(self._entry, self._zone),
            manufacturer="Home Assistant Community",
            model="Zone Controller",
            sw_version=SOFTWARE_VERSION,
        )

    async def async_press(self) -> None:
        _LOGGER.info(
            "Test shot requested for zone %s of %s",
            self._zone,
            room_prefix(self._entry) or "the room",
        )


class CropSteeringRelearnButton(ButtonEntity):
    """A zone's Relearn Peak: the controller app's Auto setpoints forgets the peak it learned for the
    zone, after the plants or the probe changed (a defoliation, a transplant, a probe moved). The
    zone's next ramp stops where the substrate stops taking water, and that is its peak from then on.
    What else it learned stays: how much a shot lifts the zone and how fast it dries."""

    _attr_icon = "mdi:restore"

    def __init__(self, entry: ConfigEntry, zone: int) -> None:
        self._entry, self._zone = entry, zone
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_zone_{zone}_relearn_peak"
        self._attr_name = f"Zone {zone} Relearn Peak"
        self._attr_object_id = f"{DOMAIN}_{room_prefix(entry)}zone_{zone}_relearn_peak"
        self.entity_id = f"button.{self._attr_object_id}"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, f"{self._entry.entry_id}_zone_{self._zone}")},
            name=zone_device_name(self._entry, self._zone),
            manufacturer="Home Assistant Community",
            model="Zone Controller",
            sw_version=SOFTWARE_VERSION,
        )

    async def async_press(self) -> None:
        _LOGGER.info(
            "Relearning the peak asked for zone %s of %s",
            self._zone,
            room_prefix(self._entry) or "the room",
        )
