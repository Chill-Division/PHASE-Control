# User guide

Use **Overview** to check a room and **Irrigation strategy** for **Today** and **Schedule**. Today shows the current zone targets; Schedule edits the dated strategy. Select the room before editing; zone numbers belong to that room.

The menu has six entries; where one holds more than one page, tabs across the top choose it.

Why a zone did what it did, in plain words: [How it works](HOW_IT_WORKS.md).

| Menu            | What it holds                                     |
| --------------- | ------------------------------------------------- |
| Overview        | The room now, with its room and watering switches |
| Irrigation strategy | Today, Schedule                                   |
| Insights        | Zone, Water, Compare runs, Activity               |
| Feed            | Reservoir (once one is mapped), Stock tanks       |
| Settings        | General, Rooms & hardware                         |
| Help            | Terms & phases, error codes, What's new, the tour |

New installation? Start with [Install, upgrade and rollback](INSTALL.md). The first time anyone opens the dashboard on a new installation, a short tour walks through it: the Overview, the Irrigation strategy, Feed, Settings' Rooms & hardware and its test shot, and how to switch the room and its watering on. It starts by itself once; **Help → Take the tour** starts it again at any time.

## What each action changes

| Action                        | Where the change goes                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| Edit manual fields/graph      | Local draft until reviewed and applied.                                |
| Apply reviewed manual changes | Existing HA setpoint entities; inspect readback.                       |
| Review & save an irrigation strategy     | HA's stored draft; separate from arming.                          |
| Arm strategy                      | Requests the eligible boundary activation; does not enable the engine. |
| Save to the strategy library  | This browser/site/room library; no HA write.                           |
| Save a run record             | Run metadata and its captured reference; no irrigation activation.     |
| Save configuration            | HA room/zone setup; wait for controller acknowledgement.               |

## Read a room

**Overview** is the room now: its room and watering switches, alerts, today's totals, the grow-day timeline, each zone's state and readings, and the tank. A zone's name opens its detail panel. On **Today's grow day**, each zone's chart has its phase and VWC now above it; **Predictions**, at the right of **Today's events** under the chart, says how each zone is tracking against yesterday (or a typical day), its targets, the water so far and what comes next, and the **?** beside it holds the chart's key, with the switches that hide the projection, the earlier day and the targets. Point at or tap the chart for the details of any moment. **Today's events** lists the day in order: phase changes, shots, holds, and each setting change with who made it (a person as Home Assistant knows them, **Auto setpoints**, or an automation by its name) and the value it replaced. **Insights → Water** has water use over the grow, today's water per plant and a shot calculator. The latest controller records open beside any page from the top bar.

| Indicator                     | Meaning                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Room status line              | At the top of every page: watering, holding and why, or not watering and what to do, with the age of the controller's last report.                                  |
| Zone scheduling               | Whether this zone is eligible for scheduling; it does not mean its valve is currently open.                                                                         |
| Controller status and phase   | The controller's reported operating state and P0/P1/P2/P3 phase. Inspect any hold or unavailable status before making changes.                                      |
| Next                          | What the controller waits for next, by its own numbers: e.g. shot when VWC < 61% (now 58%). Shown while it waters the zone and reports; not a forecast.             |
| Valve on/off                  | The state of this zone's explicitly mapped switch. It does not establish physical flow.                                                                             |
| Last irrigation               | A recorded controller event timestamp, on one line: how long ago, and the time (with the day when it was not today). It is not inferred from sensor updates. Missing/invalid timestamps remain **Not reported**. |
| VWC and root-zone EC          | The mapped substrate measurements. Their units and sensor availability matter independently.                                                                        |
| Water today                   | The controller's recorded delivery estimate since the room's lights-on boundary, against the zone's daily limit.                                                    |
| Water use                     | On **Insights → Water**: litres per zone today, this week, since the grow start and estimated for the whole grow, with a bar for each grow week.                    |

**Water use** counts grow-days from lights-on to lights-on. It reads Home Assistant's long-term statistics, which Home Assistant keeps indefinitely; opened outside Home Assistant it can only read recorded history, as far back as the recorder keeps it. The grow start is the zone's irrigation strategy start date when the strategy is armed or has been saved. Without one it is inferred: the first day with water after at least five grow-days without any. The panel says which. A day Home Assistant did not record is flagged, never counted as zero.

