# Entity Reference: Complete Schema

Every entity PHASE Control creates, what it does, its range/options, and
its default: what a new room's entity starts at. Where the setup wizard asks (plant count,
pot size, drippers, lights hours), your answers replace the default. Per-zone entities
scale with your zone count, `N` = 1…zones.

**Conventions**
- **Global** entities set the system-wide default: `…crop_steering_<param>`.
- **Per-zone** entities override the global for one zone: `…crop_steering_zone_N_<param>`.
  Most phase/EC/dryback setpoints exist in **both** forms: the engine uses the
  per-zone value for that zone and falls back to the global otherwise.
- Each room's entities carry its prefix, `<prefix>`: none for the default room (the first one
  set up), `<room slug>_` for each room added after it, e.g.
  `number.crop_steering_veg_zone_1_p2_shot_size`. The tables leave it out.
- The engine reads these by `entity_id`. Renaming a friendly-name in HA or on a
  dashboard does not affect it.
- For a few settings the engine accepts a narrower range than the entity: see
  [Engine ranges](#engine-ranges).

---

## 1. Numbers: global setpoints (`number.crop_steering_*`)

### P0: morning dryback
| Entity | Range | Default | Unit | What it does |
|---|---|---|---|---|
| `p0_dryback_drop_percent` | 1-40 | 3 | % | P0 Additional Dryback: P0 ends once VWC has dropped this far below its highest reading since lights-on, as a % of that reading (Athena's 1–5% before the first shot), unless `p0_maximum_wait_time` or the P2 trigger comes first. A value saved before the controller read it starts at 3. |
| `p0_maximum_wait_time` | 30-600 | 120 | min | Hard ceiling: forces P0 → P1 if the dryback target is never reached. |

### P1: ramp-up
| Entity | Range | Default | Unit | What it does |
|---|---|---|---|---|
| `p1_initial_shot_size` | 0.1-20 | 2 | % | Size of the first ramp shot (% of substrate volume). |
| `p1_shot_size_increment` | 0.05-10 | 0.5 | % | How much each successive shot grows. |
| `p1_minimum_shots` | 1-20 | 3 | - | Minimum shots before P1 may exit. |
| `p1_maximum_shots` | 1-30 | 6 | - | After this many shots P1 exits to P2 even if the target wasn't hit. |
| `p1_target_vwc` | 20-100 | 65 | % | VWC that ends the ramp and moves the zone to P2. |
| `p1_time_between_shots` | 1-60 | 15 | min | Spacing between ramp shots. |

### P2: maintenance
| Entity | Range | Default | Unit | What it does |
|---|---|---|---|---|
| `p2_vwc_threshold` | 10-100 | 60 | % | Shoot a maintenance top-up when VWC falls below this. |
| `p2_shot_size` | 0.5-30 | 5 | % | Size of a P2 maintenance shot. |
| `p2_time_between_shots` | 0-60 | 5 | min | Least time from the last shot to a maintenance top-up, so each can soak down to the probes before moisture is read again (0 = off). EC dilution and flushes wait 45 minutes after the last shot instead, so a settled EC reading can show what the last one did (10 minutes until the zone's first settled reading). |
| `p2_ec_high_threshold` | 0.5-3.0 | 1.2 | ×target | Display only: `p2_vwc_threshold_adjusted` reads 5 points above the trigger while `ec_ratio` is above this. The controller doesn't read it. |
| `p2_ec_low_threshold` | 0.2-2.0 | 0.8 | ×target | Display only: `p2_vwc_threshold_adjusted` reads 5 points under the trigger while `ec_ratio` is below this. The controller doesn't read it. |

### P3: pre-lights-off / overnight
| Entity | Range | Default | Unit | What it does |
|---|---|---|---|---|
| `p3_emergency_vwc_threshold` | 10-65 | 40 | % | Overnight emergency floor: a rescue shot fires below this, beneath the level P3 holds the dryback at. |
| `p3_emergency_shot_size` | 0.1-15 | 2 | % | Size of an emergency rescue shot, and of each P3 shot that holds the dryback target. |
| `p3_time_between_shots` | 0-60 | 10 | min | Least time from the last shot to a P3 shot, a rescue or a hold at the dryback target, so each can soak down to the probes before moisture is read again (0 = off). Without it a zone still reading low after a shot got another one every minute, the rescue included. |

### EC targets: vegetative & generative (per phase)
| Entity | Range | Default | Unit |
|---|---|---|---|
| `ec_target_veg_p0` / `_p1` / `_p2` / `_p3` | 0.5-15 | 3.0 / 3.0 / 3.2 / 3.0 | mS/cm |
| `ec_target_gen_p0` / `_p1` / `_p2` / `_p3` | 0.5-20 | 4.0 / 5.0 / 6.0 / 4.5 | mS/cm |

The controller uses the target for the zone's phase **and** its steering mode, P0 to P2. No
rule uses a P3 target: only the `ec_ratio` sensor reads them.

### EC & safety limits
| Entity | Range | Default | Unit | What it does |
|---|---|---|---|---|
| `maximum_ec` | 1-20 | 9.0 | mS/cm | Anti-lockout ceiling. At or above it a zone gets a high-EC flush in any phase (1.5 to 2.4 times a P2 shot, beyond the daily limit), then waits for it to drain; in P2, from 1 mS/cm under it, a rescue flush. A zone a flush can't dilute (within 2 points of full saturation, or no saltier than the feed: the `feed_ec` of the feed recipe in use, or 3.0 mS/cm without one) gets no shot at all, rescue and watchdog included, until a flush could help or its EC falls under the ceiling (CS-206). |
| `max_shot_duration` | 5-3600 | 900 | s | Longest a single shot may run. The controller refuses to water a room whose cap is unreadable or below 5 s (CS-203); only where the setting does not exist at all does it use 900 s. |
| `watchdog_hours` | 0-12 | 3 | h | Lights-on backstop: a zone below its P2 trigger that has had no water for this long gets a watchdog shot, or an urgent alert (CS-207) when watering is blocked. `0` turns it off. |

### Pump & valves
| Entity | Range | Default | Unit | What it does |
|---|---|---|---|---|
| `pump_prime_time` | 0-20 | 2 | s | How long the pump runs before the main line and the zone valve open, so the line is at pressure when water starts. A shot's time and water count from the zone valve opening. |
| `main_line_lead_time` | 0-10 | 1 | s | How long the main-line valve is open before the zone valve opens. |

### Substrate & schedule
| Entity | Range | Default | Unit | What it does |
|---|---|---|---|---|
| `substrate_volume` | 0.1-200 | 3.2 | L | Substrate volume per plant: converts shot % → mL → valve seconds. |
| `dripper_flow_rate` | 0.1-50 | 4 | L/hr | Per-dripper flow: the other half of the % → seconds conversion. |
| `drippers_per_plant` | 1-20 | 1 | - | Drippers feeding each plant. |
| `field_capacity` | 40-100 | 70 | % | Full saturation. The P1 ramp stops at it (or at the peak target, if lower), the P2 trigger stays at least 1 point under it, and EC flushes need moisture at least 2 points under it. |
| `vegetative_dryback_target` | 5-80 | 35 | % | Overnight dryback target in vegetative mode, % below the day's peak: P3 holds the zone there. |
| `generative_dryback_target` | 5-70 | 45 | % | Overnight dryback target in generative mode, % below the day's peak: P3 holds the zone there. |
| `lights_on_hour` | 0-23 | 12 | hour | Photoperiod start: P3→P0 + daily-counter reset fire here. |
| `lights_off_hour` | 0-23 | 0 | hour | Photoperiod end: zones move to P3. |

---

## 2. Numbers: per-zone overrides (`number.crop_steering_zone_N_*`)

Every zone gets its own copy of the setpoints below. The engine uses the zone's value
for that zone. (3 zones × 24 = 72 entities on a 3-zone system.)

**Per-zone copies of the global setpoints:** `p0_dryback_drop_percent`,
`p0_maximum_wait_time`, `p1_initial_shot_size`, `p1_shot_size_increment`,
`p1_minimum_shots`, `p1_maximum_shots`, `p1_target_vwc`, `p1_time_between_shots`,
`p2_vwc_threshold`, `p2_shot_size`, `p2_time_between_shots`, `p3_emergency_vwc_threshold`,
`p3_emergency_shot_size`, `p3_time_between_shots`, `vegetative_dryback_target`,
`generative_dryback_target`,
`ec_target_veg_p0` to `_p2`, `ec_target_gen_p0` to `_p2`, `field_capacity`,
`maximum_ec` and `watchdog_hours`. Ranges match the globals above.

**Per-zone only (no global equivalent):**
| Entity | Range | Default | Unit | What it does |
|---|---|---|---|---|
| `zone_N_plant_count` | 1-1000 | 4 | - | Plants in the zone: scales total water volume. |
| `zone_N_max_daily_volume` | 0-200 | 20 | L | Daily water budget for the zone. Top-ups, P3 dryback hold shots and EC-correction shots stop at it, and a shot that would cross it gets only what is left; rescues (watchdog, P3 emergency, high-EC flushes) and the P1 ramp are exempt. |
| `zone_N_substrate_volume` / `zone_N_drippers_per_plant` / `zone_N_dripper_flow_rate` | as the globals | from setup | - | Created only when setup sizes the zone itself; otherwise the room-wide value applies. |

### Engine ranges

The controller checks every setting it uses against the engine's range, which for these is
narrower than the entity's. A value outside it runs as the nearest value inside, and a
notification says so (CS-401).

| Setting | The engine uses |
|---|---|
| `p0_maximum_wait_time` | 5-240 min |
| `p1_initial_shot_size` | 0.5-15 % |
| `p1_shot_size_increment` | 0-5 % |
| `p2_shot_size` | 0.5-20 % |
| `p3_emergency_shot_size` | 0.5-15 % |
| `vegetative_dryback_target` / `generative_dryback_target` | 2-60 % |
| `ec_target_veg_p0` to `_p2`, `ec_target_gen_p0` to `_p2` | 0.5-9 mS/cm |
| `maximum_ec` | 3-15 mS/cm |
| `zone_N_max_daily_volume` | 10-2000 L |

A `p1_minimum_shots` above `p1_maximum_shots` runs as the maximum. The maintenance trigger the
engine uses also stays at least 3 points above the rescue level and at least 1 point under the
lower of the peak target and full saturation.

---

## 3. Switches

### Global (`switch.crop_steering_*`)
| Entity | What it does |
|---|---|
| `room_active` | Room on/off (default on). Off = nothing is growing: no irrigation of any kind for this room, including emergency shots and the no-probe fallback schedule, no alerts, repair issues cleared. Per room: `switch.crop_steering_<prefix>room_active`. |
| `auto_setpoints` | Auto Setpoints (default off). On = the controller may rewrite this room's per-zone VWC targets from what it has learned (the peak target, full saturation and the maintenance trigger, never the rescue level), in bounded steps, never while an armed irrigation strategy owns the room. After a ramp that has stopped climbing, it may also raise the zone's P1 EC target just enough for P1 to finish, never above its P2 EC target. Off = it still learns and reports, and writes nothing. Per room: `switch.crop_steering_<prefix>auto_setpoints`. |
| `system_enabled` / `auto_irrigation_enabled` | **Removed.** Retired in 2.25.0 and kept, hidden, until both were removed: setup takes them out of an existing room's registry. `engine_enabled` is the one switch that stops watering, and the controller never reads either. |
| `ec_stacking_enabled` | EC Stacking (default off). On = in P2 the controller moves the maintenance trigger by up to 1 point, at most every 30 minutes, to steer the settled substrate EC toward the P2 EC target: down while EC is under 90% of it (less water, so EC builds), up while it is over 110% (more water, to dilute), never by more than 20% of the trigger. The move goes at lights-on. Off = no new moves. |
| `engine_enabled` | The room's kill switch (**Switch watering on…** / **Switch watering off…** on the dashboard's Overview), created off. Off = the controller waters nothing in this room, and a shot already running stops within a few seconds. Created for named rooms and new default rooms; an older default room keeps the helper its setup names. |
| `auto_batches` | Automatic refills (default off). On = the controller app refills, mixes and doses the room's reservoir by itself once the room's next round of shots would take it under its minimum, three passes in a row, once each time it runs short. Off = a refill only when one is asked for (`mix_batch`: the dashboard's test refill), watering held at the minimum (CS-704), and a reminder to refill by hand at the reminder level (CS-706). Per room: `switch.crop_steering_<prefix>auto_batches`. |
| `notify_predictions` | Include Predictions in Notifications (default on). On = the controller's vitals notification says, under each zone, what it will do next (the dashboard's Next: line). Off = just the readings. Per room: `switch.crop_steering_<prefix>notify_predictions`; Settings → General → Notifications on the dashboard. |

### Per-zone (`switch.crop_steering_zone_N_*`)
| Entity | What it does |
|---|---|
| `zone_N_enabled` | The zone's own switch ("zone scheduling" on the dashboard). Off = the controller waters nothing in this zone, not even a rescue shot, and a shot already running in it stops within a few seconds. |
| `zone_N_manual_override` | Absolute lockout: **nothing** opens that valve (auto, emergency, manual). For maintenance. Switched on, it holds until switched off; `crop_steering.set_manual_override` holds for a set time instead (1-1440 minutes, 60 unless given), and the hold outlasts a restart. Attributes: `manual_override_mode` (`timed`, `indefinite` or `off`) and `manual_override_expires_at`. |

### Button (`button.crop_steering_*`)
| Entity | What it does |
|---|---|
| `mix_batch` | "Mix a Batch Now": asks the controller app for one nutrient batch. Its state is when it was last pressed; the controller starts the batch at its next pass, or says why it cannot (CS-703). With the reservoir's level set up, a refill is refused unless its fill fits (the level plus what the fill adds, once a refill has shown what 1% holds; from 10% or the minimum before that), so it cannot overflow; a press the controller first sees more than 30 minutes later is not acted on. The dashboard's test refill (Settings → Rooms & hardware → Tests) presses it (`feed_mix`); with **Run anyway** (`feed_mix` with `force`), for someone who has checked that the fill fits, the feed plan sensor says so first (`mix_force_until`) and the controller does not refuse that press for a fill that might not fit (one whose level reads nothing it still refuses: half-way through the fill it could not show that the reservoir fills). Per room: `button.crop_steering_<prefix>mix_batch`. |
| `zone_N_test_shot` | "Zone N Test Shot", on the zone's device: asks the controller app to water the zone for 10 seconds, to check that watering works. Its state is when it was last pressed; the controller runs it at its next pass, through every check a shot passes (the watering switches, the zone's switch and manual override, a refill in progress, the reservoir's minimum, the daily water limit) but a held irrigation strategy's. Its water counts toward the zone's day (`daily_vol`); it is not one of the day's shots, and Auto setpoints learns nothing from it. The zone's status reads `Test shot`. A press the controller sees more than 10 minutes later, or the state it finds when it starts, is not acted on. The dashboard's test shot presses it (`test_shot`). Per room: `button.crop_steering_<prefix>zone_N_test_shot`. |

---

## 4. Selects

### Global (`select.crop_steering_*`)
| Entity | Options | What it does |
|---|---|---|
| `steering_mode` | Vegetative · Generative | The room's mode, read by the `ec_ratio` sensor. The controller reads each zone's own `zone_N_steering_mode` instead. |
| `growth_stage` | Vegetative · Generative · Transition | The fallback for a zone whose own steering mode can't be read: only then does the controller read it, Transition counting as Generative. |
| `irrigation_phase` | P0 · P1 · P2 · P3 | A manual phase indicator, read by `current_phase` and `ec_ratio`. The controller keeps each zone's phase itself and does not read it. |
| `recipe_stage` | Veg · Transition · Bulk · Ripen · Custom | Picking a stage applies its setpoints to the zones. |
| `water_today_view` | Zone total · Per plant | How Water today reads for the room: each zone's total, or its water and daily limit divided by its plant count. The dashboard shows it that way for everyone (Settings → General → Appearance), and the controller's vitals notification follows it. Zone total by default. |
| `feed_stage` | The room's feed recipes | The feed recipe the next nutrient batch mixes (Reservoir page): the feed schedule's this week, or one picked by hand. Picking one while the schedule runs holds it until the schedule's next week starts. Unavailable until the room has a feed recipe. |

### Per-zone (`select.crop_steering_zone_N_*`)
| Entity | Options | What it does |
|---|---|---|
| `zone_N_set_phase` | Keep · P0 · P1 · P2 · P3 | Moves the zone to a phase by hand. The controller applies a pick once, within a minute, and sets it back to Keep; its own rules carry on from that phase. Today's water stays, and so does the shot count, except that a move to P1 starts it again: P1 ramps from its first shot. P0 measures its dry-back from the moisture at the move. |
| `zone_N_steering_mode` | Vegetative · Generative | The zone's mode: which dryback target (vegetative or generative) and which set of P0-P2 EC targets the controller uses for the zone. |
| `zone_N_vwc_method` / `zone_N_ec_method` | Average · Median · Lowest · Highest | How the zone's probes become its one moisture reading (`vwc_zone_N`), and separately its one EC reading (`ec_zone_N`), which the controller steers on. Average until chosen. Median differs from the average only with three probes or more. |

---

## 5. Sensors (read-only)

### System (`sensor.crop_steering_*`)
| Entity | Unit | What it reports |
|---|---|---|
| `activity_log` | - | The newest line of a rolling feed of shots, holds and phases moved by hand (`idle` before the first). Attribute `feed`: the newest 50 lines; `event_count`: how many are kept (up to 60). One feed covers every room, a named room's lines tagged with its slug. |
| `app_current_phase` | - | Published by the controller: each zone's phase (e.g. `Z1:P3, Z2:P3, Z3:P3`). |
| `current_phase` | - | The same, as the integration shows it: `app_current_phase`, else the `irrigation_phase` select. |
| `current_decision` | - | What the controller decided this cycle. |
| `app_status` | - | The controller's state for the room: `safe_idle`, `irrigating` (a shot running), `error` (a hardware fault, or a room held fail-closed) or `room_off`. |
| `system_safety_status` | - | `safe`, `warning` or `unsafe`, from the zones' safety labels (`zone_N_safety_status`). Attributes `unsafe_zones`, `warning_zones` and `safe_zones`: how many of each. |
| `ai_heartbeat` | - | The controller's heartbeat for the room: `healthy` each pass, `stopped` (with `stopped_at`) when the app stops. Attribute `controller_version`: the controller app that is actually running (shown in the dashboard sidebar beside the descriptor's `integration_version`). |
| `engine_config` | - | The room's descriptor: what the controller reads to find and drive the room (valves, pump, main line, kill switch, zones, `setup_revision`). Attribute `integration_version`: the integration Home Assistant actually loaded. Attribute `entry_id`: WHICH room this is. A room that is deleted and set up again keeps its entity ids and starts its revision again at 1, so this is how a running controller tells it from the room it already adopted; it then adopts the new setup through the usual gate (kill switch and hardware OFF). Neither attribute enters the setup fingerprint. |
| `configured_avg_vwc` / `configured_avg_ec` | % / mS/cm | Means across every mapped zone probe. |
| `ec_ratio` | - | Display only: the room's average EC ÷ the EC target for the `irrigation_phase` select's phase and the room's `steering_mode`. |
| `p1_shot_duration_seconds` / `p2_shot_duration_seconds` / `p3_shot_duration_seconds` | s | How long the controller runs each phase's shot as set (P1's first ramp shot, the maintenance shot, the rescue shot), before EC scales it: from each zone's pot size, drippers per plant and dripper flow, in whole seconds, at least 5 and at most `max_shot_duration`. The longest of the room's zones; attribute `zones`: each zone's. |
| `p2_vwc_threshold_adjusted` | % | Display only: the room's `p2_vwc_threshold`, 5 points higher while `ec_ratio` is above `p2_ec_high_threshold` and 5 lower while it is under `p2_ec_low_threshold`. The controller's trigger is each zone's own, moved only by EC stacking. |
| `stock_low` | - | How many of the room's stock tanks are at or below their low mark (0 when none). Attribute `tanks`: each tank's `name`, `level_l`, `capacity_l`, `percent`, `low_l`, `dose_ml` (what one batch takes now: what the feed recipe in use gives from its doser; 0 on none), `doser` (the Reservoir doser it is on, or null), `batches_left` and `low`. Attribute `last_batch`: the newest batch counted. The tanks are kept by the integration (Feed → Stock tanks, or the `stock_get`, `stock_save` and `stock_refill` services): each is its name, capacity, level, low mark and doser. A tank on a Reservoir doser loses what that doser gave in each batch the controller mixes; one on none changes only when it is refilled or its level is set. Automate a phone alert on it going above 0. |
| `feed_plan` | - | What the room's next nutrient batch runs, from the Reservoir page: the stage's recipe name, or `none`. Attributes: `stage`, `stage_id`, `feed_ec` (the EC the stage's recipe mixes to, mS/cm, or null when it gives none: the controller's feed EC for its flush and dilution tests), `fill_s`, `batch_l` (the litres the fill adds), `full_mm` and `empty_mm` (the level sensor's distance to the water when full and when empty; 0 = not set), `min_pct` (the minimum the reservoir keeps; 0 = off), `remind_pct` (the level a reminder to refill by hand comes at, CS-706; 0 = off), `pause_s`, `mix_s`, `doses` (each `doser`, `label`, `ml`, to the whole mL, and `seconds`, in the order of the stage's recipe) and `problem` (why no batch can run, or null), with the settings' `revision`, and `mix_force_until` (for two minutes after a test refill run anyway, until when; otherwise null). The feed schedule: `week` (its week today, null when none runs), `weeks` (how many it has), `schedule_start` (the day Week 1 starts), `held_until` (until when a stage picked by hand holds over it, or null) and `source` (`schedule`, `held` or `hand`); the sensor is rewritten at Home Assistant's midnight, when a new week may start. The integration keeps the settings (`feed_get` / `feed_save`); the controller app runs batches from this. |
| `batch_status` | - | Published by the controller app for a room with a reservoir mapped: `idle`, or the step of the refill running (`filling`, then from half-way `filling_mixing` with the pump and recirculation on, for one pause before the first dose, then `dosing`, `pausing`, and `mixing` after the last dose, until the fill's end and at least its recirculation time). The fresh water runs until the fill's end whatever the step, so the doses go in while it fills. Attributes: `stage`, `until` (when the step ends), `fill_until` (when the fresh water stops; null once it has), `doser` and `nutrient` (while dosing), `doses` (the plan's doses, each with `dosed`: the mL it gave), `level_mm`, `level_pct` (how full, %; both null when the sensor reads nothing: unavailable, unknown or not a number), `full_mm`, `empty_mm`, `min_pct`, `litres_per_pct` (what 1% holds, learned from refills; null before one), `due` (whether the room's next round of shots would take it under its minimum; null when it can't tell), `next_round_l` (that round's litres), `auto`, `armed` (false after an automatic refill until it reads enough again), `last` (`at`, `result`: `done` or `stopped: <why>`, `stage`, `dosed`), `blocked` (why no batch could start now) and `updated`. |

The controller also publishes `sensor.f2_control_vitals`: the time of its last vitals report, with the report in the `vitals` attribute.

### Per-zone (`sensor.crop_steering_zone_N_*`)
| Entity | Unit | What it reports |
|---|---|---|
| `vwc_zone_N` | % | The zone's substrate moisture from its probes, combined as `zone_N_vwc_method` says (`zone_N_vwc` on older installs). Attributes: `probes` (each probe's reading), `combined` (what Average, Median, Lowest and Highest give now) and `method`. |
| `ec_zone_N` | mS/cm | The zone's pore-water EC from its probes, combined as `zone_N_ec_method` says (`zone_N_ec` on older installs), with the same attributes. |
| `zone_N_phase` | - | The zone's current phase (P0-P3). |
| `zone_N_auto_setpoints` | - | Published by the controller: `off` / `learning` / `tracking` / `frozen`. Attributes: `learned_peak`, `gain`, `day_rate`, `night_rate`, `p1_outcome` (`pending` / `reached` / `short` / `plateau` / `suspect`), `hold_days`, `frozen_reason`, `last_change`, `managed` (the number entities it may rewrite), `dryback_note` (today's plan, when the P3 dryback target is out of reach: at the zone's uptake, or under the rescue level, which stops it), `p2_stop` (when today's plan stops maintenance shots for the dryback, `HH:MM`; the dashboard labels the maintenance trigger after it "Maintenance stopped"). |
| `zone_N_status` / `_status_app` | - | The controller's label for the zone, published on `zone_N_status_app` with a `reason` attribute and shown by `zone_N_status`, its only writer: `Drying back` / `Ramping` / `Optimal` / `Overnight dryback` (P0-P3, holding), `Flushing` / `Refilling` / `Topping up` / `Emergency` / `Holding dryback` (watering), `Blocked: <why>`, `Blocked — EC/cap`, `Probe dead — copying`, `Room off`. `Controller not reporting` when the controller has not reported for 10 minutes. |
| `zone_N_waiting_for_app` | - | Published by the controller each minute: what would move the zone next, by the engine's own rules and numbers (`crop_steering_engine.waiting_for`), shown as the zone's "Next:" on the dashboard. State: the phase the list is for (`none`, with an empty list, while the zone has no usable probe or the room is off). Attribute `conditions`, one item per rule: `rule` (`p0_timeout` / `p0_bypass` / `p0_dryback`, `p1_ramp` / `p1_done` / `p1_max_shots`, `p2_topup` / `p2_dilute` / `lights_off`, `p3_emergency` / `p3_hold` / `lights_on`), `shot` (it fires a shot), `to` (the phase it moves to), then a reading test (`metric` `vwc` or `ec`, `op`, `value`, `now`) or a wait (`in_min`, minutes after `at`); `p1_done` adds `shots_left`, `ec_max`, `ec_now`; `p3_hold` adds `dryback`, the P3 dryback target its level is worked out from. Attribute `at`: when it was worked out. It lists the engine's routine rules, not a forecast: a held irrigation strategy leaves out the shots it stops; the EC flushes, the watchdog and P2's early move to P3 in the last three hours before lights-off are not listed; a gate or switch that holds watering is in `zone_N_status`. |
| `zone_N_safety_status` | - | `safe`, or what is not: `over_saturated` (at full saturation or above), `ec_limit_exceeded` (at the maximum EC or above), `approaching_saturation` (within 5 points), `approaching_ec_limit` (within 1 mS/cm) or `ec_unknown`. |
| `zone_N_daily_water_usage` / `_daily_water_app` | L | Water today (resets at lights-on). |
| `zone_N_weekly_water_usage` / `_weekly_water_app` | L | Rolling 7-day water. |
| `zone_N_irrigation_count_today` / `_irrigation_count_app` | - | Shots today since the ramp began (the count starts again at P1), test shots left out. |
| `zone_N_last_irrigation` / `_last_irrigation_app` | - | Last shot timestamp. |
| `zone_N_vmax_detected` | % | Advisory: the highest moisture the zone reached in its P1 wet-up, with a `confidence` attribute. Nothing tunes from it. |
| `prediction_zone_N_next_irrigation_hours` | h | Hours to the next P2 shot, published only when it can be worked out. |

> Note: a few `…_app` sensors are engine-published mirrors of the integration sensors;
> prefer the engine `…_app` value when the two differ.

---

## 6. Hardware (your own switches/sensors: mapped in Rooms & hardware, not created here)

The pump, mainline solenoid, per-zone valve switches, and the raw VWC/EC sensors are **your**
existing HA entities. Map them in the PHASE Control sidebar under
**Settings → Rooms & hardware**: the controller drives what the room's setup maps, and with nothing mapped
it holds every zone and says so. (The controller also reads a `hardware` map from its options
file, for tests and hand-built development setups only: the app's Configuration tab doesn't
offer it, and Supervisor rejects it as an unknown option.)

For nutrient batches, the room's **Reservoir & dosers** card maps the reservoir's level sensor (an
ultrasonic distance sensor on the lid: the distance down to the water, in mm, cm or m), the
fresh-water solenoid, the recirculation solenoid and up to six dosers (each doser's power switch).
Each needs a switch of its own, which is not the pump, the main line, the waste valve or a zone's
valve; the controller app switches them only in a batch, and the dashboard never switches them
directly. A batch also runs the room's pump.
