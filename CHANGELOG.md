# Changelog

All notable changes to PHASE Control (Crop Steering before 1.0.2, PHASE Steering in 1.0.2) will be
documented in this file.

**Two views per release.** Each version leads with what changed and why it matters, written so
anyone can follow it without knowing the internals, followed by **🔧 Technical notes**, the entity-
and code-level detail for developers and AI agents working on the repo.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- **One Home Assistant button.** The top bar's house button is gone, and the room and page move
  left into its space. Home Assistant's menu opens from **Home Assistant** at the foot of the side
  menu, under ☰ on a phone, as it already could.
- **No hidden switch can stop watering.** Two on/off switches left over from older versions,
  System Enabled and Auto Irrigation Enabled, are gone. Hidden in Home Assistant, either one, off,
  kept a room from watering: switching watering on in PHASE Control never lasted, and only Home
  Assistant could put it right. Now only the room's own Watering switch turns watering on and off.
- **Old controls that did nothing are gone.** Home Assistant no longer shows a room-level
  Irrigation Phase, a Strategy Stage, two P2 EC thresholds, two P3 EC targets or the three
  readings worked out from them. None of them watered anything; a Strategy Stage picked in
  Home Assistant rewrote every zone's targets, past the dashboard's review. Today, the Schedule and
  saved strategies are where targets change.
- **Rooms & hardware asks only for what the controller uses.** The Room lights picker is gone:
  nothing ever read it, and day and night come from the lights-on and lights-off times (Irrigation
  strategy → Today → the whole room). Home Assistant's own setup form no longer asks for a waste
  valve either, which nothing ever switched. A room that recorded either loses it on its next save.
- **The dashboard can set everything the controller reads.** EC stacking switches on and off
  beside Auto setpoints on Today, and the P1 card has **Minimum P1 shots**. A zone paused by hand
  in Home Assistant now says so, with until when, and its details can resume it. All three were
  only in Home Assistant. **Most P1 shots** is now **Maximum P1 shots**, so the pair reads alike.

### 🔧 Technical notes

- Dashboard: the top bar no longer has the HA shell's menu button ("Open Home Assistant menu"); the
  sidebar footer's **Home Assistant** button, in the desktop sidebar and the phone's sheet, is the
  one way to `haShell.toggle()`. `verify-ha-shell.mjs` opens HA's menu from the sidebar at 1440 px
  and from the sheet at 390 px, and fails if the top bar has a Home Assistant button. The sidebar
  docs (`HA_SIDEBAR.md`, `INSTALL.md`, `USER_GUIDE.md`) say where the button is.
- Integration: `switch.crop_steering_<prefix>system_enabled` and `…auto_irrigation_enabled`, retired
  in 2.25.0 and kept hidden for controllers from 2.24.0 or before, are no longer created, and setup
  removes them from an existing room's entity registry (`_RETIRED`). `tests_ha/test_retired_switches.py`
  proves a new room has neither and an upgraded room loses both.
- Controller: `RETIRED_SWITCHES` and `_carry_retired_switches` are gone, so one an older integration
  left behind, off, neither holds a shot nor switches the engine switch off; CS-208 leaves the
  error-code list, and CS-207 no longer names Auto Irrigation among its causes.
- Dashboard: the status line no longer says "Not watering" for an off retired switch.
- Integration: the room-level `select.crop_steering_<prefix>irrigation_phase` and `…recipe_stage`,
  the `apply_recipe` / `save_recipe` services and `recipe.py` (the per-room recipe Store, left on
  disk, unread), `number.…p2_ec_high_threshold`, `…p2_ec_low_threshold`, `…ec_target_veg_p3` and
  `…ec_target_gen_p3`, and `sensor.…current_phase`, `…ec_ratio` and `…p2_vwc_threshold_adjusted`
  are no longer created, and setup removes them from an existing room's entity registry
  (`_RETIRED`). `tests_ha/test_removed_leftovers.py` proves a new room has none of them and an
  upgraded room loses all of them, with its EC targets kept.
- Integration: `light_entity` and `waste_switch` leave `HARDWARE_DOMAINS`, the configure flow's
  hardware step and its strings, and join `RETIRED_HARDWARE`, so a setup save drops them, and so
  does a save of the configure flow's zones and hardware. The pump and main line no longer need to
  differ from a waste valve, and setup offers no light entities as candidates.
  `tests_ha/test_configure.py` proves the form no longer asks for them and an older room's go on
  its next save.
