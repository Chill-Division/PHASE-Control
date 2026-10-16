"""PHASE Control select entities."""

from __future__ import annotations

import logging

from homeassistant.components.select import SelectEntity, SelectEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.restore_state import RestoreEntity

from .const import (
    DOMAIN,
    CONF_NUM_ZONES,
    STEERING_MODES,
    GROWTH_STAGES,
    SOFTWARE_VERSION,
    SET_PHASE_OPTIONS,
    WATER_TODAY_VIEWS,
    PROBE_METHODS,
    PRODUCT_NAME,
)
from .room import restored_state_is_ours, room_prefix, zone_device_name

_LOGGER = logging.getLogger(__name__)

SELECT_DESCRIPTIONS = [
    SelectEntityDescription(
        key="growth_stage",
        name="Growth Stage",
        icon="mdi:timeline",
        options=GROWTH_STAGES,  # Use constant from const.py
    ),
    SelectEntityDescription(
        key="steering_mode",
        name="Steering Mode",
        icon="mdi:steering",
        options=STEERING_MODES,  # Use constant from const.py
    ),
    # The room's one choice of how Water today reads: the dashboard shows it for everyone, and
    # the controller's vitals notification follows it. Zone total until someone chooses.
    SelectEntityDescription(
        key="water_today_view",
        name="Water Today Shown As",
        icon="mdi:water-outline",
        options=WATER_TODAY_VIEWS,
    ),
]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up PHASE Control select entities."""
    selects = []

    # Add main select entities
    for description in SELECT_DESCRIPTIONS:
        selects.append(CropSteeringSelect(entry, description))

    # Get number of zones from config
    config_data = hass.data[DOMAIN][entry.entry_id]
    num_zones = config_data.get(CONF_NUM_ZONES, 1)

    # Add zone-specific select entities
    for zone_num in range(1, num_zones + 1):
        # Zone Steering Mode (per-row Vegetative/Generative; the engine falls back to global).
        # Retained from the lean branch: the master app's _zone_is_vegetative() reads this
        # for per-zone veg/gen EC-target selection.
        selects.append(
            CropSteeringSelect(
                entry,
                SelectEntityDescription(
                    key=f"zone_{zone_num}_steering_mode",
                    name=f"{PRODUCT_NAME} Zone {zone_num} Steering Mode",
                    options=["Vegetative", "Generative"],
                    icon="mdi:steering",
                ),
                zone_num=zone_num,
            )
        )

        # Move the zone to a phase by hand. The controller applies a choice once, within a
        # minute, and sets this back to Keep; its own rules carry on from that phase.
        selects.append(
            CropSteeringSelect(
                entry,
                SelectEntityDescription(
                    key=f"zone_{zone_num}_set_phase",
                    name=f"Zone {zone_num} Set Phase",
                    options=SET_PHASE_OPTIONS,
                    icon="mdi:state-machine",
                ),
                zone_num=zone_num,
            )
        )

        # How the zone's probes become its moisture reading, and separately its EC reading:
        # Average (as before these existed), Median, Lowest or Highest. The zone's VWC and EC
        # sensors apply it; the controller steers on those.
        for metric, label, icon in (
            ("vwc", "Moisture", "mdi:water-percent"),
            ("ec", "EC", "mdi:lightning-bolt"),
        ):
            selects.append(
                CropSteeringSelect(
                    entry,
                    SelectEntityDescription(
                        key=f"zone_{zone_num}_{metric}_method",
                        name=f"Zone {zone_num} {label} From Probes",
                        options=PROBE_METHODS,
                        icon=icon,
                    ),
                    zone_num=zone_num,
                )
            )

    # The feed stage in use for the room's nutrient batches: one of its feed recipes (feed_api.py).
    selects.append(CropSteeringFeedStageSelect(entry))

    async_add_entities(selects)


class CropSteeringSelect(SelectEntity, RestoreEntity):
    """PHASE Control select entity with state restoration."""

    def __init__(
        self,
        entry: ConfigEntry,
        description: SelectEntityDescription,
        zone_num: int = None,
    ) -> None:
        """Initialize the select entity."""
        self.entity_description = description
        self._entry = entry
        self._zone_num = zone_num
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_{description.key}"
        self._attr_name = description.name
        # Set object_id to include crop_steering prefix for entity_id generation
        self._attr_object_id = f"{DOMAIN}_{room_prefix(entry)}{description.key}"
        # Home Assistant ignores _attr_object_id and would name a NEW entity from its friendly name
        # (number.p1_target_vwc). Existing installs keep the id the registry already holds.
        self.entity_id = f"select.{self._attr_object_id}"
        self._attr_options = description.options

        # Set default values based on entity type
        if description.key == "growth_stage":
            self._attr_current_option = "Vegetative"
        else:
            self._attr_current_option = (
                description.options[0] if description.options else None
            )

    async def async_added_to_hass(self) -> None:
        """Restore state when added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        # A state left behind by a DELETED room is not this room's.
        if last_state is not None and restored_state_is_ours(self._entry, last_state):
            if last_state.state in self.options:
                self._attr_current_option = last_state.state

    @property
    def device_info(self) -> DeviceInfo:
        """Return device information."""
        if self._zone_num is not None:
            # Zone-specific device
            return DeviceInfo(
                identifiers={(DOMAIN, f"{self._entry.entry_id}_zone_{self._zone_num}")},
                name=zone_device_name(self._entry, self._zone_num),
                manufacturer="Home Assistant Community",
                model="Zone Controller",
                sw_version=SOFTWARE_VERSION,
            )
        else:
            # Main device
            return DeviceInfo(
                identifiers={(DOMAIN, self._entry.entry_id)},
                name=PRODUCT_NAME,
                manufacturer="Home Assistant Community",
                model="Professional Irrigation Controller",
                sw_version=SOFTWARE_VERSION,
            )

    async def async_select_option(self, option: str) -> None:
        """Change the selected option."""
        if option in self.options:
            self._attr_current_option = option
            self.async_write_ha_state()

    @property
    def available(self) -> bool:
        """Return if select is available."""
        return True


