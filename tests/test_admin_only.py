"""Only an administrator can change a room through a crop_steering service. Anyone can look.

The sidebar console is registered for every Home Assistant login, because reading is legitimate,
and it calls these services with that login. Before this, any login (a staff phone, the hallway
kiosk) could arm a plan with a future start date, which holds every zone, disarm the live plan,
replace every room's recipe or put a zone on hold. Automations call with no user and must run
exactly as before. Setup has always needed a signed-in administrator, automations included, and
still does.
"""

import asyncio
import re
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from . import ha_stubs

ha_stubs.install()

from custom_components.crop_steering import (  # noqa: E402
    run_api,
    feed_api,
    selftest,
    services,
    setup_api,
    stock_api,
    strategy_api,
    whats_new,
)
from custom_components.crop_steering.const import DOMAIN  # noqa: E402
from homeassistant.exceptions import HomeAssistantError  # noqa: E402

ADMIN, STAFF, GHOST = "admin-user", "staff-user", "deleted-user"
ROOM = "room:"
READ_ONLY = {
    "strategy_get",
    "strategy_preview",
    "runs_get",
    "stock_get",
    "feed_get",
    "whats_new_get",
}
# Changes nothing but whether the dashboard's What's new window shows again, or its first-run tour
# starts by itself again: whoever opens the dashboard first may dismiss them, administrator or not.
NOTICES = {"whats_new_seen": {"version": "2.0.0"}, "whats_new_tour_seen": {}}
SETUP = {"setup_read", "setup_create", "setup_save", "setup_remove"}
# Every other service changes something. What each is called with:
CHANGES = {
    "set_manual_override": {"zone": 1},
    "strategy_save": {"room_id": ROOM, "expected_revision": 0, "plan": {}},
    "strategy_activate": {"room_id": ROOM, "expected_revision": 0},
    "strategy_disarm": {"room_id": ROOM},
    "runs_save": {"room_id": ROOM, "expected_revision": 0, "record": {}},
    "runs_archive": {
        "room_id": ROOM,
        "expected_revision": 0,
        "id": "r",
        "archived": True,
    },
    "runs_import": {"room_id": ROOM, "expected_revision": 0, "runs": []},
    "stock_save": {"room_id": ROOM, "expected_revision": 0, "tanks": []},
    "stock_refill": {"room_id": ROOM, "expected_revision": 0, "id": "bloom"},
    "feed_save": {"room_id": ROOM, "expected_revision": 0, "document": {}},
    "feed_mix": {"room_id": ROOM},
    "test_shot": {"room_id": ROOM, "zone": 1},
}


class Services(ha_stubs.FakeServices):
    def async_register(self, domain, name, handler, schema=None, **_response):
        super().async_register(domain, name, handler, schema)