- Dashboard: Rooms & hardware has no Room lights picker, and its batch-switch check no longer
  names a waste valve; the setup-change words (`setup-changes.ts`, from `HARDWARE_WORDS`) drop both.
- Dashboard: the model reads the room's `switch.crop_steering_<prefix>ec_stacking_enabled`
  (`RoomView.ecStacking`, added to the write allowlist) and each zone's `…zone_N_manual_override`
  (`Zone.override`, `overrideUntil` from `manual_override_expires_at`). `EcStackingControl`
  (`room-controls.tsx`) sits on Today beside `AutoSetpointsControl`. `OverridePill` and
  `ZoneOverrideReview` (`dashboard.tsx`) show the pause and switch the override off.
  `p1_minimum_shots` joins `ZONE_PARAMETERS`, with its words. The demo has both new controls.
- Controller: `log_words.SETTING_NAMES` names `p1_minimum_shots` "Minimum P1 shots" and
  `p1_maximum_shots` "Maximum P1 shots" (was "Most P1 shots"), as the dashboard's `setting-words.ts`
  does (`tests/test_log_words.py` holds the two together).

## [1.2.0] - 2026-10-16

Integration and controller **1.2.0**.

- Each zone on the Overview has a ⋯ menu: move it to another phase, pause it, edit its strategy or open its details.
- Each percentage on Today and the Schedule is marked as a moisture reading or a share of something else.
- Saving Rooms & hardware lists only what you changed, not the whole room.
- Bug fixes and improvements.

### 🔧 Technical notes

- Scripts: `release.py --public` checks that the public main is behind the release before saying
  what it would push, in a dry run too, as `--sync` does, with one check for both
  (`fast_forward_refusal`). For 1.1.1 the dry run said it would push and the push was refused: a
  commit had been made straight on the public repository. The refusal says how such a change comes
  back through this one.
- Dashboard: `ZoneActions`, a non-modal `DropdownMenu` (a new shadcn `ui/dropdown-menu.tsx` on Radix)
  at the end of each row of the Overview's zones table and beside each zone's title on a phone.
  Its phase moves and its pause or enable go through the same reviews as the zone's details
  (`ZonePhaseReview`, `ZoneSchedulingReview`, now shared). The compact table's inner cell padding
  is 8 px a side (12 at its edges) so the new column fits at 1440 px, and the column is sticky at
  the right edge where the table scrolls sideways (1280 px and narrower). `verify-dashboard.mjs`
  checks the menu's items, its accessibility, that a phase move is reviewed first and that the last
  item opens the details.
- Dashboard: `SettingWords` gains `scale` ("absolute" or "relative") and `scaleOf` for each of the
  eleven percentage settings, with `SCALE_WORDS` and `scaleTitle`. `ScaleMark`, `ScaleMarkFor` and
  `ScaleLegend` (`components/scale-mark.tsx`) draw them beside Today's inputs, on the read-only
  scheduled targets and by the Schedule's profile rows; Today's input column is 28 px wider for
  the mark (143 px, 138 under 620 px). `setting-words.test.ts` reads the integration's own
  `PERCENTAGE` numbers from `number.py` and fails a new one without a mark.
- Dashboard: the daily water limit and the watchdog interval have a "?" explainer; the daily limit's
  field shows its per-plant share from the zone's plant count. The demo room has a watchdog
  interval. `buildRoom` lists only the zones' `steering_mode` selects, so Today never offers the
  room's, and a targets file no longer writes it (an older file's is skipped on import).
- Dashboard: `setupChanges` (`lib/setup-changes.ts`) words a save's changes as the integration's
  `setup_changes` does for the logbook, and Rooms & hardware's review of an existing room lists
  them, with the whole room in a folded `<details>`; a new room's review still shows the whole room.
  `tests/fixtures/setup_changes.json` holds cases that `tests/test_setup_changes.py` and
  `setup-changes.test.ts` both run, and the vitest reads `HARDWARE_WORDS` and `ZONE_WORDS` from
  `setup_api.py`. `verify-workspace.mjs` renames a zone and checks the review lists only that.
