const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const encoder = new TextEncoder();
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const STATIC_ASSETS_GZIP_B64 = "__INLINE_STATIC_ASSETS__";

let staticAssetsPromise;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function secure(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "geolocation=(self), camera=(), microphone=()",
  );
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' https://speed.cloudflare.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4),
  );
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256(value) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
}

async function verifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (
    !Number.isInteger(iterations) ||
    iterations < 100000 ||
    iterations > 1000000
  )
    return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: fromB64url(parts[2]),
        iterations,
      },
      key,
      256,
    );
    const actual = new Uint8Array(bits);
    const expected = fromB64url(parts[3]);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < actual.length; i++)
      difference |= actual[i] ^ expected[i];
    return difference === 0;
  } catch {
    return false;
  }
}

async function sessionKey(env) {
  return crypto.subtle.importKey(
    "raw",
    fromB64url(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function makeSession(env) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const payload = `v1.${expires}.${nonce}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await sessionKey(env),
      encoder.encode(payload),
    ),
  );
  return `${payload}.${b64url(signature)}`;
}

async function validSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)nyambung_admin=([^;]+)/);
  if (!match) return false;
  const parts = match[1].split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires <= Math.floor(Date.now() / 1000))
    return false;
  try {
    const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
    return await crypto.subtle.verify(
      "HMAC",
      await sessionKey(env),
      fromB64url(parts[3]),
      encoder.encode(payload),
    );
  } catch {
    return false;
  }
}

function sessionCookie(value, maxAge = SESSION_SECONDS) {
  return `nyambung_admin=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function sameOriginMutation(request) {
  const origin = request.headers.get("Origin");
  return Boolean(
    origin &&
      origin === new URL(request.url).origin &&
      request.headers.get("X-Nyambung-Admin") === "1",
  );
}

function sameOriginRatingMutation(request) {
  return Boolean(
    request.headers.get("Origin") === new URL(request.url).origin &&
      request.headers.get("X-Nyambung-Rating") === "1",
  );
}

async function readJson(request, limit = 20000) {
  const size = Number(request.headers.get("content-length") || 0);
  if (size > limit) throw new Error("Ukuran data terlalu besar.");
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > limit)
    throw new Error("Ukuran data terlalu besar.");
  const body = JSON.parse(raw);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Format data tidak valid.");
  return body;
}

function nullableNumber(value, label, min, max) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new Error(`${label} di luar batas yang diizinkan.`);
  return number;
}

function text(value, label, max, required = false) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new Error(`${label} wajib diisi.`);
  if (result.length > max) throw new Error(`${label} terlalu panjang.`);
  return result;
}

