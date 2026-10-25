# What's new

The dashboard's **What's new** window shows these to the first person who opens the dashboard after
an update: every release since the last one it showed there, newest first, at most five. A new
installation has nothing to catch up on and shows none. **Help → What's new** opens it again at
any time.

A change a grower would notice adds one line under `## Unreleased` at the top, in its own pull
request, and `scripts/release.py` dates them as the release. Write it for growers, not for the
people who build the system:

- **At most five short lines a release**, one for each change a grower would notice: what they can
  now do or see, in plain words, not how it was built.
- **No entity ids, error codes, file names, pull request numbers or code.** The release notes and
  the changelog keep the detail, and the window links to them.
- **Put the small things together** as one last line: `Bug fixes and improvements.` A release with
  nothing a grower would notice has only that line.
- Each line starts with `- `. The release command writes the heading,
  `## <version> - <release date, YYYY-MM-DD>`, and puts the small things last.

`tests/test_whats_new.py` checks the shape and the plain words, and that the newest section is the
version being released.

## Unreleased

- See when your reservoir will need refilling, estimated from how fast it went down over the last day.

## 1.5.2 - 2026-10-24

- Automatic targets no longer pause when a probe feels the morning's water late: the ramp is judged once it is over.

## 1.5.1 - 2026-10-22

- Choose the order your rooms are listed in, in Settings, the same on every device.
- Setup now says which EC reading to pick for each zone, pore-water EC (pwEC), and lists those first.

## 1.5.0 - 2026-10-22

- Rooms where one valve waters every zone can now be set up: the zones keep their own readings and share every shot, phase and target.
- Mapping a sensor or renaming no longer needs watering off; a change that does is picked up within a minute, and watering waits for it.
- A room switched to Steering that isn't watering now says Steering · on hold, in amber, instead of plain Steering.
- Bug fixes and improvements.

## 1.4.0 - 2026-10-19

- Coming up lists every shot expected for the rest of the day, not just the next one, and agrees with each zone's card.
- The Overview's clock shows the next shot in its middle, labels lights-on and lights-off, and marks the shots still to come.
- With one zone across the page, its card adds today's peak, the dryback from it and the last shot.
- Bug fixes and improvements.

## 1.3.1 - 2026-10-17

- A room that is Watching only has a Start steering button right where it says it isn't watering.
- The Overview's zone cards fill the page: one zone across it, two side by side, three a row.
- Bug fixes and improvements.

## 1.3.0 - 2026-10-17

- A new look on every page, alike on a phone, a tablet and a computer: the room's day as a clock, what comes next, and a card for each zone.
- How a room runs is one choice, Steering, Watching only or Room off, and you can see at a glance whether it follows its schedule or Today's targets.
- Feed has a Recipes tab, Insights shows each zone's week, setting up a room asks less, and you can choose the room this device opens on.
- Today can switch EC stacking on and set the minimum P1 shots, and a zone paused by hand in Home Assistant can be resumed from its details.
- Bug fixes and improvements.

## 1.2.0 - 2026-10-16

- Each zone on the Overview has a ⋯ menu: move it to another phase, pause it, edit its strategy or open its details.
- Each percentage on Today and the Schedule is marked as a moisture reading or a share of something else.
- Saving Rooms & hardware lists only what you changed, not the whole room.
- Bug fixes and improvements.

## 1.1.1 - 2026-10-12

- Overnight shots now wait 10 minutes after the last one, so the water reaches the probe before the next. Change it with Time between P3 shots on the P3 card.
- Bug fixes and improvements.

## 1.1.0 - 2026-10-10

- Export your room’s targets from Today and import them into another room, or send them to someone.
- The Schedule page now explains how a schedule and Today’s targets take turns, and which one is in charge.
- When a pump or valve doesn’t switch off, the alert names it and says what it read, and its zones show as blocked.
- Bug fixes and improvements.

## 1.0.3 - 2026-10-09

- PHASE Steering is now PHASE Control, and Help says what PHASE stands for.

## 1.0.2 - 2026-10-09

- Crop Steering is now PHASE Steering, short for Precision Hydration And Steering Engine, with a new icon.

## 1.0.1 - 2026-10-08

- Unified naming of Irrigation Strategy and Feed Recipes.
- Feed EC now set per-recipe to allow for steering at lower EC rootzones, defaults to 3.0EC where not set.
- Bug fixes and improvements.

## 1.0.0 - 2026-10-05

- This is version 1.0, the first release for everyone.
- A new icon, a tank of water with a seedling in front of it: in the menu, in HACS and in Settings → Apps.
- Bug fixes and improvements.
