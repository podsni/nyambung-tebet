import assert from "node:assert/strict";
import worker from "../worker.js";

const endpoint = "https://nyambung-tebet.test/api/maps/resolve";
const originalFetch = globalThis.fetch;

async function resolveUrl(url) {
  const requestUrl = new URL(endpoint);
  requestUrl.searchParams.set("url", url);
  const response = await worker.fetch(new Request(requestUrl), {}, {});
  return { status: response.status, data: await response.json() };
}

async function withFetch(mockFetch, callback) {
  globalThis.fetch = mockFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function placePage() {
  return new Response(
    '<!doctype html><html><head><link href="/maps/preview/place?q=Kopi+Tebet%2C+Tebet%2C+Jakarta&amp;pb=!3d-6.226!4d106.8515" rel="preload"></head></html>',
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// Regression: this exact shared link must resolve without creating or changing a cafe.
const providedUrl = "https://maps.app.goo.gl/a4TU3BoA7s6eJxo3A?g_st=ic";
const actual = await resolveUrl(providedUrl);
assert.equal(actual.status, 200, JSON.stringify(actual.data));
assert.equal(actual.data.name, "CULTURECLUB COFFEE & BAKERY");
assert.match(actual.data.area, /Lowokwaru|Malang/i);
assert.match(actual.data.address, /Selorejo/i);
assert.equal(actual.data.mapUrl, providedUrl);
assert.ok(Number.isFinite(actual.data.latitude));
assert.ok(Number.isFinite(actual.data.longitude));
assert.ok(
  actual.data.googleRating === null ||
    (actual.data.googleRating >= 0 && actual.data.googleRating <= 5),
);
assert.ok(
  actual.data.googleRatingCount === null ||
    Number.isInteger(actual.data.googleRatingCount),
);
console.log("PASS: provided maps.app.goo.gl URL resolves to CULTURECLUB COFFEE & BAKERY.");

// Production regression: Google can challenge Cloudflare egress after exposing
// the place query. A Google challenge is not an unsupported user link. Never
// fetch the challenge or discard the name/address that was already available.
const challengedShortLink = "https://maps.app.goo.gl/challenge-example?g_st=ic";
const challengedRequests = [];
const challenged = await withFetch(
  async (input) => {
    const url = new URL(input);
    challengedRequests.push(url.href);
    if (url.hostname === "maps.app.goo.gl")
      return redirect("https://maps.google.com?q=Kopi+Tebet%2C+Tebet%2C+Jakarta");
    if (url.hostname === "www.google.com" && url.pathname === "/maps")
      return redirect(
        `https://www.google.com/sorry/index?continue=${encodeURIComponent(url.href)}`,
      );
    throw new Error(`Challenge or unexpected host must not be fetched: ${url.href}`);
  },
  () => resolveUrl(challengedShortLink),
);
assert.equal(challenged.status, 200, JSON.stringify(challenged.data));
assert.equal(challenged.data.name, "Kopi Tebet");
assert.equal(challenged.data.area, "Tebet, Jakarta");
assert.equal(challenged.data.mapUrl, challengedShortLink);
assert.equal(challenged.data.googleRating, null);
assert.equal(challenged.data.latitude, null);
assert.match(challenged.data.importNotice, /Google sedang membatasi/i);
assert.equal(challengedRequests.length, 2);
assert.ok(challengedRequests[1].startsWith("https://www.google.com/maps?"));
console.log("PASS: Google challenge redirects preserve usable place data and report missing details honestly.");

// Regression: short links may redirect to a CID-only URL; use the Google preview
// link, which contains the place query, instead of incorrectly reporting no name.
const cidOnlyShortLink = "https://maps.app.goo.gl/cid-example?g_st=ic";
const cidFallback = await withFetch(
  async (input) => {
    const url = new URL(input);
    if (url.hostname === "maps.app.goo.gl")
      return redirect("https://www.google.com/maps?cid=123456789");
    if (url.hostname === "www.google.com" && url.pathname === "/maps")
      return placePage();
    if (url.pathname === "/maps/preview/place") return new Response("{}", { status: 200 });
    throw new Error(`Unexpected mock request: ${url.href}`);
  },
  () => resolveUrl(cidOnlyShortLink),
);
assert.equal(cidFallback.status, 200, JSON.stringify(cidFallback.data));
assert.equal(cidFallback.data.name, "Kopi Tebet");
assert.equal(cidFallback.data.area, "Tebet, Jakarta");
assert.equal(cidFallback.data.mapUrl, cidOnlyShortLink);
assert.equal(cidFallback.data.latitude, -6.226);
assert.equal(cidFallback.data.longitude, 106.8515);
console.log("PASS: CID-only Google Maps redirects fall back to the preview place data.");

// Regression: the legacy goo.gl/maps form is accepted only when it redirects
// back into a supported Google Maps URL.
const legacyShortLink = "https://goo.gl/maps/example";
const legacy = await withFetch(
  async (input) => {
    const url = new URL(input);
    if (url.hostname === "goo.gl")
      return redirect("https://www.google.co.id/maps/place/Kopi+Tebet/@-6.226,106.8515,17z");
    if (url.hostname === "www.google.co.id") return placePage();
    if (url.pathname === "/maps/preview/place") return new Response("{}", { status: 200 });
    throw new Error(`Unexpected mock request: ${url.href}`);
  },
  () => resolveUrl(legacyShortLink),
);
assert.equal(legacy.status, 200, JSON.stringify(legacy.data));
assert.equal(legacy.data.name, "Kopi Tebet");
assert.equal(legacy.data.mapUrl, legacyShortLink);
console.log("PASS: legacy goo.gl/maps redirects are resolved while preserving the original link.");

// Redirect validation must remain strict to prevent arbitrary-host fetches.
const unsafe = await withFetch(
  async (input) => {
    const url = new URL(input);
    if (url.hostname === "maps.app.goo.gl")
      return redirect("https://maps.google.com?q=Kopi+Tebet%2C+Jakarta");
    if (url.hostname === "www.google.com" && url.pathname === "/maps")
      return redirect("https://example.org/collect");
    throw new Error(`Unexpected request escaped validation: ${url.href}`);
  },
  () => resolveUrl("https://maps.app.goo.gl/unsafe"),
);
assert.equal(unsafe.status, 400);
assert.match(unsafe.data.error, /tidak didukung/i);
console.log("PASS: redirects outside approved Google Maps hosts remain blocked.");