function allowed(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

function validPhotoKey(value) {
  return /^cafes\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(String(value || ""));
}

function photoUrl(value) {
  const result = text(value, "Tautan foto", 2048);
  if (!result) return "";
  let url;
  try {
    url = new URL(result);
  } catch {
    throw new Error("Gunakan tautan foto HTTPS langsung atau unggah foto.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Tautan foto wajib HTTPS tanpa informasi login.");
  return url.href;
}

function normalizeCafe(input) {
  const name = text(input.name, "Nama kafe", 70, true);
  const area = text(input.area, "Area", 70, true);
  const mapUrl = text(input.mapUrl, "Tautan Maps", 500);
  if (mapUrl) {
    let url;
    try {
      url = new URL(mapUrl);
    } catch {
      throw new Error("Tautan Maps tidak valid.");
    }
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("Tautan Maps harus menggunakan HTTP atau HTTPS.");
  }
  const password = text(input.password, "Password Wi-Fi", 100);
  const photoKey = text(input.photoKey, "ID foto", 100);
  if (photoKey && !validPhotoKey(photoKey))
    throw new Error("ID foto tidak valid. Unggah ulang fotonya.");
  const latitude = nullableNumber(input.latitude, "Lintang", -90, 90);
  const longitude = nullableNumber(input.longitude, "Bujur", -180, 180);
  if ((latitude === null) !== (longitude === null))
    throw new Error("Isi lintang dan bujur bersama, atau kosongkan keduanya.");
  const googleRating = nullableNumber(input.googleRating, "Rating Google Maps", 0, 5);
  const googleRatingCount = nullableNumber(
    input.googleRatingCount,
    "Jumlah ulasan Google Maps",
    0,
    100000000,
  );
  if (googleRatingCount !== null && !Number.isInteger(googleRatingCount))
    throw new Error("Jumlah ulasan Google Maps harus berupa bilangan bulat.");
  const testedAtInput = text(input.testedAt, "Waktu tes", 50);
  if (testedAtInput && !Number.isFinite(Date.parse(testedAtInput)))
    throw new Error("Waktu tes tidak valid.");
  return {
    name,
    area,
    googleRating,
    googleRatingCount,
    down: nullableNumber(input.down, "Kecepatan download", 0, 100000),
    up: nullableNumber(input.up, "Kecepatan upload", 0, 100000),
    ping: nullableNumber(input.ping, "Ping", 0, 100000),
    outlets: allowed(
      input.outlets,
      ["many", "some", "few", "varies", "unknown"],
      "unknown",
    ),
    prayer: allowed(
      input.prayer,
      ["yes", "no", "shared", "unknown"],
      "unknown",
    ),
    hours: text(input.hours, "Jam buka", 50),
    price: nullableNumber(input.price, "Harga", 0, 10000000),
    stability: allowed(
      input.stability,
      ["stable", "moderate", "unstable", "unknown"],
      "unknown",
    ),
    comfort: nullableNumber(input.comfort, "Kenyamanan", 0, 5),
    smoking: text(input.smoking, "Keterangan area merokok", 160),
    ssid: text(input.ssid, "Nama Wi-Fi", 80),
    password,
    wifiPublic: Boolean(input.wifiPublic) && Boolean(password),
    mapUrl,
    photoKey,
    photoUrl: photoKey ? "" : photoUrl(input.photoUrl),
    latitude,
    longitude,
    provider: text(input.provider, "Provider", 160),
    testedAt: testedAtInput ? new Date(testedAtInput).toISOString() : "",
    jitter: nullableNumber(input.jitter, "Jitter", 0, 100000),
  };
}

function publicCafe(row) {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    googleRating: row.google_rating,
    googleRatingCount: row.google_rating_count,
    nyambungRating: row.nyambung_rating ?? 0,
    nyambungRatingCount: row.nyambung_rating_count ?? 0,
    down: row.down_mbps,
    up: row.up_mbps,
    ping: row.ping_ms,
    outlets: row.outlets,
    prayer: row.prayer,
    hours: row.hours,
    price: row.price,
    stability: row.stability,
    comfort: row.comfort,
    smoking: row.smoking,
    ssid: row.wifi_public ? row.ssid : "",
    hasPassword: Boolean(row.wifi_public && row.wifi_password),
    mapUrl: row.map_url,
    photoUrl:
      row.photo_key && validPhotoKey(row.photo_key)
        ? `/media/${row.photo_key}`
        : row.photo_url || "",
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    provider: row.provider || "",
    testedAt: row.tested_at || "",
    jitter: row.jitter_ms ?? null,
  };
}

function adminCafe(row) {
  return {
    ...publicCafe(row),
    ssid: row.ssid || "",
    password: row.wifi_password || "",
    wifiPublic: Boolean(row.wifi_public),
    mapUrl: row.map_url || "",
    photoKey: row.photo_key || "",
  };
}

const CAFE_SAVE_COLUMNS = [
  "name",
  "area",
  "google_rating",
  "google_rating_count",
  "down_mbps",
  "up_mbps",
  "ping_ms",
  "outlets",
  "prayer",
  "hours",
  "price",
  "stability",
  "comfort",
  "smoking",
  "ssid",
  "wifi_password",
  "wifi_public",
  "map_url",
  "photo_url",
  "photo_key",
  "latitude",
  "longitude",
  "provider",
  "tested_at",
  "jitter_ms",
];
const CAFE_COLUMNS = [
  "id",
  ...CAFE_SAVE_COLUMNS,
  "nyambung_rating",
  "nyambung_rating_count",
  "created_at",
  "updated_at",
].join(", ");
function cafeDbValues(cafe) {
  return [
    cafe.name,
    cafe.area,
    cafe.googleRating,
    cafe.googleRatingCount,
    cafe.down,
    cafe.up,
    cafe.ping,
    cafe.outlets,
    cafe.prayer,
    cafe.hours,
    cafe.price,
    cafe.stability,
    cafe.comfort,
    cafe.smoking,
    cafe.ssid,
    cafe.password,
    cafe.wifiPublic ? 1 : 0,
    cafe.mapUrl,
    cafe.photoUrl,
    cafe.photoKey,
    cafe.latitude,
    cafe.longitude,
    cafe.provider,
    cafe.testedAt,
    cafe.jitter,
  ];
}

function googleMapsHostAllowed(url) {
  const host = url.hostname.toLowerCase();
  const shortLink = host === "maps.app.goo.gl" || host === "goo.gl";
  const googleHost =
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "google.co.id" ||
    host.endsWith(".google.co.id");
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  )
    return false;
  return (
    shortLink ||
    (googleHost &&
      (host.startsWith("maps.google.") ||
        /^\/(?:maps|url)(?:\/|$)/i.test(url.pathname)))
  );
}