The switch beside the **Zones** heading on **Overview** switches every zone of the room at once, as the header toggle of a Home Assistant entities card does. It is on while any zone is on. Off pauses every zone; on switches every zone on, a zone you paused yourself included. Each zone still has its own switch in its details, and like them this one asks for a review first.

A zone paused by hand in Home Assistant, with its manual override switch or the `set_manual_override` service, shows **Paused by hand** and until when. The controller fires no shot in it until then, not even a rescue shot. **Resume now** in its details ends the pause after a review.

To move a zone to another phase, open it from **Overview** and pick one under **Phase**. After the review, the controller moves it within a minute and carries on from there: lights-off still moves it to P3 and lights-on to P0. Today's water stays, and so does the shot count, except that a move to P1 starts the ramp again from its first shot.

**Switch watering off…** in the Overview's heading switches the room's engine switch ("Engine Enabled" in Home Assistant on a room made by the setup wizard), and like zone scheduling it asks for a review first. With watering off the controller opens no valve in the room and a shot already running stops within a few seconds; it keeps reading the probes and following the phases. A new room starts with watering off. When a room is not watering, the status line at the top of every page says which switch stopped it and links to the Overview when this is the one. Beside it, **Switch room off…** stands a room down when nothing is growing in it: no irrigation and no alerts until it is switched back on, with a banner on every page saying so. Pausing a zone stops a shot already running in it within a few seconds too, and a paused zone gets no water at all, not even a rescue shot. Neither is an emergency stop: use the installation's established physical shutdown procedure for an emergency.

### Tank and pump display

Choose **Map sensors** on the tank panel, or open **Settings → Rooms & hardware → Shared room hardware**, to map the **Room pump**: the room pump's actual HA switch (`pump_switch`), which the controller descriptor publishes as `pump`.

How full the tank is comes from the reservoir's level sensor (**Feed → Reservoir**), as the controller works it out from the distances when full and when empty; until those are set the tank reads **Not set up**, and a room without a reservoir level sensor reads **Not mapped**. Beside the tank, a chart shows how full it has been over the last 24 hours, or the last 12 (the buttons above it). It is Home Assistant's recorded history of that sensor, worked out the same way, and it ends on the level shown now: a refill shows as a jump, each round of shots as a step down, and a dashed line marks the reservoir's minimum. Without automatic refills, a dotted line marks the level a reminder to refill it comes at, and **Refill soon** shows under the tank once it is down to it. It needs Home Assistant's recorder to keep that sensor's history, which it does by default, and it reloads every 10 minutes.

**Refill** and **Last refill** are the controller's own record of the refills it runs for the room's reservoir (**Feed → Reservoir**), so there is nothing to map for them: what its refill is doing now (not running, filling, dosing, mixing) and when the last one ended, marked *stopped* if it stopped part-way. A room without a reservoir has neither row; they read **Unavailable** until the controller app has reported for the room.

The level is worked out from the sensor's distance to the water; drawing it as a tank does not make it a measured volume. Tank readings and switch reports do not prove dose completion, water quality suitability or physical delivery.

Unmapped inputs show **Not mapped**; invalid readings show **Unavailable**, **Check units** or **Out of range**. An unknown pump is not shown as off and an unknown tank is not drawn empty. When disconnected, the panel identifies retained readings as last received.

## Irrigation strategy → Today

When no schedule owns the room, Today lets you edit the current targets using the steps below. An active schedule replaces those controls with its effective read-only targets and graph; fallback manual inputs are hidden. If the required schedule snapshot is missing or stale, those targets remain unavailable rather than being replaced by manual values.

1. Select a room, open **Irrigation strategy → Today**, then select a zone. Choose **Room settings** for shared timing/configuration.
2. Use the phase selector to keep the relevant controls beside the whole-day VWC/EC preview. On a narrow screen, expand the preview when needed.
3. Edit a numeric field or a supported graph handle. Both edit the same local draft and respect the HA field's limits and step. The saved reference remains visible for comparison.
4. Check the setting's name, unit and draft line. Its **?** says what the setting does, what it accepts (range and step) and its key. The zone's **Steering mode** picks which EC and P3 dryback targets the controller uses, and only those show; **Show targets for both steering modes** shows the other mode's too.
5. Select **Review changes**, inspect every before/after value, then confirm application. Only this application step sends the reviewed values to HA. Readback errors and unapplied values remain visible; do not assume a partially failed batch succeeded.

