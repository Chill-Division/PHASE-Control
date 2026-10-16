/**
 * What each irrigation setting is called and what it does, for every page that shows one: the
 * Irrigation strategy, the Schedule, the planning curve and the sensor charts. One table, so a
 * setting never has two names.
 *
 * Names follow the Athena Handbook (Metric, V20) where it has a term for the thing. Every help
 * line says what the engine does (crop-steering-engine `decide()` and the controller's reads of
 * these numbers), not what the setting was meant for: change a line only together with that code.
 */

/** Which way a level acts, shown as a small tag before its name. */
export type SettingTag = "fills" | "waters" | "dries" | "rescues" | "ceiling" | "time";
/** A dryback target's unit, wherever it is shown. It is a drop relative to the day's peak: 40 means
 * 40% below it (an 87% peak dries back to 52%), not 40% VWC and not 40 points. Home Assistant's
 * entity says only "%". */
export const DRYBACK_UNIT = "% below peak";

/** Whether a percentage is a moisture reading or a share of something else: a mark beside its field
 * says which, and a legend at the top of the page says what each means. Every "%" setting has one. */
export type SettingScale = "absolute" | "relative";
export const SCALE_WORDS: Record<SettingScale, { name: string; legend: string }> = {
  absolute: {
    name: "Absolute",
    legend: "a moisture reading, on your probe’s own scale: 40% means the probe reads 40%.",
  },
  relative: {
    name: "Relative",
    legend:
      "a percentage of something else: a 30% dryback ends 30% below the day’s peak, and a 3% shot is 3% of each plant’s substrate.",
  },
};
/** What a field's mark says on hover and to a screen reader. */
export function scaleTitle(scale: SettingScale, of?: string): string {
  return scale === "absolute"
    ? "Absolute: a moisture reading, on your probe’s own scale"
    : `Relative: a percentage of ${of ?? "something else"}`;
}

export const TAG_TEXT: Record<SettingTag, string> = {
  fills: "fills up to",
  waters: "waters below",
  dries: "dries by",
  rescues: "rescues below",
  ceiling: "ceiling",
  time: "time limit",
};

export interface SettingWords {
  label: string;
  /** The same name where a full label does not fit: chart lines and sentences. */
  short: string;
  /** One line under the field. */
  help: string;
  tag?: SettingTag;
  /** For a percentage: a moisture reading (absolute), or a percentage of `scaleOf` (relative). */
  scale?: SettingScale;
  scaleOf?: string;
  /** The "?" beside the field. */
  detail?: SettingDetail;
}

/** What the "?" beside an irrigation setting says, in the order shown. */
export interface SettingDetail {
  what: string;
  when: string;
  affects?: string;
  stacking?: string;
  auto?: string;
  athena?: string;
}
export const DETAIL_HEADINGS: ReadonlyArray<readonly [keyof SettingDetail, string]> = [
  ["what", "What it is"],
  ["when", "When it acts"],
  ["affects", "What it affects"],
  ["stacking", "With EC stacking on"],
  ["auto", "With Auto setpoints on"],
  ["athena", "Athena Handbook"],
];

/** The phase groups, in order; Today files the EC targets under them too. */
export const PHASE_GROUPS = [
  "P0 · Additional dryback",
  "P1 · Ramp-up",
  "P2 · Maintenance",
  "P3 · Overnight dryback",
] as const;
export const GROUP_HELP: Record<string, string> = {
  [PHASE_GROUPS[0]]:
    "Transpiration before irrigation: the plants start drinking before the first shot.",
  [PHASE_GROUPS[1]]: "The first shots after lights-on: small, spaced out, up to the peak target.",
  [PHASE_GROUPS[2]]:
    "Maintenance shots through the day, whenever the substrate dries below the trigger.",
  [PHASE_GROUPS[3]]: "The substrate dries back until the first shot of the next day.",
  Substrate: "What this substrate can hold.",
  Schedule: "When the lights come on and go off. A grow-day runs from one lights-on to the next.",
  Safety: "Limits that hold, shorten or add watering.",
  "Pump and valves": "How long the pump and the shared main line run before a zone's valve opens.",
};

