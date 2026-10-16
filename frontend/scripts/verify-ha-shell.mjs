/** HA shell contract fixture: temporary kiosk state, recovery, no preference writes. The dashboard is
 * a custom panel (setup_panel.py): Home Assistant loads its module (www/panel.js) and puts its element
 * in the page, which holds the dashboard in a frame; Home Assistant draws no title bar above it. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fitsWidth } from "./fits-width.mjs";
const html = await readFile(new URL("../../addons/f2_control/www/public/dashboard.html", import.meta.url));
const panelJs = await readFile(
  new URL("../../custom_components/crop_steering/www/panel.js", import.meta.url),
);
const shell = `<!doctype html><html><body style="margin:0"><home-assistant></home-assistant><script>
window.events=[];const host=document.querySelector('home-assistant');
host.hass={kioskMode:new URLSearchParams(location.search).has('existing')};
const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<home-assistant-main></home-assistant-main><slot></slot>';
const main=shadow.querySelector('home-assistant-main');
window.addEventListener('hass-kiosk-mode',e=>{host.hass.kioskMode=e.detail.enable;events.push(['kiosk',e.detail.enable]);});
main.addEventListener('hass-toggle-menu',()=>events.push(['menu']));
</script><script type="module">
await import('/crop_steering/panel.js');
const panel=document.createElement('ha-panel-custom');
const element=document.createElement('crop-steering-panel');
element.panel={config:{url:'/dashboard.html?demo=1'}};
element.hass=document.querySelector('home-assistant').hass;
panel.append(element);
document.querySelector('home-assistant').append(panel);
</script></body></html>`;
const server = createServer((req, res) => {
  if (req.url.startsWith("/crop_steering/panel.js")) {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(panelJs);
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(req.url.startsWith("/crop-steering") ? shell : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await context.route("**/*", (route) =>
  new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
);
try {
  await page.goto(origin + "/crop-steering");
  const frame = page.frameLocator("crop-steering-panel iframe");
  // The panel's element holds the dashboard in a frame filling the panel: no title bar above it.
  await frame.getByRole("heading", { name: "Flower 2 overview" }).waitFor();
  const box = await page.locator("crop-steering-panel iframe").boundingBox();
  assert.ok(box.y === 0 && box.height === 1000 && box.width === 1440, JSON.stringify(box));
  // Home Assistant's menu opens from the foot of the dashboard's own menu, and only there: the top
  // bar has no second button for it.
  assert.equal(
    await frame
      .locator(".topbar")
      .getByRole("button", { name: /Home Assistant/ })
      .count(),
    0,
  );
  await frame
    .locator(".desktop-sidebar")
    .getByRole("button", { name: "Home Assistant", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => document.querySelector("home-assistant").hass.kioskMode),
    true,
  );
  assert.ok(await page.evaluate(() => events.some((e) => e[0] === "menu")));
  await page.setViewportSize({ width: 390, height: 844 });
  await frame.getByRole("button", { name: "Open navigation", exact: true }).click();
  await frame
    .locator(".mobile-sidebar")
    .getByRole("button", { name: "Home Assistant", exact: true })
    .click();
  assert.equal(await page.evaluate(() => events.filter((e) => e[0] === "menu").length), 2);
  const panel = await page.locator("crop-steering-panel iframe").elementHandle();
  await fitsWidth(await panel.contentFrame());
  await page.evaluate(() => {
    history.pushState({}, "", "/lovelace");
    dispatchEvent(new Event("location-changed"));
  });
  assert.equal(
    await page.evaluate(() => document.querySelector("home-assistant").hass.kioskMode),
    false,
  );
  await page.goto(origin + "/crop-steering?existing=1");
  await frame
    .locator(".sidebar-footer button", { hasText: "Home Assistant" })
    .first()
    .waitFor({ state: "attached" });
  await page.evaluate(() => {
    history.pushState({}, "", "/lovelace");
    dispatchEvent(new Event("location-changed"));
  });
  assert.equal(
    await page.evaluate(() => document.querySelector("home-assistant").hass.kioskMode),
    true,
  );
  await page.goto(origin + "/dashboard.html?demo=1");
  await page.getByRole("heading", { name: "Flower 2 overview" }).waitFor();
  assert.equal(
    await page.locator(".sidebar-footer button", { hasText: "Home Assistant" }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  const out = new URL("../../output/playwright/", import.meta.url);
  await mkdir(out, { recursive: true });
  await writeFile(
    new URL("ha-shell-verification.json", out),
    JSON.stringify(
      {
        checks: [
          "the custom panel's element holds the dashboard, filling the panel",
          "temporary kiosk enabled",
          "desktop/mobile recovery button",
          "leaving restores previous state",
          "preexisting kiosk preserved",
          "standalone unchanged",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("6 HA shell browser checks passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
