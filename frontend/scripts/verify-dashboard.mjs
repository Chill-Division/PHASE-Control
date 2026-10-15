/** Browser contracts against the compiled artifact. API traffic is fixture-only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { fitsWidth } from "./fits-width.mjs";
import { settled } from "./settled.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const publicRoot = path.join(root, "addons/f2_control/www/public");
const out = path.join(root, "output/playwright");
// The README's screenshots, from the same demo the checks drive.
const img = (name) => path.join(root, "img", name);
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(publicRoot, "." + (requested === "/" ? "/index.html" : requested));
    if (!file.startsWith(publicRoot + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    const type =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
      }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL || process.platform === "win32"
    ? { channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" }
    : {}),
});
const checks = [];
const pageErrors = [];
const forbidden = [];
const accessibility = [];
const planViewLayouts = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  reducedMotion: "reduce",
});
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== base || url.pathname.startsWith("/api/")) {
    forbidden.push(url.origin + url.pathname);
    return route.abort();
  }
  return route.continue();
});
const page = await context.newPage();
page.on("pageerror", (error) => pageErrors.push(error.message));
const expectVisible = async (locator) => {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
};
async function check(name, run) {
  await run();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function go(route, room = "room:") {
  await page.goto(`${base}/dashboard.html?demo&room=${room}#/${route}`, {
    waitUntil: "networkidle",
  });
}
/** Opens one of a menu section's views in the app, keeping what the demo has done so far. */
async function openView(section, view) {
  await page
    .locator(".desktop-sidebar")
    .getByRole("button", { name: section, exact: true })
    .click();
  await page
    .getByRole("navigation", { name: `${section} views` })
    .getByRole("button", { name: view, exact: true })
    .click();
}
/** Opens a zone's details from the Overview's zone table, by its name. */
async function openZone(name) {
  await page.locator(".zone-table-desktop").getByRole("button", { name, exact: true }).click();
  await expectVisible(page.getByRole("dialog"));
}
async function noOverflow() {
  await fitsWidth(page);
}
async function planViewsShareRow() {
  const views = page.getByRole("navigation", { name: "Irrigation strategy views" });
  const [today, schedule] = await Promise.all([
    views.getByRole("button", { name: "Today", exact: true }).boundingBox(),
    views.getByRole("button", { name: "Schedule", exact: true }).boundingBox(),
  ]);
  assert.ok(today && schedule, "Both irrigation plan view buttons must be visible");
  assert.ok(
    Math.abs(today.y - schedule.y) <= 2 &&
      Math.abs(today.y + today.height - schedule.y - schedule.height) <= 2,
    "Today and Schedule must share one horizontal row",
  );
  assert.ok(
    schedule.x >= today.x + today.width - 1,
    "Schedule must sit beside Today without overlap",
  );
  planViewLayouts.push({
    route: new URL(page.url()).hash,
    viewport: page.viewportSize(),
    today,
    schedule,
  });
}
/** Runs `open`, then axe, in the light theme and again in the dark one, each chosen as a person
 * would (the saved preference, applied on load), and leaves the page light. */
