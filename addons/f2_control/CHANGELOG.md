# Unreleased

- The controller takes a saved setup change on within a minute, and one that changes no switch (a sensor, a name) with watering on.
- The dashboard keeps watering off after a saved setup change until the controller has taken it on.

# 1.4.0

Pair with integration 1.4.0.

- The dashboard's Coming up lists every shot expected for the rest of the day, and its next shot matches what the controller says.
- The Overview's clock shows the next shot in its middle, labels lights-on and lights-off, and marks the shots still to come.
- With one zone across the page, its card adds today's peak, the dryback from it and the last shot.
- Bug fixes and improvements.

# 1.3.1

Pair with integration 1.3.1.

- A zone held because its room is Watching only now says "watering off (Watching only)", and one whose watering switch Home Assistant can't read says "watering switch unavailable". Both used to say "room off (kill switch)".
- The Overview's zone cards fill the page: one zone across it, two side by side, three a row, and more beneath.
- Bug fixes and improvements.

# 1.3.0

Pair with integration 1.3.0.

- The dashboard is redesigned for a phone, a tablet and a computer alike: the room's day as a clock, a card for each zone, and how a room runs as one choice.
- Today can switch EC stacking on and set the minimum P1 shots, and a zone paused by hand in Home Assistant can be resumed from its details.
- Two old, hidden switches that could stop watering are gone: only the room's own Watering switch turns watering on and off.
- The log names the P1 shot limits Minimum P1 shots and Maximum P1 shots, as the dashboard does.
- Bug fixes and improvements.

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
