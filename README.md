# PHASE Control for Home Assistant

![Release](https://img.shields.io/badge/Release-1.2.0-blue)
![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2026.5+-41BDF5)
![HACS](https://img.shields.io/badge/HACS-Custom-orange)
![License](https://img.shields.io/badge/License-MIT-green)

**PHASE** stands for **Precision Hydration And Steering Engine**.

PHASE Control waters a grow room automatically. Every minute it reads each zone's moisture and EC probes, decides whether the zone needs a shot and how big, and runs your pump and valves to deliver it, through the four-phase day that crop-steering growers use. It runs inside [Home Assistant](https://www.home-assistant.io/) with the probes, pumps and valves you already have, on your own hardware: no cloud account, no subscription.

**Deterministic, sensor-driven crop steering.** No AI makes any decision. Every shot comes from a published rule and your setpoints: the same readings, settings and day so far always give the same decision, and the dashboard shows the numbers behind each one. Nothing guesses, nothing makes up a reading, and nothing apologises after the fact.

![The Overview: the room's grow day on its clock, what comes next, and each zone's day](https://raw.githubusercontent.com/Chill-Division/PHASE-Control/main/img/operator-dashboard.png)

> **Safety first.** This switches real pumps and valves, unattended, on living plants. Set each room up with watering switched off, check every probe and switch it uses, and do a catch test (measure what the drippers actually deliver) before you let it water. It does not replace physical safety devices: use valves that close when power is lost, and a float switch or timer that can stop a pump on its own.

## Features

- **The four-phase day, for every zone.** P0: the morning dryback. P1: small shots, a few minutes apart, up to your peak target. P2: a top-up whenever moisture falls to your trigger. P3: the overnight dryback, held at your dryback target, with a rescue shot if a zone still gets too dry. The day's counters start again at lights-on.
- **Shots sized from your hardware.** Each zone's pot size, plant count, drippers and dripper flow turn a shot's percentage into litres and seconds, within a daily water limit and a maximum shot length.
- **An irrigation strategy for the whole grow.** Steer each zone week by week, or day by day, between vegetative and generative; the targets change at lights-on. Keep the strategies that worked in a library.
- **The grow day at a glance.** The room's day as a clock, with what comes next, and a card for each zone with its own day. A zone's details chart its phases, shots, holds and setting changes since lights-on, against its targets, yesterday and the projected rest of the day. Every setting change says who made it and what it replaced.
- **One page for a phone, a tablet and a computer.** How a room runs is one choice (Steering, Watching only or Room off), and every page says whether the room follows its schedule or Today's targets.
- **Water use and runs compared.** Litres per zone by day, week and grow, today's water per plant, and this run lined up against an earlier one at the same age.
- **It fails safe.** Every switch it turns off is read back, and one that stays on holds the room and alerts you. A zone whose probe dies follows a working zone, or a cautious timer. An empty room switches off: no watering, no alerts.
- **Alerts you can act on.** Each alert, as a Repairs card or a notification, carries a code (such as CS-601) that the built-in Help explains: what it means, what happens to watering meanwhile, and what to do.
- **Auto setpoints (off by default).** Learns each zone's real peak and drying rates from its own shots, and keeps its targets reachable in small, bounded steps, by fixed rules.
- **Set up without YAML.** Map the valves, pumps and probes you already have from the dashboard. Every save is checked before it applies, and the controller confirms it has picked the change up.
- **A log you can read.** The controller app's log says, every minute and in plain words, what each zone is doing and what it is waiting for.

| Today's targets on the zone's own readings | A strategy for the whole grow | Water use per zone |
| --- | --- | --- |
| ![Today's targets on the zone's recorded moisture and EC, with the projected day](https://raw.githubusercontent.com/Chill-Division/PHASE-Control/main/img/plan-graph.png) | ![A zone's strategy for its days: its steering between vegetative and generative, and the day's moisture and EC targets](https://raw.githubusercontent.com/Chill-Division/PHASE-Control/main/img/grow-plan.png) | ![Today, this week, this grow and an estimate for the whole grow, with litres per grow week](https://raw.githubusercontent.com/Chill-Division/PHASE-Control/main/img/water-use.png) |

| On a phone: the Overview | Today's targets |
| --- | --- |
| ![The Overview on a phone](https://raw.githubusercontent.com/Chill-Division/PHASE-Control/main/img/mobile-overview.png) | ![Today's targets on a phone](https://raw.githubusercontent.com/Chill-Division/PHASE-Control/main/img/mobile-plan.png) |

More in the [screenshots](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/SCREENSHOTS.md).

## What you need

| | |
| --- | --- |
| **Home Assistant** | **2026.5.0 or newer.** Every change is tested on 2026.5.0 and on 2026.9.3. |
| **The controller app** | Home Assistant OS. The controller installs from Settings → Apps; HACS installs the integration. |
| **HACS** | 1.6.0 or newer for the guided download, or copy `custom_components/crop_steering` into Home Assistant by hand. |
| **Hardware** | A smart switch that Home Assistant can control for irrigation (a pump, a valve, whatever you have) and a moisture probe to steer from. Several substrate sensors are ideal. |

## Install

PHASE Control comes in two parts, and watering needs both: the **integration** keeps your rooms, settings and strategies and adds the PHASE Control page to the sidebar, but never switches anything; the **controller app** reads the probes and runs the pump and valves.

| [How to install](https://www.youtube.com/watch?v=Lor93_c-ibU) (2:28) | [How to upgrade](https://www.youtube.com/watch?v=pDjWWWM_XBQ) (1:17) |
| --- | --- |
| [![How to install PHASE Control, a video on YouTube](https://i.ytimg.com/vi/Lor93_c-ibU/hqdefault.jpg)](https://www.youtube.com/watch?v=Lor93_c-ibU) | [![How to upgrade PHASE Control, a video on YouTube](https://i.ytimg.com/vi/pDjWWWM_XBQ/hqdefault.jpg)](https://www.youtube.com/watch?v=pDjWWWM_XBQ) |

1. **Download the integration with HACS**, then restart Home Assistant.
   [![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Chill-Division&repository=PHASE-Control&category=integration)
2. **Add PHASE Control** and name your first room.
   [![Open your Home Assistant instance and start setting up PHASE Control.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=crop_steering)
3. **Add the controller app's repository**, then install and start **PHASE Controller**.
   [![Open your Home Assistant instance and add this app repository.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FChill-Division%2FPHASE-Control)
4. **Open PHASE Control in the sidebar.** Map your valves, pump and probes in **Settings, Rooms & hardware**, check the readings on the **Overview**, and keep watering switched off until everything reads correctly.

**Updating:** both parts carry one version number; update them together. Update the integration in HACS and restart Home Assistant, then press **Update** on the controller app (restarting it alone keeps the old version). Updates keep your rooms, settings, strategies and history. The [install guide](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/INSTALL.md) covers manual installs, upgrades and rolling back.

## Documentation

- [How it works](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/HOW_IT_WORKS.md): why a zone waters when it does, in plain words
- [User guide](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/USER_GUIDE.md) and [planning a grow](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/GROW_PLANS.md)
- [Error codes](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/ERROR_CODES.md) and [troubleshooting](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/troubleshooting.md)
- [Entity reference](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/ENTITIES.md)
- For developers: [how it fits together](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/SYSTEM_OVERVIEW.md), [testing](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/TESTING.md), [releasing](https://github.com/Chill-Division/PHASE-Control/blob/main/docs/RELEASING.md) and [contributing](https://github.com/Chill-Division/PHASE-Control/blob/main/CONTRIBUTING.md)

## Support

Report a problem or ask a question in [GitHub issues](https://github.com/Chill-Division/PHASE-Control/issues). Include the error code if there is one, both version numbers (shown at the top of PHASE Control's **Help** page), and what the controller app's log says.

## Credits

PHASE Control began as [JakeTheRabbit's HA-Irrigation-Strategy](https://github.com/JakeTheRabbit/HA-Irrigation-Strategy), and this project carries it on.

## License

[MIT](https://github.com/Chill-Division/PHASE-Control/blob/main/LICENSE), © 2026 JakeTheRabbit and Chill Division. The dashboard ships the licences of the open-source libraries it is built from, in `THIRD_PARTY_LICENSES.txt` beside it.