const OF_SUBSTRATE = "as a percentage of each plant’s substrate volume";

const WORDS: Record<string, SettingWords> = {
  p0_maximum_wait_time: {
    label: "Latest first shot",
    short: "Latest first shot",
    tag: "time",
    help: "The ramp starts this long after lights-on at the latest; sooner if moisture falls to the maintenance trigger.",
  },
  p0_dryback_drop_percent: {
    label: "Additional dryback",
    short: "Additional dryback",
    scale: "relative",
    scaleOf: "its lights-on reading",
    tag: "dries",
    help: "The ramp starts once moisture has dropped this far below its lights-on reading, or at the latest first shot. Athena: 1 to 5%.",
  },
  p1_target_vwc: {
    label: "Peak VWC target",
    short: "Peak target",
    scale: "absolute",
    tag: "fills",
    help: "The morning ramp waters up to this: the top of the day. It is capped at full saturation.",
  },
  p1_initial_shot_size: {
    label: "First P1 shot",
    short: "First P1 shot",
    scale: "relative",
    scaleOf: "each plant’s substrate",
    help: `The ramp’s first shot, ${OF_SUBSTRATE}.`,
  },
  p1_shot_size_increment: {
    label: "Each P1 shot adds",
    short: "Each P1 shot adds",
    scale: "relative",
    scaleOf: "each plant’s substrate",
    help: "Every ramp shot is this much bigger than the one before.",
  },
  p1_time_between_shots: {
    label: "Time between P1 shots",
    short: "Time between P1 shots",
    help: "Lets each ramp shot soak in before the next. Athena: 15 to 30 minutes.",
  },
  p1_maximum_shots: {
    label: "Most P1 shots",
    short: "Most P1 shots",
    help: "The ramp ends after this many shots, even below the peak VWC target.",
  },
  p1_minimum_shots: {
    label: "Fewest P1 shots",
    short: "Fewest P1 shots",
    help: "The ramp hands over to P2 only once this many shots have gone in, even if moisture reaches the peak VWC target sooner.",
  },
  p2_vwc_threshold: {
    label: "Maintenance shot when below",
    short: "Maintenance trigger",
    scale: "absolute",
    tag: "waters",
    help: "Through the day, a maintenance shot fires whenever moisture reads below this. The peak VWC target down to here is the daytime dryback.",
  },
  p2_shot_size: {
    label: "Maintenance shot size",
    short: "Maintenance shot",
    scale: "relative",
    scaleOf: "each plant’s substrate",
    help: `Each maintenance shot, ${OF_SUBSTRATE}.`,
  },
  p2_time_between_shots: {
    label: "Time between P2 shots",
    short: "Time between P2 shots",
    help: "Lets each maintenance shot soak down to the probes before moisture is read again. 0 turns it off.",
  },
  p3_emergency_vwc_threshold: {
    label: "Rescue shot when below",
    short: "Rescue level",
    scale: "absolute",
    tag: "rescues",
    help: "In P3, a rescue shot fires whenever moisture reads below this. Keep it above the wilting point.",
  },
  p3_emergency_shot_size: {
    label: "Rescue shot size",
    short: "Rescue shot",
    scale: "relative",
    scaleOf: "each plant’s substrate",
    help: `Each rescue shot, and each shot holding the P3 dryback target, ${OF_SUBSTRATE}.`,
  },
  p3_time_between_shots: {
    label: "Time between P3 shots",
    short: "Time between P3 shots",
    help: "Every P3 shot, a rescue or one holding the P3 dryback target, waits at least this long after the last shot, so its water can reach the probes before moisture is read again. Shorter than a shot takes to show on the probes, and extra shots fire before the first one registers. 0 turns it off.",
  },
  field_capacity: {
    label: "Full saturation (most it holds)",
    short: "Full saturation",
    scale: "absolute",
    tag: "ceiling",
    help: "The wettest this substrate gets; the peak VWC target is capped here. It is not Athena’s field capacity, which is lower.",
  },
  max_daily_volume: {
    label: "Daily water limit",
    short: "Daily water limit",
    help: "The most water this zone gets in one grow-day, lights-on to lights-on: litres for all of its plants together, not per plant. Routine shots stop at it; ramp, rescue and watchdog shots and high-EC flushes can go past it.",
  },
  maximum_ec: {
    label: "Maximum substrate EC",
    short: "Maximum EC",
    help: "At this substrate EC a flush fires in any phase (in P2, from 1 mS/cm below it), when the feed is weaker than the substrate (the feed's EC is the Feed EC of the feed recipe in use, on Feed → Reservoir, or 3.0 mS/cm without one). If the feed isn't weaker, or moisture is within 2 points of full saturation, the zone gets no shots at all, rescue and watchdog included, until its EC falls below this.",
  },
  watchdog_hours: {
    label: "Watchdog interval",
    short: "Watchdog interval",
    help: "A safety net while the lights are on: a zone below its maintenance trigger that has had no shot for this many hours gets a maintenance-sized shot, even when the daily water limit is spent or a schedule is holding its shots. Never in P0. 0 turns it off.",
  },
  max_shot_duration: {
    label: "Longest shot",
    short: "Longest shot",
    help: "The longest any valve in this room stays open for one shot. A longer planned shot is cut short and delivers less.",
  },
  substrate_volume: {
    label: "Substrate per plant",
    short: "Substrate per plant",
    help: "Litres of substrate in each plant’s pot or block. Shot sizes are a percentage of it.",
  },
  plant_count: {
    label: "Plants",
    short: "Plants",
    help: "Plants in this zone. A shot’s water is its size times the substrate per plant, times this.",
  },
  drippers_per_plant: {
    label: "Drippers per plant",
    short: "Drippers per plant",
    help: "With the dripper flow, this sets how long a shot runs: its water divided by the zone’s total dripper flow.",
  },
  dripper_flow_rate: {
    label: "Dripper flow",
    short: "Dripper flow",
    help: "Litres per hour from each dripper.",
  },
  pump_prime_time: {
    label: "Pump prime time",
    short: "Pump prime",
    help: "Seconds the pump runs before the main line and the zone’s valve open, so the line is at pressure when water starts. Set it to how long your pump takes to reach pressure. A shot’s time and water count from the zone’s valve opening.",
  },
  main_line_lead_time: {
    label: "Main line lead time",
    short: "Main line lead",
    help: "Seconds the shared main-line valve is open before the zone’s valve opens.",
  },
  lights_on_hour: {
    label: "Lights on",
    short: "Lights on",
    help: "The hour the lights come on, on the controller’s clock. The grow-day and P0 start here.",
  },
  lights_off_hour: {
    label: "Lights off",
    short: "Lights off",
    help: "The hour the lights go off. Any zone not yet in P3 moves to P3.",
  },
};

