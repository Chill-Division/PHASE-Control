# Unreleased

- The top bar's Home Assistant button is gone; Home Assistant's menu opens from the bottom of the side menu (☰ on a phone).
- Two old, hidden switches are gone, so only the room's own Watering switch ever switches watering on and off.
- Old controls Home Assistant showed that didn't water anything are gone, among them Irrigation Phase and Strategy Stage.
- Rooms & hardware no longer asks for the room's lights, which nothing used: day and night come from the lights-on and lights-off times.
- Today can switch EC stacking on and set the minimum P1 shots, and a zone paused by hand in Home Assistant shows it and can be resumed.
- The log names the P1 shot limits Minimum P1 shots and Maximum P1 shots, as the dashboard does.
- The dashboard is redesigned for a phone, a tablet and a computer alike: the room's day as a clock, a card for each zone, and how a room runs as one choice.

# 1.2.0

Pair with integration 1.2.0.

- Each zone on the Overview has a ⋯ menu: move it to another phase, pause it, edit its strategy or open its details.
- Each percentage on Today and the Schedule is marked as a moisture reading or a share of something else.
- Saving Rooms & hardware lists only what you changed, not the whole room.
- Bug fixes and improvements.

# 1.1.1

Pair with integration 1.1.1.

- Overnight shots now wait 10 minutes after the last one, so the water reaches the probe before the next. Change it with Time between P3 shots on the P3 card.
- Bug fixes and improvements.

# 1.1.0

Pair with integration 1.1.0.

- Export your room’s targets from Today and import them into another room, or send them to someone.
- The Schedule page now explains how a schedule and Today’s targets take turns, and which one is in charge.
- When a pump or valve doesn’t switch off, the alert names it and says what it read, and its zones show as blocked.
- Bug fixes and improvements.

# 1.0.1

Pair with integration 1.0.1.

- Unified naming of Irrigation Strategy and Feed Recipes.
- Feed EC now set per-recipe to allow for steering at lower EC rootzones, defaults to 3.0EC where not set.
- Bug fixes and improvements.
