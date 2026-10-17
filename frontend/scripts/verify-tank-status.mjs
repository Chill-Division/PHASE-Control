/** Graphical room telemetry against the isolated compiled demo: the reservoir's full card on Feed ›
 * Reservoir, and its summary on the Overview. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { lightShot } from "./light-shot.mjs";
import { settled } from "./settled.mjs";
import { fitsWidth } from "./fits-width.mjs";
const html = await readFile(new URL("../../addons/f2_control/www/public/dashboard.html", import.meta.url));
const out = new URL("../../output/playwright/", import.meta.url);
const file = (name) => new URL(name, out).pathname.replace(/^\/([A-Za-z]:)/, "$1");
// The README's screenshots.
const img = (name) =>
  new URL(`../../img/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
await mkdir(out, { recursive: true });
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  colorScheme: "dark",
});
// Follows the device's colour scheme, as the dashboard did by default before it defaulted to light.
await context.addInitScript(() => {
  if (!localStorage.getItem("irrigation-theme")) localStorage.setItem("irrigation-theme", "auto");
});
const errors = [],
  forbidden = [];
async function open(target) {
  const page = await target.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    if (
      !route.request().url().startsWith(origin) ||
      new URL(route.request().url()).pathname.startsWith("/api/")
    ) {
      forbidden.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  return page;
}
// The full card (Feed › Reservoir) and the Overview's summary of it.
const FULL = ".tank-panel[data-tank-status]",
  SUMMARY = ".reservoir-summary[data-tank-status]";
const page = await open(context);
try {
  // Feed › Reservoir has the whole tank card, after the nutrient batch.
  await page.goto(`${origin}/dashboard.html?demo=1#/reservoir`);
  const tank = page.locator(FULL);
  await tank.waitFor();
  // The reservoir's own level, as the controller works it out: 640 mm between 125 (full) and 850
  // (empty) is 29%.
  assert.equal(await tank.locator("[data-tank-level]").getAttribute("data-tank-level"), "29");
  assert.equal(await tank.locator("[data-pump-state]").getAttribute("data-pump-state"), "on");
  assert.doesNotMatch(await tank.innerText(), /°C/, "no water temperature any more");
  assert.doesNotMatch(await tank.innerText(), /mS\/cm|\bpH\b/, "no tank EC or pH any more");
  assert.ok(await tank.locator("time").getAttribute("datetime"));
  // The refills are the controller's own record: none running, and when the last one ended.
  assert.equal(await tank.locator("[data-refill-state]").getAttribute("data-refill-state"), "idle");
  assert.match(await tank.innerText(), /Refill\s+Not running/);
  assert.doesNotMatch(await tank.innerText(), /Not mapped/, "nothing on the card asks to be mapped");
  // Beside the tank, its level over the last 24 hours (the refill, and the shots since), ending on now.
  const history = tank.locator("[data-tank-history]");
  await history.locator(".recharts-area-curve").waitFor();
  assert.match(await history.getAttribute("aria-label"), /last 24 hours: .*29% now.*5% minimum/);
  await tank.getByRole("button", { name: "12 h" }).click();
  await page.waitForFunction(() =>
    /last 12 hours/.test(document.querySelector("[data-tank-history]")?.getAttribute("aria-label")),
  );
  assert.equal(await tank.getByRole("button", { name: "12 h" }).getAttribute("aria-pressed"), "true");
  await tank.getByRole("button", { name: "24 h" }).click();
  await page.waitForFunction(() =>
    /last 24 hours/.test(document.querySelector("[data-tank-history]")?.getAttribute("aria-label")),
  );
  // The tank and its first reading sit as far below the heading as the tank sits from the left.
  const inset = await tank.evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    const heading = panel.querySelector(".panel-heading").getBoundingClientRect();
    const drawing = panel.querySelector(".tank-vessel svg").getBoundingClientRect();
    const first = panel.querySelector(".tank-history").getBoundingClientRect();
    return {
      left: Math.round(drawing.left - box.left),
      top: Math.round(drawing.top - heading.bottom),
      readingTop: Math.round(first.top - heading.bottom),
    };
  });
  assert.ok(
    Math.abs(inset.top - inset.left) <= 2,
    `tank inset: top ${inset.top}, left ${inset.left}`,
  );
  assert.ok(
    Math.abs(inset.readingTop - inset.left) <= 2,
    `first reading inset: top ${inset.readingTop}, left ${inset.left}`,
  );
  await tank.screenshot({ path: file("tank-status.png") });
  await lightShot(page, tank, { path: img("tank-status.png") });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await fitsWidth(page, `Feed › Reservoir: horizontal overflow at ${width}`);
    // The times under the level chart stay apart: a chart too narrow for three leaves the middle
    // one out. The chart redraws for the new width a little later.
    const apart = await page
      .waitForFunction(
        () => {
          const times = [...document.querySelectorAll(
            "[data-tank-history] .recharts-cartesian-axis-tick-label text",
          )]
            .filter((text) => text.textContent.trim() && !text.textContent.endsWith("%"))
            .map((text) => text.getBoundingClientRect());
          return times.length >= 2 && times.slice(1).every((box, i) => box.left - times[i].right >= 6);
        },
        null,
        { polling: "raf", timeout: 2_000 },
      )
      .then(
        () => true,
        () => false,
      );
    assert.ok(apart, `the level chart's times run together at ${width} px`);
    await settled(page);
    const audit = await new AxeBuilder({ page }).include(FULL).analyze();
    assert.deepEqual(
      audit.violations.map((v) => ({ id: v.id, impact: v.impact })),
      [],
    );
  }
  await page.screenshot({ path: file("tank-status-mobile.png"), fullPage: true });

  // The Overview has the reservoir at a glance: how full it is against its minimum, the pump, the
  // last refill, and the way to Feed.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    location.hash = "#/overview";
  });
  const summary = page.locator(SUMMARY);
  await summary.waitFor();
  assert.equal(await page.locator(FULL).count(), 0, "the full card is on Feed, not the Overview");
  assert.equal(await summary.locator("[data-tank-level]").getAttribute("data-tank-level"), "29");
  assert.match(
    await summary.locator("[data-tank-level]").getAttribute("aria-label"),
    /Reservoir 29% full; its minimum 5%/,
  );
  assert.equal(await summary.locator("[data-pump-state]").getAttribute("data-pump-state"), "on");
  assert.match(await summary.innerText(), /29%\s*full/);
  assert.match(await summary.innerText(), /last refill .*minimum 5%/);
  assert.doesNotMatch(await summary.innerText(), /°C/, "no water temperature on the summary");
  assert.doesNotMatch(
    await summary.innerText(),
    /mS\/cm|\bpH\b/,
    "no tank EC or pH on the summary",
  );
  assert.doesNotMatch(await summary.innerText(), /Not mapped/, "nothing asks to be mapped");
  assert.equal(await summary.locator("[data-refill-soon]").count(), 0, "no reminder set yet");
  // A zone's events keep their timestamps: its last irrigation, in its details.
  await page.locator('[data-zone-card="1"] .zone-card-name').click();
  assert.ok(await page.locator('[data-last-irrigation="1"]:visible').getAttribute("datetime"));
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await fitsWidth(page, `Overview: horizontal overflow at ${width}`);
    await settled(page);
    const audit = await new AxeBuilder({ page }).include(SUMMARY).analyze();
    assert.deepEqual(
      audit.violations.map((v) => ({ id: v.id, impact: v.impact })),
      [],
      `reservoir summary accessibility at ${width} px`,
    );
  }
  await page.screenshot({ path: file("reservoir-summary-mobile.png"), fullPage: true });

  // The Overview stays two screens at most at 1440×800, the reservoir's summary beside Earlier
  // today in the row under the zones, its Feed link on its title's line; on Feed › Reservoir, the
  // full card comes straight after the nutrient batch, Map sensors on its title's line.
  await page.setViewportSize({ width: 1440, height: 800 });
  // Measured once the page has caught up with the window.
  await fitsWidth(page, "Overview: horizontal overflow at 1440×800");
  const layout = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    // A live Overview has no demo banner: the room it takes here is not counted.
    const banner = document.querySelector(".demo-banner");
    const demo = banner
      ? banner.nextElementSibling.getBoundingClientRect().top - banner.getBoundingClientRect().top
      : 0;
    return {
      height: document.documentElement.scrollHeight - demo,
      window: innerHeight,
      zonesBottom: box(".zones-section").bottom,
      tankTop: box(".reservoir-summary[data-tank-status]").top,
      tankRight: box(".reservoir-summary[data-tank-status]").right,
      earlierTop: box("[data-earlier-today]").top,
      earlierLeft: box("[data-earlier-today]").left,
      feedTop: box(".reservoir-summary > .link-button").top,
      titleBottom: box(".reservoir-summary h2").bottom,
    };
  });
  assert.ok(
    layout.height <= 2 * layout.window,
    `Overview is ${layout.height}px tall without the demo banner, in a ${layout.window}px window`,
  );
  assert.ok(layout.tankTop > layout.zonesBottom, "the reservoir comes after the zones");
  assert.equal(layout.tankTop, layout.earlierTop, "the reservoir and Earlier today share a row");
  assert.ok(layout.tankRight < layout.earlierLeft, "the reservoir beside Earlier today");
  assert.ok(layout.feedTop < layout.titleBottom, "the summary's Feed link shares its title's line");
  await summary.getByRole("button", { name: "Feed", exact: true }).click();
  await page.waitForFunction(() => location.hash === "#/reservoir");
  await tank.waitFor();
  assert.equal(
    await page.locator(".res-batch + .tank-panel[data-tank-status]").count(),
    1,
    "the tank card follows the nutrient batch",
  );
  const card = await tank.evaluate((panel) => ({
    mapTop: panel.querySelector(".tank-actions button").getBoundingClientRect().top,
    titleBottom: panel.querySelector(".panel-heading h2").getBoundingClientRect().bottom,
  }));
  assert.ok(card.mapTop < card.titleBottom, "the tank's action shares the title's line");

  // Light theme: the card and the summary stay accessible.
  const lightContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  const light = await open(lightContext);
  await light.goto(`${origin}/dashboard.html?demo=1#/reservoir`);
  await light.locator(FULL).locator("[data-tank-history]").waitFor();
  await settled(light);
  const audit = await new AxeBuilder({ page: light }).include(FULL).analyze();
  assert.deepEqual(
    audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    [],
    "tank panel accessibility, light",
  );
  await light.evaluate(() => {
    location.hash = "#/overview";
  });
  await light.locator(SUMMARY).waitFor();
  await settled(light);
  const summaryAudit = await new AxeBuilder({ page: light }).include(SUMMARY).analyze();
  assert.deepEqual(
    summaryAudit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    [],
    "reservoir summary accessibility, light",
  );
  await lightContext.close();

  // Without automatic refills, a reminder to refill the reservoir by hand comes at a level of its
  // own: set on the Reservoir page, a dotted line on the chart, and Refill soon under the tank once
  // it is down to it, and on the Overview's summary. While automatic refills keep it up, there is
  // no reminder to set.
  await page.goto(`${origin}/dashboard.html?demo=1#/reservoir`);
  await page.locator(".res-batch").waitFor();
  const remind = page.getByLabel("Remind me at (%)");
  assert.equal(await remind.count(), 0, "no reminder while automatic refills keep it up");
  await page.getByRole("button", { name: "Turn automatic off…" }).click();
  await page.getByRole("button", { name: "Apply 1 change" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await remind.inputValue(), "20");
  await remind.fill("4");
  await page.locator("[data-remind-note]").waitFor(); // at or under the 5% minimum: never reminds
  await remind.fill("30");
  assert.equal(await page.locator("[data-remind-note]").count(), 0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved. The controller app runs the next batch").waitFor();
  await page.locator(".res-batch [data-refill-soon]").waitFor(); // 29%, at or under 30%
  const reminded = page.locator(FULL);
  await reminded.locator("[data-refill-soon]").waitFor();
  await reminded.locator(".tank-remind-line").first().waitFor({ state: "attached" });
  assert.match(
    await reminded.locator("[data-tank-history]").getAttribute("aria-label"),
    /the dotted line is 30%, where a reminder to refill it comes/,
  );
  const heading = await reminded.evaluate((panel) => ({
    mapTop: panel.querySelector(".tank-actions button").getBoundingClientRect().top,
    titleBottom: panel.querySelector(".panel-heading h2").getBoundingClientRect().bottom,
  }));
  assert.ok(heading.mapTop < heading.titleBottom, "Map sensors stays on the title's line");
  await settled(page);
  const remindAudit = await new AxeBuilder({ page }).include(FULL).analyze();
  assert.deepEqual(
    remindAudit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    [],
    "tank panel accessibility, with Refill soon",
  );
  await page.evaluate(() => {
    location.hash = "#/overview";
  });
  await summary.locator("[data-refill-soon]").waitFor();
  assert.match(await summary.innerText(), /reminder at 30%/);
  const line = await summary.evaluate((panel) => ({
    feedTop: panel.querySelector(":scope > .link-button").getBoundingClientRect().top,
    titleBottom: panel.querySelector("h2").getBoundingClientRect().bottom,
  }));
  assert.ok(line.feedTop < line.titleBottom, "the Feed link stays on the title's line");
  await settled(page);
  const summaryRemindAudit = await new AxeBuilder({ page }).include(SUMMARY).analyze();
  assert.deepEqual(
    summaryRemindAudit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    [],
    "reservoir summary accessibility, with Refill soon",
  );

  await page.goto(`${origin}/dashboard.html?demo=1&room=room%3Af1_#/overview`);
  // Flower 1 has no reservoir: no level sensor reads it and nothing refills it, so its level is not
  // mapped, there is nothing to chart and no refill to report. Only its pump is mapped, and its
  // summary asks for the rest to be mapped, in Rooms & hardware.
  await page.waitForFunction(() =>
    /Not mapped/.test(document.querySelector("[data-tank-status]")?.textContent ?? ""),
  );
  assert.equal(
    await page.locator("[data-tank-level]").getAttribute("data-tank-level"),
    "unknown",
  );
  assert.equal(await page.locator("[data-pump-state]").getAttribute("data-pump-state"), "off");
  assert.doesNotMatch(await summary.innerText(), /last refill|minimum|reminder/);
  assert.equal(await page.locator("[data-refill-soon]").count(), 0);
  assert.equal(await page.locator("[data-refill-state]").count(), 0);
  assert.equal(await page.locator("[data-tank-history]").count(), 0);
  assert.equal(await summary.getByRole("button", { name: "Feed", exact: true }).count(), 0);
  await summary.getByRole("button", { name: "Map sensors", exact: true }).click();
  await page.waitForFunction(() => location.hash === "#/setup");
  // Nor does its Feed › Reservoir page have a tank to draw or a refill to report.
  await page.evaluate(() => {
    location.hash = "#/reservoir";
  });
  await page.getByText("No reservoir mapped").waitFor();
  assert.equal(await page.locator("[data-tank-status]").count(), 0);
  assert.equal(await page.locator("[data-refill-state]").count(), 0);
  assert.equal(await page.locator("[data-tank-history]").count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  const checks = [
    "graphical mapped tank readings, no tank EC or pH, on Feed › Reservoir and the Overview",
    "refills from the controller's record, none for a room without a reservoir",
    "the level over the last 12 or 24 hours beside the tank, its times apart at 1440 and 390 px",
    "zone event timestamps",
    "mobile layout and accessibility, light and dark, of the card and the summary",
    "Overview two screens at most, the reservoir beside Earlier today under the zones, its Feed link on the title's line; on Feed › Reservoir the card after the batch, Map sensors on the heading's line",
    "without automatic refills, a reminder level: its setting, a line on the chart and Refill soon",
    "room isolation",
  ];
  await writeFile(
    new URL("tank-status-verification.json", out),
    JSON.stringify({ checks, errors, forbidden }, null, 2),
  );
  console.log(
    `${checks.length} tank/zone browser checks passed; no console errors or external/API requests.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