**Auto setpoints** and **EC stacking** sit beside the heading, each switched on or off after a review. With EC stacking on, the controller moves each zone's maintenance trigger in P2, a point at a time, to steer its settled substrate EC toward the zone's P2 EC target. Each grow-day starts from the trigger as set. On the P1 card, **Minimum P1 shots** keeps the ramp going until that many shots have gone in, even if moisture reaches the peak target sooner.

Pot size, plant count and drippers are the room's hardware, set in **Settings → Rooms & hardware**, not here. What a shot of a given length delivers is on **Insights → Water**.

**Export** saves the room's targets to a file, to keep or to send to someone: the room settings and each zone's, both steering modes' values and each steering mode, but not the pot size, plants or drippers. **Import** loads such a file, from this room or another, into the draft, zone by zone number. A value a setting can't take exactly is rounded to its step, one outside its limits is skipped, and the room's own lights hours, pump and main-line timings and longest shot stay as this room has them; the note above the draft says which. Nothing changes until you review and apply. Import waits while a draft is open, and neither button works while a schedule runs: the room follows the schedule then, so export that from **Schedule**.

Room changes can be previewed against a selected zone. A zone-specific value takes precedence over a room fallback where the controller supports it. Missing or invalid inputs remain missing/invalid instead of becoming an invented curve.

When a schedule owns the room, use **Irrigation strategy → Schedule** to inspect its dated targets and state. Today says when a schedule is armed or running. Disarm it on Schedule; Today's targets run again from the next lights-on, and you can edit them once it shows **Not armed**. See [the schedule and Today](GROW_PLANS.md#the-schedule-and-today). Export or deliberately discard drafts before leaving; a navigation warning is not an automatic backup.

## Irrigation strategy → Schedule

The planner schedules user-defined profiles by zone and grow day. The balance slider interpolates between the profile's explicit vegetative and generative endpoints; it does not select a built-in agronomic prescription. Equal endpoints intentionally produce equal targets at every slider position. Pot/dripper sizing affects water estimates, not the suitability of the endpoint values.

1. Open **Irrigation strategy → Schedule → Endpoint profiles**. Inspect both endpoints and select the correct **Zone limits**. Duplicate a profile when you need an independent copy. A shared profile affects all schedule blocks referring to it.
2. Open **Schedule & curve**. Select a zone and set **Zone grow start date**. Each zone can have its own start date.
3. Select a day or week in the overview. Assign its **Endpoint profile** and **Steering balance**. Days 1-366 are supported. Range edits preserve surrounding assignments by splitting existing blocks.
4. Inspect **Zone schedule blocks** for coverage. Fill missing days and resolve overlap, parameter or zone-assignment errors.
5. Inspect the selected day's curve. Graph handles edit the selected profile as described on screen, which can affect its other schedule references.
6. Choose **Review & save** to validate and persist the draft in HA. **Validate preview** checks an unchanged stored draft. **Export** downloads a portable strategy; **Reload stored strategy** retrieves the stored revision once local edits are saved or discarded.
7. If you intend the controller to use the strategy, review **Arm strategy** separately. The controller must report support. Activation occurs at the eligible local lights-on boundary; arming does not enable the engine or pump.

An active/armed strategy cannot be edited as a draft. **Disarm strategy** requests the normal boundary handoff back to manual targets; wait for **draft** status before editing. The UI reports unsupported controllers, stale required snapshots and unfinished handoffs instead of claiming activation succeeded.

Saving, arming and disarming a strategy need a Home Assistant administrator login. Any other login can open the strategy and its previews, and is refused when it tries to change them.

After adding or archiving zones in setup, use **Update zones from setup** in a draft strategy. It preserves existing active-zone schedules, removes archived assignments, and initializes new zones from their current settings. Export the previous strategy first if you need those removed assignments.

### Strategy library

A library item is a reusable copy, separate from the strategy currently controlling the room.

