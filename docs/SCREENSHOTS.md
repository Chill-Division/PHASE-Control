# Current workspace screenshots

Captured in October 2026 from the compiled application with isolated demo data, in the light theme the dashboard opens in, on a laptop and on a phone. These are current UI examples, not photographs or live facility readings.

## Overview

![Overview](../img/operator-dashboard.png)

## Feed: the tank and pump

![The tank's level, its level over the last 24 hours, the pump, and the controller's refills](../img/tank-status.png)

## Insights: water use per zone

![Today, this week, this grow and an estimate for the whole grow, with litres per grow week](../img/water-use.png)

## Feed: Reservoir

![Nutrient batches: a refill's steps (the doses go in while it fills), the reservoir level and its minimum, automatic refills and the feed stage in use](../img/reservoir.png)

## Feed: Stock tanks

![Nutrient stock tanks with their levels, low marks and batches left](../img/stock-tanks.png)

## Irrigation strategy: Schedule and combined VWC/EC curve

![Zone planning and steering controls](../img/grow-plan.png)

## Irrigation strategy: Today, with the recorded zone and the projected day

![Targets, recorded VWC/EC and the projected P0-P3 day on one graph](../img/plan-graph.png)

## Recorded sensor history beside the setpoints

![24 h / 72 h / 7 d probe history with setpoint lines, peaks and troughs](../img/sensor-history.png)

## Irrigation strategy: Today beside its graph

![Saved and draft targets with the review bar](../img/manual-setpoints.png)

## Room switched off

![Room off: readings shown, no irrigation and no alerts](../img/room-off.png)

## Insights: Compare runs

![Compare VWC and EC over the same grow age](../img/run-comparison.png)

## User-authored strategy library

![Save and reuse your own strategies as local drafts](../img/recipe-library.png)

## Settings: Rooms & hardware

![Rooms & hardware](../img/rooms-setup.png)

## On a phone

| The Overview | Feed: Reservoir | Irrigation strategy: Today |
| --- | --- | --- |
| ![The Overview on a phone](../img/mobile-overview.png) | ![The Reservoir on a phone: a batch's steps, the doses inside Fill and mix](../img/mobile-reservoir.png) | ![Today's targets on a phone](../img/mobile-plan.png) |

Reproduce these captures by building the frontend and running the browser checks in `frontend/scripts/` (`verify-workspace.mjs`, `verify-steering-visuals.mjs`, `verify-dashboard.mjs`, `verify-tank-status.mjs` and `verify-recipe-library.mjs`); each writes its screenshots into `img/`, in the light theme, even where its own checks run dark (`light-shot.mjs`). The demo keeps the real time of day: take them in the early afternoon, when the day is under way, or set the browser's clock there with `TZ` (for example `TZ=Asia/Dubai` at 10:30 UTC). The README links these images at their address on `Chill-Division/PHASE-Control`, so HACS, which shows the README, shows them too.