const EC_WORDS: Record<string, SettingWords> = {
  "0": {
    label: "Substrate EC target, P0",
    short: "P0 EC target",
    help: "In P0, a flush fires when substrate EC is more than 2.5 times this.",
  },
  "1": {
    label: "Substrate EC target, P1",
    short: "P1 EC target",
    help: "At the peak VWC target, the ramp ends only once substrate EC is no more than 15% above this (or after the most P1 shots).",
  },
  "2": {
    label: "Substrate EC target, P2",
    short: "P2 EC target",
    help: "Maintenance shots are sized against this; more than 20% above it, a dilution shot runs.",
  },
};

const DRYBACK_WORDS: SettingWords = {
  label: "P3 dryback target",
  short: "P3 dryback target",
  scale: "relative",
  scaleOf: "the day’s peak",
  tag: "dries",
  help: "How far to dry back overnight, relative to the day’s peak: a 30% dryback from a 60% peak ends at 42%, and P3 holds it there.",
};

// The "?" text. Quotes are the handbook's own words, with its printed page; the rest is what the
// engine does, from decide() and the controller's parameter reads.
const AUTO = "The controller adjusts this zone’s value itself. Auto setpoints is off by default.";
const EC_STAGES =
  "Substrate EC targets by growth stage: veg 3 to 5, flower stretch 4 to 10, bulk 3.5 to 6, finish 3 to 4 (p. 40).";
