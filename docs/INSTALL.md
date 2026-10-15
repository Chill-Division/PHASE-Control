# Installation, upgrade and rollback

[Complete user guide](USER_GUIDE.md)

## What gets installed

| Component                  | Where it runs                                                       | Purpose                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| PHASE Control integration  | Home Assistant custom integration                                   | Room/zone configuration, entities, stored strategies, reviewed APIs and the native sidebar workspace.                                       |
| PHASE Controller app       | A Home Assistant app (Settings → Apps)                              | Reads the configuration and sensors, makes irrigation decisions and sequences equipment.                                               |

Install the integration and controller together. HACS, the integration's setup and Settings → Apps are separate steps. The guided links open those screens; they cannot pair devices, prove flow or bypass HA confirmations.

## Requirements

- Home Assistant OS, running Home Assistant 2026.5 or newer.
- HACS for the guided integration download, or access to copy a custom integration manually.
- The controller app installs from Settings → Apps. It is built for amd64 or aarch64 (64-bit only) and brings its own Python 3.12.
- An HA administrator account for Settings → Rooms & hardware and its configuration services.
- Existing HA entities for the actual pump and zone valves, fresh VWC/EC probes and any configured interlocks. This integration maps entities; it does not provision sensor firmware or pair devices.

Install the integration and the controller app at the same version: both carry one version number and are released together, as the [changelog](../CHANGELOG.md) shows.

## Guided installation

