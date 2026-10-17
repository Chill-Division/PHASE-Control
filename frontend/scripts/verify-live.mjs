/** Mock-HA integration checks. No connection to a live Home Assistant installation. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  out = path.join(root, "output/playwright");
await mkdir(out, { recursive: true });
const html = await readFile(path.join(root, "addons/f2_control/www/public/dashboard.html"));
const server = createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Cache-Control": "no-store",
  });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL || process.platform === "win32"
    ? { channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
await context.addInitScript(() =>
  localStorage.setItem(
    "hassTokens",
    JSON.stringify({
      access_token: "browser-fixture-token",
      expires: Date.now() + 3600000,
    }),
  ),
);
const states = {};
const calls = [];
const errors = [];
const checks = [];
let failStates = false,
  failWrite = "",
  ignoreWrite = "",
  noEntities = false,
  /** What crop_steering.whats_new_get answers; null: an integration without What's new. */
  whatsNew = null;
const put = (entity_id, state, attributes = {}) =>
  (states[entity_id] = {
    entity_id,
    state: String(state),
    attributes,
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  });
for (const prefix of ["", "f1_"]) {
  const name = prefix ? "Flower 1" : "Flower 2",
    flag = prefix ? "switch.crop_steering_f1_engine_enabled" : "input_boolean.f2_control_enabled";
  put(`sensor.crop_steering_${prefix}engine_config`, "ready", {
    prefix,
    slug: prefix ? "f1" : "",
    num_zones: 2,
    friendly_name: `${name} engine config`,
    enable_flag: flag,
    // F1 runs a pair that reports its versions; the default room models an older pair that does not
    ...(prefix ? { integration_version: "2.19.1" } : {}),
    // F1's pump is mapped: the Overview's reservoir card then shows a reading that can go stale.
    ...(prefix ? { pump: "switch.f1_irrigation_pump" } : {}),
  });
  if (prefix) put("switch.f1_irrigation_pump", "off");
  put(`sensor.crop_steering_${prefix}ai_heartbeat`, "online", {
    enable_flag: flag,
    last_beat: new Date().toISOString(),
    ...(prefix ? { controller_version: "0.16.1" } : {}),
  });
  put(flag, "on");
  put(`sensor.crop_steering_${prefix}activity_log`, "active", {
    feed: `12:30 ${prefix ? "f1 " : ""}Z1 P1 -> P2`,
  });
  for (let z = 1; z <= 2; z++) {
    const k = `crop_steering_${prefix}zone_${z}_`;
    put(`switch.${k}enabled`, "on");
    put(`sensor.${k}phase`, "P2");
    put(`sensor.${k}status`, "monitoring");
    put(`sensor.crop_steering_${prefix}vwc_zone_${z}`, 54 + z, {
      unit_of_measurement: "%",
    });
    put(`sensor.crop_steering_${prefix}ec_zone_${z}`, 3, {
      unit_of_measurement: "mS/cm",
    });
    // Today's water and shots so far, for the Overview's totals.
    put(`sensor.${k}daily_water_app`, 1.5, { unit_of_measurement: "L" });
    put(`sensor.${k}irrigation_count_app`, 4);
    put(`number.${k}p1_target_vwc`, 64, {
      min: 10,
      max: 90,
      step: 1,
      unit_of_measurement: "%",
    });
    put(`number.${k}p2_vwc_threshold`, 54, {
      min: 10,
      max: 90,
      step: 1,
      unit_of_measurement: "%",
    });
    put(`select.${k}steering_mode`, "Vegetative", {
      options: ["Vegetative", "Generative"],
    });
  }
}
await context.route("**/*", async (route) => {
  const req = route.request(),
    url = new URL(req.url());
  if (url.origin !== base) {
    errors.push(`Unexpected external request ${url.origin}`);
    return route.abort();
  }
  if (!url.pathname.startsWith("/api/")) return route.continue();
  if (req.headers().authorization !== "Bearer browser-fixture-token") {
    errors.push("Missing fixture auth");
    return route.fulfill({ status: 401, body: "Unauthorized" });
  }
  const reply = (body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  if (url.pathname === "/api/states")
    return failStates
      ? reply({ message: "Unauthorized" }, 401)
      : reply(noEntities ? [] : Object.values(states));
  if (url.pathname.startsWith("/api/states/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/states/".length));
    return states[id] ? reply(states[id]) : reply({}, 404);
  }
  if (url.pathname.startsWith("/api/history/")) return reply([]);
  if (whatsNew && url.pathname.startsWith("/api/services/crop_steering/whats_new_")) {
    const action = url.pathname.split("/").pop(),
      body = req.postDataJSON() ?? {};
    calls.push({ path: url.pathname + url.search, ...body });
    if (action === "whats_new_seen") whatsNew.seen = body.version;
    return reply({
      changed_states: [],
      service_response: action === "whats_new_get" ? whatsNew : { seen: whatsNew.seen },
    });
  }
  if (url.pathname.startsWith("/api/services/crop_steering/"))
    return reply({ message: "Fixture has no workspace API" }, 404);
  if (url.pathname.startsWith("/api/services/")) {
    const body = req.postDataJSON();
    calls.push({ path: url.pathname, ...body });
    if (body.entity_id === failWrite) return reply({ message: "Fixture refused write" }, 500);
    if (body.entity_id !== ignoreWrite)
      states[body.entity_id].state = String(
        body.value ?? body.option ?? (url.pathname.endsWith("turn_on") ? "on" : "off"),
      );
    return reply([]);
  }
  return reply({}, 404);
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const visible = (locator) => locator.waitFor({ state: "visible", timeout: 10000 });
async function check(name, run) {
  await run();
  checks.push(name);
  console.log("PASS " + name);
}
const field = (key) => page.locator(`input[id="setting-number.crop_steering_f1_zone_1_${key}"]`);
/** Today's targets show one phase card open at a time (the zone's phase now, by default): opens the
 * card of `phase`, whose settings the checks then type into. */
async function openCard(phase) {
  const head = page.locator(`section.phase-card[data-phase="${phase}"] > button.phase-card-head`);
  await visible(head);
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await page
    .locator(
      `section.phase-card[data-phase="${phase}"] > button.phase-card-head[aria-expanded="true"]`,
    )
    .waitFor();
}
/** A section, from the rail down the left of a tablet or a desktop. */
const openSection = (name) =>
  page
    .locator('nav.app-rail[aria-label="Sections"]')
    .getByRole("button", { name, exact: true })
    .click();
/** The room shown, as the rooms column marks it (a desktop with more than one room); "" for none. */
async function currentRoom() {
  await visible(page.locator('nav.rooms-column[aria-label="Rooms"]'));
  const current = page.locator('nav.rooms-column button.room-card[aria-current="page"]');
  return (await current.count()) ? current.locator(".room-card-head strong").innerText() : "";
}
/** Picks a room the way a person does on a desktop: its card in the rooms column. */
async function chooseRoom(name) {
  await page
    .locator("nav.rooms-column button.room-card")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await page
    .locator('nav.rooms-column button.room-card[aria-current="page"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .waitFor();
}
try {
  await check("live connection selects requested room without showing demo", async () => {
    await page.goto(`${base}/dashboard.html?room=room:f1_#/strategy`, {
      waitUntil: "networkidle",
    });
    // The section header says live, and when the newest data came.
    const status = page.locator('.section-header .live-status[data-connection="live"]');
    await visible(status);
    assert.match(await status.innerText(), /^Live · updated \d{1,2}:\d{2}/);
    assert.equal(await currentRoom(), "Flower 1");
    assert.equal(await page.locator(".demo-banner").count(), 0);
    await openCard("P1");
    await visible(field("p1_target_vwc"));
  });
  await check(
    "Help shows the versions the running integration and controller report, per room",
    async () => {
      await openSection("Help");
      const versions = page.locator('dl.running-versions[aria-label="Running versions"]');
      await visible(versions);
      assert.match(await versions.innerText(), /Integration\s+2\.19\.1/);
      assert.match(await versions.innerText(), /Controller\s+0\.16\.1/);
      // An older pair reports nothing: say so, never show a number this page made up.
      await chooseRoom("Flower 2");
      await visible(versions.getByText("not reported").first());
      assert.equal((await versions.innerText()).match(/not reported/g).length, 2);
      await chooseRoom("Flower 1");
      await visible(versions.getByText("2.19.1"));
    },
  );
  await check(
    "the versions stay reachable: on a phone at the foot of More, above its tabs, and in a short window down the rail to Help",
    async () => {
      // Seen on a real phone: the old drawer was screen-high, the menu taller, and it would not
      // scroll. A phone now reaches the versions on More, which scrolls as a page under tabs fixed
      // at the foot of the screen: the versions must come out from under them.
      const phone = await context.newPage();
      try {
        await phone.setViewportSize({ width: 390, height: 640 });
        await phone.goto(`${base}/dashboard.html?room=room:f1_#/overview`, { waitUntil: "networkidle" });
        const tabs = phone.locator('nav.phone-tabs[aria-label="Sections"]');
        await tabs.getByRole("button", { name: "More", exact: true }).click();
        const versions = phone.locator(
          '.more-foot dl.running-versions[aria-label="Running versions"]',
        );
        await versions.waitFor({ state: "visible" });
        const fits = await phone.evaluate(() => {
          // The window scrolls as the root says, or as the body says when the root leaves it.
          const root = getComputedStyle(document.documentElement).overflowY;
          return {
            taller: document.scrollingElement.scrollHeight > innerHeight,
            overflowY: root === "visible" ? getComputedStyle(document.body).overflowY : root,
          };
        });
        assert.ok(fits.taller, "the fixture must make More taller than the phone's screen");
        assert.ok(!["hidden", "clip"].includes(fits.overflowY), "More must scroll");
        // Scrolled to its very end, the versions sit above the tabs, not under them.
        await phone.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
        const box = await versions.boundingBox();
        const tabsBox = await tabs.boundingBox();
        assert.ok(
          box && tabsBox && box.y >= 0 && box.y + box.height <= tabsBox.y,
          `versions must be reachable above the tabs (${JSON.stringify({ box, tabsBox })})`,
        );
        assert.match(await versions.innerText(), /Controller\s+0\.16\.1/);
        assert.ok((await phone.evaluate(() => window.scrollY)) > 0, "it really scrolled");
        // and the first item is still reachable on the way back
        await phone
          .locator(".more-page")
          .getByRole("button", { name: /^Settings/ })
          .scrollIntoViewIfNeeded();
      } finally {
        await phone.close();
      }
      const short = await context.newPage();
      try {
        await short.setViewportSize({ width: 1280, height: 480 });
        await short.goto(`${base}/dashboard.html?room=room:f1_#/overview`, { waitUntil: "networkidle" });
        // The rail's last section is reachable in a short window, and so are the versions it opens.
        const help = short
          .locator('nav.app-rail[aria-label="Sections"]')
          .getByRole("button", { name: "Help", exact: true });
        await help.scrollIntoViewIfNeeded();
        const helpBox = await help.boundingBox();
        assert.ok(
          helpBox && helpBox.y >= 0 && helpBox.y + helpBox.height <= 480,
          "the rail's Help must be reachable in a short window",
        );
        await help.click();
        const versions = short.locator('dl.running-versions[aria-label="Running versions"]');
        await versions.scrollIntoViewIfNeeded();
        const box = await versions.boundingBox();
        assert.ok(box && box.y + box.height <= 480, "versions must be reachable in a short window");
        assert.match(await versions.innerText(), /Controller\s+0\.16\.1/);
      } finally {
        await short.close();
      }
    },
  );
  await check(
    "an open dropdown can be read on a dark Home Assistant theme (steering mode, activity, history, compare runs)",
    async () => {
      // Home Assistant's input fill is a translucent rgba of the text colour. The browser cannot
      // paint an option list with it and fell back to white under light text.
      const themed = await context.newPage();
      try {
        const alpha = (colour) => {
          const parts = colour.match(/[\d.]+/g).map(Number);
          return parts.length < 4 ? 1 : parts[3];
        };
        const luminance = (colour) => {
          const [r, g, b] = colour.match(/[\d.]+/g).map(Number);
          return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        };
        // Compare runs is #/compare. ("comparison" was never a page: it opened the Overview, whose
        // one dropdown here was the old sidebar's room picker, now buttons.)
        for (const route of ["strategy", "activity", "insights", "compare"]) {
          await themed.goto(`${base}/dashboard.html?room=room:f1_#/${route}`, {
            waitUntil: "networkidle",
          });
          await themed.evaluate(() => {
            document.documentElement.classList.add("dark");
            document.documentElement.style.setProperty(
              "--ha-native-input",
              "rgba(225, 225, 225, 0.05)",
            );
          });
          const options = await themed.locator("select option").evaluateAll((nodes) =>
            nodes.map((node) => {
              const style = getComputedStyle(node);
              return {
                text: node.textContent,
                background: style.backgroundColor,
                colour: style.color,
              };
            }),
          );
          assert.ok(options.length > 0, `${route}: expected at least one dropdown`);
          for (const option of options) {
            assert.equal(
              alpha(option.background),
              1,
              `${route}: "${option.text}" has a see-through background`,
            );
            assert.ok(
              Math.abs(luminance(option.background) - luminance(option.colour)) > 0.4,
              `${route}: "${option.text}" is ${option.colour} on ${option.background}`,
            );
          }
        }
      } finally {
        await themed.close();
      }
    },
  );
  await check("partial failure keeps failed draft and writes only selected room", async () => {
    await openSection("Strategy");
    failWrite = "number.crop_steering_f1_zone_1_p2_vwc_threshold";
    await openCard("P1");
    await field("p1_target_vwc").fill("65");
    await openCard("P2");
    await field("p2_vwc_threshold").fill("55");
    // Both wait in the draft bar, whose Review and apply opens the review.
    const bar = page.getByRole("region", { name: "Unsaved changes", exact: true });
    await bar.locator(".draft-count", { hasText: /^2$/ }).waitFor();
    await bar.getByRole("button", { name: "Review and apply", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Apply 2 changes", exact: true })
      .click();
    await visible(page.getByText("Some changes were not applied.", { exact: true }));
    assert.equal(states["number.crop_steering_f1_zone_1_p1_target_vwc"].state, "65");
    assert.equal(states["number.crop_steering_zone_1_p1_target_vwc"].state, "64");
    assert.equal(calls.length, 2);
    assert.equal(
      calls.every((c) => c.entity_id.startsWith("number.crop_steering_f1_")),
      true,
    );
    await page.screenshot({
      path: path.join(out, "live-partial-failure.png"),
      fullPage: true,
    });
    failWrite = "";
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Apply 1 change", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(calls.length, 3);
    assert.equal(calls[2].entity_id, "number.crop_steering_f1_zone_1_p2_vwc_threshold");
  });
  await check("service acknowledgement without readback is a visible failure", async () => {
    ignoreWrite = "number.crop_steering_f1_zone_1_p1_target_vwc";
    await openCard("P1");
    await field("p1_target_vwc").fill("66");
    const bar = page.getByRole("region", { name: "Unsaved changes", exact: true });
    await bar.locator(".draft-count", { hasText: /^1$/ }).waitFor();
    await bar.getByRole("button", { name: "Review and apply", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Apply 1 change", exact: true })
      .click();
    await visible(page.getByText("Some changes were not applied.", { exact: true }));
    assert.equal(states[ignoreWrite].state, "65");
    await page.getByRole("button", { name: "Back to editing" }).click();
    await bar.getByRole("button", { name: "Discard", exact: true }).click();
    await bar.waitFor({ state: "detached" });
    ignoreWrite = "";
  });
  await check("missing live sensor stays unavailable and timestamps remain honest", async () => {
    states["sensor.crop_steering_f1_ec_zone_1"].state = "unavailable";
    await page.getByRole("button", { name: "Refresh controller data" }).click();
    await openSection("Overview");
    // Needs you says so, and so does Zone 1's card, its EC a dash rather than the last number.
    await visible(
      page
        .locator("[data-needs-you]")
        .getByText("Zone 1: sensor data unavailable", { exact: true }),
    );
    const card = page.locator('article.zone-card[data-zone-card="1"]');
    const foot = card.locator('p.zone-card-foot[data-zone-status="1"]');
    assert.equal(await foot.innerText(), "Zone 1: sensor data unavailable");
    assert.equal(await foot.getAttribute("data-tone"), "warning");
    assert.equal(
      await card.locator(".zone-stat").filter({ hasText: "EC" }).locator("strong").innerText(),
      "–",
    );
    // The reservoir card's pump reading is live: nothing says it is an old one.
    assert.equal(
      await page.locator("[data-tank-status] [data-pump-state]").innerText(),
      "Pump off",
    );
    assert.equal(await page.getByText("Invalid Date", { exact: false }).count(), 0);
    assert.equal(await page.locator(".demo-banner").count(), 0);
    // The room's status line and today's totals first, then the notices, the day's clock, the zones,
    // and the reservoir below them. (The redesign put the status line with the totals above the
    // notices, and moved the grow-day chart into each zone's details.)
    const order = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".status-row[data-room-status], [data-needs-you], [data-today], .zones-section, [data-tank-status]",
        ),
      ].map((el) =>
        el.matches(".status-row")
          ? "status"
          : el.matches("[data-needs-you]")
            ? "needs-you"
            : el.matches("[data-today]")
              ? "today"
              : el.matches(".zones-section")
                ? "zones"
                : "reservoir",
      ),
    );
    assert.deepEqual(order, ["status", "needs-you", "today", "zones", "reservoir"]);
    assert.match(
      await page.locator(".status-row[data-room-status] .status-row-totals").innerText(),
      /^Today so far: 3 L · 8 shots$/,
    );
  });
  await check("stale probe is unavailable in zone diagnostics, with its age", async () => {
    const probe = "sensor.crop_steering_f1_vwc_zone_1";
    states[probe].last_updated = "2020-01-01T00:00:00Z";
    await page.getByRole("button", { name: "Refresh controller data" }).click();
    await openSection("Insights");
    // Insights › Zone ends with every zone's probes, now (the old probe coverage table).
    await visible(page.getByRole("heading", { name: "Every zone’s probes, now", exact: true }));
    const cell = (zone, column) =>
      page
        .locator(".insights-page .probe-cover .data-table tbody tr")
        .filter({ hasText: `Zone ${zone}` })
        .locator("td")
        .nth(column);
    // Zone 1's moisture is stale and its EC is down: red, the stale one with its age. Zone 2's EC
    // reports: green.
    const reading = async (zone, column) => [
      await cell(zone, column).locator(".pill").innerText(),
      await cell(zone, column).locator(".pill").getAttribute("data-tone"),
    ];
    assert.deepEqual(await reading(1, 1), ["Unavailable / unverified", "off"]);
    assert.match(await cell(1, 1).innerText(), /Reading \d+ d old$/);
    assert.deepEqual(await reading(1, 2), ["Unavailable / unverified", "off"]);
    assert.deepEqual(await reading(2, 2), ["Current", "on"]);
  });
  await check(
    "authentication failure preserves explicit offline state and disables writes",
    async () => {
      failStates = true;
      await page.getByRole("button", { name: "Refresh controller data" }).click();
      await visible(
        page.locator(".connection-banner").getByText("Can’t reach Home Assistant", { exact: true }),
      );
      await openSection("Overview");
      // The Overview's heading says offline, with when the last data came; the reservoir card marks
      // its pump reading as the last known one.
      const status = page.locator('.room-header .live-status[data-connection="offline"]');
      await visible(status);
      assert.match(await status.innerText(), /^Offline · last \d{1,2}:\d{2}.* \(.+ ago\)$/);
      const pump = page.locator("[data-tank-status] [data-pump-state]");
      await visible(pump);
      assert.equal(await pump.innerText(), "Pump off · last known");
      await openSection("Strategy");
      await openCard("P1");
      assert.equal(await field("p1_target_vwc").isDisabled(), true);
      assert.equal(await page.locator(".demo-banner").count(), 0);
      await page.screenshot({
        path: path.join(out, "live-disconnected.png"),
        fullPage: true,
      });
    },
  );
  await check("empty HA response clears stale room controls with useful empty state", async () => {
    failStates = false;
    noEntities = true;
    await page.getByRole("button", { name: "Refresh controller data" }).click();
    await openSection("Overview");
    await visible(page.getByRole("heading", { level: 1, name: "Overview", exact: true }));
    await visible(page.getByRole("heading", { name: "No zones discovered", exact: true }));
    // No room is left to pick: neither the rooms column nor the room chips offer a stale one.
    assert.equal(await page.locator("nav.rooms-column, nav.room-chips").count(), 0);
    assert.equal(await page.locator("button.room-card, button.room-chip").count(), 0);
  });
  await check(
    "named F2 stays distinct from default and unsupported tools cannot misroute",
    async () => {
      noEntities = false;
      const prefix = "f2_",
        flag = "switch.crop_steering_f2_engine_enabled";
      put("sensor.crop_steering_f2_engine_config", "ready", {
        prefix,
        slug: "f2",
        num_zones: 1,
        friendly_name: "Named F2 engine config",
        enable_flag: flag,
      });
      put(flag, "on");
      put("sensor.crop_steering_f2_ai_heartbeat", "online", { enable_flag: flag });
      put("switch.crop_steering_f2_zone_1_enabled", "on");
      put("sensor.crop_steering_f2_zone_1_phase", "P2");
      put("sensor.crop_steering_f2_vwc_zone_1", 60, { unit_of_measurement: "%" });
      put("sensor.crop_steering_f2_ec_zone_1", 3, { unit_of_measurement: "mS/cm" });
      put("number.crop_steering_f2_zone_1_p2_vwc_threshold", 50, {
        min: 10,
        max: 90,
        step: 1,
        unit_of_measurement: "%",
      });
      await page.goto(`${base}/dashboard.html?room=room:f2_#/strategy`, { waitUntil: "networkidle" });
      assert.equal(await currentRoom(), "Named F2");
      await visible(
        page.locator('input[id="setting-number.crop_steering_f2_zone_1_p2_vwc_threshold"]'),
      );
      await page.goto(`${base}/dashboard.html?room=room:f2_#/help`, { waitUntil: "networkidle" });
      await chooseRoom("Flower 2");
      await visible(page.getByRole("heading", { level: 1, name: "Help", exact: true }));
      assert.equal(new URL(page.url()).hash, "#/help");
      assert.equal(await currentRoom(), "Flower 2");
      assert.equal(new URL(page.url()).searchParams.get("room"), "room:");
    },
  );
  await check("what's new: an update shows it once, and the integration is told", async () => {
    // Every check above ran against an integration without What's new: no window, no error.
    const dialog = page.getByRole("dialog", { name: "What’s new in PHASE Control", exact: true });
    assert.equal(await dialog.count(), 0);
    whatsNew = {
      version: "2.25.0",
      seen: "2.24.0",
      releases: [
        { version: "2.25.0", date: "2026-10-05", items: ["Each zone says what it waits for."] },
        { version: "2.24.0", date: "2026-09-26", items: ["Bug fixes and improvements."] },
      ],
    };
    const told = () =>
      calls.filter((call) => call.path.startsWith("/api/services/crop_steering/whats_new_seen"));
    await page.goto(`${base}/dashboard.html?room=room:f1_#/overview`, { waitUntil: "networkidle" });
    await visible(dialog);
    assert.deepEqual(
      (await dialog.locator("section h3").allInnerTexts()).map((text) => text.split("\n")[0]),
      ["Version 2.25.0"],
    );
    // Told as it opens, with the installed version, over the REST call the integration answers.
    assert.deepEqual(told(), [
      { path: "/api/services/crop_steering/whats_new_seen?return_response", version: "2.25.0" },
    ]);
    await dialog.getByRole("button", { name: "Got it", exact: true }).click();
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    assert.equal(await dialog.count(), 0, "the next visit, by anyone, does not show it again");
    assert.equal(told().length, 1);
    whatsNew = null;
  });
  await check("explicit missing room never falls through to default controls", async () => {
    await page.goto(`${base}/dashboard.html?room=missing-room#/strategy`, {
      waitUntil: "networkidle",
    });
    assert.equal(await currentRoom(), "");
    assert.equal(await page.locator('input[type="number"]').count(), 0);
  });
  assert.deepEqual(errors, []);
  console.log(`PASS ${checks.length} mocked HA workflow groups.`);
} catch (error) {
  console.error(error);
  await page
    .screenshot({ path: path.join(out, "live-failure.png"), fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(out, "live-verification.json"),
    JSON.stringify({ checks, calls, errors }, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
