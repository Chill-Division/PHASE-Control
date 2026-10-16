/** Compiled visual editing, delivery and comparison contracts; isolated demo only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { lightShot } from "./light-shot.mjs";
import { settled } from "./settled.mjs";
import { fitsWidth } from "./fits-width.mjs";
const out = fileURLToPath(new URL("../../output/playwright/", import.meta.url));
await mkdir(out, { recursive: true });
const html = await readFile(new URL("../../addons/f2_control/www/public/dashboard.html", import.meta.url));
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1100 },
  acceptDownloads: true,
  colorScheme: "dark",
  ...(process.env.VERIFY_TZ ? { timezoneId: process.env.VERIFY_TZ } : {}),
});
// Follows the device's colour scheme, as the dashboard did by default before it defaulted to light.
const followDevice = () => {
  // The blank page between checks (fresh) has no storage.
  if (location.protocol === "about:") return;
  if (!localStorage.getItem("irrigation-theme")) localStorage.setItem("irrigation-theme", "auto");
};
await context.addInitScript(followDevice);
const forbidden = [],
  errors = [],
  checks = [],
  accessibility = [];
const isolate = (route) => {
  const u = new URL(route.request().url());
  if (u.origin !== origin || u.pathname.startsWith("/api/")) {
    forbidden.push(u.origin + u.pathname);
    return route.abort();
  }
  return route.continue();
};
await context.route("**/*", isolate);
const page = await context.newPage();
// The demo's readings depend on the hour. VERIFY_TZ=UTC VERIFY_AT=2026-09-20T11:41:00Z replays any
// wall clock (CI runs in UTC, at whatever hour the push happened) without changing how timers run.
if (process.env.VERIFY_AT) await page.clock.setFixedTime(new Date(process.env.VERIFY_AT));
page.setDefaultTimeout(10000);
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
async function fresh(route) {
  // Through a blank page, so a draft a failed check left behind cannot hold the route: within the
  // same document the dashboard keeps the page with a draft and asks before leaving it.
  await page.goto("about:blank");
  await page.goto(`${origin}/dashboard.html?demo=1#/${route}`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
}
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, status: "pass" });
    console.log("PASS " + name);
  } catch (e) {
    checks.push({ name, status: "fail", error: e.stack });
    console.error("FAIL " + name + ": " + e.message);
    await page.screenshot({
      path: out + "visual-failure-" + checks.length + ".png",
      fullPage: true,
    });
  }
}
async function axe(name) {
  await settled(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  accessibility.push({ name, violations: result.violations });
  assert.deepEqual(
    result.violations.map((v) => v.id),
    [],
    name + " accessibility",
  );
}
async function noOverflow() {
  await fitsWidth(page, "Document overflow");
}
const field = (suffix) => page.locator(`[id="setting-number.crop_steering_zone_1_${suffix}"]`);
const line = (name) => page.locator(`[data-planning-line="${name}"]`);
// Whose targets the page shows: a chip per zone, then "Whole room".
const zoneChip = (n) =>
  page.locator(".target-chips").getByRole("button", { name: new RegExp("Zone " + n) });
// The settings sit in phase cards beside the day, one open at a time: by default the card of the
// zone's phase now, and again after another zone is picked. A card opens by its head; `card` is a
// phase ("P3") or a group's name ("Substrate").
async function openCard(card) {
  const section = page.locator(
    /^P[0-3]$/.test(card)
      ? `section.phase-card[data-phase="${card}"]`
      : `section.phase-card[aria-label="${card}"]`,
  );
  const head = section.locator(".phase-card-head");
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await section.locator('.phase-card-head[aria-expanded="true"]').waitFor();
}
// The draft's bar at the foot of the page, there while the draft holds a change.
const draftBar = page.getByRole("region", { name: "Unsaved changes" });
const discard = draftBar.getByRole("button", { name: "Discard", exact: true });
try {
  await check(
    "P3 floor follows numeric edits; saved baseline and room values remain unchanged",
    async () => {
      await fresh("strategy");
      await page.locator(".targets-banner").waitFor();
      await openCard("P3");
      const floor = field("p3_emergency_vwc_threshold");
      // Each zone's axis scales to its own recorded data, so zones are compared by value and a
      // zone's draft line only against that same zone's saved line, never by pixels across zones.
      const zoneTab = async (n) => {
        await zoneChip(n).click();
        await openCard("P3");
      };
      const otherFloor = page.locator(
        '[id="setting-number.crop_steering_zone_2_p3_emergency_vwc_threshold"]',
      );
      await zoneTab(2);
      const other = await otherFloor.inputValue();
      await zoneTab(1);
      const original = await floor.inputValue();
      const savedY = await line("baseline-p3-floor").getAttribute("y1");
      const curve = await line("vwc").getAttribute("d");
      await floor.fill(String(Number(original) + 5));
      assert.notEqual(await line("p3-floor").getAttribute("y1"), savedY);
      assert.equal(await line("baseline-p3-floor").getAttribute("y1"), savedY);
      assert.equal(
        await line("vwc").getAttribute("d"),
        curve,
        "Emergency floor must not pretend to reshape daytime moisture",
      );
      await discard.waitFor();
      await noOverflow();
      await axe("manual preview");
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await lightShot(page, page, {
        path: fileURLToPath(new URL("../../img/manual-setpoints.png", import.meta.url)),
      });
      await zoneTab(2);
      assert.equal(await otherFloor.inputValue(), other, "Zone 2 remains unchanged");
      assert.equal(
        await line("p3-floor").getAttribute("y1"),
        await line("baseline-p3-floor").getAttribute("y1"),
        "Zone 2 draws no draft floor",
      );
      await zoneTab(1);
      assert.equal(await floor.inputValue(), String(Number(original) + 5));
      await discard.click();
      assert.equal(await floor.inputValue(), original);
      assert.equal(await line("p3-floor").getAttribute("y1"), savedY);
    },
  );
  await check("Today graph carries the recorded probe and the whole projected day", async () => {
    // The demo's history always ends at its fixed live reading, so what the recorded day looks like
    // depends on the hour. An hour before lights-on the grow-day is complete (P0 dip, ramp, top-ups,
    // overnight dry-down) and lines up with the targets; a pinned clock also stops the README images
    // changing on every run. The clock belongs to the browser context, so this gets its own and the
    // other checks keep real time.
    const pinned = await browser.newContext({
      viewport: { width: 1600, height: 1100 },
      colorScheme: "dark",
    });
    await pinned.addInitScript(followDevice);
    await pinned.route("**/*", isolate);
    const shot = await pinned.newPage();
    shot.on("pageerror", (e) => errors.push(e.message));
    await shot.clock.setFixedTime(new Date(2026, 8, 20, 9, 0, 0));
    await shot.goto(`${origin}/dashboard.html?demo=1#/strategy`, { waitUntil: "networkidle" });
    const graph = shot.locator(".planning-curve");
    await graph.locator('[data-planning-line="recorded-vwc"]').waitFor();
    assert.ok(await graph.locator('[data-planning-line="recorded-vwc-previous"]').count());
    assert.ok(await graph.locator('[data-planning-line="recorded-ec"]').count());
    assert.match(
      await graph.locator(".planning-recorded").innerText(),
      /Now[\s\S]*Peak · this grow-day[\s\S]*Trough · this grow-day/,
    );
    // every phase is drawn the way it runs: all six demo ramp shots, and the P2 top-ups
    assert.equal(await graph.locator('[data-planning-shot="P1"]').count(), 6);
    assert.ok((await graph.locator('[data-planning-shot="P2"]').count()) > 1);
    assert.match(
      await graph.locator(".planning-projection").innerText(),
      /Projected day[\s\S]*measured from this zone/,
    );
    assert.doesNotMatch(await graph.innerText(), /NaN|undefined/);
    await graph.scrollIntoViewIfNeeded();
    await lightShot(shot, graph, {
      path: fileURLToPath(new URL("../../img/plan-graph.png", import.meta.url)),
    });
    const history = shot
      .locator("section")
      .filter({ has: shot.getByRole("heading", { name: "Recorded sensor behaviour" }) })
      .first();
    await history.locator(".sensor-chart").first().waitFor();
    await history.scrollIntoViewIfNeeded();
    await lightShot(shot, history, {
      path: fileURLToPath(new URL("../../img/sensor-history.png", import.meta.url)),
    });
    await pinned.close();
  });
  await check("Room off stands the room down and says so", async () => {
    await fresh("overview");
    // How the room runs is one choice, the mode pill in the Overview's heading: Room off, reviewed
    // (the room's switch, one change) and applied.
    await page.getByRole("button", { name: /^How Flower 2 runs: Steering\. Change$/ }).click();
    await page
      .getByRole("dialog", { name: "How Flower 2 runs" })
      .getByRole("radio", { name: /^Room off/ })
      .click();
    await page.getByRole("button", { name: /^Apply 1 change/ }).click();
    const on = page.getByRole("button", { name: /^How Flower 2 runs: Room off\. Change$/ });
    await on.first().waitFor();
    // One switch on the Overview, in its heading: the banner there only says so.
    assert.equal(await on.count(), 1);
    assert.equal(
      await page
        .locator(".room-header")
        .getByRole("button", { name: /Room off/ })
        .count(),
      1,
    );
    assert.equal(await page.getByRole("button", { name: "Switch room on…" }).count(), 0);
    const banner = page.locator(".room-off-banner");
    await banner.waitFor();
    assert.equal(await banner.getByRole("button").count(), 0, "The Overview's banner only says so");
    assert.match(await banner.innerText(), /no irrigation, no alerts/i);
    await page.evaluate(() => window.scrollTo(0, 0));
    await lightShot(page, page, {
      path: fileURLToPath(new URL("../../img/room-off.png", import.meta.url)),
      clip: { x: 0, y: 0, width: 1600, height: 760 },
    });
    // Any other page: the banner carries the switch. Same document, so the demo keeps its
    // in-memory state; a reload would switch the room back on.
    await page.evaluate(() => (location.hash = "#/insights"));
    await banner.getByRole("button", { name: "Switch room on…" }).waitFor();
  });
  await check("P1 controls reshape preview; invalid drafts cannot apply", async () => {
    await fresh("strategy");
    await openCard("P1");
    const target = field("p1_target_vwc");
    // The VWC axis scales to what is plotted, so compare what each line plots, not its pixels.
    const before = await line("vwc").getAttribute("data-planning-values");
    await target.fill("70");
    assert.notEqual(await line("vwc").getAttribute("data-planning-values"), before);
    assert.equal(await line("baseline-vwc").getAttribute("data-planning-values"), before);
    await target.fill("999");
    assert.equal(await target.getAttribute("aria-invalid"), "true");
    assert.equal(
      await draftBar.getByRole("button", { name: "Review and apply", exact: true }).isDisabled(),
      true,
    );
    await discard.click();
  });
  await check("A target dragged on the chart stays under the pointer with the page scrolled down", async () => {
    // Scrolled to the end, the sticky preview is held in place by its foot: the field being dragged
    // turning into a draft, and the words around the chart changing length, slid the chart under a
    // still pointer, and the maintenance trigger ran away (from 55.5 to 30 in one 10 px step). The
    // chart is no longer sticky: brought back into view from the end, it is dragged with the page
    // scrolled down, while the field turns into a draft and the draft bar appears.
    await page.setViewportSize({ width: 1280, height: 720 });
    await fresh("strategy");
    await page.evaluate(() => {
      document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
    });
    const handle = page.locator("circle.planning-handle[aria-label^='Maintenance']").first();
    await handle.scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(() => document.scrollingElement.scrollTop > 0),
      "the page is scrolled down",
    );
    const chartTop = () => handle.evaluate((h) => h.ownerSVGElement.getBoundingClientRect().top);
    const handleY = () =>
      handle.evaluate((h) => {
        const r = h.getBoundingClientRect();
        return r.top + r.height / 2;
      });
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2;
    let y = box.y + box.height / 2;
    const top = await chartTop();
    const start = Number(await handle.getAttribute("aria-valuenow"));
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 40; step++) {
      y += 2;
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
      assert.ok(Math.abs((await chartTop()) - top) < 2, `the chart moved at step ${step}`);
      assert.ok(Math.abs((await handleY()) - y) < 4, `the target left the pointer at step ${step}`);
    }
    await page.mouse.up();
    const end = Number(await handle.getAttribute("aria-valuenow"));
    assert.ok(end < start && end > start - 30, `80 px moved the trigger from ${start} to ${end}`);
    await discard.click();
    await page.setViewportSize({ width: 1600, height: 1100 });
  });
  await check(
    "Field capacity suggestion names its source, fills only the local draft and is never applied by itself",
    async () => {
      await fresh("strategy");
      await openCard("Substrate");
      const capacity = field("field_capacity");
      const context = page.locator('[id="context-number.crop_steering_zone_1_field_capacity"]');
      // Zone 1's supervisor is tracking, so the controller has a learned peak to offer.
      const learned = context.locator(".setting-suggestion");
      await learned.waitFor();
      assert.match(
        await learned.innerText(),
        /^Suggestion · Learned peak 60\.0%, the ceiling the controller’s Auto Setpoints has learned for this zone\./,
      );
      assert.equal(await capacity.inputValue(), "70", "A suggestion must not change the field");
      assert.equal(await discard.count(), 0, "A suggestion must not create a draft");
      await context.getByRole("button", { name: "Use 60% in draft", exact: true }).click();
      assert.equal(await capacity.inputValue(), "60", "The draft holds the suggested value");
      // Draft only: the controller keeps its saved value until the change is reviewed and applied.
      await page
        .locator('[id="hint-number.crop_steering_zone_1_field_capacity"]')
        .getByText("Was 70 %", { exact: true })
        .waitFor();
      assert.equal(
        await context.getByRole("button", { name: "Use 60% in draft", exact: true }).isDisabled(),
        true,
      );
      assert.equal(await draftBar.locator(".draft-count").innerText(), "1", "One change in draft");
      await draftBar.getByRole("button", { name: "Review and apply", exact: true }).click();
      await page.getByRole("button", { name: /^Apply 1 change/ }).waitFor();
      assert.match(
        await page.getByRole("dialog").locator(".review-row").innerText(),
        /Zone 1 · Full saturation \(most it holds\)[\s\S]*70 %[\s\S]*60 %/,
      );
      await page.getByRole("button", { name: "Back to editing", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await discard.click();
      assert.equal(await capacity.inputValue(), "70");
      // Zone 2's supervisor is still learning: the suggestion falls back to recorded history.
      await zoneChip(2).click();
      await openCard("Substrate");
      const typical = page.locator(
        '[id="context-number.crop_steering_zone_2_field_capacity"] .setting-suggestion',
      );
      await typical.waitFor();
      assert.match(
        await typical.innerText(),
        /^Suggestion · Typical daily peak \d+\.\d%, the median daily high this probe recorded over \d+ days? \(72 h window\)\./,
      );
      await axe("field capacity suggestion");
    },
  );
  await check(
    "Runtime estimates show all-plant zone litres and per-plant water separately",
    async () => {
      await fresh("water");
      const water = page.getByRole("region", { name: "Zone 1 water delivery" });
      // A labelled section is exposed as a region by the accessibility tree.
      await water.getByLabel("Try a valve-open runtime · seconds").fill("120");
      assert.match(await water.locator(".wd-effective").innerText(), /133\.3 mL \/ plant/);
      assert.match(await water.locator(".wd-effective").innerText(), /4\.8(?:0)? L \/ zone/);
      await water.getByLabel("Try a valve-open runtime · seconds").fill("60");
      assert.match(await water.locator(".wd-effective").innerText(), /66\.7 mL \/ plant/);
      assert.match(await water.locator(".wd-effective").innerText(), /2\.4(?:0)? L \/ zone/);
      assert.match(await water.innerText(), /Total substrate capacity/);
      assert.match(await water.innerText(), /216/);
      // Today's water, shared across the zone's 36 plants, beside the zone's total.
      const row = page.locator(".wu-table tbody tr").filter({ hasText: "Zone 1" });
      assert.match(await row.innerText(), /5\.3(?:0)? L/);
      assert.match(await row.innerText(), /147 mL per plant, 36 plants/);
    },
  );
  await check(
    "Register, compare and archive runs with bounded dates and room isolation",
    async () => {
      await fresh("compare");
      // The page's own title is for a screen reader now: the section header names the page.
      await page
        .getByRole("heading", { name: "Compare runs", exact: true })
        .waitFor({ state: "attached" });
      await page.getByRole("img", { name: /Recorded VWC and EC/ }).waitFor();
      const dateAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      async function register(name, start, end = "") {
        await page.getByRole("button", { name: "Add run", exact: true }).click();
        await page.getByLabel("Run name", { exact: true }).fill(name);
        await page.getByLabel("Run start date", { exact: true }).fill(start);
        await page.getByLabel("Run end date", { exact: true }).fill(end);
        await page.getByRole("button", { name: "Save run record", exact: true }).click();
        await page.locator(".comparison-run-list article").filter({ hasText: name }).waitFor();
      }
      await page.getByRole("button", { name: "Add run", exact: true }).click();
      await page.getByLabel("Run name", { exact: true }).fill("Unsaved run draft");
      await page
        .locator("nav.app-rail")
        .getByRole("button", { name: "Overview", exact: true })
        .click();
      await page.getByRole("heading", { name: "Discard unsaved workspace changes?" }).waitFor();
      await page.getByRole("button", { name: "Keep editing", exact: true }).click();
      assert.equal(
        await page.getByLabel("Run name", { exact: true }).inputValue(),
        "Unsaved run draft",
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await register("Previous room run", dateAgo(80), dateAgo(50));
      await register("Current room run", dateAgo(16));
      await page
        .getByLabel("Previous run", { exact: true })
        .selectOption({ label: "Previous room run" });
      const previous = page.locator(".comparison-chart path").filter({ hasText: "Previous VWC" });
      await previous.waitFor();
      assert.ok((await previous.getAttribute("d"))?.length > 10, "Previous retained curve");
      for (const period of ["day", "week", "month", "run"]) {
        await page.getByLabel("Comparison history range", { exact: true }).selectOption(period);
        await page
          .getByText("Loading selected-zone Recorder history…", { exact: true })
          .waitFor({ state: "hidden" });
        await page.getByRole("img", { name: /Recorded VWC and EC/ }).waitFor();
        assert.ok((await page.locator(".comparison-chart path").count()) >= 4);
      }
      await page.getByLabel("Comparison history range", { exact: true }).selectOption("week");
      await page.getByLabel("Target reference", { exact: true }).selectOption("saved");
      await page
        .getByText("Loading selected-zone Recorder history…", { exact: true })
        .waitFor({ state: "hidden" });
      assert.ok(
        (await page.locator('[data-comparison-series=\"target-floor\"]').count()) > 0,
        "Daily P3 reference is rendered",
      );
      assert.ok(
        (await page.locator('[data-comparison-series=\"target-vwc\"]').count()) > 0,
        "Full daily VWC reference is rendered",
      );
      await noOverflow();
      await axe("run comparison");
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await lightShot(page, page, {
        path: fileURLToPath(new URL("../../img/run-comparison.png", import.meta.url)),
        fullPage: true,
      });
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export metadata", exact: true }).click();
      const metadata = JSON.parse(await readFile(await (await downloaded).path(), "utf8"));
      assert.equal(metadata.room_id, "room:");
      assert.equal(metadata.runs.length, 5); // Three sample records plus this workflow's two.
      assert.ok(metadata.runs.every((run) => run.zones.length === 3 && run.captured_at));
      const past = page
        .locator(".comparison-run-list article")
        .filter({ hasText: "Previous room run" });
      await past.getByRole("button", { name: "Archive", exact: true }).click();
      await past.waitFor({ state: "hidden" });
      await page.getByLabel("Include archived run records").check();
      await page
        .locator(".comparison-run-list article")
        .filter({ hasText: "Previous room run" })
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      // Flower 1 (room:f1_), picked from the desktop's rooms column.
      await page
        .getByRole("navigation", { name: "Rooms" })
        .getByRole("button", { name: /Flower 1/ })
        .click();
      await page
        .locator('nav.rooms-column .room-card[aria-current="page"]')
        .filter({ hasText: "Flower 1" })
        .waitFor();
      await page.waitForFunction(
        () => document.querySelectorAll(".comparison-run-list article").length >= 2,
      );
      assert.equal(
        await page
          .locator(".comparison-run-list article")
          .filter({ hasText: "Previous room run" })
          .count(),
        0,
      );
      assert.equal(
        await page
          .locator(".comparison-run-list article")
          .filter({ hasText: "Current room run" })
          .count(),
        0,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await noOverflow();
      await axe("mobile run comparison");
      await page.screenshot({ path: out + "visual-mobile-comparison.png", fullPage: true });
      await page.setViewportSize({ width: 1600, height: 1100 });
    },
  );
  await check("Mobile phase editing stays usable without page overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fresh("strategy");
    await openCard("P3");
    await field("p3_emergency_vwc_threshold").fill("40");
    await noOverflow();
    await axe("mobile setpoints");
    await page.screenshot({ path: out + "visual-mobile-setpoints.png", fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1100 });
  });
  assert.deepEqual(forbidden, [], "Demo attempted external/API traffic");
  assert.deepEqual(errors, [], "Browser exceptions");
} finally {
  await writeFile(
    out + "steering-visual-verification.json",
    JSON.stringify({ checks, forbidden, errors, accessibility }, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
if (checks.some((c) => c.status === "fail")) process.exitCode = 1;