- Dashboard: the grow day's lanes give a valve-open time's water as the room's Water today view
  reads (`Lane.water`, from `useWaterView`): each plant's mL from its drippers' flow, or the zone's
  litres. Today's events, yesterday's shot marks and the Predictions line use it.
  `verify-dashboard.mjs`'s per-plant check reads them in both views.

## [1.1.1] - 2026-10-12

Integration and controller **1.1.1**.

- Overnight shots now wait 10 minutes after the last one, so the water reaches the probe before the next. Change it with Time between P3 shots on the P3 card.
- Bug fixes and improvements.

### 🔧 Technical notes

- Engine: `ZoneParams.p3_time_between_min`. `decide()` fires a P3 rescue (`p3_emergency`) or dryback
  hold (`p3_hold`) only once `minutes_since_shot` reaches it, and `waiting_for()` gives each an
  `in_min`; 0 turns it off. Unset (`None`), both behave as before: a hold waits
  `p2_time_between_min` and a rescue nothing (`p3_gaps()`). `validate_params` keeps it to 0-120.
  The app's vendored copy matches.
- Integration: `number.crop_steering_p3_time_between_shots` and a per-zone
  `number.crop_steering_zone_N_p3_time_between_shots`, 0-60 minutes, 10 by default. An upgraded
  room gains both at 10 (`tests_ha/test_p3_time_between_shots.py`, on a fresh install and the
  seeded 2.17 room).
- Controller: `_params` reads it as an optional setting (the zone's, the room's, then 10), so under
  an older integration it waters with 10 minutes and holds nothing for a missing setting. The
  vitals' Next line and the dashboard's say when a waiting rescue may fire ("rescue shot at 07:42
  (VWC 44.2% under 45%)"). The engine twin and the log's setting names have it.
- Dashboard: Time between P3 shots on Today's P3 card, with what it does and how to choose it. The
  P2 time's words no longer claim the P3 hold. Help's P3 entry and How it works say how P3 shots are
  spaced, and why several close together overshoot.
- Dashboard: `PlanningCurve` drags by the pointer's travel since it took hold (`grab`: its
  `clientY`, its position in the chart's units and the SVG's scale at pointerdown), not by where it
  is over the chart, which can move. While a target is held, the page scrolls back each frame by
  however far the chart slid (`heldTop`), and the dryback sentence and the projected-day notes keep
  their words until release (`heldWords`). Scrolled to the end, the sticky preview is held by its
  foot, so every height change in the left column (the dragged field turning into a draft is 51 px
  shorter) or in the notes moved the chart. `verify-steering-visuals.mjs` drags the maintenance
  trigger 80 px with the page scrolled to the end and holds the chart within 2 px and the target
  within 4 px of the pointer; it fails on the code before.

## [1.1.0] - 2026-10-10

Integration and controller **1.1.0**.

- Export your room's targets from Today and import them into another room, or send them to someone.
- The Schedule page now explains how a schedule and Today's targets take turns, and which one is in charge.
- When a pump or valve doesn't switch off, the alert names it and says what it read, and its zones show as blocked.
- Bug fixes and improvements.

### 🔧 Technical notes

- Integration: the zones' `DeviceInfo` no longer passes `via_device`, deprecated in Home Assistant
  2026.9 and removed in 2027.8.0. `_link_zone_devices` sets each zone device's `via_device_id` to its
  room's device once the platforms are set up, which works on every supported Home Assistant
  (2026.5 on); a zone an older version linked is left as it is. Proven in
  `tests_ha/test_zone_devices_under_the_room.py` on a fresh install and a seeded old one (2026.5 and
  2026.9), where the old code logged the warning.
- Controller: `_close_failures` and `_switch_off_failures` keep each switch that did not read OFF
  after a close and how (`CLOSE_FAILURES`: Home Assistant refused, still ON, unavailable, unknown,
  unreadable, or OFF only after the read-back gave up). The hardware fault keeps them (`switches`,
  saved in `/data/state.json`; a fault saved before has none, and still loads and holds). The CS-301
  notification leads with them, and `_hardware_fault_block`, the heartbeat's `hardware_fault` and the
  zone's status, reads "hardware fault (CS-301): zone 1 shot end: Pump (switch.pump) still read ON
  6 s after it was switched off", without the internal room name, an entity id to switch or "re-arm".
  The hold, what clears it and the 6 s read-back are as before. Each zone's status
  (`zone_N_status_app`) says "Blocked: hardware fault (CS-301)" for as long as the fault holds the
  room (`_hardware_fault_short`), not only in a pass where the zone wanted water: it used to read its
  phase ("Optimal" in P2) the rest of the time.