class CropSteeringFeedStageSelect(SelectEntity):
    """The feed stage in use: the name of one of the room's feed recipes, the feed schedule's this
    week, or one picked by hand. The recipes, the schedule and the stage live in the room's feed
    store; picking here saves it there (with the schedule running, until its next week starts),
    and the controller doses that recipe in the next batch. Unavailable until there is one.
    """

    _attr_should_poll = False
    _attr_icon = "mdi:flask-round-bottom-outline"

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_feed_stage"
        self._attr_name = "Feed Stage"
        self._attr_object_id = f"{DOMAIN}_{room_prefix(entry)}feed_stage"
        self.entity_id = f"select.{self._attr_object_id}"

    def _manager(self):
        from .feed_api import get_feed

        return get_feed(self.hass, self._entry)

    @property
    def options(self) -> list[str]:
        manager = self._manager()
        if manager is None or manager.error:
            return []
        return [recipe["name"] for recipe in manager.data["recipes"]]

    @property
    def current_option(self) -> str | None:
        manager = self._manager()
        if manager is None or manager.error:
            return None
        from .feed import recipe

        chosen = recipe(manager.data, manager.in_use())
        return chosen["name"] if chosen else None

    @property
    def available(self) -> bool:
        return bool(self.options)

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name=PRODUCT_NAME,
            manufacturer="Home Assistant Community",
            model="Professional Irrigation Controller",
            sw_version=SOFTWARE_VERSION,
        )

    async def async_select_option(self, option: str) -> None:
        manager = self._manager()
        if manager is None:
            return
        try:
            await manager.set_stage(option)
        except ValueError as error:
            from homeassistant.exceptions import HomeAssistantError

            raise HomeAssistantError(str(error)) from error

    async def async_added_to_hass(self) -> None:
        from homeassistant.helpers.dispatcher import async_dispatcher_connect

        from .feed_api import SIGNAL

        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, f"{SIGNAL}_{self._entry.entry_id}", self.async_write_ha_state
            )
        )