function mapsError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function coordinatesFromMapsUrl(url) {
  const exact = [
    ...url.href.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g),
  ].pop();
  const at = [...url.href.matchAll(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].pop();
  const query = (
    url.searchParams.get("q") ||
    url.searchParams.get("query") ||
    ""
  ).match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  const pair = exact || at || query;
  if (!pair) return { latitude: null, longitude: null };
  const latitude = Number(pair[1]),
    longitude = Number(pair[2]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : { latitude: null, longitude: null };
}

function placeFromMapsUrl(url, originalUrl) {
  let address =
    url.searchParams.get("q") ||
    url.searchParams.get("query") ||
    url.searchParams.get("destination") ||
    url.searchParams.get("daddr") ||
    "";
  if (!address) {
    const match = url.pathname.match(/\/maps\/(?:place|search)\/([^/]+)/i);
    if (match) address = decodeURIComponent(match[1]).replace(/\+/g, " ");
  }
  address = address.replace(/\s+/g, " ").trim();
  if (!address || /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(address)) {
    throw mapsError(
      "Google Maps tidak memberikan nama tempat. Isi nama dan area secara manual.",
      422,
    );
  }
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const name = parts.shift()?.slice(0, 70) || "";
  const provincesAndCountries = new Set([
    "indonesia",
    "east java",
    "jawa timur",
    "central java",
    "jawa tengah",
    "west java",
    "jawa barat",
    "north java",
    "banten",
    "bali",
    "dki jakarta",
    "jakarta special capital region",
    "special region of yogyakarta",
    "di yogyakarta",
    "north sumatra",
    "sumatera utara",
    "south sumatra",
    "sumatera selatan",
    "west sumatra",
    "sumatera barat",
    "united states",
    "usa",
    "united kingdom",
    "uk",
    "australia",
  ]);
  const areaParts = parts
    .map((part) => part.replace(/\b\d{4,6}(?:-\d{4})?\b/g, "").trim())
    .filter((part) => part && !provincesAndCountries.has(part.toLowerCase()));
  const area = areaParts.slice(-2).join(", ").slice(0, 70);
  return {
    name,
    area,
    address: parts.join(", "),
    mapUrl: originalUrl,
    ...coordinatesFromMapsUrl(url),
  };
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'");
}

async function limitedText(response, maxBytes = 800000) {
  const declaredLength = Number(response.headers.get("Content-Length") || 0);
  if (declaredLength > maxBytes) {
    await response.body?.cancel();
    throw mapsError("Halaman Google Maps terlalu besar untuk dibaca.", 502);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw mapsError("Halaman Google Maps terlalu besar untuk dibaca.", 502);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function googlePreviewHref(html, baseUrl) {
  const match = String(html || "").match(
    /<link\b[^>]*href=["']([^"']*\/maps\/preview\/place[^"']*)["']/i,
  );
  if (!match) return null;
  try {
    return new URL(decodeHtml(match[1]), baseUrl);
  } catch {
    return null;
  }
}

function parseGooglePreview(payload) {
  const result = {
    googleRating: null,
    googleRatingCount: null,
    latitude: null,
    longitude: null,
  };
  let root;
  try {
    root = JSON.parse(String(payload || "").replace(/^\)\]\}'(?:\r?\n)?/, ""));
  } catch {
    return result;
  }
  const isReviewCount = (value) =>
    typeof value === "string" && /^\d[\d,.]*\s+(?:reviews?|ulasan)$/i.test(value.trim());
  function visit(node) {
    if (!Array.isArray(node)) return;
    if (
      result.latitude === null &&
      node.length >= 4 &&
      node[0] === null &&
      node[1] === null &&
      typeof node[2] === "number" &&
      typeof node[3] === "number" &&
      Math.abs(node[2]) <= 90 &&
      Math.abs(node[3]) <= 180
    ) {
      result.latitude = node[2];
      result.longitude = node[3];
    }
    if (result.googleRating === null) {
      const summaryIndex = node.findIndex(
        (child) => Array.isArray(child) && child.some(isReviewCount),
      );
      if (summaryIndex >= 0) {
        const summary = node[summaryIndex].find(isReviewCount);
        const countFromLabel = Number(
          summary?.match(/[\d,.]+/)?.[0]?.replace(/[,.]/g, ""),
        );
      const rating = Number(node[summaryIndex + 4]);
      const count = Number(node[summaryIndex + 5]);
      if (
        Number.isFinite(rating) &&
        rating >= 0 &&
        rating <= 5 &&
        Number.isInteger(count) &&
        count >= 0
      ) {
        result.googleRating = rating;
          result.googleRatingCount = Number.isInteger(count)
            ? count
            : countFromLabel || null;
        }
      }
    }
    for (const child of node) visit(child);
  }
  visit(root);
  return result;
}

async function resolveGoogleMapsPlace(rawUrl) {
  if (!rawUrl || rawUrl.length > 500)
    throw mapsError("Tautan Maps kosong atau terlalu panjang.");
  let current;
  try {
    current = new URL(rawUrl);
  } catch {
    throw mapsError("Tautan Google Maps tidak valid.");
  }
  if (!googleMapsHostAllowed(current))
    throw mapsError("Gunakan tautan Google Maps atau maps.app.goo.gl.");
  const originalUrl = current.href;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let place = null;
  try {
    let response = null;
    for (let hop = 0; hop < 6; hop++) {
      if (!googleMapsHostAllowed(current))
        throw mapsError("Tautan mengarah ke alamat yang tidak didukung.");
      try {
        place = placeFromMapsUrl(current, originalUrl);
      } catch {
        // A short link may not contain place data until its first redirect.
      }
      response = await fetch(current.href, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/html,application/xhtml+xml" },
        signal: controller.signal,
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("Location");
      if (!location) break;
      current = new URL(location, current);
      if (!googleMapsHostAllowed(current))
        throw mapsError("Tautan mengarah ke alamat yang tidak didukung.");
      try {
        place = placeFromMapsUrl(current, originalUrl);
      } catch {
        // Continue resolving until Google exposes a place name or address.
      }
    }
    if (!googleMapsHostAllowed(current))
      throw mapsError("Tautan mengarah ke alamat yang tidak didukung.");
    if (!response || response.status >= 400)
      if (place)
        return {
          ...place,
          googleRating: null,
          googleRatingCount: null,
        };
      else throw mapsError("Google Maps menolak tautan tersebut.", 502);

    const html = await limitedText(response);
    place = place || placeFromMapsUrl(current, originalUrl);
    const previewUrl = googlePreviewHref(html, current.href);
    let rating = {
      googleRating: null,
      googleRatingCount: null,
      latitude: null,
      longitude: null,
    };
    if (previewUrl && googleMapsHostAllowed(previewUrl)) {
      try {
        const previewResponse = await fetch(previewUrl.href, {
          redirect: "manual",
          headers: { Accept: "application/json,text/plain,*/*" },
          signal: controller.signal,
        });
        if (previewResponse.ok) {
          const previewBody = await limitedText(previewResponse);
          rating = parseGooglePreview(previewBody);
        }
      } catch {
        // Keep the name and location usable if Google's preview data is unavailable.
      }
    }
    const mapCoordinates = previewUrl
      ? coordinatesFromMapsUrl(previewUrl)
      : { latitude: null, longitude: null };
    return {
      ...place,
      latitude: place.latitude ?? rating.latitude ?? mapCoordinates.latitude,
      longitude: place.longitude ?? rating.longitude ?? mapCoordinates.longitude,
      googleRating: rating.googleRating,
      googleRatingCount: rating.googleRatingCount,
    };
  } catch (error) {
    if (error.status && !(error.status >= 500 && place)) throw error;
    if (place)
      return {
        ...place,
        googleRating: null,
        googleRatingCount: null,
      };
    throw mapsError(
      error?.name === "AbortError"
        ? "Google Maps tidak merespons tepat waktu."
        : "Tautan Google Maps tidak dapat dibaca.",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function loginIpHash(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const secret = env.SESSION_SECRET || "";
  return b64url(await sha256(`${secret}:${ip}`));
}

async function checkLoginLimit(request, env) {
  const ipHash = await loginIpHash(request, env);
  const row = await env.DB.prepare(
    "SELECT attempts, window_started FROM admin_login_attempts WHERE ip_hash = ?",
  )
    .bind(ipHash)
    .first();
  const now = Date.now();
  if (!row || now - Number(row.window_started) >= LOGIN_WINDOW_MS) {
    await env.DB.prepare(
      "INSERT INTO admin_login_attempts (ip_hash, attempts, window_started) VALUES (?, 1, ?) ON CONFLICT(ip_hash) DO UPDATE SET attempts = 1, window_started = excluded.window_started",
    )
      .bind(ipHash, now)
      .run();
    return { allowed: true, ipHash };
  }
  if (Number(row.attempts) >= MAX_LOGIN_ATTEMPTS)
    return { allowed: false, ipHash };
  await env.DB.prepare(
    "UPDATE admin_login_attempts SET attempts = attempts + 1 WHERE ip_hash = ?",
  )
    .bind(ipHash)
    .run();
  return { allowed: true, ipHash };
}

async function requireAdmin(request, env) {
  return validSession(request, env);
}

async function readPhoto(request) {
  const contentType = (request.headers.get("Content-Type") || "")
    .split(";")[0]
    .toLowerCase();
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (!extensions[contentType])
    throw new Error("Gunakan foto JPEG, PNG, atau WebP.");
  if (Number(request.headers.get("Content-Length") || 0) > MAX_PHOTO_BYTES)
    throw new Error("Foto maksimal 3 MB.");
  if (!request.body) throw new Error("Foto belum dipilih.");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PHOTO_BYTES) {
      await reader.cancel();
      throw new Error("Foto maksimal 3 MB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const matches =
    contentType === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : contentType === "image/png"
        ? bytes[0] === 0x89 &&
          bytes[1] === 0x50 &&
          bytes[2] === 0x4e &&
          bytes[3] === 0x47 &&
          bytes[4] === 0x0d &&
          bytes[5] === 0x0a &&
          bytes[6] === 0x1a &&
          bytes[7] === 0x0a
        : total >= 12 &&
          String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!matches || total < 12) throw new Error("Berkas bukan foto yang valid.");
  return { bytes, contentType, extension: extensions[contentType] };
}

async function validateCafePhoto(cafe, env, cafeId = "") {
  if (!cafe.photoKey) return;
  if (!env.CAFE_PHOTOS)
    throw new Error(
      "Penyimpanan foto belum tersedia. Gunakan tautan foto HTTPS.",
    );
  const linked = await env.DB.prepare(
    "SELECT id FROM cafes WHERE photo_key = ? AND id != ? LIMIT 1",
  )
    .bind(cafe.photoKey, cafeId)
    .first();
  if (linked)
    throw new Error(
      "Foto ini sudah digunakan tempat lain. Unggah salinan foto untuk tempat ini.",
    );
  if (!(await env.CAFE_PHOTOS.head(cafe.photoKey)))
    throw new Error("Foto tidak ditemukan. Unggah ulang sebelum menyimpan.");
}

async function removeUnusedPhoto(key, env) {
  if (!validPhotoKey(key) || !env.CAFE_PHOTOS) return;
  const linked = await env.DB.prepare(
    "SELECT id FROM cafes WHERE photo_key = ? LIMIT 1",
  )
    .bind(key)
    .first();
  if (!linked) await env.CAFE_PHOTOS.delete(key);
}

async function handleMedia(request, env) {
  if (!["GET", "HEAD"].includes(request.method))
    return secure(
      new Response("Metode tidak diizinkan", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      }),
    );
  let key;
  try {
    key = decodeURIComponent(
      new URL(request.url).pathname.slice("/media/".length),
    );
  } catch {
    return secure(new Response("Foto tidak ditemukan", { status: 404 }));
  }
  if (!validPhotoKey(key) || !env.CAFE_PHOTOS)
    return secure(new Response("Foto tidak ditemukan", { status: 404 }));
  const object = await env.CAFE_PHOTOS.get(key);
  if (!object)
    return secure(new Response("Foto tidak ditemukan", { status: 404 }));
  const headers = new Headers({
    "cache-control": "public, max-age=86400",
    ETag: object.httpEtag,
  });
  object.writeHttpMetadata(headers);
  headers.set("Content-Disposition", "inline");
  if (request.headers.get("If-None-Match") === object.httpEtag)
    return secure(new Response(null, { status: 304, headers }));
  return secure(
    new Response(request.method === "HEAD" ? null : object.body, { headers }),
  );
}

async function bulkDeleteCafes(request, env) {
  let body;
  try {
    body = await readJson(request, 150000);
  } catch (error) {
    return json({ error: error.message || "Data tidak valid." }, 400);
  }
  if (
    !Array.isArray(body.ids) ||
    !body.ids.length ||
    body.ids.length > 1000 ||
    body.ids.some((id) => typeof id !== "string" || !id || id.length > 100)
  )
    return json({ error: "Pilih 1–1000 kafe yang ingin dihapus." }, 400);
  const ids = [...new Set(body.ids)];
  if (ids.length !== body.ids.length || typeof body.all !== "boolean")
    return json({ error: "Pilihan penghapusan tidak valid." }, 400);
  const expectedConfirmation = body.all ? "HAPUS SEMUA DATA" : "HAPUS PILIHAN";
  if (body.confirmation !== expectedConfirmation)
    return json(
      {
        error: `Konfirmasi wajib sama persis dengan “${expectedConfirmation}”.`,
      },
      400,
    );
  const { results: rows } = await env.DB.prepare(
    "SELECT id, photo_key FROM cafes",
  ).all();
  const selected = new Set(ids);
  const targets = rows.filter((row) => selected.has(row.id));
  if (targets.length !== ids.length)
    return json(
      {
        error:
          "Daftar kafe telah berubah. Muat ulang dan periksa pilihan Anda.",
      },
      409,
    );
  if (
    body.all &&
    (Number(body.expectedCount) !== rows.length || ids.length !== rows.length)
  )
    return json(
      {
        error:
          "Jumlah kafe telah berubah. Konfirmasi ulang dari daftar terbaru sebelum menghapus semua.",
      },
      409,
    );
  // Deliberately only delete explicit IDs. Never execute an unqualified DELETE FROM cafes.
  const statements = [];
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90);
    statements.push(
      env.DB.prepare(
        `DELETE FROM cafes WHERE id IN (${chunk.map(() => "?").join(",")}) RETURNING id`,
      ).bind(...chunk),
    );
  }
  const results = await env.DB.batch(statements);
  const deleted = results.reduce(
    (sum, result) => sum + Number(result.results?.length || 0),
    0,
  );
  let photoCleanupWarning = false;
  const photoKeys = [
    ...new Set(targets.map((row) => row.photo_key).filter(validPhotoKey)),
  ];
  if (photoKeys.length && env.CAFE_PHOTOS) {
    try {
      await env.CAFE_PHOTOS.delete(photoKeys);
    } catch {
      photoCleanupWarning = true;
    }
  }
  return json({
    deleted,
    message: `${deleted} kafe dihapus.`,
    photoCleanupWarning,
  });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/api/network" && method === "GET") {
    const cf = request.cf || {};
    return json({
      provider:
        typeof cf.asOrganization === "string" ? cf.asOrganization : null,
      asn: Number.isFinite(Number(cf.asn)) ? Number(cf.asn) : null,
      city: null,
      country: cf.country || null,
      colo: cf.colo || null,
      source: "cloudflare-request-metadata",
    });
  }

  if (path === "/api/maps/resolve" && method === "GET") {
    try {
      return json(
        await resolveGoogleMapsPlace(url.searchParams.get("url") || ""),
      );
    } catch (error) {
      return json(
        { error: error.message || "Tautan Google Maps tidak dapat dibaca." },
        error.status || 422,
      );
    }
  }

  const ratingMatch = path.match(/^\/api\/cafes\/([^/]+)\/rating$/);
  if (ratingMatch && method === "POST") {
    if (!sameOriginRatingMutation(request))
      return json({ error: "Permintaan rating tidak valid." }, 403);
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return json({ error: error.message || "Data rating tidak valid." }, 400);
    }
    if (
      typeof body.ratingId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.ratingId,
      ) ||
      !Number.isInteger(body.rating) ||
      body.rating < 1 ||
      body.rating > 5
    )
      return json({ error: "Pilih rating 1 sampai 5 bintang." }, 400);
    let cafeId;
    try {
      cafeId = decodeURIComponent(ratingMatch[1]);
    } catch {
      return json({ error: "Kafe tidak ditemukan." }, 404);
    }
    const exists = await env.DB.prepare("SELECT id FROM cafes WHERE id = ?")
      .bind(cafeId)
      .first();
    if (!exists) return json({ error: "Kafe tidak ditemukan." }, 404);
    const voterHash = b64url(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          await sessionKey(env),
          encoder.encode(`nyambung-rating-v1:${body.ratingId}`),
        ),
      ),
    );
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO cafe_ratings (cafe_id, voter_hash, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cafe_id, voter_hash) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at",
      ).bind(cafeId, voterHash, body.rating, now, now),
      env.DB.prepare(
        "UPDATE cafes SET nyambung_rating = (SELECT ROUND(AVG(rating), 1) FROM cafe_ratings WHERE cafe_id = ?), nyambung_rating_count = (SELECT COUNT(*) FROM cafe_ratings WHERE cafe_id = ?) WHERE id = ?",
      ).bind(cafeId, cafeId, cafeId),
    ]);
    const aggregate = await env.DB.prepare(
      "SELECT nyambung_rating, nyambung_rating_count FROM cafes WHERE id = ?",
    )
      .bind(cafeId)
      .first();
    return json({
      yourRating: body.rating,
      nyambungRating: Number(aggregate?.nyambung_rating || 0),
      nyambungRatingCount: Number(aggregate?.nyambung_rating_count || 0),
      message: "Rating Nyambung tersimpan. Terima kasih!",
    });
  }

  if (path === "/api/cafes" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT ${CAFE_COLUMNS} FROM cafes ORDER BY name COLLATE NOCASE`,
    ).all();
    return json(results.map(publicCafe));
  }

  if (path.startsWith("/api/cafes/") && method === "GET") {
    const id = decodeURIComponent(path.slice("/api/cafes/".length));
    const row = await env.DB.prepare(
      `SELECT ${CAFE_COLUMNS} FROM cafes WHERE id = ?`,
    )
      .bind(id)
      .first();
    if (!row) return json({ error: "Kafe tidak ditemukan." }, 404);
    const cafe = publicCafe(row);
    if (row.wifi_public && row.wifi_password)
      cafe.wifiPassword = row.wifi_password;
    return json(cafe);
  }

  if (path === "/api/admin/session" && method === "GET") {
    return json({ authenticated: await requireAdmin(request, env) });
  }

  if (path === "/api/admin/login" && method === "POST") {
    if (!sameOriginMutation(request))
      return json({ error: "Permintaan tidak valid." }, 403);
    const limit = await checkLoginLimit(request, env);
    if (!limit.allowed)
      return json(
        { error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." },
        429,
      );
    let body;
    try {
      body = await readJson(request);
    } catch {
      return json({ error: "Permintaan tidak valid." }, 400);
    }
    const valid =
      typeof body.password === "string" &&
      body.password.length <= 200 &&
      (await verifyPassword(body.password, env.ADMIN_PASSWORD_HASH));
    if (!valid) return json({ error: "Password tidak cocok." }, 401);
    await env.DB.prepare("DELETE FROM admin_login_attempts WHERE ip_hash = ?")
      .bind(limit.ipHash)
      .run();
    return json({ authenticated: true }, 200, {
      "Set-Cookie": sessionCookie(await makeSession(env)),
    });
  }

  if (path === "/api/admin/logout" && method === "POST") {
    if (!sameOriginMutation(request))
      return json({ error: "Permintaan tidak valid." }, 403);
    return json({ authenticated: false }, 200, {
      "Set-Cookie": sessionCookie("", 0),
    });
  }

  if (path.startsWith("/api/admin/")) {
    if (!(await requireAdmin(request, env)))
      return json({ error: "Sesi admin tidak aktif." }, 401);
    if (path === "/api/admin/cafes" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT ${CAFE_COLUMNS} FROM cafes ORDER BY updated_at DESC, name COLLATE NOCASE`,
      ).all();
      return json(results.map(adminCafe));
    }
    if (!sameOriginMutation(request))
      return json({ error: "Permintaan tidak valid." }, 403);
    if (path === "/api/admin/photos" && method === "POST") {
      if (!env.CAFE_PHOTOS)
        return json(
          { error: "Upload foto belum tersedia. Gunakan tautan foto HTTPS." },
          503,
        );
      try {
        const photo = await readPhoto(request);
        const photoKey = `cafes/${crypto.randomUUID()}.${photo.extension}`;
        await env.CAFE_PHOTOS.put(photoKey, photo.bytes, {
          httpMetadata: {
            contentType: photo.contentType,
            cacheControl: "public, max-age=86400",
          },
          customMetadata: { uploadedAt: new Date().toISOString() },
        });
        return json({ photoKey, photoUrl: `/media/${photoKey}` }, 201);
      } catch (error) {
        return json({ error: error.message || "Foto gagal diunggah." }, 400);
      }
    }
    if (path === "/api/admin/photos" && method === "DELETE") {
      let body;
      try {
        body = await readJson(request);
      } catch {
        return json({ error: "Data tidak valid." }, 400);
      }
      if (!validPhotoKey(body.photoKey))
        return json({ error: "ID foto tidak valid." }, 400);
      const linked = await env.DB.prepare(
        "SELECT id FROM cafes WHERE photo_key = ? LIMIT 1",
      )
        .bind(body.photoKey)
        .first();
      if (linked)
        return json(
          {
            error:
              "Foto masih terhubung ke kafe. Hapus melalui formulir tempat.",
          },
          409,
        );
      if (env.CAFE_PHOTOS) await env.CAFE_PHOTOS.delete(body.photoKey);
      return json({ message: "Foto yang belum dipakai dibersihkan." });
    }
    if (path === "/api/admin/cafes/bulk-delete" && method === "POST")
      return bulkDeleteCafes(request, env);
    if (path === "/api/admin/cafes" && method === "POST") {
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        return json({ error: error.message || "Data tidak valid." }, 400);
      }
      let cafe;
      try {
        cafe = normalizeCafe(body);
        await validateCafePhoto(cafe, env);
      } catch (error) {
        return json({ error: error.message }, 400);
      }
      const id = `cafe-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const columns = ["id", ...CAFE_SAVE_COLUMNS, "created_at", "updated_at"];
      await env.DB.prepare(
        `INSERT INTO cafes (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      )
        .bind(id, ...cafeDbValues(cafe), now, now)
        .run();
      return json({ id, message: "Kafe ditambahkan." }, 201);
    }
    const cafeMatch = path.match(/^\/api\/admin\/cafes\/([^/]+)$/);
    if (cafeMatch && method === "PUT") {
      const id = decodeURIComponent(cafeMatch[1]);
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        return json({ error: error.message || "Data tidak valid." }, 400);
      }
      let cafe;
      try {
        cafe = normalizeCafe(body);
        await validateCafePhoto(cafe, env, id);
      } catch (error) {
        return json({ error: error.message }, 400);
      }
      const old = await env.DB.prepare(
        "SELECT photo_key FROM cafes WHERE id = ?",
      )
        .bind(id)
        .first();
      if (!old) return json({ error: "Kafe tidak ditemukan." }, 404);
      const result = await env.DB.prepare(
        `UPDATE cafes SET ${CAFE_SAVE_COLUMNS.map((column) => `${column}=?`).join(",")},updated_at=? WHERE id=?`,
      )
        .bind(...cafeDbValues(cafe), new Date().toISOString(), id)
        .run();
      if (!result.meta?.changes)
        return json({ error: "Kafe tidak ditemukan." }, 404);
      if (old.photo_key && old.photo_key !== cafe.photoKey) {
        try {
          await removeUnusedPhoto(old.photo_key, env);
        } catch {
          /* A storage cleanup failure must not undo a saved cafe. */
        }
      }
      return json({ id, message: "Perubahan disimpan." });
    }
    if (cafeMatch && method === "DELETE") {
      const id = decodeURIComponent(cafeMatch[1]);
      const old = await env.DB.prepare(
        "SELECT photo_key FROM cafes WHERE id = ?",
      )
        .bind(id)
        .first();
      const result = await env.DB.prepare("DELETE FROM cafes WHERE id = ?")
        .bind(id)
        .run();
      if (!result.meta?.changes)
        return json({ error: "Kafe tidak ditemukan." }, 404);
      if (old?.photo_key) {
        try {
          await removeUnusedPhoto(old.photo_key, env);
        } catch {
          /* Keep the successful database deletion. */
        }
      }
      return json({ id, message: "Kafe dihapus." });
    }
    return json({ error: "Rute admin tidak ditemukan." }, 404);
  }

  return json({ error: "Rute API tidak ditemukan." }, 404);
}