- Dashboard: the room's card is "Watering stopped: a pump or valve didn't switch off (CS-301)" with
  the controller's words (`hardwareFaultWords`, which also tidies an older controller's), and a zone
  blocked by it raises no second card. Every zone of a held room reads "Blocked: hardware fault
  (CS-301)", whatever its phase, and a code in a zone's status never breaks at its hyphen. The
  CS-301 entry in the error codes says the alert names the switch.
- Tests: `addons/f2_control/tests/test_hardware_fault_names.py`,
  `tests_ha/test_hardware_fault_names_the_switch.py` (2026.5 and 2026.9) and `room-status.test.ts`.
  The controller tests' fake Home Assistant keeps a switch's attributes when it switches, as Home
  Assistant does.
- Dashboard: `lib/schedule-words.ts` says, from `strategy.py` and `strategy_runtime.py`, what each
  schedule status means: Not armed, Armed, Running, Disarming, Held. Schedule's status card says
  it, with when an arm or disarm takes effect (`armed_after`, `disarm_after`), above four steps
  with the current one marked and "What takes priority"; its arm and disarm dialogs and notices
  name Today's targets instead of "legacy setpoints". Today's description and note follow the
  schedule's status. The demo publishes its schedule's status as
  `sensor.crop_steering_<prefix>strategy_plan`, as the integration does. Nothing changes in how the
  integration or the controller runs a schedule.
- Dashboard: `lib/targets-file.ts`, format `phase-control-targets` version 1. It holds the room's
  settings and each zone's by setting key and zone number, so a file fits a room with another
  prefix, and each steering mode. Pot size, plants and drippers are never written; lights hours,
  the pump and main-line timings and the room's longest shot are written but never loaded. A value
  off a setting's step is rounded to the nearest it takes and one outside its limits is skipped,
  both said. Import only fills Today's draft and waits while one is open; neither button works
  while a schedule is engaged. Tests: `targets-file.test.ts` and the dashboard browser check.

## [1.0.3] - 2026-10-09

Integration and controller **1.0.3**.

- **PHASE Steering is now PHASE Control**, and its app PHASE Controller: PHASE already stands for
  Precision Hydration And Steering Engine, so the name no longer says steering twice. Help says
  what PHASE stands for.
- **The project's address is now github.com/Chill-Division/PHASE-Control.** The old addresses keep
  working, so a Home Assistant that already has one needs no change: leave it as it is.

### 🔧 Technical notes

- Names only. `const.PRODUCT_NAME` is PHASE Control: the sidebar entry, the room's device, the
  zones' entity names, the setup wizard's default name, `manifest.json` and `hacs.json`. The app
  is PHASE Controller, its panel and `repository.yaml` PHASE Control. The menu reads PHASE Control
  over "Crop steering", and Help → Terms & phases opens with PHASE. The setup and Repairs texts,
  the error codes, the alerts, the docs and the logos say the same. No entity id, the domain, the
  `f2_control` slug, the app's options and `/data` or the file formats change. Home Assistant
  renames the device and the entities' default names in place, from Crop Steering or from 1.0.2's
  PHASE Steering, and keeps any name the operator gave (`tests_ha/test_product_name.py`).
- The controller leaves a room still at the wizard's default name out of alerts, whichever release
  set it up: `DEFAULT_ROOM_NAMES` adds "phase control" and keeps "phase steering".
- Both repositories were renamed on 2026-10-09, from `HA-Irrigation-Strategy` to `PHASE-Steering`
  and the same day to `PHASE-Control` (`Chill-Division/…` and `ChillingSilence/…`). GitHub redirects
  every old address for the web, its API and git. HACS records a rename itself
  (`renamed_repositories` in its source), and the Supervisor's `git ls-remote` and `git fetch`
  follow the redirect. The Supervisor names the app after the address it was added from:
  `f50c47e4_f2_control` (HA-Irrigation-Strategy), `f99c52b1_f2_control` (PHASE-Steering),
  `4cddaccb_f2_control` (PHASE-Control). Swapping one address for another is a move
  ([INSTALL.md](docs/INSTALL.md)), not an update. No repository may ever take an old name.
