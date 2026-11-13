import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const fixture = [
  { id: "fixture-klojen", name: "critasena", area: "Kec. Klojen, Kota Malang", address: "Jl. Kahuripan No.1", ssid: "Citrasena Area", hasPassword: true, down: 21.7, up: 32.7, ping: 93 },
  { id: "fixture-dmdt", name: "D.M.D.T", area: "Tebet Barat", ssid: "", down: 6 },
  { id: "fixture-thyme", name: "Coffee & Thyme", area: "Tebet Timur", ssid: "", down: 174 },
].map((cafe) => ({ outlets: "unknown", prayer: "unknown", stability: "unknown", ...cafe }));
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (path.startsWith("/api/")) {
      response.setHeader("Content-Type", "application/json");
      if (path === "/api/cafes") response.end(JSON.stringify(fixture));
      else if (path === "/api/network") response.end("{}");
      else {
        const cafe = fixture.find((item) => path === `/api/cafes/${item.id}`);
        if (!cafe) response.writeHead(404).end('{"error":"Kafe tidak ditemukan."}');
        else response.end(JSON.stringify({ ...cafe, ...(cafe.hasPassword ? { wifiPassword: "test-only-password" } : {}) }));
      }
      return;
    }
    const file = path === "/" ? "index.html" : path.slice(1);
    if (!/^[a-z-]+\.(html|css|js)$/.test(file)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    response.end(await readFile(new URL(file, root)));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "id-ID", reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll(".cafe-card").length === 3);
  const search = page.locator("#searchInput");
  for (const query of ["critasena", "citrasena", "CITRA SENA", "Klojen Citrasena", "Kahuripan", "citrasenaa", "cirtasena"]) {
    await search.fill(query);
    assert.equal(await page.locator(".cafe-card").count(), 1, query);
    assert.match(await page.locator(".card-title").innerText(), /critasena/);
  }
  for (const query of ["dmdt", "coffee thyme"]) { await search.fill(query); assert.equal(await page.locator(".cafe-card").count(), 1); }
  await search.fill("citrasena");
  await page.locator("#areaSelect").selectOption("Tebet Barat");
  assert.ok(await page.locator("#emptyState").isVisible());
  await page.locator("#searchAllAreas").click();
  assert.equal(await search.inputValue(), "citrasena");
  assert.equal(await page.locator(".cafe-card").count(), 1);
  await page.locator("#areaSelect").selectOption("Kec. Klojen, Kota Malang");
  await page.locator(".detail-link").click();
  await page.locator("#revealPassword").waitFor();
  assert.equal(await page.locator("#detailTitle").innerText(), "critasena");
  assert.ok(await page.locator("#wifiPassword").isHidden());
  assert.match(await page.locator("#detailContent").innerText(), /Citrasena Area/);
  await page.locator(".modal-close").click();

  let failures = 1, aborted = 0;
  await page.route("**/api/cafes/fixture-klojen", async (route) => {
    if (failures > 0) { failures--; aborted++; await route.abort("failed"); }
    else await route.continue();
  });
  await page.locator(".detail-link").click();
  await page.locator("#revealPassword").waitFor();
  assert.equal(aborted, 1);
  assert.equal(await page.locator(".detail-notice").count(), 0);
  await page.locator(".modal-close").click();
  failures = 2;
  await page.locator(".detail-link").click();
  await page.locator(".detail-notice").waitFor();
  assert.equal(aborted, 3, "Failed GET is retried once, not indefinitely");
  assert.equal(await page.locator("#detailTitle").innerText(), "critasena");
  assert.match(await page.locator("#detailContent").innerText(), /Kahuripan/);
  assert.match(await page.locator("#detailContent").innerText(), /Citrasena Area/);
  assert.equal(await page.locator("#revealPassword").count(), 0);
  assert.doesNotMatch(await page.locator("#detailContent").innerText(), /Load failed|Detail tidak tersedia/);
  const widths = [];
  for (const width of [320, 390, 768, 1365]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, modal: document.querySelector("dialog").clientWidth, modalScroll: document.querySelector("dialog").scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, JSON.stringify(layout));
    assert.ok(layout.modalScroll <= layout.modal + 1, JSON.stringify(layout));
    widths.push(layout);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-retry-detail]").click();
  await page.locator("#revealPassword").waitFor();
  assert.equal(await page.locator(".detail-notice").count(), 0);
  await page.locator(".modal-close").click();
  await page.locator("#clearFilters").click();
  assert.equal(await page.locator(".cafe-card").count(), 3);
  assert.deepEqual(errors, []);
  console.log("PASS: mobile search variants, Klojen filter/detail, hidden password, no-result filter reset, one automatic retry, full-data fallback, manual recovery, 320–1365px layouts, no JS errors.");
  console.log(JSON.stringify({ widths, expectedNetworkFailures: aborted, pageErrors: errors }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
