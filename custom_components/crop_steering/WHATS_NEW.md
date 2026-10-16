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

- The top bar's Home Assistant button is gone; Home Assistant's menu opens from the bottom of the side menu (☰ on a phone).
- Two old, hidden switches are gone, so only the room's own Watering switch ever switches watering on and off.
- Old controls Home Assistant showed that didn't water anything are gone, among them Irrigation Phase and Strategy Stage.

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