async function inBothThemes(label, open) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("irrigation-theme", value), theme);
    await page.reload({ waitUntil: "networkidle" });
    await open();
    assert.equal(
      await page.evaluate(() => document.documentElement.classList.contains("dark")),
      theme === "dark",
    );
    await axe(theme === "dark" ? `${label}, dark` : label);
  }
  await page.evaluate(() => localStorage.setItem("irrigation-theme", "light"));
  await page.reload({ waitUntil: "networkidle" });
}
/** The words and the colour (tone, or phase) of every pill `scope` matches. */
async function pillTones(scope) {
  return page
    .locator(scope)
    .evaluateAll((pills) =>
      pills.map((pill) => [pill.textContent.trim(), pill.dataset.tone ?? pill.dataset.phase]),
    );
}
/** axe on the page once nothing is easing any more (settled.mjs). */
async function axe(label) {
  await settled(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  accessibility.push({
    page: label,
    violations: result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
  assert.equal(
    result.violations.length,
    0,
    `${label} accessibility: ${result.violations.map((v) => v.id).join(", ")}`,
  );
}
try {
  await check("primary entry preserves room, demo and route", async () => {
    await page.goto(`${base}/index.html?demo&room=room:f1_#/water`);
    await expectVisible(page.getByRole("heading", { name: "Water", exact: true }));
    const opened = new URL(page.url());
    assert.equal(opened.pathname, "/dashboard.html");
    assert.ok(opened.searchParams.has("demo"));
    assert.equal(opened.searchParams.get("room"), "room:f1_");
    assert.equal(opened.hash, "#/water");
    assert.equal(await page.locator("#desktop-room").inputValue(), "room:f1_");
  });
  const routes = [
    ["overview", "Flower 2 overview"],
    ["strategy", "Today’s targets"],
    ["grow-plan", "Scheduled targets"],
    ["insights", "Zone diagnostics"],
    ["water", "Water"],
    ["compare", "Compare runs"],
    ["activity", "Activity"],
    ["reservoir", "Reservoir"],
    ["stock", "Stock tanks"],
    ["settings", "Settings"],
    ["setup", "Rooms & hardware"],
    ["help", "Help"],
  ];
  for (const [route, heading] of routes)
    await check(`${route}: render, desktop layout and accessibility`, async () => {
      await go(route);
      await expectVisible(page.getByRole("heading", { name: heading, exact: true }));
      // A heading carries a sentence only for a behaviour someone could get wrong.
      if (!["strategy", "grow-plan"].includes(route))
        assert.equal(
          await page.locator(".page-heading > div > p").count(),
          0,
          `${route}: the heading repeats itself in a description`,
        );
      if (["strategy", "grow-plan"].includes(route)) await planViewsShareRow();
      await noOverflow();
      await axe(route);
      await page.screenshot({
        path: path.join(out, `dashboard-${route}.png`),
        fullPage: true,
      });
    });
  await check("irrigation plan: a setting's ? explains it, in both themes, and closes on Escape", async () => {
    const trigger = () =>
      page.getByRole("button", { name: "About Maintenance shot when below", exact: true });
    const help = () => page.getByRole("dialog", { name: "Maintenance shot when below" });
    await inBothThemes("setting explainer", async () => {
      await go("strategy");
      await trigger().click();
      await expectVisible(help());
      const text = await help().innerText();
      for (const part of ["What it is", "When it acts", "What it affects", "Athena Handbook"])
        assert.match(text, new RegExp(part, "i"), `the explainer has "${part}"`);
      assert.match(text, /a level, not a crossing/);
      // What it accepts and the setting's key, which the field itself no longer spells out.
      assert.match(text, /^10–100 % · step 0\.5$/m);
      assert.match(text, /^p2_vwc_threshold$/m);
    });
    assert.equal(await page.locator(".setting-field code").count(), 0, "no setting key on a field");
    await go("strategy");
    await trigger().click();
    await expectVisible(help());
    await page.keyboard.press("Escape");
    assert.equal(await help().count(), 0, "Escape closes the explainer");
    // The popover hands focus back as it finishes closing, a moment after Escape: read it until it
    // arrives (up to 2 s) rather than once, which failed at random on a slower machine.
    let focused = false;
    for (let tries = 0; tries < 20 && !focused; tries++) {
      focused = await trigger().evaluate((button) => button === document.activeElement);
      if (!focused) await page.waitForTimeout(100);
    }
    assert.equal(focused, true, "focus returns to the ?");
  });
  await check("irrigation plan: a level out of order says what the controller does with it", async () => {
    await go("strategy");
    const field = (key) =>
      page.locator(".setting-field", {
        has: page.locator(`[id="setting-number.crop_steering_zone_1_${key}"]`),
      });
    // The levels' own advisories, not the probe-history ones beside them.
    const advisory = (key) =>
      field(key).locator(".setting-advisory", {
        hasText: /controller uses|stop tonight's dryback|dries back overnight|ramp stops/,
      });
    for (const key of ["p1_target_vwc", "p2_vwc_threshold", "p3_emergency_vwc_threshold"])
      assert.equal(await advisory(key).count(), 0, "the demo's levels are in order");
    // A trigger typed above the zone's 64% peak target: the controller keeps it 1 point under.
    await field("p2_vwc_threshold").locator("input").fill("80");
    assert.match(
      await advisory("p2_vwc_threshold").innerText(),
      /^The controller uses 63%: it keeps the trigger 1 point under the peak VWC target\. Advisory only/,
    );
    // A rescue level above where tonight's dryback ends, said beside both settings it involves.
    await field("p2_vwc_threshold").locator("input").fill("61");
    await field("p3_emergency_vwc_threshold").locator("input").fill("62");
    assert.match(
      await advisory("p3_emergency_vwc_threshold").innerText(),
      /^Rescue shots would stop tonight's dryback at 62%: /,
    );
    await field("p3_emergency_vwc_threshold").locator("input").fill("35");
    assert.equal(await advisory("p3_emergency_vwc_threshold").count(), 0);
  });
  await check("irrigation plan: auto setpoints says when tonight's dryback is out of reach", async () => {
    await go("strategy");
    const note =
      "8% dryback unreachable at this zone's uptake: about 6% tonight, with maintenance shots until 19:00";
    // Beside the P3 dryback target of the steering mode in use, and on the zone's Auto chip.
    const target = page.locator(".setting-field", {
      has: page.locator('[id="setting-number.crop_steering_zone_1_vegetative_dryback_target"]'),
    });
    assert.equal(await target.locator("[data-auto-dryback]").innerText(), `Auto setpoints: ${note}.`);
    assert.match(await page.locator(".auto-chip").first().innerText(), /Tonight/);
  });
  await check("status line: watering switched off says why and opens that room's Overview", async () => {
    await go("overview", "room:f1_");
    await page.getByRole("button", { name: "Switch watering off…", exact: true }).click();
    await page.getByRole("button", { name: /Apply \d+ change/ }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    // Another room selected, on another page: the link must still open Flower 1's Overview.
    await page.locator("#desktop-room").selectOption("room:");
    await page.evaluate(() => (location.hash = "#/activity"));
    const line = page.locator('.status-line[data-room="room:f1_"]');
    assert.match(
      await line.innerText(),
      /Not watering — Watering is switched off for this room \(its engine switch\)/,
    );
    await line.getByRole("link", { name: "Switch it on in Overview", exact: true }).click();
    await expectVisible(page.getByRole("heading", { name: "Flower 1 overview", exact: true }));
    assert.match(page.url(), /room=room(%3A|:)f1_/);
    assert.equal(await page.locator("#desktop-room").inputValue(), "room:f1_");
    await expectVisible(page.getByText("Watering off", { exact: true }));
    await expectVisible(page.getByRole("button", { name: "Switch watering on…", exact: true }));
  });
  await check("help: the terms and the error codes, no second menu", async () => {
    await go("help");
    await expectVisible(page.getByRole("heading", { name: "Terms & phases", exact: true }));
    await expectVisible(page.getByRole("heading", { name: "Error codes", exact: true }));
    // Every page is in the menu: Help links to none of them.
    assert.equal(await page.locator('#main-content a[href^="#/"]').count(), 0);
  });
  await check("recent activity opens beside any page and leads to the full log", async () => {
    await go("water");
    assert.equal(await page.getByRole("dialog").count(), 0, "the panel starts closed");
    await page.getByRole("button", { name: "Recent activity", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Recent activity" });
    await expectVisible(panel);
    assert.ok((await panel.locator(".event-row").count()) > 0, "the demo room has records");
    await axe("recent activity panel");
    await page.screenshot({ path: path.join(out, "dashboard-activity-panel.png") });
    // Closing hands focus back to the button that opened it.
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    // Radix restores focus as the panel unmounts, a moment after it is hidden: wait, don't sample.
    await page
      .waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "Recent activity",
        null,
        { timeout: 5_000 },
      )
      .catch(() => {
        throw new Error("focus did not return to the Recent activity button");
      });
    await page.getByRole("button", { name: "Recent activity", exact: true }).click();
    await expectVisible(panel);
    await panel.getByRole("button", { name: "Open the activity log" }).click();
    await expectVisible(page.getByRole("heading", { name: "Activity", exact: true }));
    assert.equal(await page.getByRole("dialog").count(), 0, "the panel closes when the log opens");
    await go("overview");
    assert.equal(await page.getByRole("heading", { name: "Recent activity" }).count(), 0);
  });
  await check("overview: the grow day comes first, above the tank", async () => {
    await go("overview");
    const timeline = page.locator("[data-day-timeline]");
    await expectVisible(timeline.locator(".timeline-zone").first());
    const tops = await page.evaluate(() =>
      ["[data-day-timeline]", "[data-tank-status]", ".zone-table-desktop"].map(
        (selector) => document.querySelector(selector).getBoundingClientRect().top,
      ),
    );
    assert.ok(tops[0] < tops[1] && tops[0] < tops[2], `timeline ${tops[0]}, tank ${tops[1]}`);
    assert.equal(await page.locator(".wd-daily").count(), 0, "no water table on the Overview");
    assert.equal(await page.getByText("Controller scheduling", { exact: true }).count(), 0);
  });
  await check("stock tanks: refill, set a level and add a tank; a batch is the recipe's", async () => {
    await go("stock");
    const card = (id) => page.locator(`[data-stock-tank="${id}"]`);
    await expectVisible(card("balance"));
    assert.equal(await page.locator("[data-stock-tank]").count(), 4);
    await page.screenshot({ path: img("stock-tanks.png") });
    // Balance starts within half again of its low mark: amber, "Getting low".
    assert.equal(await card("balance").locator(".pill").textContent(), "Getting low");
    // What a batch takes is the feed recipe's: Flower gives 150 mL of Balance from doser 3.
    assert.match(await card("balance").innerText(), /150\s*mL\s*from doser 3/);
    await card("balance").getByRole("button", { name: "Refilled" }).click();
    await expectVisible(card("balance").getByText("OK", { exact: true }));
    assert.match(await card("balance").locator("dd").first().textContent(), /^10 of 10 L$/);

    await card("cleanse").getByRole("button", { name: "Set level" }).click();
    await card("cleanse").getByLabel("Level read off the tank (L)").fill("0.8");
    await card("cleanse").getByRole("button", { name: "Save level" }).click();
    await expectVisible(card("cleanse").getByText("Low", { exact: true }));
    // Every batch comes from the Reservoir: none is recorded by hand.
    assert.equal(await page.getByRole("button", { name: "Record a batch" }).count(), 0);
    await expectVisible(page.getByRole("heading", { name: "Recent batches" }));

    await page.getByRole("button", { name: "Edit stock tanks" }).click();
    const editor = page.getByRole("dialog");
    // A tank is its name, capacity, level, low mark and doser: no dose per batch, no dose entity.
    assert.equal(await editor.getByLabel(/Per batch/).count(), 0);
    assert.equal(await editor.getByLabel(/Dose entity/).count(), 0);
    await editor.getByRole("button", { name: "Add a stock tank" }).click();
    await editor.getByLabel("Name").last().fill("Silica");
    await editor.getByRole("button", { name: "Save stock tanks" }).click();
    await expectVisible(card("silica"));
    assert.match(await card("silica").innerText(), /On no doser/);
    await axe("stock tanks after edits");
    await noOverflow();
  });
  await check("stock tanks: a tank on a Reservoir doser takes what the stage in use gives from it", async () => {
    await go("stock");
    await page.reload({ waitUntil: "networkidle" }); // the same address: a fresh demo
    await page.getByRole("button", { name: "Edit stock tanks" }).click();
    const editor = page.getByRole("dialog");
    await editor.getByRole("button", { name: "Add a stock tank" }).click();
    await editor.getByLabel("Name").last().fill("Fade");
    const doser = editor.getByLabel("Doser", { exact: true }).last();
    assert.deepEqual(await doser.locator("option").allInnerTexts(), [
      "Not on a doser",
      "Doser 1 · Core",
      "Doser 2 · Bloom",
      "Doser 3 · Balance",
      "Doser 4 · Cleanse",
    ]);
    // The Fade bottle shares doser 2 with Bloom (bottles swapped between stages).
    await doser.selectOption("2");
    await axe("stock tank editor with dosers");
    await editor.getByRole("button", { name: "Save stock tanks" }).click();
    const bloom = page.locator('[data-stock-tank="bloom"]');
    await expectVisible(bloom);
    const text = await bloom.innerText();
    assert.match(text, /750\s*mL/, "Flower gives 750 mL from doser 2");
    assert.match(text, /from doser 2/);
    // Flower puts Bloom on doser 2, so the Fade bottle beside it takes nothing this week.
    assert.match(await page.locator('[data-stock-tank="fade"]').innerText(), /Per batch\s*—/);
    await expectVisible(page.locator("[data-stock-dosers]"));
    await noOverflow();
  });
  await check("reservoir: a refill waits until its fill fits, then mixes in the room's order", async () => {
    await go("reservoir");
    const batch = page.locator("[data-batch-status]");
    await expectVisible(batch);
    assert.equal(await batch.getAttribute("data-batch-status"), "idle");
    // Fill, then fill and mix (the pump from half-way) with a chip inside it for each dose, in the
    // recipe's order: the doses go in while it fills, and all fit, so it ends with the fill.
    const steps = () => batch.locator(".res-step-label").allInnerTexts();
    const fill = ["Fill", "Fill and mix"];
    assert.deepEqual(await steps(), [...fill, "Core", "Bloom", "Balance", "Cleanse"]);
    assert.equal(await batch.locator(".res-steps-group .res-step-label").count(), 5);
    // The level is the distance between the distances when full and empty: 640 mm of 125-850 is 29%.
    await expectVisible(
      batch.getByRole("img", { name: "The reservoir is 29% full; it keeps at least 5%" }),
    );
    await page.screenshot({ path: img("reservoir.png") });

    // A refill by hand is a test, under Tests in Settings → Rooms & hardware. At 29%, with 1% holding
    // 2.07 L, a 150 L fill (about 72%) could overflow it: the dialog says why the controller would not
    // start it, and only someone who has checked that it fits can run it anyway.
    await batch.getByRole("button", { name: "Refill by hand…" }).click();
    const tests = page.locator("[data-room-tests]");
    await expectVisible(tests);
    await tests.getByRole("button", { name: "Run a test refill" }).click();
    let dialog = page.getByRole("dialog");
    await expectVisible(dialog.getByText(/reads 29%, and its 150 L fill adds about 72%, so it could overflow/));
    assert.equal(await dialog.getByRole("button", { name: "Refill and mix", exact: true }).isDisabled(), true);
    await dialog.getByLabel(/Run anyway: I have checked that the reservoir has room for 150\sL/).check();
    assert.equal(await dialog.getByRole("button", { name: "Refill and mix anyway" }).isDisabled(), false);
    await axe("test refill that could overflow, run anyway");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "hidden" });
    await openView("Feed", "Reservoir");

    // Each recipe doses in its own order: drag Core's row below Balance's by its handle, as with a
    // finger or a mouse.
    const flowerCard = page.locator('[data-recipe="Flower"]');
    const rows = flowerCard.locator("tbody tr");
    const names = () => rows.evaluateAll((trs) => trs.map((tr) => `Doser ${tr.dataset.dose}`));
    await rows.nth(2).scrollIntoViewIfNeeded(); // the mouse only reaches what is on screen: the drop row too
    const from = await rows.nth(0).locator(".res-grip").boundingBox();
    const target = await rows.nth(2).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, target.y + target.height * 0.75, { steps: 8 });
    await page.mouse.up();
    assert.deepEqual(await names(), ["Doser 2", "Doser 3", "Doser 1", "Doser 4"]);
    // The arrows move one too: Cleanse's doser first.
    for (let i = 0; i < 3; i++)
      await flowerCard.getByRole("button", { name: "Move doser 4 earlier" }).click();
    assert.deepEqual(await names(), ["Doser 4", "Doser 2", "Doser 3", "Doser 1"]);
    // The Dosers section keeps only what each pumps: no order to set there.
    assert.equal(await page.locator(".res-doser .res-grip").count(), 0);
    // 1 part as mL of nutrient in each 150 L fill: 240 mL makes 5 parts of Bloom 1,200 mL, whole.
    await flowerCard.getByLabel("1 part (mL)").fill("240");
    await expectVisible(
      flowerCard.getByText(/1 part is 240 mL of nutrient in each 150 L fill, so a nutrient gets its parts × 240 mL \(Bloom: 5 × 240 = 1,200 mL\)/),
    );
    assert.equal(await flowerCard.getByLabel("mL per litre per part").inputValue(), "1.6");
    assert.match(
      await flowerCard.locator('tbody tr[data-dose="2"] td').nth(4).innerText(),
      /^1,200\s*mL$/,
    );

    // A new recipe takes the bottles the last one had, and the next stage name.
    await page.getByRole("button", { name: "Add a feed recipe" }).click();
    const vege = page.locator('[data-recipe="Vege"]');
    await expectVisible(vege);
    assert.equal(await vege.getByLabel("Doser 1 nutrient").inputValue(), "Core");
    await vege.getByLabel("Doser 1 parts").fill("4");
    // A 100 L fill adds about 48%: from 29% it fits now.
    await page.getByLabel("Fill litres (L)").fill("100");
    const bar = page.getByRole("region", { name: "Unsaved changes" });
    await expectVisible(bar);
    await axe("reservoir with unsaved changes");
    await bar.getByRole("button", { name: "Save" }).click();
    await expectVisible(page.getByText("Saved. The controller app runs the next batch"));
    assert.equal(await bar.count(), 0);
    const stages = await page.getByLabel("Stage in use").locator("option").allInnerTexts();
    assert.deepEqual(stages, ["None: no batches", "Flower", "Vege"]);
    assert.deepEqual(await steps(), [...fill, "Cleanse", "Bloom", "Balance", "Core"]);

    await batch.getByRole("button", { name: "Refill by hand…" }).click();
    await tests.getByRole("button", { name: "Run a test refill" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Refill and mix", exact: true }).click();
    await expectVisible(tests.getByText(/Test refill asked for at .*within a minute/));
    // One runs now: no other can be asked for until it is done.
    assert.equal(await tests.getByRole("button", { name: "Run a test refill" }).isDisabled(), true);
    await openView("Feed", "Reservoir");
    assert.equal(await batch.getAttribute("data-batch-status"), "filling");
    await expectVisible(batch.getByText(/s left$/));
    await axe("reservoir while a batch fills");
    await noOverflow();
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow();
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check("feed schedule: each week its recipe from Week 1's day; a pick holds until next week", async () => {
    await go("reservoir");
    await page.reload({ waitUntil: "networkidle" }); // the same address: a fresh demo, no refill running
    await page.getByRole("button", { name: "Add a feed recipe" }).click(); // Vege
    const panel = page.locator("[data-feed-schedule]");
    // Three weeks that began 8 days ago: today is in week 2.
    const began = new Date(Date.now() - 8 * 86_400_000);
    const day = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await panel.getByLabel("Week 1 starts on").fill(day(began));
    for (let i = 0; i < 3; i++) await panel.getByRole("button", { name: "One more week" }).click();
    await panel.locator('[data-week="1"] select').selectOption({ label: "Vege" });
    assert.equal(await panel.locator("[data-week]").count(), 3);
    assert.equal(await panel.locator('[data-week="2"]').getAttribute("data-now"), "");
    await expectVisible(panel.getByText(/This week: Week 2 of 3, Flower\. Week 3 \(Flower\) starts on /));
    await expectVisible(page.locator("[data-stage-source]"));
    // Picked by hand while it runs: held only until the next week, and the page says so.
    await page.getByLabel("Stage in use").selectOption({ label: "Vege" });
    await expectVisible(page.locator("[data-stage-held]").getByText(/Held by hand only until Week 3 starts on/));
    await expectVisible(panel.getByText(/If you don't want the scheduled recipe, remove the schedule/));
    await axe("feed schedule with a stage held by hand");
    const bar = page.getByRole("region", { name: "Unsaved changes" });
    await bar.getByRole("button", { name: "Save" }).click();
    await expectVisible(page.getByText("Saved. The controller app runs the next batch"));
    await expectVisible(page.locator("[data-batch-status]").getByText("Next refill: Vege, 150 L."));
    // Removed, the stage in use stays as it was, picked by hand.
    await panel.getByRole("button", { name: "Remove the schedule" }).click();
    await expectVisible(panel.getByText(/No schedule: the stage in use is the one picked by hand/));
    assert.equal(await page.getByLabel("Stage in use").inputValue(), await page.getByLabel("Stage in use").locator("option", { hasText: "Vege" }).getAttribute("value"));
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole("button", { name: "One more week" }).click();
    await noOverflow();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await bar.getByRole("button", { name: "Discard" }).click(); // leave nothing unsaved behind
    await bar.waitFor({ state: "hidden" });
  });
  await check("reservoir: a template or a recipe file puts each nutrient on the doser that carries it", async () => {
    await go("reservoir");
    const recipes = page.locator("section.res-recipes");
    await expectVisible(recipes);
    const cards = recipes.locator(".res-recipe");
    const before = await cards.count();
    // Athena Bloom as Chill Division runs it: each nutrient goes on the doser the room's recipes give it.
    await page.getByLabel("Start from").selectOption("athena-cd-bloom");
    await page.getByRole("button", { name: "Add a feed recipe" }).click();
    const note = page.locator("[data-recipe-added]");
    await expectVisible(
      note.getByText(
        "Added Athena Bloom (Chill Division modified). Each nutrient went on the doser that carries it.",
      ),
    );
    assert.equal(await cards.count(), before + 1);
    const added = cards.last();
    assert.equal(await added.getByLabel("Stage name").inputValue(), "Athena Bloom (Chill Division modified)");
    // Its recipe file, back in: the same recipe, under a name of its own.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      added.getByRole("button", { name: "Export Athena Bloom (Chill Division modified)" }).click(),
    ]);
    assert.equal(download.suggestedFilename(), "feed-recipe-athena-bloom-chill-division-modified.json");
    await page.getByLabel("Import a feed recipe file").setInputFiles(await download.path());
    await expectVisible(note.getByText(/^Added Athena Bloom \(Chill Division modified\) 2\./));
    assert.equal(await cards.count(), before + 2);
    // A file that isn't one says so, and adds nothing.
    await page.getByLabel("Import a feed recipe file").setInputFiles({
      name: "not-a-recipe.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
    await expectVisible(note.getByText("That file isn't a PHASE Control feed recipe."));
    assert.equal(await cards.count(), before + 2);
    await axe("feed recipes from a template and a recipe file");
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const bar = page.getByRole("region", { name: "Unsaved changes" });
    await bar.getByRole("button", { name: "Discard" }).click(); // leave nothing unsaved behind
    await bar.waitFor({ state: "hidden" });
  });
  await check("tests: a zone's test shot says what it gives, and is asked for once confirmed", async () => {
    await go("setup");
    const tests = page.locator("[data-room-tests]");
    await expectVisible(tests);
    await tests.getByLabel("Zone").selectOption({ label: "Zone 2" });
    await tests.getByRole("button", { name: "Run a test shot" }).click();
    const dialog = page.getByRole("dialog", { name: "Water Zone 2 for 10 seconds now?" });
    // 36 plants with one 4 L/h dripper each: 10 s gives 0.4 L.
    await expectVisible(dialog.getByText(/About 0\.4 L across 36 plants, 11 mL each/));
    await axe("test shot dialog");
    await dialog.getByRole("button", { name: "Run the test shot" }).click();
    await expectVisible(tests.getByText(/Test shot for Zone 2 asked for at .*within a minute/));
    // A change not saved yet: a test runs on the saved configuration, so none runs until it is.
    await page.getByLabel("Room name").fill("Renamed");
    await expectVisible(tests.getByText("Save or discard your changes first"));
    assert.equal(await tests.getByRole("button", { name: "Run a test shot" }).isDisabled(), true);
    await inBothThemes("rooms & hardware tests", async () => {
      await go("setup");
      await page.locator("[data-room-tests]").scrollIntoViewIfNeeded();
      await expectVisible(page.locator("[data-room-tests]"));
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await go("setup");
    await page.locator("[data-room-tests]").scrollIntoViewIfNeeded();
    await noOverflow();
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check("reservoir: a room without one points to Rooms & hardware, which maps it", async () => {
    await go("reservoir", "room:f1_");
    await expectVisible(page.getByRole("heading", { name: "No reservoir mapped" }));
    await page.getByRole("button", { name: "Map them in Rooms & hardware" }).click();
    const card = page.locator("[data-setup-reservoir]");
    await expectVisible(card);
    assert.equal(await card.locator(".mapping-picker").count(), 9);
    // Nothing here can refill: the Tests offer no refill, and say nothing about one.
    const tests = page.locator("[data-room-tests]");
    await expectVisible(tests.getByRole("button", { name: "Run a test shot" }));
    assert.equal(await tests.getByText(/refill/i).count(), 0);
    await inBothThemes("rooms & hardware reservoir card", async () => {
      await go("setup", "room:f1_");
      await expectVisible(page.locator("[data-setup-reservoir]"));
    });
  });
  await check("reservoir: a room that cannot refill shows its level, and no refill", async () => {
    // Flower 2 without its recirculation solenoid: nothing can refill it. (A setup change needs
    // watering off.)
    await go("overview");
    await page.getByRole("button", { name: "Switch watering off…", exact: true }).click();
    await page.getByRole("button", { name: /Apply \d+ change/ }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.evaluate(() => (location.hash = "#/setup"));
    const card = page.locator("[data-setup-reservoir]");
    await expectVisible(card);
    await card.getByRole("button", { name: "Map Recirculation solenoid", exact: true }).click();
    await page.getByRole("button", { name: "Clear mapping", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Review configuration", exact: true }).click();
    await page.getByRole("button", { name: "Save configuration", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const tests = page.locator("[data-room-tests]");
    await expectVisible(tests.getByRole("button", { name: "Run a test shot" }));
    assert.equal(await tests.getByText(/refill/i).count(), 0, "the Tests offer no refill");
    await page.evaluate(() => (location.hash = "#/reservoir"));
    const panel = page.locator(".res-batch");
    await expectVisible(panel.getByText("Level", { exact: true }));
    for (const gone of ["Refill by hand…", "Fill and mix", "Automatic refills", "A batch cannot start", "Next refill"])
      assert.equal(await panel.getByText(gone).count(), 0, gone);
    assert.equal(await panel.locator(".eyebrow").first().innerText(), "Reservoir");
    // Its last batch, recorded when it could, still shows.
    await expectVisible(panel.getByText("Last batch", { exact: true }));
    // go() changes only the hash of a page on the same address, which keeps this demo's changes:
    // the next check starts from a fresh one.
    await page.goto("about:blank");
  });
  await check("overview: every zone and room metric has its mini visual", async () => {
    await go("overview");
    await expectVisible(page.locator(".zone-table-desktop th", { hasText: "Dryback" }));
    // The dryback waits for the recorded readings; every row gets one once they arrive.
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".zone-table-desktop [data-dryback]").length ===
        document.querySelectorAll(".zone-table-desktop tbody tr").length,
    );
    const facts = await page.evaluate(() => ({
      rows: document.querySelectorAll(".zone-table-desktop tbody tr").length,
      sparklines: document.querySelectorAll(".zone-table-desktop .dryback .sparkline").length,
      water: [...document.querySelectorAll(".zone-table-desktop .water-use .meter")].map((m) =>
        m.getAttribute("aria-label"),
      ),
      valves: [...document.querySelectorAll(".zone-table-desktop [data-zone-valve]")].map((v) => [
        v.textContent.trim(),
        v.dataset.tone,
      ]),
      bars: [...document.querySelectorAll(".metric-strip .mini-bars")].map(
        (b) => b.querySelectorAll(".mini-bar").length,
      ),
      captions: [...document.querySelectorAll(".metric-caption")].map((c) => c.textContent.trim()),
    }));
    assert.ok(facts.rows > 0);
    assert.equal(facts.sparklines, facts.rows, "every zone draws its recent moisture");
    assert.equal(facts.water.length, facts.rows, "every zone shows water against its daily limit");
    for (const label of facts.water) assert.match(label, /^\d+% of the [\d.]+ L daily limit$/);
    for (const [text, tone] of facts.valves)
      assert.equal(tone, /on$/.test(text) ? "on" : /off$/.test(text) ? "off" : "unknown", text);
    assert.deepEqual(facts.bars, [facts.rows, facts.rows, facts.rows, facts.rows]);
    assert.ok(
      facts.captions.some((c) => /^Avg [\d.]+ L per zone$/.test(c)),
      facts.captions.join(" | "),
    );
  });
  await check(
    "overview: the grow day tracks today against yesterday, a typical day and its targets",
    async () => {
      await go("overview");
      const timeline = page.locator("[data-day-timeline]");
      const lane = timeline.locator(".timeline-zone").first();
      const layer = (name) => lane.locator(`[data-layer="${name}"]`);
      // The earlier days load after today's: yesterday's line is the last to arrive.
      await expectVisible(layer("yesterday"));
      for (const name of ["targets", "projected", "expected", "yesterday-shots"])
        assert.equal(await layer(name).count(), 1, `the ${name} layer is drawn`);
      // Above each zone's chart, its phase and VWC now; how it tracks against yesterday and what
      // comes next are in Predictions, one paragraph a zone.
      const line = lane.locator(".timeline-zone-line");
      assert.match(await line.textContent(), /^Zone 1 P\d · [\d.]+% now$/);
      const predictions = async () => {
        await timeline.getByRole("button", { name: "Predictions" }).click();
        const box = page.locator("[data-predictions]");
        await expectVisible(box);
        const text = await box.locator("p[data-zone]").first().textContent();
        await page.keyboard.press("Escape");
        await box.waitFor({ state: "detached" });
        return text;
      };
      const tracked = await predictions();
      assert.match(tracked, /% now · [+−±][\d.]+ pts vs yesterday at .+ · Peak target [\d.]+% /);
      assert.match(tracked, /L so far \([+−±][\d.]+ L\)/);
      // The key is behind the "?" at the right of Today's events, its layers' switches with it.
      const openKey = async () => {
        await timeline.getByRole("button", { name: "Chart key" }).click();
        const key = page.getByRole("list", { name: "Timeline key" });
        await expectVisible(key);
        return key;
      };
      let key = await openKey();
      for (const [name, layers] of [
        ["Yesterday", ["yesterday", "yesterday-shots"]],
        ["Projected (estimate)", ["projected", "expected"]],
        ["Target for the phase", ["targets"]],
      ]) {
        const toggle = key.getByRole("button", { name, exact: true });
        assert.equal(await toggle.getAttribute("aria-pressed"), "true");
        await toggle.click();
        assert.equal(await toggle.getAttribute("aria-pressed"), "false");
        for (const hidden of layers) assert.equal(await layer(hidden).count(), 0, `${name} hides`);
      }
      await page.keyboard.press("Escape");
      // The choices are remembered in the browser.
      await page.reload({ waitUntil: "networkidle" });
      await expectVisible(lane);
      key = await openKey();
      assert.equal(
        await key
          .getByRole("button", { name: "Target for the phase" })
          .getAttribute("aria-pressed"),
        "false",
      );
      for (const name of ["Yesterday", "Projected (estimate)", "Target for the phase"])
        await key.getByRole("button", { name, exact: true }).click();
      await page.keyboard.press("Escape");
      await expectVisible(layer("yesterday"));
      assert.equal(await layer("targets").count(), 1);
      const compare = timeline.getByLabel("Compare with");
      await compare.selectOption("typical");
      await expectVisible(layer("typical"));
      assert.ok(
        (await layer("typical").locator(".typical-band").getAttribute("d")).length > 100,
        "the typical day is a p25-p75 band",
      );
      assert.equal(await layer("yesterday").count(), 0);
      key = await openKey();
      await expectVisible(key.getByRole("button", { name: "Typical (7 days)", exact: true }));
      await page.keyboard.press("Escape");
      assert.match(await predictions(), /pts vs typical at /);
      await axe("overview grow day, typical");
      await compare.selectOption("none");
      assert.equal(await layer("typical").count(), 0);
      assert.doesNotMatch(await predictions(), / vs (yesterday|typical)/);
      await compare.selectOption("yesterday");
      await expectVisible(layer("yesterday"));
      // Dark: the timeline's own layers and controls, as the error codes are checked below.
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await settled(page);
      const dark = await new AxeBuilder({ page })
        .include("[data-day-timeline]")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      // The key's popover, its switches on the popover's own background.
      await openKey();
      await settled(page);
      const darkKey = await new AxeBuilder({ page })
        .include(".timeline-popover")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      await page.keyboard.press("Escape");
      dark.violations.push(...darkKey.violations);
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
      assert.deepEqual(
        dark.violations.map((v) => v.id),
        [],
        "The grow day must be readable on a dark theme",
      );
    },
  );
  await check("overview: the zone table marks every target and colours every state", async () => {
    const rows = ".zone-table-desktop tbody tr";
    await inBothThemes("overview zone table", async () => {
      await go("overview");
      await page.waitForFunction(
        (rows) =>
          document.querySelectorAll(`${rows} [data-dryback]`).length ===
          document.querySelectorAll(rows).length,
        rows,
      );
    });
    await go("overview");
    await page.waitForFunction(
      (rows) => document.querySelectorAll(`${rows} [data-dryback]`).length > 0,
      rows,
    );
    const table = await page.evaluate((rows) => {
      const all = [...document.querySelectorAll(rows)];
      return {
        rows: all.length,
        headers: [...document.querySelectorAll(".zone-table-desktop th")].map((th) =>
          th.textContent.trim(),
        ),
        marked: all.filter((row) => row.cells[3].querySelector(".meter .meter-mark")).length,
      };
    }, rows);
    assert.ok(table.rows > 0);
    assert.deepEqual(table.headers, [
      "Zone",
      "Current state",
      "Last irrigation",
      "Moisture",
      "Root-zone EC",
      "Dryback",
      "Water today",
      "Actions",
    ]);
    assert.equal(table.marked, table.rows, "every moisture reading has its bar and target mark");
    const states = {
      "Valve on": "on",
      "Valve off": "off",
      "Valve unknown": "unknown",
      Enabled: "on",
      Paused: "warn",
      Unavailable: "unknown",
      Stale: "warn",
    };
    for (const [text, tone] of await pillTones(`${rows} .pill:has(.pill-dot)`))
      assert.equal(tone, states[text], text);
  });
  await check("overview: every zone's ⋯ holds its actions, and a phase move is reviewed first", async () => {
    await go("overview");
    await page.locator(".zone-table-desktop").getByRole("button", { name: "Actions for Zone 1" }).click();
    const menu = page.getByRole("menu");
    await expectVisible(menu);
    // Zone 1 is in P1: the other three phases, then its scheduling, its strategy and its details.
    assert.deepEqual(await menu.getByRole("menuitem").allInnerTexts(), [
      "Move to P0 · Dry-back",
      "Move to P2 · Maintenance",
      "Move to P3 · Overnight",
      "Pause zone scheduling",
      "Edit Zone 1 strategy",
      "Open zone details",
    ]);
    await axe("zone actions menu");
    await menu.getByRole("menuitem", { name: "Move to P2 · Maintenance" }).click();
    const review = page.getByRole("dialog", { name: "Move Zone 1 to P2?" });
    await expectVisible(review);
    assert.match(await review.innerText(), /Zone 1 phase\s*P1\s*→\s*P2/);
    await review.getByRole("button", { name: "Back to editing" }).click();
    await review.waitFor({ state: "hidden" });
    // The last item opens the zone's details, as its name does.
    await page.locator(".zone-table-desktop").getByRole("button", { name: "Actions for Zone 1" }).click();
    await page.getByRole("menuitem", { name: "Open zone details" }).click();
    await expectVisible(page.getByRole("dialog").getByRole("heading", { name: "Phase" }));
    await page.keyboard.press("Escape");
  });
  await check("zone details: a zone with two probes chooses how each reading combines them", async () => {
    await go("overview");
    await openZone("Zone 1");
    const sheet = page.getByRole("dialog");
    await expectVisible(sheet.getByRole("heading", { name: "Probes" }));
    const moisture = sheet.getByLabel("Moisture from 2 probes");
    assert.deepEqual(await moisture.locator("option").allInnerTexts(), [
      "Average — 56%",
      "Median — 56%",
      "Lowest — 54% (Door End moisture)",
      "Highest — 58% (AC End moisture)",
    ]);
    assert.match(await sheet.locator(".detail-metrics").innerText(), /Average of 2 probes: 54 · 58/);
    await axe("zone details with probes");
    await moisture.selectOption("Lowest");
    const review = page.getByRole("dialog", { name: /as lowest\?/ });
    await expectVisible(review);
    assert.match(await review.innerText(), /Average \(56%\)\s*→\s*Lowest \(54%\)/);
    await review.getByRole("button", { name: /Apply 1 change/ }).click();
    await review.waitFor({ state: "hidden" });
    await expectVisible(sheet.getByText(/Lowest of 2 probes: 54 · 58/));
    assert.equal(await sheet.getByLabel("Moisture from 2 probes").inputValue(), "Lowest");
    // EC is its own choice, still the average.
    assert.equal(await sheet.getByLabel("EC from 2 probes").inputValue(), "Average");
    await page.keyboard.press("Escape");
    // The room's tiles say how its zones read their probes: zone 1, the one with two, its lowest.
    const tiles = await page.locator(".metric-item .eyebrow").allTextContents();
    assert.deepEqual(tiles.slice(0, 2), ["Average lowest VWC", "Average EC"]);
  });
  await check(
    "zone details: readings as meters, water against its limit, dryback, state pills",
    async () => {
      const open = async () => {
        await go("overview");
        await openZone("Zone 2");
        await page.getByRole("dialog").locator("[data-dryback] .sparkline").waitFor();
      };
      await inBothThemes("zone details", open);
      await open();
      const sheet = page.getByRole("dialog");
      const tiles = await sheet.locator(".detail-metrics > div").evaluateAll((tiles) =>
        tiles.map((tile) => ({
          name: tile.firstElementChild.textContent.trim(),
          meter: tile.querySelector(".meter")?.getAttribute("aria-label") ?? null,
          mark: !!tile.querySelector(".meter-mark"),
        })),
      );
      const tile = (name) => tiles.find((item) => item.name.startsWith(name));
      assert.match(tile("Moisture").meter, /^Moisture [\d.]+ %, .+ [\d.]+ % marked$/);
      assert.ok(tile("Moisture").mark && tile("Root-zone EC").mark, "targets are marked");
      assert.match(tile("Root-zone EC").meter, /^Root-zone EC [\d.]+ mS\/cm, .+ marked$/);
      assert.match(tile("Water today").meter, /^\d+% of the [\d.]+ L daily limit$/);
      assert.ok(tile("Dryback"), "the dryback has a tile");
      const pills = await pillTones('[role="dialog"] .zone-state-flags .pill');
      assert.deepEqual(
        pills.map(([, tone]) => tone),
        ["off", "P2", "on"],
        `valve off, the phase, enabled: ${JSON.stringify(pills)}`,
      );
      await page.keyboard.press("Escape");
    },
  );
  await check("overview: each zone says what the controller waits for next", async () => {
    // The controller's own thresholds against the readings now, as the demo's controller publishes
    // them: in a zone's details and on the phone's zone list.
    const P1 = /^Next: ramp shot (due|at .+) \(VWC [\d.]+% under [\d.]+%\) · P2 at VWC ≥ /;
    const P2 =
      /^Next: shot when VWC < [\d.]+% \(now [\d.]+%[^)]*\) · dilution if pwEC > [\d.]+ \(now [\d.]+\) · P3 by /;
    await go("overview");
    for (const [zone, next] of [
      ["Zone 1", P1],
      ["Zone 2", P2],
    ]) {
      await openZone(zone);
      assert.match(await page.getByRole("dialog").locator(".zone-waiting").innerText(), next);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await go("overview");
    const phone = await page.locator(".zone-mobile-target").allInnerTexts();
    assert.equal(phone.length, await page.locator(".zone-mobile-row").count());
    assert.match(phone[0], P1);
    assert.match(phone[1], P2);
    await page.setViewportSize({ width: 1440, height: 1000 });
    // The grow-day line says it too, for a lane in the phase the controller worked it out for: at
    // 4 PM the demo's recorded day has zone 2 in P2 as its controller does, and zone 1 in P2 where
    // its controller has it in P1.
    const pinned = await context.newPage();
    pinned.on("pageerror", (error) => pageErrors.push(error.message));
    await pinned.clock.setFixedTime(new Date(2026, 8, 20, 16, 0, 0));
    await pinned.goto(`${base}/dashboard.html?demo&room=room:#/overview`, {
      waitUntil: "networkidle",
    });
    const lanes = pinned.locator(".timeline-zone-line");
    await lanes.first().waitFor();
    await pinned.getByRole("button", { name: "Predictions" }).click();
    const [zone1, zone2] = await pinned.locator("[data-predictions] p[data-zone]").allInnerTexts();
    assert.match(
      zone2,
      / · next: shot when VWC < [\d.]+% \(now [\d.]+%[^)]*\) · dilution if pwEC > /,
    );
    assert.doesNotMatch(zone1, /next:/, "no P1 conditions beside a P2 lane");
    await pinned.close();
    // Overnight a lane says how far it has dried from today's peak, what the P3 dryback target
    // reads; the morning's P0 figure beside "P3" read as tonight's (GR2, 28 Sep).
    const night = await context.newPage();
    night.on("pageerror", (error) => pageErrors.push(error.message));
    await night.clock.setFixedTime(new Date(2026, 8, 20, 23, 30, 0));
    await night.goto(`${base}/dashboard.html?demo&room=room:#/overview`, {
      waitUntil: "networkidle",
    });
    const nightLanes = night.locator(".timeline-zone-line");
    await nightLanes.first().waitFor();
    assert.ok((await nightLanes.allInnerTexts()).every((line) => line.includes(" P3 · ")));
    await night.getByRole("button", { name: "Predictions" }).click();
    const lines = await night.locator("[data-predictions] p[data-zone]").allInnerTexts();
    assert.ok(lines.length && lines.every((line) => line.includes(" P3 · ")), lines.join("\n"));
    for (const line of lines) {
      assert.match(line, / · P3 dryback [\d.]+% of [\d.]+% from today's [\d.]+% peak/);
      assert.doesNotMatch(line, /P0 dryback/);
    }
    await night.close();
  });
  await check("overview: today's events say who changed a setting, and what it was", async () => {
    // The demo day at 4 PM: Auto setpoints moved zone 1's peak target, and the demo's grower raised
    // zone 2's maximum EC, which ended its high-EC hold.
    const pinned = await context.newPage();
    pinned.on("pageerror", (error) => pageErrors.push(error.message));
    await pinned.clock.setFixedTime(new Date(2026, 8, 20, 16, 0, 0));
    await pinned.goto(`${base}/dashboard.html?demo&room=room:#/overview`, {
      waitUntil: "networkidle",
    });
    const events = pinned.locator(".timeline-events");
    await events.locator("summary").click();
    await pinned.waitForFunction(() =>
      [...document.querySelectorAll(".timeline-events li")].some((item) =>
        item.textContent.includes(" Auto setpoints "),
      ),
    );
    const changes = (await events.locator("li").allInnerTexts()).filter((line) =>
      / (raised|lowered) /.test(line),
    );
    for (const expected of [
      / · Zone 1 · Auto setpoints lowered Peak target to 64% \(was 66%\)$/,
      / · Zone 2 · Alex raised Maximum EC to 9 mS\/cm \(was 8\.5 mS\/cm\)$/,
    ])
      assert.ok(
        changes.some((line) => expected.test(line)),
        `${expected} in:\n${changes.join("\n")}`,
      );
    await pinned.close();
  });
  await check("water today: per plant is the room's choice, made in Settings", async () => {
    const cells = () => page.locator(".zone-table-desktop .water-use").allInnerTexts();
    // Within the visit, not a reload: the demo keeps each room's choice as Home Assistant would.
    const visit = async (route) => {
      await page.evaluate((hash) => (location.hash = hash), `#/${route}`);
      await page.waitForTimeout(300);
    };
    const choose = async (name) => {
      await visit("settings");
      const choice = page.getByRole("group", { name: "Water today, shown as", exact: true });
      await choice.getByRole("button", { name, exact: true }).click();
      await page.waitForFunction(
        (name) =>
          [...document.querySelectorAll(".water-view-options button")].some(
            (button) =>
              button.textContent.trim() === name && button.getAttribute("aria-pressed") === "true",
          ),
        name,
      );
    };
    const litres = /^[\d.]+ \/ [\d.]+ L\n\d+% of limit$/;
    // Each zone's total, as always, until someone chooses otherwise.
    await go("overview");
    assert.match((await cells())[0], litres);
    await choose("Per plant");
    await axe("settings: water per plant");
    // The demo's zone 1: 5.3 L for 36 plants, a 40 L limit.
    await visit("overview");
    assert.equal((await cells())[0], "147 mL / 1.11 L\n13% of limit");
    const water = page.locator(".zone-table-desktop th", { hasText: "Water today" });
    assert.equal((await water.innerText()).replace(/\s+/g, " "), "Water today per plant");
    assert.match(
      await page.locator(".metric-item", { hasText: "Water today" }).innerText(),
      /^Water today\n\d+ mL\nPer plant, across 108 plants/,
    );
    const table = await page.evaluate(() => {
      const box = document.querySelector(".zone-table-desktop");
      return box.scrollWidth > box.clientWidth + 1;
    });
    assert.equal(table, false, "per plant, the Overview's zone table scrolls sideways");
    await page.locator(".zone-table-desktop .zone-name", { hasText: "Zone 1" }).click();
    const tile = page.getByRole("dialog").locator(".detail-metrics > div", {
      hasText: "Water today per plant",
    });
    assert.match(await tile.innerText(), /147 mL \/ 1\.11 L/);
    await page.keyboard.press("Escape");
    // The choice is Flower 2's: Flower 1 still shows each zone's total.
    await page.locator("#desktop-room").selectOption("room:f1_");
    await page.waitForTimeout(300);
    assert.match((await cells())[0], litres);
    await page.locator("#desktop-room").selectOption("room:");
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 390, height: 844 });
    await visit("overview");
    assert.match(
      await page.locator(".zone-mobile-row").first().innerText(),
      /Water today per plant\n147 mL \/ 1\.11 L/,
    );
    await noOverflow();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await choose("Zone total");
    await visit("overview");
    assert.match((await cells())[0], litres);
  });
  await check("what's new: once after an update, on a desktop and a phone, and from Help", async () => {
    const dialog = page.getByRole("dialog", { name: "What’s new in PHASE Control", exact: true });
    const versions = () => dialog.locator("section h3").allInnerTexts();
    // Every other check opens the demo as a new installation: nothing to catch up on.
    await go("overview");
    await page.waitForTimeout(300);
    assert.equal(await dialog.count(), 0, "a new installation shows no What's new");
    // Updated from 2.22.0: the releases since, newest first, in both themes.
    const updated = async () => {
      await page.goto(`${base}/dashboard.html?demo&whats-new=2.22.0#/overview`, {
        waitUntil: "networkidle",
      });
      await expectVisible(dialog);
    };
    await inBothThemes("what's new", updated);
    await updated();
    assert.deepEqual(
      (await versions()).map((text) => text.split("\n")[0]),
      ["Version 2.24.0", "Version 2.23.0"],
    );
    assert.equal(
      await dialog.getByRole("link", { name: /Full release notes/ }).getAttribute("href"),
      "https://github.com/Chill-Division/PHASE-Control/releases/tag/v2.24.0",
    );
    await page.screenshot({ path: path.join(out, "whats-new-desktop.png") });
    await dialog.getByRole("button", { name: "Got it", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.evaluate(() => (location.hash = "#/water")); // another page, same visit
    await page.waitForTimeout(300);
    assert.equal(await dialog.count(), 0, "shown once, not on every page");
    // A phone, where it cannot know what was shown: the last 30 days, inside the screen with a
    // margin, the list scrolling and both buttons in reach.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/dashboard.html?demo&whats-new=unknown#/overview`, {
      waitUntil: "networkidle",
    });
    await expectVisible(dialog);
    assert.equal((await versions()).length, 4, "2.21.0 to 2.24.0, all within 30 days");
    const fit = await dialog.evaluate((box) => {
      const outer = box.getBoundingClientRect();
      const list = box.querySelector(".whats-new-releases");
      const reach = [...box.querySelectorAll(".whats-new-actions > *")].map((item) => {
        const rect = item.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      });
      return {
        margins: Math.min(outer.left, innerWidth - outer.right),
        inside: outer.top >= 0 && outer.bottom <= innerHeight,
        scrolls: list.scrollHeight > list.clientHeight,
        reach,
      };
    });
    assert.ok(fit.margins >= 16, `${fit.margins}px from the screen's edge`);
    assert.ok(fit.inside, "the window fits the screen");
    assert.ok(fit.scrolls, "the releases scroll inside the window");
    assert.deepEqual(fit.reach, [true, true], "Got it and the release notes stay in reach");
    await axe("what's new on a phone");
    await noOverflow();
    await page.screenshot({ path: path.join(out, "whats-new-phone.png") });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Help opens it again at any time, whatever the window has shown.
    await go("help");
    await page.getByRole("button", { name: "What’s new", exact: true }).click();
    await expectVisible(dialog);
    assert.equal((await versions()).length, 4);
    await dialog.getByRole("button", { name: "Got it", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  });
  await check("first-run tour: by itself on a new installation, on a desktop and a phone, and from Help", async () => {
    const card = page.locator(".tour-card");
    // Every other check opens the demo as an installation the tour has been through.
    await go("overview");
    await page.waitForTimeout(300);
    assert.equal(await card.count(), 0, "the tour starts by itself only on a new installation");
    // A new one: it starts at once, opens each page in turn, rings what each stop is about and,
    // on a wide screen, its entry in the menu, and ends on the room's switches.
    await page.goto(`${base}/dashboard.html?demo&tour=new#/overview`, { waitUntil: "networkidle" });
    await expectVisible(card);
    const walked = [];
    for (;;) {
      await page.waitForTimeout(250);
      walked.push([
        await card.getAttribute("data-tour-step"),
        new URL(page.url()).hash,
        await page.locator("[data-tour-ring]").count(),
      ]);
      const next = card.getByRole("button", { name: /^(Show me|Next)$/ });
      if (!(await next.count())) break;
      await next.click();
    }
    assert.deepEqual(walked, [
      ["welcome", "#/overview", 0],
      ["overview", "#/overview", 2],
      ["plan", "#/strategy", 2],
      ["feed", "#/reservoir", 2],
      ["settings", "#/setup", 2],
      ["switch", "#/overview", 2],
    ]);
    const ringed = await page.evaluate(() => {
      const ring = document.querySelector("[data-tour-ring]").getBoundingClientRect();
      return [...document.querySelectorAll(".page-heading .room-power")].every((group) => {
        const box = group.getBoundingClientRect();
        return (
          box.left >= ring.left && box.right <= ring.right && box.top >= ring.top && box.bottom <= ring.bottom
        );
      });
    });
    assert.ok(ringed, "the last stop rings the room's switches");
    await axe("first-run tour");
    await page.screenshot({ path: path.join(out, "tour-desktop.png") });
    await card.getByRole("button", { name: "Done", exact: true }).click();
    await card.waitFor({ state: "detached" });
    await page.evaluate(() => (location.hash = "#/water")); // another page, same visit
    await page.waitForTimeout(300);
    assert.equal(await card.count(), 0, "once, not on every page");
    // A phone: the card along the bottom, inside the screen, and each stop's ring above it. A
    // fresh load: the same address but for its hash would only change the page.
    await page.goto("about:blank");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/dashboard.html?demo&tour=new#/overview`, { waitUntil: "networkidle" });
    await expectVisible(card);
    await card.getByRole("button", { name: "Show me", exact: true }).click();
    await page.waitForTimeout(400);
    const fit = await page.evaluate(() => {
      const box = document.querySelector(".tour-card").getBoundingClientRect();
      const ring = document.querySelector("[data-tour-ring]").getBoundingClientRect();
      return {
        margins: Math.min(box.left, innerWidth - box.right),
        inside: box.top >= 0 && box.bottom <= innerHeight,
        ringAbove: ring.top >= 0 && ring.top < box.top - 40,
      };
    });
    assert.ok(fit.margins >= 12, `${fit.margins}px from the screen's edge`);
    assert.ok(fit.inside, "the card fits the screen");
    assert.ok(fit.ringAbove, "the stop's ring shows above the card");
    await axe("first-run tour on a phone");
    await noOverflow();
    await page.screenshot({ path: path.join(out, "tour-phone.png") });
    await page.keyboard.press("Escape");
    await card.waitFor({ state: "detached" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Help starts it at any time, from its first stop.
    await go("help");
    await page.getByRole("button", { name: "Take the tour", exact: true }).click();
    await expectVisible(card);
    assert.equal(await card.getAttribute("data-tour-step"), "welcome");
    await card.getByRole("button", { name: "Close the tour", exact: true }).click();
    await card.waitFor({ state: "detached" });
    // The tour, and no What's new with it, even where the window's record is behind (a room set
    // up again on an installation that had one): someone new is shown round, not what changed.
    await page.goto("about:blank");
    await page.goto(`${base}/dashboard.html?demo&tour=new&whats-new=2.22.0#/overview`, {
      waitUntil: "networkidle",
    });
    await expectVisible(card);
    await page.waitForTimeout(300);
    const whatsNew = page.getByRole("dialog", { name: "What’s new in PHASE Control", exact: true });
    assert.equal(await whatsNew.count(), 0, "no What's new with the tour");
    await card.getByRole("button", { name: "Close the tour", exact: true }).click();
    await card.waitFor({ state: "detached" });
  });
  await check(
    "activity: every record's type is a coloured pill, in the log and the panel",
    async () => {
      // Flower 1's demo log has all but one kind: water, phase changes and a warning.
      const tones = { water: "water", phase: "phase", warning: "warn", info: "neutral" };
      await inBothThemes("activity", async () => {
        await go("activity", "room:f1_");
        await page.locator(".activity-table [data-event-type]").first().waitFor();
      });
      await go("activity", "room:f1_");
      const types = await page
        .locator(".activity-table [data-event-type]")
        .evaluateAll((pills) => pills.map((pill) => [pill.dataset.eventType, pill.dataset.tone]));
      assert.equal(types.length, await page.locator(".activity-table tbody tr").count());
      assert.deepEqual([...new Set(types.map(([type]) => type))].sort(), [
        "phase",
        "warning",
        "water",
      ]);
      for (const [type, tone] of types) assert.equal(tone, tones[type], type);
      const panel = async () => {
        await page.getByRole("button", { name: "Recent activity", exact: true }).click();
        await expectVisible(page.getByRole("dialog", { name: "Recent activity" }));
      };
      await inBothThemes("recent activity panel", async () => {
        await go("activity", "room:f1_");
        await panel();
      });
      await go("activity", "room:f1_");
      await panel();
      const rows = page.getByRole("dialog", { name: "Recent activity" }).locator(".event-row");
      assert.equal(
        await rows.locator(".event-meta [data-event-type]").count(),
        await rows.count(),
        "every record in the panel names its type in a pill",
      );
      await page.keyboard.press("Escape");
    },
  );
  await check("insights: a zone against its targets, and each zone's probes as pills", async () => {
    await inBothThemes("insights", async () => {
      await go("insights");
      await expectVisible(page.getByRole("heading", { name: "Probe coverage", exact: true }));
    });
    await go("insights");
    const references = () =>
      page
        .locator(".insight-reference > strong")
        .evaluateAll((all) => all.map((s) => s.textContent));
    assert.equal((await references()).length, 4, "moisture and EC, each with its target");
    const findings = page.locator(".panel-heading", { hasText: "What the readings show" });
    assert.match(await findings.locator("p").innerText(), /^Zone 1 · /);
    await page.locator("#insights-zone").selectOption({ index: 1 });
    assert.match(await findings.locator("p").innerText(), /^Zone 2 · /);
    assert.equal(await page.locator(".insight-zone-picker .pill[data-phase]").count(), 1);
    // Entity ids stay in Rooms & hardware.
    assert.equal(await page.locator(".insights-page code").count(), 0);
    const probes = await pillTones(".insights-page .data-table .pill");
    assert.equal(probes.length, 3 * (await page.locator("#insights-zone option").count()));
    for (const [text, tone] of probes)
      assert.equal(tone, text === "Current" || text === "Enabled" ? "on" : "off", text);
  });
  await check(
    "compare runs: each recorded range is a bar on one scale, the previous run grey",
    async () => {
      const table = ".comparison-table tbody";
      await inBothThemes("compare runs", async () => {
        await go("compare");
        await page.locator(`${table} .meter`).first().waitFor();
      });
      await go("compare");
      await page.locator(`${table} .meter`).first().waitFor();
      const cells = await page.locator(`${table} tr`).evaluateAll((rows) =>
        rows.flatMap((row) =>
          [...row.cells].slice(1).map((cell) => {
            const meter = cell.querySelector(".meter");
            return meter
              ? [
                  meter.querySelector(".meter-fill").dataset.tone,
                  meter.getBoundingClientRect().width,
                ]
              : null;
          }),
        ),
      );
      assert.ok(cells.length > 0 && cells.every(Boolean), "every recorded day has its range bars");
      // Current VWC, current EC, previous VWC, previous EC: the previous run's ranges are grey.
      assert.deepEqual(
        [...new Set(cells.map(([tone], i) => `${i % 4 < 2 ? "current" : "previous"} ${tone}`))],
        ["current normal", "previous muted"],
      );
      assert.equal(new Set(cells.map(([, width]) => width)).size, 1, "one scale width for all");
      assert.deepEqual(await pillTones(".comparison-run-list h3 .pill"), [
        ["Ongoing", "on"],
        ["Ended", "neutral"],
      ]);
    },
  );
  await check("setup: every mapping says whether it is mapped; the checks are pills", async () => {
    await inBothThemes("rooms & hardware", async () => {
      await go("setup");
      await expectVisible(page.locator("#room-name"));
    });
    await go("setup");
    await expectVisible(page.locator("#room-name"));
    const mappings = await page.locator(".mapping-picker").evaluateAll((pickers) =>
      pickers.map((picker) => ({
        mapped: !!picker.querySelector(".mapping-id"),
        pill: [
          picker.querySelector(".mapping-head .pill")?.textContent.trim(),
          picker.querySelector(".mapping-head .pill")?.dataset.tone,
        ],
      })),
    );
    assert.ok(mappings.some((m) => m.mapped) && mappings.some((m) => !m.mapped));
    for (const { mapped, pill } of mappings)
      assert.deepEqual(pill, mapped ? ["Mapped", "on"] : ["Not mapped", "neutral"]);
    // Watering is on, so mapping changes wait, with the switch to turn it off right there.
    assert.deepEqual(await pillTones(".workspace-card .pill:has(.pill-dot)"), [
      ["Controller acknowledgement pending", "warn"],
      ["Room descriptor discovered", "on"],
      ["Watering on", "on"],
    ]);
  });
  await check("settings: the vitals notification's predictions can be left out and put back", async () => {
    await go("settings");
    const group = page.getByRole("group", {
      name: "Include room predictions in informational notifications",
    });
    await expectVisible(group);
    const option = (name) => group.getByRole("button", { name, exact: true });
    assert.equal(await option("Included").getAttribute("aria-pressed"), "true");
    await option("Left out").click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[aria-pressed="true"]')].some((b) => b.textContent.includes("Left out")),
    );
    await option("Included").click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[aria-pressed="true"]')].some((b) => b.textContent.includes("Included")),
    );
    await axe("settings notifications");
  });
  await check(
    "state pills: the connection in Settings, the room and its watering on the Overview",
    async () => {
      await inBothThemes("settings", async () => {
        await go("settings");
        await expectVisible(page.locator("[data-connection]"));
      });
      await go("settings");
      assert.deepEqual(await pillTones(".settings-section .pill"), [["Demo mode", "warn"]]);
      await go("overview");
      assert.deepEqual(await pillTones(".page-heading .pill"), [
        ["Room on", "on"],
        ["Watering on", "on"],
      ]);
    },
  );
  await check("overview: two screens at most, zones beside the tank", async () => {
    // 1440×800 ≈ the browser window of a 1440×900 laptop; the Overview was 3.2 screens tall.
    await page.setViewportSize({ width: 1440, height: 800 });
    await go("overview");
    await expectVisible(page.getByRole("heading", { name: "Flower 2 overview", exact: true }));
    const layout = await page.evaluate(() => {
      const top = (selector) => document.querySelector(selector).getBoundingClientRect().top;
      const table = document.querySelector(".zone-table-desktop");
      // A live Overview has no demo banner: the room it takes here is not counted.
      const banner = document.querySelector(".demo-banner");
      const demo = banner
        ? banner.nextElementSibling.getBoundingClientRect().top - banner.getBoundingClientRect().top
        : 0;
      // Each zone's line on the grow day wraps so it can be read whole: what it adds is not counted.
      const wrapped = [...document.querySelectorAll(".timeline-zone-line")].reduce(
        (sum, line) =>
          sum + line.getBoundingClientRect().height - parseFloat(getComputedStyle(line).lineHeight),
        0,
      );
      return {
        height: document.documentElement.scrollHeight - demo - wrapped,
        window: innerHeight,
        zonesTop: top(".overview-grid > .panel"),
        tankTop: top("[data-tank-status]"),
        tableScrolls: table.scrollWidth > table.clientWidth + 1,
        subtitles: document.querySelectorAll("#main-content .panel-heading p").length,
      };
    });
    assert.ok(
      layout.height <= 2 * layout.window,
      `Overview is ${layout.height}px tall without the demo banner and the zone lines' wrapping, in a ${layout.window}px window`,
    );
    assert.equal(layout.zonesTop, layout.tankTop, "zones and tank share a row");
    assert.equal(layout.tableScrolls, false, "the zone table scrolls sideways");
    assert.equal(layout.subtitles, 0, "a panel on the Overview repeats its title in a subtitle");
    await page.screenshot({
      path: path.join(out, "dashboard-overview-laptop.png"),
      fullPage: true,
    });
    // A narrow desktop stacks the columns without sideways page scroll.
    await page.setViewportSize({ width: 1100, height: 800 });
    await noOverflow();
    const stacked = await page.evaluate(() => {
      const zones = document.querySelector(".overview-grid > .panel").getBoundingClientRect();
      const tank = document.querySelector("[data-tank-status]").getBoundingClientRect();
      return tank.top >= zones.bottom;
    });
    assert.ok(stacked, "below 1200 px the tank stacks under the zones");
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check("help: every error code is listed, searchable and linkable", async () => {
    const catalog = JSON.parse(await readFile(path.join(root, "docs/error-codes.json"), "utf8"));
    await go("help");
    await expectVisible(page.getByRole("heading", { name: "Error codes", exact: true }));
    const codes = page.locator("details.error-code");
    assert.deepEqual(
      await codes.evaluateAll((all) => all.map((d) => d.id)),
      catalog.codes.map((entry) => entry.code.toLowerCase()),
      "Help must list exactly the codes in docs/error-codes.json",
    );
    const search = page.getByRole("textbox", { name: "Search error codes" });
    await search.fill("101");
    assert.equal(await codes.count(), 1);
    const found = page.locator("details#cs-101");
    assert.equal(await found.getAttribute("open"), "", "A code typed in full opens by itself");
    await expectVisible(found.getByText("Likely causes", { exact: true }));
    await expectVisible(found.getByText(/No plant in the cube/));
    await search.fill("nothing like this");
    await expectVisible(page.getByText(/No code matches/));
    await page.goto(`${base}/dashboard.html?demo&room=room:#/help?code=CS-605`, {
      waitUntil: "networkidle",
    });
    await expectVisible(page.locator("details#cs-605[open]"));
    assert.equal(await search.inputValue(), "CS-605");
    await search.fill("");
    await codes.evaluateAll((all) => all.forEach((d) => (d.open = true)));
    await noOverflow();
    await axe("help error codes, all open");
    // Dark: only the new section. Toggling the class alone is not the app's full dark theme, so
    // the rest of the page is not judged on it here.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await settled(page);
    const dark = await new AxeBuilder({ page })
      .include(".error-codes")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    accessibility.push({
      page: "help error codes, all open, dark",
      violations: dark.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    });
    assert.deepEqual(
      dark.violations.map((v) => v.id),
      [],
      "Error codes must be readable on a dark theme",
    );
    await page.screenshot({
      path: path.join(out, "dashboard-help-error-codes.png"),
      fullPage: true,
    });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
  });
  await check(
    "one Irrigation strategy entry exposes Today and Schedule with working history",
    async () => {
      await go("overview");
      const primary = page.getByRole("navigation", { name: "Main navigation" });
      const plan = primary.getByRole("button", { name: "Irrigation strategy", exact: true });
      assert.equal(await plan.count(), 1);
      assert.equal(
        await primary.getByRole("button", { name: "Manual setpoints", exact: true }).count(),
        0,
      );
      assert.equal(
        await primary.getByRole("button", { name: "Grow plan", exact: true }).count(),
        0,
      );
      await plan.click();
      await expectVisible(page.getByRole("heading", { name: "Today’s targets", exact: true }));
      const views = page.getByRole("navigation", { name: "Irrigation strategy views" });
      const today = views.getByRole("button", { name: "Today", exact: true });
      const schedule = views.getByRole("button", { name: "Schedule", exact: true });
      assert.equal(await today.getAttribute("aria-current"), "page");
      assert.equal(await schedule.getAttribute("aria-current"), null);
      await schedule.click();
      await expectVisible(page.getByRole("heading", { name: "Scheduled targets", exact: true }));
      assert.equal(new URL(page.url()).hash, "#/grow-plan");
      assert.equal(await plan.getAttribute("aria-current"), "page");
      assert.equal(await schedule.getAttribute("aria-current"), "page");
      assert.equal(await today.getAttribute("aria-current"), null);
      await page.goBack();
      await expectVisible(page.getByRole("heading", { name: "Today’s targets", exact: true }));
      await page.goForward();
      await expectVisible(page.getByRole("heading", { name: "Scheduled targets", exact: true }));
      await today.click();
      await expectVisible(page.getByRole("heading", { name: "Today’s targets", exact: true }));
    },
  );
  await check("Schedule and Today say which of them is in charge", async () => {
    await go("strategy");
    await expectVisible(page.getByRole("heading", { name: "Today’s targets", exact: true }));
    // No schedule armed: Today runs the room, and says so.
    await expectVisible(
      page.getByText(
        "The targets the room runs on, and their daily curve. A schedule takes over only once it’s armed.",
      ),
    );
    // Schedule: four steps with the current one marked; arming it moves the step and tells Today.
    await openView("Irrigation strategy", "Schedule");
    const current = page.locator('.schedule-steps [aria-current="step"] strong');
    assert.equal(await page.locator(".schedule-steps li").count(), 4);
    assert.equal(await current.innerText(), "Not armed");
    await page.getByRole("button", { name: "Arm strategy", exact: true }).click();
    await page.getByRole("button", { name: "Arm for next lights-on", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await expectVisible(page.locator(".plan-state").getByText("Armed", { exact: true }));
    assert.equal(await current.innerText(), "Armed");
    await axe("Schedule, how it works with Today");
    await openView("Irrigation strategy", "Today");
    await expectVisible(page.locator(".schedule-note").getByText(/^A schedule is armed\./));
    await axe("Today with a schedule armed");
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow();
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Leave the demo as it was.
    await openView("Irrigation strategy", "Schedule");
    await page.getByRole("button", { name: "Disarm strategy", exact: true }).click();
    await page.getByRole("button", { name: "Confirm disarm", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await current.innerText(), "Not armed");
  });
  await check("Today's targets go to a file and come back as a draft", async () => {
    await go("strategy");
    await expectVisible(page.getByRole("heading", { name: "Today’s targets", exact: true }));
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export", exact: true }).click(),
    ]);
    assert.match(
      download.suggestedFilename(),
      /^phase-control-targets-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const file = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.equal(file.format, "phase-control-targets");
    assert.ok(file.zones["1"].settings.p1_target_vwc > 0);
    assert.equal(file.zones["1"].settings.plant_count, undefined, "the hardware stays out");
    // A tester's copy: one target lower, and their own lights hours.
    file.zones["1"].settings.p1_target_vwc -= 2;
    file.room_settings.lights_on_hour = (file.room_settings.lights_on_hour + 1) % 24;
    await page.getByLabel("Import targets").setInputFiles({
      name: "targets.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(file)),
    });
    const loaded = page.locator(".targets-loaded");
    await expectVisible(loaded.getByText(/^Loaded 1 change from /));
    await expectVisible(loaded.getByText(/^Left as this room has them: Lights on\.$/));
    const bar = page.locator(".draft-bar");
    await expectVisible(bar.getByText("1 unsaved change", { exact: true }));
    // A draft waits to be reviewed or discarded before another file goes in.
    assert.equal(await page.getByRole("button", { name: "Import", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: /^Review 1 change/ }).click();
    await expectVisible(page.getByRole("dialog").getByText(/Peak VWC target/));
    await page.getByRole("button", { name: "Back to editing", exact: true }).click();
    await axe("Today, a targets file loaded into the draft");
    await bar.getByRole("button", { name: "Discard draft", exact: true }).click();
    await page.getByLabel("Import targets").setInputFiles({
      name: "not-targets.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
    await expectVisible(page.getByText("That file isn’t a PHASE Control targets file."));
    assert.equal(await bar.count(), 0, "a file that isn't one loads nothing");
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow();
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check("keyboard skip retains page and browser history works", async () => {
    await go("water");
    await page.getByRole("link", { name: "Skip to content" }).focus();
    await page.keyboard.press("Enter");
    await expectVisible(page.getByRole("heading", { name: "Water", exact: true }));
    assert.equal(await page.evaluate(() => document.activeElement?.id), "main-content");
    assert.match(page.url(), /#\/water$/);
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expectVisible(page.getByRole("heading", { name: "Settings", exact: true }));
    await page.goBack();
    await expectVisible(page.getByRole("heading", { name: "Water", exact: true }));
    await page.goForward();
    await expectVisible(page.getByRole("heading", { name: "Settings", exact: true }));
  });
  await check("overview: a zone's name opens its details", async () => {
    await go("overview");
    await openZone("Zone 1");
    await axe("zone drawer");
    await page.screenshot({
      path: path.join(out, "dashboard-zone-detail.png"),
    });
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  });
  await check("overview: a zone is moved to a phase by hand, through the review", async () => {
    await go("overview");
    await openZone("Zone 1");
    const sheet = page.getByRole("dialog").filter({ hasText: "zone details" });
    const picker = sheet.getByRole("group", { name: "Move Zone 1 to" });
    await expectVisible(picker);
    const move = async (from, to) => {
      assert.equal(await picker.getByRole("button", { name: from, exact: true }).isDisabled(), true);
      await picker.getByRole("button", { name: to, exact: true }).click();
      const review = page.getByRole("dialog", { name: `Move Zone 1 to ${to.slice(0, 2)}?` });
      await expectVisible(review);
      await review.getByRole("button", { name: /^Apply 1 change/ }).click();
      await review.waitFor({ state: "hidden" });
      await expectVisible(sheet.locator(`.pill[data-phase="${to.slice(0, 2)}"]`));
    };
    await move("P1 · Ramp-up", "P2 · Maintenance");
    await axe("zone phase picker");
    await move("P2 · Maintenance", "P1 · Ramp-up"); // the demo as the other checks expect it
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
  });
  await check("overview: one switch flips every zone, through the review", async () => {
    // Flower 1's zone 3 is paused for inspection: the switch is on while any zone is on, as the
    // entities card's header toggle is, and switching it on again switches zone 3 on too.
    await go("overview", "room:f1_");
    const all = page.getByRole("switch", { name: "Every zone in Flower 1", exact: true });
    const count = page.locator(".zones-heading-actions .all-zones-count");
    const flip = async (title, rows, after) => {
      await all.click();
      const review = page.getByRole("dialog", { name: title, exact: true });
      await expectVisible(review);
      assert.deepEqual(
        await review.locator(".review-row strong").allInnerTexts(),
        rows.map((zone) => `Zone ${zone} scheduling`),
      );
      await axe(`every zone: ${title}`);
      await review.getByRole("button", { name: `Apply ${rows.length} changes` }).click();
      await review.waitFor({ state: "hidden" });
      assert.equal(await count.innerText(), after);
    };
    assert.equal(await all.getAttribute("aria-checked"), "true");
    assert.equal(await count.innerText(), "2 of 3 zones on");
    await flip("Pause every zone", [1, 2], "0 of 3 zones on");
    assert.equal(await all.getAttribute("aria-checked"), "false");
    await flip("Switch every zone on", [1, 2, 3], "3 of 3 zones on");
    assert.equal(await all.getAttribute("aria-checked"), "true");
    // At a phone's width too.
    await page.setViewportSize({ width: 390, height: 844 });
    await go("overview");
    await expectVisible(page.getByRole("switch", { name: "Every zone in Flower 2", exact: true }));
    await noOverflow();
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check("water: Water use totals every zone and charts its grow weeks", async () => {
    await go("water");
    const panel = page.locator(".wu-panel");
    await expectVisible(panel.getByRole("heading", { name: "Water use", exact: true }));
    const rows = panel.locator(".wu-table tbody tr");
    await expectVisible(rows.first());
    assert.equal(await rows.count(), 3, "one row per demo zone");
    for (let index = 0; index < 3; index++) {
      const [zone, today, week, since, estimate] = await rows
        .nth(index)
        .locator("td")
        .allInnerTexts();
      assert.match(zone, new RegExp(`Zone ${index + 1}`));
      // Litres, and the grow-days each number covers.
      assert.match(today, /[\d.]+ L\n.+ from 10:00/, `Zone ${index + 1} today: ${today}`);
      assert.match(week, /[\d,.]+ L\nWeek \d+ · /, `Zone ${index + 1} this week: ${week}`);
      assert.match(
        since,
        /[\d,.]+ L\n.+ · grow-day \d+/,
        `Zone ${index + 1} since start: ${since}`,
      );
      assert.match(estimate, /≈ [\d,]+ L\n.*last 7 days’ average.*\n84-day strategy/);
    }
    // Today is the live counter, shared across the zone's plants; the demo's saved draft plan
    // dates the grow and says so.
    assert.match(
      (await rows.first().locator("td").allInnerTexts())[1],
      /^5\.3 L\n[^\n]+\n147 mL per plant, 36 plants$/,
    );
    await expectVisible(panel.getByText(/^Grow start: .+ saved strategy \(a draft, not armed\)/));
    const chart = panel.getByRole("img", {
      name: /^Litres per grow week for Zone 1, Zone 2, Zone 3/,
    });
    await expectVisible(chart);
    const bars = chart.locator(".recharts-bar-rectangle");
    await bars.first().waitFor();
    const count = await bars.count();
    assert.ok(count >= 6 && count % 3 === 0, `one bar per zone and grow week, got ${count}`);
    await panel.screenshot({ path: img("water-use.png") });
    // The definition of "This week" is reachable from the keyboard.
    await panel.getByRole("button", { name: "How this week is counted" }).focus();
    await expectVisible(panel.getByRole("tooltip", { name: /grow week/ }));
    await axe("water use");
    await page.screenshot({ path: path.join(out, "dashboard-water-use.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await settled(page);
    const dark = await new AxeBuilder({ page })
      .include(".wu-panel")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    accessibility.push({
      page: "water use, dark",
      violations: dark.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    });
    assert.deepEqual(
      dark.violations.map((v) => v.id),
      [],
      "Water use must be readable on a dark theme",
    );
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
  });
  await check("strategy draft survives refresh, validates, reviews and applies", async () => {
    await go("strategy");
    const field = page.locator('input[id="setting-number.crop_steering_zone_1_p1_target_vwc"]');
    const original = Number(await field.inputValue());
    await field.fill("999");
    await expectVisible(page.locator('[id="hint-number.crop_steering_zone_1_p1_target_vwc"]'));
    assert.equal(
      await page
        .getByRole("button", { name: /^Review/ })
        .first()
        .isDisabled(),
      true,
    );
    await field.fill(String(original + 1));
    await page.getByRole("button", { name: "Refresh controller data" }).click();
    assert.equal(await field.inputValue(), String(original + 1));
    await page.getByRole("button", { name: /^Review 1 change/ }).click();
    await expectVisible(page.getByRole("dialog").getByText(/Flower 2 only/));
    await axe("strategy review");
    await page.screenshot({ path: path.join(out, "dashboard-review.png") });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Apply 1 change", exact: true })
      .click();
    await expectVisible(page.getByText("Changes applied and verified by controller readback."));
    assert.equal(await field.inputValue(), String(original + 1));
    await field.fill(String(original + 2));
    await page.locator("#desktop-room").selectOption("room:f1_");
    await expectVisible(
      page.getByRole("heading", {
        name: "Discard unsaved workspace changes?",
      }),
    );
    await page.getByRole("button", { name: "Keep editing" }).click();
    assert.equal(await field.inputValue(), String(original + 2));
    await page.locator("#desktop-room").selectOption("room:f1_");
    await page.getByRole("button", { name: "Discard and continue" }).click();
    assert.equal(await page.locator("#desktop-room").inputValue(), "room:f1_");
    await expectVisible(
      page.locator('input[id="setting-number.crop_steering_f1_zone_1_p1_target_vwc"]'),
    );
  });
  await check("activity filters and CSV export", async () => {
    await go("activity");
    await page.getByRole("textbox", { name: "Search activity" }).fill("no-such-event");
    await expectVisible(page.getByRole("heading", { name: "No activity matches this view" }));
    await page.getByRole("button", { name: "Clear filters" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /flower-2-activity-.+\.csv/);
    await download.saveAs(path.join(out, "activity-export.csv"));
    const csv = await readFile(path.join(out, "activity-export.csv"), "utf8");
    assert.match(csv, /Timestamp.*Room.*Zone.*Type.*Message/);
  });
  await check("dark theme persists and remains accessible", async () => {
    await go("settings");
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    assert.equal(await page.locator("html").evaluate((el) => el.classList.contains("dark")), true);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("html").evaluate((el) => el.classList.contains("dark")), true);
    await axe("dark settings");
    await page.screenshot({
      path: path.join(out, "dashboard-dark.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Light", exact: true }).click();
  });
  await check("mobile navigation and every primary page fit 390px", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await go("overview");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await axe("mobile navigation");
    const mobileMenu = page.getByRole("dialog");
    assert.equal(
      await mobileMenu.getByRole("button", { name: "Irrigation strategy", exact: true }).count(),
      1,
    );
    assert.equal(
      await mobileMenu.getByRole("button", { name: "Manual setpoints", exact: true }).count(),
      0,
    );
    assert.equal(
      await mobileMenu.getByRole("button", { name: "Grow plan", exact: true }).count(),
      0,
    );
    await mobileMenu.getByRole("button", { name: "Irrigation strategy", exact: true }).click();
    await expectVisible(page.getByRole("heading", { name: "Today’s targets", exact: true }));
    const views = page.getByRole("navigation", { name: "Irrigation strategy views" });
    await views.getByRole("button", { name: "Schedule", exact: true }).click();
    await expectVisible(page.getByRole("heading", { name: "Scheduled targets", exact: true }));
    await noOverflow();
    await views.getByRole("button", { name: "Today", exact: true }).click();
    await expectVisible(page.getByRole("heading", { name: "Today’s targets", exact: true }));
    for (const [route, heading] of routes) {
      await go(route);
      await expectVisible(page.getByRole("heading", { name: heading, exact: true }));
      if (["strategy", "grow-plan"].includes(route)) await planViewsShareRow();
      await noOverflow();
      await page.screenshot({
        path: path.join(out, `mobile-${route}.png`),
        fullPage: true,
      });
    }
    await axe("mobile help");
  });
  assert.deepEqual(forbidden, [], "Demo attempted live API or external CDN requests");
  assert.deepEqual(pageErrors, [], "Browser JavaScript exceptions");
  console.log(`PASS ${checks.length} workflow groups; no runtime CDN/API calls in demo.`);
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(path.join(out, "failure.txt"), String(error.stack));
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(out, "verification.json"),
    JSON.stringify({ checks, pageErrors, forbidden, accessibility, planViewLayouts }, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
