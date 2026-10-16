# How PHASE Control works

This page explains, in plain words, how PHASE Control decides when to water and how much, so you
can tell why a zone did what it did without reading any code. It is about the reasoning; the
[User guide](USER_GUIDE.md) is about using the dashboard, and every setting's **?** on
**Irrigation strategy → Today** says what that one setting does.

Where the [Athena Handbook](https://athenaag.com) gives guidance, its page number is given beside it.

- [The short version](#the-short-version)
- [The grow day in four phases](#the-grow-day-in-four-phases)
- [Dryback](#dryback)
- [The rescue level](#the-rescue-level)
- [Auto setpoints](#auto-setpoints)
- [Vegetative and generative](#vegetative-and-generative)
- [Substrate EC](#substrate-ec)
- [Limits, holds and safety nets](#limits-holds-and-safety-nets)
- [Reading the grow-day chart](#reading-the-grow-day-chart)
- [Feeding: the reservoir](#feeding-the-reservoir)
- [Common questions](#common-questions)

## The short version

- **Every minute**, the controller reads each zone's moisture (VWC) and substrate EC, works out which
  phase of the day the zone is in, and decides whether it needs a shot and how big.
- **Nothing guesses.** The same readings, settings and time of day always give the same decision, and
  the dashboard shows the numbers behind each one. No AI makes any decision.
- **A grow day is one photoperiod,** lights-on to the next lights-on. The day's shot and water
  counters start again at lights-on, not at midnight.
- **Shots are a percentage of the substrate.** A 3% shot on 40 plants with 5 L each is 6 L; how long
  the valve stays open comes from your drippers and their flow (**Settings → Rooms & hardware**).

## The grow day in four phases

![Today's targets graph: a zone's targets for each phase, the recorded day and a projected one, with the four phases along the bottom](../img/plan-graph.png)

| Phase                  | What happens                                                                 | What ends it                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **P0** morning dryback | No routine watering. The plants start drinking before the first shot.        | The first of: moisture down by the **Additional dryback**; the **Latest first shot** time; moisture at the maintenance trigger. |
| **P1** ramp            | A shot every **Time between P1 shots**, up to the **Peak VWC target**.       | The peak target reached (with substrate EC back near its target), or **Maximum P1 shots** fired. Lights-off.                    |
| **P2** maintenance     | A shot each time moisture falls below the maintenance trigger.               | Lights-off, or a little earlier when the overnight dryback needs the time.                                                      |
| **P3** overnight       | No routine watering. The zone dries back, and is held at its dryback target. | Lights-on: the next day's P0.                                                                                                   |

### P0: the morning dryback

Athena calls this "transpiration before irrigation": the plants start drinking before the substrate
is watered. P0 ends, and P1 starts, at the first of:

- moisture falls by the **Additional dryback** (3% unless changed) below its highest reading since
  lights-on. Athena's additional dryback is 1 to 5% (p. 39);
- the **Latest first shot** time after lights-on passes. Athena puts the first shot 30 minutes to
  2 hours after lights-on (p. 39), and 1 to 2 hours on its P1 page (p. 36);
- moisture is already at or below the maintenance trigger.

So how long P0 lasts depends on how fast the plants drink in the morning: often the additional
dryback comes first, and the latest first shot is only the limit.

### P1: the ramp

A shot every **Time between P1 shots**, starting at **First P1 shot** and growing by **Each P1 shot
adds**, until moisture reaches the **Peak VWC target**. Athena: "2%-6% shots, spaced 15-30 minutes
apart allows the substrate to gradually build up to target VWC%" (p. 36).

The ramp ends when moisture reaches the peak target and substrate EC is back within 15% of the P1 EC
target (with no EC reading, once at least one shot is in), or when **Maximum P1 shots** have fired.
There is deliberately no time limit: a ramp that is held up (a refill in progress, say) waits and
carries on. Lights-off is the only other way out. The peak target is capped at **Full saturation**,
the most the substrate can hold: a target above it could never be reached.

### P2: maintenance

A **Maintenance shot size** shot each time moisture reads below the maintenance trigger (**Maintenance
shot when below**), at least **Time between P2 shots** after the last shot, so each one can soak down
to the probe before moisture is judged again. The peak down to the trigger is the daytime dryback.

In its last 3 hours, P2 can hand over to P3 early: if, at the rate the zone is drying, reaching the
dryback target would take every hour left until lights-on, the night's dryback starts now instead of
at lights-off.

### P3: overnight

P3 stops routine watering and lets the zone dry back toward its **P3 dryback target**. If it gets
there, the zone is held there: a **Rescue shot size** shot each time it dries under that level. Under
the **rescue level**, a rescue shot fires. At lights-on the zone goes back to P0, and a new grow day
begins.

Every P3 shot, hold or rescue, waits at least **Time between P3 shots** after the last shot (10
minutes unless changed), so its water can reach the probe before moisture is read again. The
controller checks every minute: read sooner, moisture has not moved yet, and a zone still reading
low would get another shot each minute until the water arrived. Set it longer than a shot takes to
show on your probes.

Lights-off ends P1 and P2 straight away: no zone carries a half-finished ramp into the night.

## Dryback

The dryback target is a **percentage of the day's peak**, not percentage points, as Athena uses it.
A 40% dryback from an 80% peak ends at 48% VWC (80 × 0.6), not at 40%.

Athena's P3 dryback targets are 30 to 40% for vegetative and 40 to 50% for generative (p. 39). A new
room starts at 35% vegetative and 45% generative, the middle of each.

How far a zone actually dries overnight comes down to four things:

1. **Where it starts at lights-off.** A zone topped up at 7 pm starts the night near its peak; one
   whose maintenance shots stopped at 3 pm has already dried for hours. Athena: "The grower can control
   the amount of dryback by adding or subtracting P2 shots at the end of the day" (p. 37).
2. **How fast the plants drink at night.** With the lights off they drink far less than by day, so
   the night dries a zone much more slowly than the afternoon did.
3. **The target is a floor, not a pull.** P3 stops the zone drying past the target; it never makes it
   dry faster. A slow night simply ends above the target.
4. **The rescue level beneath it.** A target that would end under the rescue level cannot be reached:
   the rescue stops the zone there.

## The rescue level

**Rescue shot when below** is your emergency floor. In P3, a rescue shot fires whenever moisture reads
under it, at least **Time between P3 shots** after the last shot, even when the day's water limit is
spent. Athena: "Caution: make sure to monitor the
drybacks in larger plants to avoid drying back past wilting point" (p. 41). Set it above the wilting
point.

Nothing automatic moves it. Auto setpoints never changes it; the other targets keep clear of it
instead: the maintenance trigger stays at least 3 points above it, and a dryback planned to end under
it is planned only as deep as it allows.

## Auto setpoints

![Irrigation strategy → Today: the Auto setpoints line shows what each zone has learned and tonight's plan](../img/manual-setpoints.png)

Auto setpoints is optional, one switch per room (**Auto setpoints on** or **Turn auto off…** on the
Irrigation strategy). It never fires a shot itself: the engine still waters by the rules above. It keeps
three settings attainable for each zone, from how that zone has actually behaved: the **Peak VWC
target**, **Full saturation** and the **maintenance trigger**. After a ramp that has stopped climbing,
it may also raise the zone's **P1 EC target**, just enough for the ramp to hand over to P2 and never
above the zone's P2 EC target: once moisture has stopped rising, more water at the top only runs
off. It never touches the rescue level, the dryback target or any timing.

### What it learns

- **What a shot keeps.** For each shot, the rise that is still there 20 minutes later (or just before
  the next shot). The first minutes after a shot read the water still draining, not what the substrate
  kept.
- **How fast the zone dries,** by day and by night, from quiet spells at least 30 minutes after a
  shot. Each morning, the learned rate moves 30% of the way toward the grow day just gone, so one odd
  day doesn't swing it.
- **Where the substrate is full.** When the last two ramp shots stop lifting moisture, the zone has
  reached its peak: that becomes the peak target. It is held for 3 days, then tried 1 point higher. A
  ramp that reaches its target while still climbing aims a point higher the next day.

Until it has two days of each drying rate, it only keeps the peak target and the maintenance trigger
near the zone's peak; the day plan below starts after that. A ramp that barely climbed, or stalled
well under a peak the zone has reached before, looks like a delivery or probe problem: nothing is
learned or changed, and the zone's Auto line says to check the dripper, line and probe.

### How it plans the day

- **Maintenance trigger, through the day:** the peak less what one maintenance shot lifts, so each
  shot tops the zone back up to about its peak.
- **When maintenance shots stop:** as late as they can, while leaving the rest of the day and the
  night enough time to reach the dryback target, by the zone's learned drying rates. A vegetative
  zone keeps them until at least 3 hours before lights-off, a generative one until the middle of the
  day. P1 always runs in full.
- **After that stop, overnight and through P0:** the trigger drops to 2 points under where the planned
  dryback ends, so no top-up fires and P0 runs its course.
- **Never against the rescue level:** the trigger stays at least 3 points above it, and a dryback that
  would end under it is planned only as deep as it allows, with its hold 5 points above it.

Big moves are taken in steps of up to 10 points a minute, so **Today's events** can show the
maintenance trigger change three times in a row as P2 begins.

When tonight's dryback is out of reach, the zone's Auto line says so, for example _"45% dryback
unreachable at this zone's uptake: about 30% tonight, with maintenance shots until 19:00"_. It keeps
learning: a night slower than it expected brings the next day's stop earlier, a little at a time.

An armed irrigation strategy owns its room's targets. While one is in control, Auto setpoints stands back.

## Vegetative and generative

Each zone has a **steering mode** (or the room's growth stage, when the zone has none). It picks:

- which **P3 dryback target** applies, the vegetative or the generative one;
- which set of **substrate EC targets** each phase uses;
- for Auto setpoints, how early maintenance shots may stop.

Athena: "A smaller dryback creates less stress on the plant forcing more vegetative growth cues", and
"A large dryback stresses the plant forcing more generative growth cues" (p. 37). A peak target between
field capacity and full saturation forces runoff (vegetative); one at or below field capacity
restricts it (generative) (p. 40).

## Substrate EC

When a zone's probe reads EC, EC shapes the watering:

- **Shot size follows EC.** Substrate EC well over the phase's target makes shots bigger (up to
  double, to dilute); well under it, smaller (down to half). Athena: "Decrease Substrate EC: Increase
  shot size"; "Increase Substrate EC: Decrease shot size" (p. 38).
- **P1 waits for EC.** The ramp hands over only once EC is within 15% of the P1 target.
- **Diluting shots.** In P2, EC more than 20% over target fires a larger shot to bring it down,
  when the feed is weaker than the substrate and there is room for the water. The feed's EC is the
  **Feed EC** of the feed recipe in use (Feed → Reservoir); without one, the controller counts the
  feed as 3.0 mS/cm, and so dilutes only a substrate above that.
- **Never locked out.** At the **Maximum substrate EC**, a flush fires in any phase, when the water can
  dilute it. In P0, the only shot is a flush when EC is over 2.5 times the P0 target.
- **EC stacking** (a room switch) nudges the maintenance trigger by up to a point every half hour: down
  when EC is under 90% of the P2 target (fewer top-ups, so EC builds), up when over 110%.
- **Settled readings only.** For about 45 minutes after a shot the probe reads the fresh feed passing
  through, not the substrate, so EC rules wait for a settled reading.

With no EC reading, a zone waters by moisture alone, and Home Assistant shows why.

## Limits, holds and safety nets

**Switches.**

| Switch       | Off means                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Room**     | Nothing growing: no watering, no refills, no alerts. Readings still show.                                          |
| **Watering** | No shots and no refills or dosing. Phases, peaks and what each zone is waiting for are still worked out and shown. |
| A **zone**   | That zone gets no shots; the rest of the room carries on.                                                          |

![A room switched off: no irrigation, no alerts, readings still shown](../img/room-off.png)

**Daily water limit.** Each zone's day has a water budget. Routine shots stop when it is spent; the
P1 ramp, rescue shots, the EC anti-lockout flush and the watchdog still go.

**Watchdog.** With the lights on and outside P0, a zone that has had no water for the **Watchdog
interval** (3 hours unless changed) while under its maintenance trigger gets a maintenance-sized shot,
even when the day's water limit is spent.

**Held.** A due shot waits, and **Today's events** says why, while:

- the room's reservoir is refilling, dosing or mixing;
- the shot would take the reservoir under its minimum (a refill comes first);
- the controller has just started and is still reading the room's settings (up to 3 minutes);
- a pump, main line or valve switch reads neither on nor off (its device is offline);
- the zone is under manual override;
- a hardware fault has latched: switch watering off, fix it, check everything reads off, switch
  watering back on.

## Reading the grow-day chart

![The Overview: today's grow day for every zone](../img/operator-dashboard.png)

**Today's grow day** on the Overview runs from lights-on to the next lights-on, one row per zone.

- **The coloured bar** is the phase: P0 dryback, P1 ramp, P2 maintenance, P3 overnight. The dark band
  is lights-off.
- **The solid blue line** is today's moisture, and **the dashed blue line** a projection: an estimate
  from the zone's drying rates. **The grey line** is yesterday, or a grey band for a typical day
  (**Compare with**).
- **The dashed amber line** is the target for the phase: _Dries back to_ in P0, _Peak target_ in P1,
  _Maintenance trigger_ in P2 (_Maintenance stopped_ after Auto setpoints' planned stop), _Held at_ in
  P3.
- **The ticks** underneath are shots; dashed ones are expected shots. Other marks show a shot blocked
  or over the day's budget, one held by a gate, and a setting change (◇).

Point at or tap the chart for any moment. The line above each zone says where it stands, for example:

> _Zone 1 P3 · 67.1% now · +10.1 pts vs yesterday at 06:50 am · Peak target 84.9% not reached today ·
> ≈47.8 L so far · P3 dryback 21% of 45% from today's 84.9% peak · next: rescue shot if VWC < 50% (now
> 67.1%) · P0 at 07:00 am_

Here the zone has dried back 21% from today's peak, against a 45% target; the next thing that can
water it is a rescue shot under 50%, and P0 starts at lights-on.

**Today's events** lists the day in order: every shot with its reason (_P1 ramp VWC 71<85_, _P2
top-up VWC 80<80_), every hold, every phase change, and every setting change with who made it: a
person, **Auto setpoints**, or an automation by name (_Auto setpoints raised Maintenance trigger to
79.9% (was 73%)_).

## Feeding: the reservoir

![The Reservoir: a batch's steps, with the doses inside Fill and mix](../img/reservoir.png)

A room with a reservoir mapped mixes its own nutrient batches: by itself with **Automatic refills**
on, or when you ask for one with **Refill by hand…**. A batch refills the reservoir with fresh water; from
half-way through the fill, the pump and the recirculation line run, and the doses go in one doser at a
time, in the recipe's order. Then the batch recirculates to mix. The room's shots wait meanwhile.
Each recipe can also give its **Feed EC**, what it mixes to: the controller waters with that feed,
so it uses the recipe in use's to judge whether a flush or a diluting shot would bring the
substrate's EC down.

With the reservoir's level set up, a refill is planned before the room's next round of shots would
take it under its minimum, so no shot takes it under; if a refill cannot happen, watering waits.
Without automatic refills, a reminder says when to refill it by hand.

## Common questions

**Why didn't a zone reach its overnight dryback target?**
Usually it went into the night too wet, or the night was slower than expected. Check where it was at
lights-off on the grow-day chart: if maintenance shots ran late into the evening, the night started
near the peak. Auto setpoints learns from slower nights and stops maintenance earlier the next day, a
little at a time. For a deeper dryback sooner, a generative steering mode lets maintenance stop from
the middle of the day. A target that would end under the rescue level can't be reached at all.

**Why did P0 last as long as it did?**
It ends at the first of the additional dryback, the latest first shot and the maintenance trigger. A
slow morning reaches the additional dryback later; the **Latest first shot** caps how long that can
take.

**Why did P1 stop short of the peak target, or keep going?**
It stops at **Maximum P1 shots** even below the target. It keeps going at the target while substrate
EC is still more than 15% over the P1 EC target. With Auto setpoints on, a ramp whose last two shots
stop lifting moisture has found the zone's peak, and the target drops to it.

**Why did it water at night?**
In P3 a zone is held at its dryback target (a rescue-sized shot each time it dries past it) and rescued
under the rescue level. Neither is routine watering.

**Why did a zone get several shots close together overnight?**
Each P3 shot waits **Time between P3 shots** after the last one, then moisture is read again; a zone
still under the level gets another. If your probes take longer than that to show a shot, the next one
fires before the first has registered and the zone overshoots. Set the time longer than a shot takes
to show, or make the **Rescue shot size** smaller.

**Why did the maintenance trigger jump during the day?**
With Auto setpoints on it rises as P2 begins (in steps of up to 10 points a minute) and drops again at
the planned stop, so the night can dry. Every change is in **Today's events**.

**Why was a shot held?**
Something else had to come first: a refill, a setting still loading, an offline switch, a manual
override. **Today's events** names it, with how long it waited.

**Why doesn't Auto setpoints change my rescue level?**
It is your emergency floor. Only you change it.

**Is "Water today" measured?**
No: it is worked out from each shot's run time and your drippers' flow. A catch test or a flow meter is
what proves the water delivered.