- Links: `manifest.json` (documentation, issue tracker), the Repairs cards' Learn more
  (`const.REPAIRS_DOCS_URL`), What's new's release notes, the app's `config.yaml`, `repository.yaml`
  and DOCS.md, the README's links, badges and pictures, the docs, and `release.py`'s `PUBLIC`.
  `tests/test_repository_links.py` keeps every link on the current name.
- 1.0.3 was first released with only the links to PHASE-Steering. It was withdrawn the same day
  and this release took its number ([RELEASING.md](docs/RELEASING.md), Versions). A box that took
  that first 1.0.3 is offered nothing for this one: Redownload in HACS and Rebuild the app.

## [1.0.2] - 2026-10-09

Integration and controller **1.0.2**.

- **Crop Steering is now PHASE Steering**, short for Precision Hydration And Steering Engine, with
  a new icon: the day's four phases around a drop of water. Nothing else changes: your rooms,
  settings, strategies, history and automations carry on as they were.

### 🔧 Technical notes

- Names only. The integration (`manifest.json`, `hacs.json`), its sidebar entry (now
  `mdi:water-circle`), the room's device, the zones' entity names (`PHASE Steering Zone N …`), the
  setup wizard's default name, the setup and Repairs texts, the error codes, the dashboard, the
  controller app (`PHASE Steering Controller`, its panel and `repository.yaml`) and the brand images.
  The integration keeps the name in one place, `const.PRODUCT_NAME`.
- Unchanged: the `crop_steering` domain, every entity id, the `f2_control` slug and the app's
  options and `/data`, the sidebar's address, the strategy and feed recipe file formats and the
  repository's address.
- The room's device had two names, "Crop Steering System" from the sensors and "Crop Steering" from
  the other platforms, whichever registered last; it has one, PHASE Steering. Home Assistant renames
  the device and the entities' default names in place, and keeps any name the operator gave either.
  From 2026.9 Home Assistant shows the device's name in front of each entity's, so a room's entities
  read "PHASE Steering …" there.
- Controller: the vitals notifications are titled "PHASE Steering vitals" where the app's
  "Name in notifications" option was never changed. A room left at the wizard's default name
  (PHASE Steering, or Crop Steering System before) is still left out of alerts
  (`DEFAULT_ROOM_NAMES`).