async function loadStaticAssets() {
  if (!staticAssetsPromise) {
    const compressed = Uint8Array.from(atob(STATIC_ASSETS_GZIP_B64), (char) =>
      char.charCodeAt(0),
    );
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    staticAssetsPromise = new Response(stream)
      .text()
      .then((value) => JSON.parse(value));
  }
  return staticAssetsPromise;
}

async function handleStatic(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return secure(
      new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      }),
    );
  }
  const url = new URL(request.url);
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/admin" || pathname === "/admin/") pathname = "/admin.html";
  const assets = await loadStaticAssets();
  const asset = assets[pathname];
  if (!asset) return secure(new Response("Not found", { status: 404 }));
  const headers = {
    "content-type": asset.contentType,
    "cache-control": pathname.endsWith(".html")
      ? "no-cache"
      : "public, max-age=300",
  };
  return secure(
    new Response(request.method === "HEAD" ? null : asset.content, { headers }),
  );
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        if (
          request.method !== "GET" &&
          request.method !== "POST" &&
          request.method !== "PUT" &&
          request.method !== "DELETE"
        )
          return json({ error: "Metode tidak diizinkan." }, 405, {
            Allow: "GET, POST, PUT, DELETE",
          });
        return secure(await handleApi(request, env));
      }
      if (url.pathname.startsWith("/media/"))
        return await handleMedia(request, env);
      return await handleStatic(request);
    } catch (error) {
      return secure(
        json({ error: "Terjadi kendala pada server. Silakan coba lagi." }, 500),
      );
    }
  },
};