@pytest.fixture
def rig(monkeypatch):
    """Every crop_steering service registered as HA would, over fakes that record what ran."""
    monkeypatch.setattr(
        sys.modules["homeassistant.core"],
        "SupportsResponse",
        SimpleNamespace(ONLY="only", OPTIONAL="optional"),
        raising=False,
    )
    vol = sys.modules["voluptuous"]
    for name, value in (("ALLOW_EXTRA", object()), ("Length", lambda **_: None)):
        if not hasattr(vol, name):
            monkeypatch.setattr(vol, name, value, raising=False)

    override = SimpleNamespace(
        entity_id=f"switch.{DOMAIN}_zone_1_manual_override",
        _override_loaded=True,
        async_set_manual_override=AsyncMock(),
        extra_state_attributes={"manual_override_expires_at": None},
    )
    strategy = SimpleNamespace(
        room_id=ROOM,
        save=AsyncMock(return_value={}),
        activate=AsyncMock(return_value={}),
        disarm=AsyncMock(return_value={}),
        response=MagicMock(return_value={"status": "draft"}),
        preview=MagicMock(return_value={}),
    )
    runs = SimpleNamespace(
        room_id=ROOM,
        async_init=AsyncMock(),
        response=MagicMock(return_value={"runs": []}),
        mutate=AsyncMock(return_value={"runs": []}),
    )
    monkeypatch.setattr(run_api, "RunStore", lambda hass, entry: runs)
    tanks = SimpleNamespace(
        room_id=ROOM,
        async_init=AsyncMock(),
        start=MagicMock(return_value=None),
        response=MagicMock(return_value={"tanks": []}),
        mutate=AsyncMock(return_value={"tanks": []}),
    )
    monkeypatch.setattr(stock_api, "StockStore", lambda hass, entry: tanks)
    batches = SimpleNamespace(
        room_id=ROOM,
        async_init=AsyncMock(),
        start=MagicMock(return_value=None),
        response=MagicMock(return_value={"recipes": []}),
        save=AsyncMock(return_value={"recipes": []}),
        mix=AsyncMock(return_value={"recipes": []}),
    )
    monkeypatch.setattr(feed_api, "FeedStore", lambda hass, entry: batches)
    notice = SimpleNamespace(
        async_init=AsyncMock(),
        response=AsyncMock(return_value={"seen": None}),
        mark_seen=AsyncMock(return_value={"seen": "2.0.0"}),
        mark_toured=AsyncMock(return_value={"tour": False}),
    )
    monkeypatch.setattr(whats_new, "WhatsNew", lambda hass: notice)
    setup = {
        "read_setup": MagicMock(return_value={}),
        "create_setup": AsyncMock(return_value={}),
        "save_setup": AsyncMock(return_value={}),
        "remove_setup": AsyncMock(return_value={}),
    }
    for name, fake in setup.items():
        monkeypatch.setattr(setup_api, name, fake)

    hass = ha_stubs.FakeHass(
        # the zone's Test Shot button, which test_shot presses
        states={f"button.{DOMAIN}_zone_1_test_shot": "unknown"},
        data={
            DOMAIN: {
                "_manual_overrides": {"zone_1_manual_override": override},
                "_strategy": {"entry": strategy},
            }
        },
    )
    hass.services = Services()
    users = {
        ADMIN: SimpleNamespace(is_admin=True),
        STAFF: SimpleNamespace(is_admin=False),
    }
    hass.auth = SimpleNamespace(async_get_user=AsyncMock(side_effect=users.get))
    asyncio.run(services.async_setup_services(hass))
    asyncio.run(strategy_api.async_setup_strategy_services(hass))
    asyncio.run(run_api.async_setup_runs(hass, ha_stubs.FakeEntry()))
    asyncio.run(stock_api.async_setup_stock(hass, ha_stubs.FakeEntry()))
    asyncio.run(feed_api.async_setup_feed(hass, ha_stubs.FakeEntry()))
    asyncio.run(selftest.async_setup_selftest(hass))
    asyncio.run(setup_api.async_setup_setup_services(hass))
    asyncio.run(whats_new.async_setup_whats_new(hass, ha_stubs.FakeEntry(), False))

    def effects():
        """Everything a handler could have done: events, service calls, writes."""
        writes = (
            override.async_set_manual_override,
            strategy.save,
            strategy.activate,
            strategy.disarm,
            runs.mutate,
            tanks.mutate,
            batches.save,
            batches.mix,
            setup["create_setup"],
            setup["save_setup"],
            setup["remove_setup"],
        )
        return (
            len(hass.bus.events),
            len(hass.services.calls),
            setup["read_setup"].call_count,
            *(fake.await_count for fake in writes),
        )

    def call(name, user, data=None):
        handler = hass.services.registered[(DOMAIN, name)]
        request = SimpleNamespace(
            service=name,
            data=dict({**CHANGES, **NOTICES}.get(name, {}) if data is None else data),
            context=SimpleNamespace(user_id=user),
            return_response=True,
        )
        return asyncio.run(handler(request))

    return SimpleNamespace(hass=hass, call=call, effects=effects, notice=notice)


def test_every_service_is_either_read_only_or_checked(rig):
    """A new service has to be put in one list or the other here, on purpose."""
    registered = {name for _domain, name in rig.hass.services.registered}
    assert registered == READ_ONLY | SETUP | set(CHANGES) | set(NOTICES)


@pytest.mark.parametrize("user", [STAFF, ADMIN, None])
def test_anyone_may_dismiss_the_whats_new_window_and_it_changes_nothing_else(rig, user):
    before = rig.effects()
    assert rig.call("whats_new_seen", user) == {"seen": "2.0.0"}
    rig.notice.mark_seen.assert_awaited_once_with("2.0.0")
    assert rig.effects() == before


@pytest.mark.parametrize("user", [STAFF, ADMIN, None])
def test_anyone_may_say_the_first_run_tour_has_started_and_it_changes_nothing_else(
    rig, user
):
    before = rig.effects()
    assert rig.call("whats_new_tour_seen", user) == {"tour": False}
    rig.notice.mark_toured.assert_awaited_once_with()
    assert rig.effects() == before


@pytest.mark.parametrize("user", [STAFF, GHOST])
@pytest.mark.parametrize("name", sorted(set(CHANGES) | SETUP))
def test_a_signed_in_non_administrator_changes_nothing(rig, name, user):
    label = "Setup" if name in SETUP else f"{DOMAIN}.{name}"
    before = rig.effects()
    with pytest.raises(
        HomeAssistantError,
        match=rf"^{re.escape(label)} requires an authenticated Home Assistant administrator$",
    ):
        rig.call(name, user)
    assert rig.effects() == before


@pytest.mark.parametrize("user", [ADMIN, None], ids=["administrator", "automation"])
@pytest.mark.parametrize("name", sorted(CHANGES))
def test_an_administrator_or_an_automation_still_changes_it(rig, name, user):
    before = rig.effects()
    rig.call(name, user)
    assert rig.effects() != before


@pytest.mark.parametrize("name", sorted(SETUP))
def test_setup_still_refuses_a_call_with_no_signed_in_administrator(rig, name):
    before = rig.effects()
    with pytest.raises(HomeAssistantError, match="^Setup requires"):
        rig.call(name, None)
    assert rig.effects() == before
    rig.call(name, ADMIN)
    assert rig.effects() != before


@pytest.mark.parametrize("user", [STAFF, GHOST, None])
@pytest.mark.parametrize("name", sorted(READ_ONLY))
def test_reading_stays_open_to_every_login(rig, name, user):
    before = rig.effects()
    rig.call(name, user, {"room_id": ROOM})
    assert rig.effects() == before