- **Save current as a strategy** creates a named browser copy with optional notes/source URL.
- **Import strategy file** accepts the supported strategy export format, validates it and lets you name the library copy.
- **Preview strategy** shows its zones, retained current start dates, schedule spans and inspectable profiles. **Load into local draft** requires the exact current active-zone IDs and preserves current start dates. Replacing unsaved planner work requires explicit acknowledgement.
- Loading is unavailable while active, armed, busy or disconnected. It does not save or arm the strategy.
- **Export strategy** downloads a copy. **Remove strategy** asks for confirmation and removes only the browser copy.

Libraries are isolated by site, browser and room. They are not a shared HA database. Limits are 20 strategies per room, 500 KB per strategy and 2 MB per library. Export important copies before clearing browser data or moving to another browser. Corrupt data is retained with a recovery-download action; storage denial, quota and stale-tab conflicts are reported rather than silently overwritten. See [Strategy library](RECIPE_LIBRARY.md).

## Understand the graphs and water figures

| View                          | What it shows                                                                                                            | What it does not establish                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Today/Schedule VWC-EC curve   | Configured targets, phase references and supported timing, with local draft changes where applicable.                    | Exact future shot times, uptake, runoff or EC accumulation.                                 |
| Insights → Zone history       | Retained HA Recorder measurements on separate VWC and EC axes.                                                           | Measurements from periods Recorder did not retain.                                          |
| Water today                   | The controller's recorded estimate from its configured flow and elapsed shot runtime, including accounted partial shots. | Independent meter readings, uniform distribution, plant uptake or external irrigation.      |
| Water use estimate            | Water used so far plus the last 7 full grow-days' average for every grow-day left in the irrigation strategy.                      | A forecast of plant uptake, or a total for a grow whose strategy's length is unknown.             |
| Average mL per plant          | Zone estimated water divided by configured plant count.                                                                  | A measurement from each emitter.                                                            |
| Total substrate capacity      | Substrate volume per plant multiplied by plant count.                                                                    | Water delivered or water retained.                                                          |
| Shot calculator (Water)       | A conditional calculation from supplied settings, showing requested versus effective runtime and caps.                   | A guaranteed daily total; feedback-dependent maintenance/emergency shot counts are unknown. |

The updated planning curve uses separate axes for VWC (%) and root-zone EC, joining configured references across lights-off and overnight to the next lights-on. VWC joins the daytime reference to the relative dryback endpoint; the P3 emergency floor remains a separate protection reference. Dashed EC interpolates from the last daytime anchor to the next morning anchor. There is no P3 EC setpoint or prediction of the physical EC/salt trajectory. Missing values remain gaps rather than being filled with guessed readings. A graph handle changes configuration in a draft, not physical equipment.

Historical estimates are not retroactively corrected when flow settings change. For detailed software semantics, see [Steering and planning](GROW_PLANS.md).

## Compare recorded runs

1. Open **Insights → Compare runs** and select the room and zone. Date-range history works without a registered run.
2. In **Run records**, choose **Add run**, enter the actual run name/start date and optional end date, then **Save run record**. This saves metadata and a timestamped reference configuration; it does not arm irrigation.
3. Select the current and, optionally, previous run. Previous readings align by grow age and stop at the same elapsed progress as the current run.
4. Select **Day**, **Week · 7 days**, **Calendar month**, **Run to date**, or **Custom dates**. Check the calendar timezone and requested-through time. Use **Refresh history** to advance the window.
5. Choose a **Target reference**: **Current configured daily targets**, **Saved run daily reference**, or **Current phase reference**. Read its capture/source note before comparing it with recorded measurements.
6. Inspect coverage and missing-data notices. **Export metadata** backs up run definitions and reference snapshots, not Recorder readings. Archive/restore controls retain the registered run's identity.

Saving, archiving and importing run records need a Home Assistant administrator login; any login can view them.

Registering last month's run today captures today's reference configuration. It cannot recover last month's setpoints or expired Recorder data. Editing dates preserves the original capture. Current/saved daily target illustrations are references, not an audit of every historical target. Each room supports up to 100 run records; a completed run covers 1-366 inclusive calendar days.

## Set up rooms, zones and sensors

An HA administrator uses **Settings → Rooms & hardware**. Pair devices and expose their entities in HA first; this workspace maps existing entities.