const DETAILS: Record<string, SettingDetail> = {
  p0_maximum_wait_time: {
    what: "How long after lights-on the first shot can wait: Athena’s “transpiration before irrigation”.",
    when: "P0 ends and the ramp starts at the first of: this long after lights-on; moisture at or below the maintenance trigger; moisture down by the additional dryback from its highest reading since lights-on. The ramp’s first shot then fires straight away, unless moisture is still at the peak VWC target.",
    athena:
      "Additional dryback is “the decrease in VWC% that occurs during P3, after the lights turn on and before the first irrigation event of the day” (p. 33): 1 to 5%, first shot 30 minutes to 2 hours after lights-on (p. 39). The P1 page says 1 to 2 hours (p. 36).",
  },
  p0_dryback_drop_percent: {
    what: "How far the substrate dries after lights-on before the first shot, as a percentage of its reading at lights-on: Athena’s additional dryback, the plants drinking before they are watered.",
    when: "In P0, the ramp starts once moisture is this far below its highest reading since lights-on, unless the latest first shot or the maintenance trigger comes first. 3% unless changed.",
    affects:
      "When the ramp starts: a bigger additional dryback starts it later, after more drinking. The overnight dryback is the P3 dryback target’s.",
    athena:
      "“The decrease in VWC% that occurs during P3, after the lights turn on and before the first irrigation event of the day” (p. 33): 1 to 5% (p. 39).",
  },
  p1_target_vwc: {
    what: "The moisture the morning ramp brings the substrate up to: the top of the day’s range. Athena calls it the Peak VWC% Target.",
    when: "In P1, a ramp shot fires while moisture is below it (or below full saturation, if that is lower) and the time between P1 shots has passed. P1 hands over to P2 once moisture has reached it, the P1 minimum shots have fired (3 by default, set in Home Assistant) and substrate EC is no more than 15% above the P1 target; or after the most P1 shots.",
    affects:
      "Where the day peaks, which the P3 dryback target is measured from, and how much runoff the ramp makes. The maintenance trigger is always kept at least 1 point below it.",
    auto: AUTO,
    athena:
      "“The goal for maximum VWC% established by the last P1 event and maintained throughout the P2 phase” (p. 33). Set between field capacity and full saturation it forces runoff (vegetative); at or below field capacity it restricts runoff (generative) (p. 40).",
  },
  p1_initial_shot_size: {
    what: `The size of the ramp’s first shot, ${OF_SUBSTRATE}.`,
    when: "The first shot of P1. Each later ramp shot adds “Each P1 shot adds” to the one before, until the most P1 shots.",
    affects:
      "Ramp shots are sized by substrate EC against the P1 target: up to twice this while EC is well above it, as little as half while it is well below.",
    athena:
      "2 to 6% shots, 15 to 30 minutes apart, saturate slowly and avoid channelling (p. 36). A 1% shot of a 4 L pot is 40 mL (p. 40).",
  },
  p1_shot_size_increment: {
    what: `How much bigger each ramp shot is than the one before, ${OF_SUBSTRATE}.`,
    when: "Every P1 shot after the first: the third shot, for example, is the first P1 shot plus twice this.",
  },
  p1_time_between_shots: {
    what: "The wait between ramp shots.",
    when: "A ramp shot fires only once this long has passed since the last shot, so each one can soak in.",
    athena:
      "“2%-6% shots, spaced 15-30 minutes apart allows the substrate to gradually build up to target VWC%” (p. 36).",
  },
  p1_maximum_shots: {
    what: "The most shots the ramp fires.",
    when: "After this many ramp shots P1 hands over to P2, wherever moisture is. P2 then waters whenever moisture reads below the maintenance trigger.",
  },
  p1_minimum_shots: {
    what: "The fewest shots the ramp fires before it hands over to P2.",
    when: "Each time the controller checks in P1, reaching the peak VWC target moves the zone to P2 only once this many ramp shots have gone in. Until then the zone stays in P1, and a ramp shot fires whenever moisture is back below the peak target.",
    affects:
      "How many small shots build the morning up, and so how wet the substrate is at the top of the day. The most P1 shots still ends the ramp: a minimum above it runs as that maximum.",
  },
  p2_vwc_threshold: {
    what: "The level that triggers a daytime maintenance shot. The peak VWC target minus this is how far the substrate dries back during the day.",
    when: "Each time the controller checks in P2 (every minute by default), from the end of the ramp until P3: whenever moisture reads below it, a maintenance shot fires, once the time between P2 shots has passed since the last shot. It is a level, not a crossing: moisture does not need to have been above it first, and reading exactly the value does not fire. The daily water limit still applies.",
    affects:
      "How often maintenance shots fire, runoff and substrate EC. In P0, reaching it ends the wait and starts the ramp. After P0, with lights on, the watchdog waters a zone below it that has had no shot for the watchdog interval. It is always kept at least 1 point below the peak VWC target and 3 points above the rescue level, whatever is entered.",
    stacking:
      "Moved 1 point down while substrate EC is under 90% of the P2 target (a bigger dryback, less runoff) and 1 point up while it is over 110%, checked every 30 minutes.",
    auto: "The controller adjusts this zone’s value itself: by day, one maintenance shot under the peak VWC target; from the time its plan stops maintenance shots for the dryback (3 hours before lights-off at the earliest on a vegetative zone, the middle of the day on a generative one), 2 points under where the P3 dryback target ends, through the night and P0, so nothing tops the zone up and P0 still runs. Auto setpoints is off by default.",
    athena:
      "Athena names the maintenance shots, not this level. P2 “is used to maintain a desired VWC% throughout the lights on period” (p. 37), and “as plants grow and the rate of dryback increases it is now necessary to add P2 events to keep the substrate from drying back too much” (p. 38). Here, that means raising this level.",
  },
  p2_shot_size: {
    what: `The size of each maintenance shot, ${OF_SUBSTRATE}.`,
    when: "Every maintenance shot. Watchdog shots use it as it is; dilution and high-EC flushes are 1.5 times it or more.",
    affects:
      "Maintenance shots are sized by substrate EC against the P2 target, from half to twice this. Bigger shots make more runoff and lower substrate EC.",
    athena:
      "“Decrease Substrate EC: Increase shot size”; “Increase Substrate EC: Decrease shot size” (p. 38).",
  },
  p2_time_between_shots: {
    what: "The least time from the last shot to a maintenance shot.",
    when: "Under the maintenance trigger, a maintenance shot fires only once this long has passed since the last shot of any kind, so its water can reach the probes before moisture is read again. Read sooner, moisture has not moved yet and shots stack a minute apart. 0 turns it off: a shot every time the controller checks and moisture reads below the trigger.",
    affects:
      "How fast a zone below its trigger is brought back up: one maintenance shot each time this passes until moisture reads at the trigger. Dilution and rescue flushes keep their own 10-minute wait; the watchdog does not wait for this, and P3 shots wait the time between P3 shots instead.",
    athena:
      "Athena spaces P1 shots 15 to 30 minutes apart so each can soak in (p. 36); it gives no spacing for P2 events.",
  },
  p3_emergency_vwc_threshold: {
    what: "The overnight safety level. It is not an Athena setting.",
    when: "Each time the controller checks in P3, a rescue shot fires if moisture reads below it, once the time between P3 shots has passed since the last shot. The daily water limit does not hold rescue shots.",
    affects:
      "It can cut the P3 dryback short: if the P3 dryback target ends below this level, a rescue shot fires before the substrate gets there. Otherwise it is the floor beneath the level P3 holds the zone at. The maintenance trigger is always kept at least 3 points above it.",
    auto: AUTO,
    athena:
      "“Caution: make sure to monitor the drybacks in larger plants to avoid drying back past wilting point” (p. 41). Set this above the wilting point.",
  },
  p3_emergency_shot_size: {
    what: `The size of each rescue shot, and of each shot that holds the P3 dryback target, ${OF_SUBSTRATE}.`,
    when: "Every P3 shot: a rescue below the rescue level, which the daily water limit does not hold, and a hold at the P3 dryback target, which it does.",
  },
  p3_time_between_shots: {
    what: "The least time from the last shot to a P3 shot: a rescue, or a shot holding the P3 dryback target.",
    when: "In P3, under the rescue level or under where the P3 dryback target ends, a shot fires only once this long has passed since the last shot of any kind, so its water can reach the probes before moisture is read again. Read sooner, moisture has not moved yet: the controller checks every minute, and shots stack a minute apart until the water arrives. 0 turns it off: a shot every time the controller checks and moisture reads below the level.",
    affects:
      "How far one dip below a level overshoots it, and how fast a zone below its rescue level is brought back up: one shot each time this passes until moisture reads at the level. Set it longer than a shot takes to show on your probes; a slow probe, or a deep pot, needs more. 10 minutes unless changed.",
    athena:
      "Shots in P3, the rescue and the dryback hold, are this controller’s own, not Athena’s. Athena spaces P1 shots 15 to 30 minutes apart so each can soak in (p. 36).",
  },
  field_capacity: {
    what: "The wettest the substrate can be: the ceiling for the peak VWC target.",
    when: "The ramp stops at the lower of this and the peak VWC target. EC flushes and dilution shots only run while moisture is more than 2 points below it. The zone’s safety status reports approaching saturation within 5 points of it, and over-saturated at or above it.",
    auto: AUTO,
    athena:
      "Full saturation: “a substrate can no longer hold anymore water and peak VWC% can no longer increase” (p. 33), and a target above it “is a target that is impossible to reach” (p. 40). That is how this setting behaves. Field capacity, “maximum VWC% of a substrate prior to runoff” (p. 33), is lower: enter that here and a vegetative peak target above it (p. 40) is capped and never reached.",
  },
  max_daily_volume: {
    what: "The most water this zone gets in one grow-day, in litres for all of its plants together: not per plant, and not for the whole room. Each zone has its own.",
    when: "Every shot’s water counts toward it: its size, times each plant’s substrate, times the plants in the zone. The count starts again at lights-on, not at midnight. Once it is spent, maintenance shots, dilution shots and the shots holding the P3 dryback stop until lights-on.",
    affects:
      "Ramp shots, rescue shots, watchdog shots and high-EC flushes still go past it, so a zone is never left to dry out or lock out. Under the field, the same limit is shown per plant.",
  },
  watchdog_hours: {
    what: "A safety net for daytime watering, in hours: a zone that needs water is never left without it for long.",
    when: "While the lights are on and P0 is over, a zone that reads below its maintenance trigger and has had no shot for longer than this gets a maintenance-sized shot. Normally a maintenance shot comes first, so it fires when routine shots have stopped: the daily water limit spent, a schedule holding the zone, or the zone in P3 before lights-off.",
    affects:
      "Neither the daily water limit nor a held schedule stops it. If something blocks watering altogether (watering switched off, a hardware fault, a refill), the controller raises an urgent alert, CS-207, once the zone has gone this long instead. 0 turns off both.",
  },
};
const EC_DETAILS: Record<string, SettingDetail> = {
  "0": {
    what: "The substrate (pore water) EC reference for P0.",
    when: "In P0, a 10% flush fires when substrate EC is more than 2.5 times this, the feed is weaker than the substrate and moisture is more than 2 points below full saturation.",
    athena: EC_STAGES,
  },
  "1": {
    what: "The substrate (pore water) EC the ramp checks before it hands over.",
    when: "At the peak VWC target, P1 ends only once substrate EC is no more than 15% above this. Until then, while the feed is weaker than the substrate and there is room below full saturation, the ramp keeps shooting at the ceiling to flush, up to the most P1 shots.",
    affects:
      "Ramp shots are sized 1.2×, 1.5× or 2× while EC is above this (by up to 20%, up to 50%, or more), and 0.7× or 0.5× while it is under 80% or 50% of it.",
    auto: "After a ramp levels off, the controller may raise this (never above the P2 target) so a finished ramp can hand over. Auto setpoints is off by default.",
    athena: EC_STAGES,
  },
  "2": {
    what: "The substrate (pore water) EC the day is steered toward.",
    when: "Maintenance shots are sized against it, from half to twice the maintenance shot size. More than 20% above it, a dilution shot of 1.5 times the maintenance shot runs, if the feed is weaker than the substrate and there is room below full saturation.",
    stacking: "The maintenance trigger moves to steer substrate EC toward it.",
    athena: EC_STAGES,
  },
};
const DRYBACK_DETAIL: SettingDetail = {
  what: "How far the substrate should dry back overnight, as a percentage of the day’s peak: a relative change. A 30% dryback from a 65% peak ends at 45.5%. The zone’s steering mode picks the vegetative or generative one.",
  when: "Overnight the substrate dries to it and is held there: each time the controller checks in P3 and moisture reads below where it ends, a shot the size of a rescue shot fires, once the time between P3 shots has passed since the last shot. The daily water limit holds these shots. In the last 3 hours before lights-off, maintenance shots stop early if drying this far by lights-on needs the rest of the night (and no more than 12 hours). The drying after lights-on, before the first shot, is P0’s own additional dryback.",
  affects: "When P2 ends, and so substrate EC: a bigger dryback raises it.",
  athena:
    "P3 dryback targets: vegetative 30 to 40% (less stress), generative 40 to 50% (more stress), “based on a relative change” (p. 39). By growth stage, the veg stage dries back 50% the first time, then 25% (p. 40). “The grower can control the amount of dryback by adding or subtracting P2 shots at the end of the day” (p. 37): stopping maintenance shots early is how the controller does that. Holding the dryback with shots overnight is this controller’s own, not Athena’s.",
};