- Tests: `tests_ha/test_product_name.py` (a fresh install, and a seeded old install updated in
  place: the device and names follow, no id moves, the operator's device name stays) and a real
  wizard left at its default name in `tests_ha/test_alerts_name_the_zone.py`.

## [1.0.1] - 2026-10-08

Integration and controller **1.0.1**.

- **Unified naming of Irrigation Strategy and Feed Recipes.**
- **Feed EC now set per-recipe** to allow for steering at lower EC rootzones, defaults to 3.0EC
  where not set.
- Bug fixes and improvements.

### 🔧 Technical notes

- Docs: `docs/HOW_IT_WORKS.md`, linked first in the README's Documentation and from the user guide.
  Every rule in it is the one the engine, the controller or Auto setpoints applies, and its pictures
  are the README's own screenshots.
- Release: `scripts/release.py --sync` fast-forwards the public `main` to `main` here once Validate
  has passed on it, with no version, tag or release. `sync_refusal` refuses when the commits since
  touch `custom_components/` or `addons/f2_control/`: the Supervisor builds the app from the public
  `main`, so they would reach every box that installs or rebuilds it under the last released
  number. `docs/RELEASING.md` (Commits that ship nothing) and CLAUDE.md say when to use it.
  The app's changelog, documentation and pictures and the controller's tests go too
  (`SHOWN_ONLY`): the Supervisor only shows them, and none is built into the image.
- Docs: stale references removed across `docs/`, `CONTRIBUTING.md`, the engine's README and the
  app's `DOCS.md`, each checked against the code. `docs/ENTITIES.md` gains the room prefix, an
  Engine ranges table (the `validate_params` bounds narrower than the entities') and corrected
  rows for `maximum_ec`, `field_capacity`, EC stacking, the steering selects, the display-only EC
  sensors, `app_status`, `ai_heartbeat`, the safety sensors and the manual override.
  `docs/RELEASING.md` says the 2.x numbers can be used again.
- Text only, no change to watering: `docs/error-codes.json` (CS-206, CS-401, CS-601, CS-606,
  CS-608) and `docs/ERROR_CODES.md` from it; the CS-206 and CS-401 notifications in
  `controller.py`; the CS-606 Repairs card (`strings.json`, `translations/en.json`); the Maximum EC
  help and the Reservoir's not-reported note on the dashboard; comments and docstrings in the
  engine (both copies), the controller, `health.py`, `strategy.py` and `room.py`; the app's
  `num_zones` and `enable_flag` option texts (`addons/f2_control/translations/en.yaml`); and the
  `whats_new_seen` example version in `services.yaml`.
- Integration: `sensor.crop_steering_<prefix>p1/p2/p3_shot_duration_seconds` time the configured
  shot in each active zone from the zone's own `substrate_volume`, `drippers_per_plant` and
  `dripper_flow_rate` (the room's where the zone has none), then whole seconds, at least
  `MIN_SHOT_S` and at most `max_shot_duration`, as `_act_zone` does. The state is the longest
  zone's, attribute `zones` each zone's, and unknown when no zone's sizing gives a flow (it used to
  read 0). `ShotCalculator.calculate_shot_duration` takes `drippers_per_plant`;
  `capped_shot_seconds` is new. `tests_ha/test_shot_duration_sensors.py` holds the real sensors
  against the real controller's arithmetic.
- Feed EC: `feed.clean` keeps a recipe's optional `ec` (mS/cm, 0.1 to 10; none, empty or 0 is
  none; a stored recipe without it loads with none) and `feed.plan` publishes the stage in use's
  as `feed_ec` on `sensor.crop_steering_<prefix>feed_plan`. The controller's `feed_plan()` reads it
  (anything not a number from 0.1 to 10 is none) and `_snapshot` passes it as
  `ZoneSnapshot.feed_ec`, which every flush and dilution test in `decide()` compares pore EC with;
  without it the engine's default stays 3.0. The dashboard's recipe card has the field, recipe
  files carry `ec` (a file without it imports with none), and CS-206 says where the feed's EC comes
  from. `tests_ha/test_feed_batches.py` takes a recipe's EC from the real `feed_save` to the real
  controller's snapshot.
- Wording: "irrigation strategy" (or "strategy") replaces "grow plan", "plan" and the irrigation
  "recipe" in the dashboard, the integration's Repairs cards (CS-606, CS-607), `services.yaml`,
  `setup_api`'s zone-change refusal, `strategy_model`'s zone check, the strategy sensor's friendly
  name (Irrigation strategy), `select.crop_steering_<prefix>recipe_stage`'s name (Strategy Stage),
  `docs/error-codes.json` and the docs. Nothing a box or an automation reads moves: entity ids,
  service ids and fields, the `#/strategy` and `#/grow-plan` addresses, the library's storage key
  and the export format (`crop-steering-plan`) stay; exported files are now named
  `crop-steering-strategy-….json`. The controller's Auto setpoints frozen reason names an armed
  irrigation strategy. The browser checks and unit tests follow the new labels.
- Dashboard: a feed recipe card's "In use" pill, export and remove buttons are one group
  (`.res-recipe-actions`), the header grid's last column; on a phone they take a row of their own.

## [1.0.0] - 2026-10-05

Integration and controller **1.0.0**.

- **Version 1.0, for everyone.** The first release published at
  github.com/Chill-Division/HA-Irrigation-Strategy, where HACS and Settings → Apps install it from.
  The numbers start again: 1.0.0 follows 2.37.1. On a box already running 2.37, the Supervisor
  offers the controller app as usual, but HACS offers no lower number: redownload Crop Steering in
  HACS and pick 1.0.0. What's new then shows what's new in 1.0.
- **Credits and licences.** The README credits JakeTheRabbit's HA-Irrigation-Strategy, where Crop
  Steering began, and the licence names him and Chill Division. Every part a box installs carries
  the licence, and the dashboard ships its open-source libraries' licences beside it.
- **The README shows the public repository's pictures.** Its screenshots and its link to the rest
  come from github.com/Chill-Division/HA-Irrigation-Strategy, like its other links.
- **Fresh screenshots.** The README and the screenshots page show this release, the new icon
  included.
- **No What's new with the first-run tour.** Someone shown round the dashboard for the first time
  is not also shown what changed in it. The two met only where a room was set up again on a box
  that had run an older release.
- **A new icon.** A tank of water with a seedling in front of it, white on the same blue tile: in
  the dashboard's menu, on Home Assistant's integrations page, in HACS, and for the controller app
  in Settings → Apps. The logo beside it says Crop Steering in the tile's blue, which reads on a
  light theme and a dark one.
- **Steadier accessibility checks.** The checks that read the dashboard's contrast in the dark
  theme no longer fail now and then on text that was still turning light. They wait until nothing
  on the page is changing colour, so what they measure is what a grower sees.

### 🔧 Technical notes

- Licence: `LICENSE` names JakeTheRabbit and, under him, Chill Division. Copies ship in
  `custom_components/crop_steering/` (HACS installs only that folder, and the release zip holds
  only it), `addons/f2_control/` (the Dockerfile copies it into the app's image) and
  `crop-steering-engine/`. The dashboard build writes `THIRD_PARTY_LICENSES.txt`: every npm package
  in the build's module graph, and Tailwind, sorted and undated (`frontend/vite.config.ts`).
  `package.mjs` ships it beside both copies of the dashboard, and `tests/test_licence.py` holds
  all of it.
- Docs: the README's six image addresses (raw.githubusercontent.com) and its screenshots link move
  from `ChillingSilence` to `Chill-Division`, where its other links already went. They stay
  absolute, so HACS, which shows the README, shows the pictures too (`docs/SCREENSHOTS.md`).
- Docs: the twelve `img/` screenshots that show the menu or the time of day are retaken by the
  browser checks that write them, at 2:35 PM in the demo (`TZ=Asia/Dubai`), as the last set was
  taken in the afternoon. `docs/SCREENSHOTS.md` says to take them while the day is under way.
- Dashboard: `WhatsNewOnUpdate` marks the installed release seen and opens no window when it starts
  the first-run tour (`whats_new_get`'s `tour`), as its comment already said it did. The
  verify-dashboard tour check opens the demo as a new installation whose record is behind
  (`?tour=new&whats-new=2.22.0`): the tour, and no What's new, which the bundle before this opened
  too.
- Release: `scripts/release.py --start-again` releases a number below the last one, never one the
  changelog already has (`check_number`). It leaves `WHATS_NEW.md` with only the sections numbered
  up to the new release (`drop_numbered_above`), since the dashboard orders releases by number; the
  changelogs keep everything. `test_version_consistency` now holds every release to one number for
  the pair: it skipped anything below 2.21.0, which 1.x would have been. Integration:
  `WhatsNew.async_init` reads a record numbered above the installed release as unknown, so a box
  that last showed 2.37.1 shows the last 30 days of releases up to 1.0.0 and marks it. The
  real-HA What's new tests number their earlier releases 0.x, under every real one.
- Dashboard, integration and app: `BrandGlyph` (`frontend/src/components/brand-glyph.tsx`)
  replaces the menu's droplets. Its seedling is drawn twice, first wide in the tile's colour
  (`.brand-glyph-halo`), so the tank's lines stop short of it. A new script,
  `frontend/scripts/make-brand-images.mjs` (run after `npm run build`), draws the integration's
  `brand/` images and the app's `icon.png` and `logo.png` from the built dashboard's own mark, in
  its light theme's colours and font. It replaces `scripts/make_brand_images.py` and that
  script's 2.2 MB source picture, `img/crop-steering-logo.png`. The `dark_` images are gone: Home
  Assistant serves the light ones in their place, which `tests_ha/test_brand_images.py` proves
  through its web server.
- Tests: `settled` (`frontend/scripts/settled.mjs`) waits until no finite animation or transition
  is running (at most 5 s), then two frames, and every axe audit in the browser checks calls it
  first. At reduced motion every element eases every property for 0.01 ms, and an element added
  while its parent's colour is still changing starts its own change only when the parent's ends,
  so after the theme flips a colour reaches nested text one level a frame: the strategy page's
  headings took about twelve frames on a CPU slowed sixfold. The two-frame wait read them still
  dark on dark (#212121 on #1c1c1c, 1.05:1) in "setting explainer, dark", which failed pull
  requests #58 and #139. With the race forced, the old wait failed 6 runs of 6 and `settled`
  none. It replaces `verify-workspace`'s own one-pass `settle` and `light-shot.mjs`'s `settled`.