1. Choose an existing room or **Add room**. Give it a clear name. Names may change without changing its stable identity.
2. Map **Room pump** and **Mainline valve**, then each active zone's valve. Search by friendly name or exact entity ID; inspect the displayed value/unit before selecting.
3. Select one or more VWC and EC probes per zone. **Clear mapping** removes the selected mapping; **Done** closes the picker. Several probes in a zone become one moisture and one EC reading: their average until you choose otherwise in the zone's details, under **Probes** (average, median, lowest or highest, for moisture and EC apart; each choice shows what the zone would read with it now). The Overview's VWC and EC tiles are named for it: **Lowest VWC** in a room of one zone that reads its lowest probe, **Average lowest VWC** when several zones all do. Automatic outlier rejection is not provided.
4. Enter plant count, substrate litres **per plant**, drippers **per plant**, and flow in litres/hour **per dripper**. Review existing values instead of replacing them with generic defaults.
5. Map the optional room equipment, and the **Reservoir & dosers** if the controller app mixes the room's feed (see [Mix nutrient batches](#mix-nutrient-batches-reservoir)). Explicitly map shared equipment only where appropriate; never reuse a zone valve accidentally.
6. Stop affected engines (the notice at the top of the page has the room's watering switch) and verify the implicated irrigation equipment is OFF. **Review configuration** shows the changes and blockers; **Save configuration** persists the setup after backend validation.
7. Wait for controller acknowledgement of the saved setup revision. A saved configuration and an adopted configuration are different states. Then verify **Overview** and **Insights → Zone**, where **Probe coverage** shows whether every zone's probes give a current reading, before restoring the prior scheduling state.

Zone and room removal archives stable IDs. **Restore zone** or **Restore room** reactivates the same identity after review; archived slots are not silently reused for different hardware. Adding/archiving a zone may require updating a draft irrigation strategy's assignments.

Every saved change is recorded in Home Assistant's **Activity** (the logbook), on the room's device page too: who saved it and what changed, for example *Growroom 2 setup saved (revision 2): renamed from "PHASE Control"*. A change Home Assistant refuses is not saved, so it is not recorded; the review says why it was refused.

### Tests

At the bottom of **Settings → Rooms & hardware**, **Tests** checks that a room's hardware works. Each test asks the controller app, which runs it at its next pass, within a minute, through the same safety checks as everything it does; **Insights → Activity** says how it went. A test runs on the saved configuration, in the room chosen under **Room** in the menu, so save or discard any change first.

- **Test shot** waters one zone for 10 seconds: the pump, the mainline and the zone's valve, in the order a shot opens them. The dialog says about how much it gives. It is held, and the log says why, while watering is switched off, the zone is off or on manual override, a refill is running, the reservoir is at its minimum or the zone's daily water limit is spent; a held irrigation strategy does not hold it. Its water counts toward the zone's day, but it is not one of the day's shots (the ramp does not move on for it), and Auto setpoints learns nothing from it.
- **Test refill** refills and mixes the reservoir now, as an automatic refill does (see below). The controller refuses one that could overflow the reservoir; the dialog says so first. If you have checked that the reservoir has room for the fill (the reading may be off, or you know how far it really is from full), tick **Run anyway**: that refill then starts without the check. Every other check still applies, and a level sensor that reads nothing is not overridden: half-way through the fill a refill checks that the reservoir is filling, and one it cannot read would stop there.

## Mix nutrient batches (Reservoir)

**Feed → Reservoir** runs a room's nutrient batches: the controller app refills the room's reservoir with fresh water, mixes it and doses each nutrient in turn, and keeps it from running dry. Each room has its own reservoir and dosers. The tab shows once the room has a reservoir mapped.

1. In **Settings → Rooms & hardware**, map the room's **Reservoir & dosers**: the level sensor (an ultrasonic sensor on the lid, reading the distance down to the water), the fresh-water solenoid, the recirculation solenoid and each doser's power switch, up to six. The room's pump mixes the batch.
2. On **Reservoir**, set the **batch**: how long the fresh water runs (**Fresh-water fill**, for example 11 min 30 s), the litres that fill adds (**Fill litres**, for example 145 L: the doses are worked out for these, since what is left in the reservoir is already mixed), the level sensor's readings when the reservoir is full and when it is empty (**Distance when full** and **Distance when empty**; **Use the reading now** takes the current one), the **Minimum level** it keeps (5% to start with; 0 turns it off), the level a reminder to refill it by hand comes at without automatic refills (**Remind me at**, 20% to start with; 0 turns it off), a pause before the first doser and between dosers, and the least it recirculates after the last dose (10 s to start with). The two distances make the level a percentage, worked out as an ESPHome template would: 100% at the distance when full, 0% at the distance when empty.
3. Under **Dosers**, each doser's flow, 600 mL/min unless you change it, is only used to work out how long it runs for its dose; its speed and calibration stay on the doser.
4. Add a **feed recipe** for each growth stage. Give each doser the nutrient on it in that stage and its **parts**, the ratio off the nutrient chart: Athena Flower is 3 Core : 5 Bloom : 1 Balance : 0.5 Cleanse. The **mL per litre per part** is the strength; **1 part** is the same set as mL of nutrient in each fill (240 mL in a 145 L fill is 1.655 mL per litre per part), and each sets the other. Each doser then gives its parts × 1 part, to the whole mL: at 1 mL per litre per part in 150 L, Bloom at 5 parts is 750 mL and runs 75 s at 600 mL/min. Each recipe doses in its own order, so a stage can use a doser the others leave out (Fade's doser in place of Core's): drag a row by its handle, or use its arrows; the number beside it is its turn. A new recipe starts with the nutrients and the order the last one had, since the bottles usually stay on their dosers. A recipe coming to more than 60 mL per litre is refused as a likely typo. Under its doses, **Feed EC** is what the recipe mixes to, in mS/cm: measure it once it is mixed. The controller waters with that feed, so it flushes or dilutes only a substrate saltier than the recipe in use's Feed EC; a recipe without one is counted as 3.0 mS/cm.

   Instead of a blank recipe, **Add a feed recipe** can start from one of the list beside it:
   - **Athena (Chill Division modified)**, Grow, Bloom and Fade, as Chill Division runs them: 240 mL a part whatever the fill, Balance first. Grow is 0.7 Balance : 5 Grow : 3 Core : 0.5 Cleanse; Bloom is 1.05 Balance : 5 Bloom : 3 Core : 0.5 Cleanse; Fade is 1.1 Balance : 5 Bloom : 3 Fade : 0.5 Cleanse.
   - **Front Row 3-2-2, high strength**, Veg, Stretch (flower weeks 1-2), Stack (weeks 3-5), Swell (weeks 6-8/9) and Ripen (the final 1-2 weeks): Front Row's 3-2-2 stock concentrate feed chart at high strength, where one part is 1 mL of stock concentrate per litre, so the parts are the chart's own numbers. Front Row Si, the pH up, goes in first in every stage, with PhosZyme in each. Each stage also comes **+ Triologic** (0.26 mL per litre, the low end of its range, since the chart has it once a week and a recipe doses every refill) and **+ BioFlo** (8 mL per litre), each undiluted from its own bottle.

   Each nutrient goes on the doser your recipes already give that name, the one most of them do. One no recipe names goes on a free doser, one no recipe gives a nutrient first, and a note says which, so check those bottles before saving; one that finds no free doser is left out, and the note says so. A recipe called the same as one you have gets a number after its name.

   Each recipe's download button saves it to a recipe file, by nutrient rather than by doser, and **Import recipe file** adds one, in this room or another, putting its nutrients on the dosers the same way.
5. Give the grow a **feed schedule**: the day **Week 1 starts on**, how many **weeks** it has (strains differ: a week or three of veg, eight or ten of flower) and each week's recipe, for example Week 1 Vege, Weeks 2–6 Bloom, Weeks 7–8 Fade. The stage in use then changes by itself at midnight as each week starts, and the next refill doses that week's recipe (what is already in the reservoir is not touched). After the last week, its recipe carries on. **Save**.
6. Without a schedule, choose the **stage in use** by hand. With one running, a stage picked by hand (here, or in Home Assistant's select, which an automation or a dashboard card can change) holds only until the schedule's next week starts; the page says until when. If you don't want the scheduled recipe, remove the schedule: the stage in use stays what it was, picked by hand from then on.

A refill runs: fresh water for its fill time; half-way through, once the level shows it is filling, the recirculation solenoid opens and the pump starts; a pause later, while the fresh water still runs, each doser runs for its dose, one after another, a pause apart; the tank keeps circulating until the fill time ends, and at least the recirculation time after the last dose; then the pump stops before the recirculation line closes. When the doses fit in the fill's second half, the whole refill takes its fill time. When they do not, the rest go in after the fresh water stops, and the page says so. The page shows each step as it happens, with the time left, the dose in progress and what the last batch gave, and the level with what 1% of the reservoir holds, which each refill teaches (its fill litres over how far the level rose).

- **The minimum.** No shot takes the reservoir under its minimum: a pump that runs it dry loses its prime. With **automatic refills** on, the controller plans ahead: once the room's next round of shots (every zone's next shot, sized by its phase: the next, bigger, ramp shot in P1, P2's maintenance shot once the ramp is done) would take it under the minimum, a refill starts, between shots, after three passes in a row (one bad echo starts nothing). A shot that still would not fit waits for it. Without automatic refills, watering is held there and a notice says so (CS-704) until the reservoir reads enough again. Before the first refill has shown what 1% holds, it goes by the reading alone: under the minimum.
- **The reminder.** Without automatic refills (switched off, or a room with nothing to refill with), a notification (CS-706) reminds you to refill the reservoir by hand once it has read at or under **Remind me at** for three passes in a row. It says how full the reservoir is and, once a refill has shown what 1% holds, about how many litres and rounds of shots are left before the minimum. It comes again each day the reservoir stays that low, and goes once it reads 5 points above. **Remind me at** shows only while it can remind, and one at or under the minimum never does: watering waits there instead.
- **Refill by hand…** opens **Tests** (above), where **Test refill** asks for one; the controller app starts it at its next pass, within a minute, or says why it cannot. A refill must fit: once a refill has shown what 1% holds, the level plus what the fill adds must stay under 100%; before that, one asked for by hand starts only from 10% (or the minimum, if higher). **Run anyway** starts one you have checked fits. A request the app first sees more than 30 minutes later (it was stopped) is not acted on.
- **Automatic refills** (off until you turn them on) start one by itself as above, and not again until the reservoir reads enough.
- A level sensor reads nothing when Home Assistant has no reading from it: unavailable, unknown or not a number. Then no refill starts on it, by itself or asked for, and one already filling stops half-way, before the pump runs. If it reads nothing for 5 minutes, watering carries on and a notice says so (CS-705): no refill starts and nothing keeps the minimum until it reads again.
- A still reservoir reads the same for hours, and Home Assistant shows no new reading from an ESPHome sensor until the value changes, so the age of a reading says nothing. An ESPHome ultrasonic whose echoes fail keeps showing its last good value; give it a `timeout` filter (last in its filters, e.g. `- timeout: 10min`) and it reports unknown once it has had no good reading for that long, so a failed sensor is noticed.
- A batch starts only while the room's watering switch is on, the room is on, no hardware fault is latched and everything it uses reads off: its solenoids, its dosers, the pump, the main line and every zone valve. Otherwise nothing is switched on and a notice says why (CS-703).
- While a refill runs, the room waters nothing; while one fills or doses, no other room starts a shot either, and the controller app's log says which room's refill it waits for.
- **Stock tanks** (Feed → Stock tanks): each concentrate's bottle is its name, capacity, level, low mark and the doser it feeds. Each refill takes from it what that doser gave, as the week's recipe says, so how much a batch takes is never set on the tank; the card shows it, and about how many refills are left. A card warns at the low mark; **Refilled** and **Set level** keep it right.
- If the level has not risen half-way through the fill, the fresh water stops, the pump never starts and nothing is dosed (CS-702). If anything stops a batch part-way (the watering switch, the room switched off, a switch that went off or offline, the app stopping), everything it had on is switched off, within seconds while it fills or doses, and a notice says what went in (CS-701); a switch that will not read off latches the hardware hold. Dose what is missing by hand, or empty the reservoir and run a test refill.

## Connection, appearance and supporting pages

The native HA sidebar normally uses your existing HA session. In a standalone tab, **Settings → General → Home Assistant connection** takes an explicit URL and a long-lived access token instead; the token is kept for that tab session and is never put in the URL. Inside Home Assistant the section is not shown: the session is the connection. A hosted HTTPS page may be unable to access a local HTTP HA server because of browser origin/security rules; use the native sidebar for the normal installation.

Inside a compatible same-origin HA shell, the workspace temporarily collapses HA's sidebar. Use **Home Assistant** at the bottom of the workspace navigation (under ☰ on a phone) to reopen HA's menu. Leaving the workspace restores the prior temporary state; it does not change the saved HA sidebar preference. Standalone and unsupported embeddings keep normal navigation. See [Home Assistant sidebar](HA_SIDEBAR.md) for compatibility limits.

The dashboard is **Light** unless you choose otherwise in **Settings → General → Appearance**: **Home Assistant** inherits the HA theme when embedded on the same origin, or the device's appearance in standalone mode, and **Dark** is always dark. The choice is kept in each browser. Cross-origin embedding cannot read the host theme.

**Settings → General → Appearance → Water today, shown as** switches every Water today (the Overview's totals and zone table, a zone's details and the Schedule's zone panel) between each zone's total, the default, and **per plant**: the zone's water today and its daily limit divided by its plant count from Rooms & hardware, as if every plant got the same. A zone without a plant count stays in litres and says *zone total*. Water use over the grow stays in litres per zone. The choice is the room's, kept in Home Assistant (`select.crop_steering_<prefix>water_today_view`): everyone who opens the room sees water that way, and the controller's vitals notification follows it.

**Settings → General → Notifications → Include room predictions in informational notifications** puts, under each zone of the controller's vitals notification, what the controller will do next, as the zone's Next: line on the dashboard says it. It is on until you switch it off, and it is the room's (`switch.crop_steering_<prefix>notify_predictions`).

After an update, the first person to open the dashboard sees **What's new**: the main changes of every release this installation had not yet shown, in a few plain lines each, with a link to the full release notes. It shows once for everyone, never on a new installation, and **Help → What's new** opens the latest releases again at any time.

**Insights → Zone** shows one zone's readings against its targets and their history, and under **Probe coverage** whether each zone's probes give the controller a current reading and how old the last one is. **Insights → Activity** lists available controller/state records and supports CSV export; it is not an immutable audit of every physical shot. **Help** explains the terms and phases and lists every error code.

For an existing timed zone hold, Home Assistant exposes the `crop_steering.set_manual_override` action. The action refuses a signed-in user who is not an administrator (automations can still call it); the switch itself follows Home Assistant's own user permissions. Its timeout defaults to 60 minutes and accepts 1-1440 minutes; specify the intended zone and room slug (omit the room for the default room, the first one set up). Clearing the hold is distinct from enabling zone/room scheduling. Turning its switch on directly creates an indefinite hold. See the action's fields in HA and the [entity reference](ENTITIES.md).

## When something does not look right

| Symptom                                        | Next step                                                                                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No rooms or missing workspace services         | Verify the integration loaded, the controller version matches, and the current HA account can access the entities/services. Refresh after upgrading.             |
| Tank **Not mapped** or **Not set up**          | **Not mapped**: map the reservoir's level sensor in **Settings → Rooms & hardware → Reservoir & dosers**. **Not set up**: set its distances when full and when empty on **Feed → Reservoir**. |
| Last irrigation or Last refill is missing      | Both are the controller's own records: a zone has no Last irrigation until the controller has watered it, and a room no Last refill until it has refilled its reservoir. A sensor's update time never stands in for either. |
| A reading shows **Check units**                | Inspect the actual HA unit and choose/repair the appropriate entity. Do not relabel an unrelated quantity to pass validation.                                    |
| Setup is saved but adoption is pending         | Inspect heartbeat/setup blockers; keep affected engines off until the controller acknowledges the revision.                                                      |
| Slider appears to do nothing                   | Inspect both selected endpoint columns. Equal endpoints are deliberately equal at every balance.                                                                 |
| Today is read-only                             | Inspect the schedule or connection state. Active schedules show effective read-only targets; use Schedule and the normal boundary handoff before manual editing. |
| Cannot load a saved strategy                   | Check active-zone IDs, current limits, strategy state, connection and explicit replacement acknowledgement.                                                          |
| Comparison is blank                            | Check selected run/zone, recorded sensor IDs, dates, Recorder retention and coverage notices. Registering metadata cannot recreate readings.                     |
| A pause was confirmed but equipment remains on | Pause affects scheduling. Inspect the active shot and use the site's established physical shutdown procedure if necessary.                                       |

For anything else, use the [troubleshooting guide](troubleshooting.md). A switch that reads on does not prove water reached the plants: only a catch test or a flow meter does.