const MODE: Record<string, string> = {
  veg: "vegetative",
  vegetative: "vegetative",
  gen: "generative",
  generative: "generative",
};
/** The mode in a short name: "P1 EC target (Veg)". */
const MODE_SHORT: Record<string, string> = {
  veg: "Veg",
  vegetative: "Veg",
  gen: "Gen",
  generative: "Gen",
};
const withMode = (words: SettingWords, mode: string | undefined): SettingWords =>
  mode
    ? {
        ...words,
        label: `${words.label} (${MODE[mode]})`,
        short: `${words.short} (${MODE_SHORT[mode]})`,
      }
    : words;

/** Words for a setting key: an entity's parameter ("zone_1_" already removed), or the Schedule's
 * mode-resolved key ("dryback_target", "ec_target_p1"). Undefined for a key nobody has named. */
export function settingWords(param: string): SettingWords | undefined {
  const ec = param.match(/^ec_target_(?:(veg|gen)_)?p([012])$/);
  if (ec) return withMode({ ...EC_WORDS[ec[2]], detail: EC_DETAILS[ec[2]] }, ec[1]);
  const dryback = param.match(/^(?:(vegetative|generative)_)?dryback_target$/);
  if (dryback) return withMode({ ...DRYBACK_WORDS, detail: DRYBACK_DETAIL }, dryback[1]);
  const key = param === "maximum_shot_duration" ? "max_shot_duration" : param;
  return WORDS[key] && { ...WORDS[key], ...(DETAILS[key] ? { detail: DETAILS[key] } : {}) };
}