1. [Open this repository in HACS](https://my.home-assistant.io/redirect/hacs_repository/?owner=Chill-Division&repository=PHASE-Control&category=integration). Download the integration and restart HA. If HACS is absent, install HACS first or use the manual path below.
2. [Start the PHASE Control config flow](https://my.home-assistant.io/redirect/config_flow_start/?domain=crop_steering). Name the room and say how many zones it has, then map each zone's valve and probes, and give the room's plumbing, lights hours and pot and dripper sizes. Later, **Settings → Rooms & hardware** (step 5) changes the mapping and sizes, and **Irrigation strategy → Today** the lights hours.
3. [Add the app repository](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FChill-Division%2FPHASE-Control). In **Settings → Apps**, install **PHASE Controller**. Keep the affected engine enable flags OFF, review the app options, then start the app so it can publish its heartbeat and discover configuration. From then on it starts with the host (**Start on boot** is on unless you turn it off); turn on **Watchdog** as well, so Supervisor restarts it if it stops. Supervisor supplies the internal HA token; do not paste a token into a repository file.
4. Open **PHASE Control** in the HA sidebar. The integration serves its bundled dashboard automatically; no manual dashboard YAML or custom Lovelace card installation is required. The controller's ingress can also serve the same dashboard. In supported HA shells, use **Home Assistant** at the bottom of the workspace's menu (under ☰ on a phone) to reopen the temporarily collapsed HA sidebar; see [sidebar behavior](HA_SIDEBAR.md).
5. In **Settings → Rooms & hardware**, select or add a room. Name its zones. Search HA entities by friendly name or ID and check their units/current states while mapping valves, VWC probes, EC probes and room equipment. Multiple probes can be selected per zone. Every zone needs its valve. Under **Shared room hardware**, say how the room is plumbed: a tent with one smart plug or solenoid is *Zone valves only* and maps that switch as the zone's valve and nothing else; a room where water only flows while a pump runs is *A pump, then zone valves* and must have the pump chosen. The switches have to match the answer, and the controller holds a room whose switches stop matching rather than watering it with no pump.
6. Enter substrate litres **per plant**, plant count, drippers per plant and each dripper's L/hour.
7. Choose **Review configuration**, then **Save configuration**. Setup validates entity domains, moisture/EC units, duplicate valve assignments, revision conflicts and readable OFF states of the affected engine/equipment. A saved configuration and controller acknowledgement are shown separately; wait for **Mapping acknowledged** instead of assuming a save has already reached the controller.

Steps 2 and 3 can be done in either order. A controller started before any room exists waits, invents no zones, and picks the room up by itself within a minute of setup finishing; no restart is needed.

See the [step-by-step mapping workflow](USER_GUIDE.md#set-up-rooms-zones-and-sensors) for field meanings, revision conflicts and controller adoption.

Room and zone removal means archive. Archived IDs remain reserved, so restoring or adding a zone cannot silently point an old strategy at different hardware. Changing names preserves entity identity. The default room retains its legacy IDs.

## Verify the installation

With engines still off, confirm each room loads in the sidebar, the selected room has a current controller heartbeat, mappings show **Mapping acknowledged**, and **Settings → Rooms & hardware** shows the intended entities with their current readings and units. Open **Irrigation strategy → Today** and verify the existing values. An upgrade should retain each room's current values, zone identities and plant/dripper sizing.

Open **Overview** and a zone detail panel. A room without a reservoir level sensor shows its tank as **Not mapped**; a missing required control sensor or controller acknowledgement needs resolution before commissioning. **Last irrigation** is an event record and may legitimately be absent on a new installation. Do not generate a physical shot just to fill that display.

## Before enabling irrigation

In **Insights → Zone**, verify under **Probe coverage** that every zone's probes give a current reading, and in **Settings → Rooms & hardware** that each mapping reads in the expected units. Set room lights-on/off hours and review the zone's water limits, shot sizes and emergency floor. Check controller heartbeat and any holds. Validate pump/valve physical operation and delivered water on site before enabling an engine. HA state readback alone does not prove water flow.

Start with a reviewed manual configuration, or create a draft in **Irrigation strategy → Schedule**, preview it, save it and arm it. A strategy becomes eligible at the next lights-on boundary. Arming does not switch on the engine. An unsupported/old controller cannot activate a strategy.

## Manual integration install

Copy the entire `custom_components/crop_steering` directory into HA's `/config/custom_components/crop_steering` and restart HA. Include its `www/dashboard.html` file. Then follow steps 2-7 above. Do not copy this repository wholesale into `/config`; historical facility examples are not your configuration.

Developers build the dashboard using `npm ci --prefix frontend` then `npm run build --prefix frontend`. Packaging generates identical self-contained HTML in the integration, controller and web distribution folders. Compiled HTML is a deliverable, not the editing source.

## Upgrading an existing installation

Update an existing controller in place from this repository. A controller installed from another repository moves once, as described in [Moving a controller installed from another repository](#moving-a-controller-installed-from-another-repository). Never run two controllers against one room: each app has its own identity and runtime data, and both would drive the same pump and valves.

1. Back up HA, the controller's persistent data and existing setpoints. Export irrigation strategies if available. Record which engines are enabled.
2. Turn the affected engines off and wait for the pump, mainline and valves to be OFF. Stop the existing controller while replacing software.
3. Refresh your existing app repository and update that controller in place to the release's version. A restart alone does not rebuild an old image. Do not install a second copy. The controller starts with the host unless its **Start on boot** was turned off, so a host restart during the upgrade starts it; with the engines off (step 2) it waters nothing.
4. Download the same version of the integration through HACS and restart HA. Confirm every PHASE Control room finishes loading.
5. Start the controller with engines still off. Verify its version, fresh heartbeat, both room descriptors, sensor readings, setup acknowledgement and strategy capability. Compare current setpoints and pot/dripper sizing with the backup.
6. Restore the engines' previous enabled states after these checks. An upgrade does not require arming a strategy or replacing existing values with defaults.

If an update is missing from Settings → Apps, refresh the repository information there first. Use Update for published versions or Rebuild for a local source installation. HACS and Settings → Apps update separate components.

### Moving a controller installed from another repository

PHASE Control, called Crop Steering before 1.0.2 and PHASE Steering in 1.0.2, started at `JakeTheRabbit/HA-Irrigation-Strategy`, and its controller was also mirrored to `JakeTheRabbit/f2-control`. Supervisor names an app after the repository it came from, so the same controller from another repository is a separate app with its own data: `4cddaccb_f2_control` from this repository, `6db5faba_f2_control` from `JakeTheRabbit/HA-Irrigation-Strategy` and `4d457e60_f2_control` from the mirror.

This repository was `Chill-Division/HA-Irrigation-Strategy` until October 2026, and then for a day `Chill-Division/PHASE-Steering`. A box that added it under one of those names has `f50c47e4_f2_control` or `f99c52b1_f2_control` and nothing to move: GitHub sends the old addresses on to the new one, so it keeps updating in HACS and in Settings → Apps. Leave that repository as it is. Removing it and adding the new address instead would install a second, empty copy of the app.

Moving from another repository is a one-time reinstall that carries the runtime state across:

1. Add this repository in Settings → Apps and install **PHASE Controller** from it. Do not start it, and turn its **Start on boot** off for now: it is on by default, and a host restart before step 6 would otherwise start both apps.
2. Copy the old app's Configuration into the new app: every option.
3. Turn every engine kill switch off and wait until the pump, mainline and valves read OFF.
4. Stop the old app and turn off its Start on boot and Watchdog.
5. Copy `state.json` from the old app's data folder to the new one. It holds each zone's phase, today's counters, the accepted setup revision and what Auto Setpoints has learned; without it the controller starts learning again and waits for setup to be accepted. On HA OS, from an SSH terminal with Docker access: `docker run --rm -v /mnt/data/supervisor/apps/data:/d alpine cp -p /d/6db5faba_f2_control/state.json /d/4cddaccb_f2_control/state.json`, with the old app's name in place of `6db5faba_f2_control` if it came from the mirror (older Supervisor versions use `addons/data`).
6. Start the new app, turn on its Start on boot and Watchdog, and check its log, version, heartbeat and setup acceptance before turning the engines back on.
7. After a day of normal running, uninstall the old app and remove its repository.

The existing app slug `f2_control` and entity IDs are deliberately stable. A room set up from a `crop_steering.env` file keeps working without the file. After upgrade, verify the room descriptor and controller heartbeat, setup acknowledgement and strategy capability before enabling control.

## The tank on the Overview

The Overview's tank is the room's reservoir. Its level comes from the level sensor mapped under **Settings → Rooms & hardware → Reservoir & dosers**, with the distances when full and when empty set on **Feed → Reservoir**; until then it reads **Not mapped** or **Not set up**. The room pump is mapped under **Shared room hardware**, or from **Map sensors** on the tank. **Refill** and **Last refill** need no mapping: they are the controller's own record of the refills it runs for the room's reservoir. See [Tank and pump display](USER_GUIDE.md#tank-and-pump-display).

Save setup with the affected engines and irrigation equipment off, then verify the readings in **Overview** before restoring the previous engine state. Missing mappings remain labelled; an unavailable pump is never displayed as off.

## Restore a prior version

Turn affected engines off and confirm physical equipment is off. Restore the prior integration/controller versions and their matching persistent-state backup. An active irrigation strategy uses a durable required-strategy latch: do not downgrade the controller while expecting it to understand a newer active strategy. Disarm and verify the boundary handoff to manual targets first, or restore a complete known-good backup with engines off.

## If the sidebar or setup is missing

Restart HA after installing the integration. Check integration logs and that `custom_components/crop_steering/www/dashboard.html` exists. Missing workspace services mean Home Assistant is still running the integration it loaded before an update: restart it. A strategy that cannot activate for lack of controller support means the controller app is not running or has not reported yet. Refresh the page after upgrading both components.

The installation links follow the official [Home Assistant app repository format](https://developers.home-assistant.io/docs/apps/repository/) and [configuration flow mechanism](https://developers.home-assistant.io/docs/config_entries_config_flow_handler/). Home Assistant's [frontend theme configuration](https://www.home-assistant.io/integrations/frontend/) supplies inherited theme colors.
