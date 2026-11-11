import assert from "node:assert/strict";
import { randomBytes, randomUUID, pbkdf2Sync } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

// This test intentionally exercises deletion ONLY in an ephemeral local database.
// No production configuration, database ID, credentials, or remote flag is used.
const root = fileURLToPath(new URL("../", import.meta.url));
const runDir = join(root, ".test", `api-${Date.now()}-${process.pid}`);
const persist = join(runDir, "state");
const config = join(runDir, "wrangler.json");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const password = randomBytes(24).toString("base64url");
const sessionSecret = randomBytes(32).toString("base64url");
const salt = randomBytes(16);
const hash = `pbkdf2$100000$${salt.toString("base64url")}$${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("base64url")}`;
const cliEnv = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };
let server;
let logs = "";
let cookie = "";
let base;
const sanitize = (text) =>
  String(text)
    .split(password)
    .join("[redacted]")
    .split(sessionSecret)
    .join("[redacted]")
    .split(hash)
    .join("[redacted]");

async function availablePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function api(
  path,
  {
    method = "GET",
    body,
    raw,
    headers = {},
    origin = true,
    authenticated = true,
  } = {},
) {
  assert.equal(
    new URL(base).hostname,
    "127.0.0.1",
    "Safety guard: localhost only",
  );
  const h = { Accept: "application/json", ...headers };
  if (origin) h.Origin = base;
  if (method !== "GET") h["X-Nyambung-Admin"] = "1";
  if (authenticated && cookie) h.Cookie = cookie;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers: h,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}
const list = async () => (await api("/api/cafes")).data;
const cafeInput = (name) => ({
  name,
  area: "Data uji lokal",
  outlets: "unknown",
  prayer: "unknown",
  stability: "unknown",
  password: randomBytes(12).toString("base64url"),
  wifiPublic: false,
});

try {
  await mkdir(runDir, { recursive: true });
  await writeFile(
    config,
    JSON.stringify(
      {
        name: "nyambung-ephemeral-local-test",
        main: join(root, "worker-embedded.js"),
        compatibility_date: "2026-11-11",
        vars: { ADMIN_PASSWORD_HASH: hash, SESSION_SECRET: sessionSecret },
        d1_databases: [
          {
            binding: "DB",
            database_name: "nyambung-ephemeral-local-test",
            database_id: randomUUID(),
            migrations_dir: join(root, "migrations"),
          },
        ],
        r2_buckets: [
          {
            binding: "CAFE_PHOTOS",
            bucket_name: "nyambung-ephemeral-local-photos",
          },
        ],
      },
      null,
      2,
    ),
  );
  console.log("Build source and create ephemeral LOCAL D1/R2 state…");
  execFileSync(process.execPath, [join(root, "build-assets.mjs")], {
    cwd: root,
    env: cliEnv,
    stdio: "pipe",
  });
  execFileSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--config",
      config,
      "--persist-to",
      persist,
    ],
    { cwd: runDir, env: cliEnv, input: "", stdio: "pipe" },
  );
  const port = await availablePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--config",
      config,
      "--persist-to",
      persist,
      "--log-level",
      "warn",
    ],
    {
      cwd: runDir,
      env: cliEnv,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(`${base}/api/cafes`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert.ok(ready, `Local Worker not ready: ${sanitize(logs.slice(-6000))}`);
  const seeded = await list();
  assert.equal(seeded.length, 27);
  assert.equal(seeded.find((cafe) => cafe.id === "agna")?.googleRating, 4.2);
  assert.ok(seeded.every((cafe) => cafe.nyambungRatingCount === 0));
  assert.ok(seeded.every((cafe) => "googleRating" in cafe));
  assert.ok(
    seeded.every((cafe) => !("password" in cafe) && !("wifiPassword" in cafe)),
  );
  assert.ok(
    seeded.every((cafe) => cafe.photoUrl === "" && cafe.latitude === null),
  );
  const network = (await api("/api/network")).data;
  assert.ok("provider" in network && "asn" in network && !("ip" in network));
  assert.equal((await api("/api/admin/cafes")).response.status, 401);
  assert.equal(
    (
      await api("/api/admin/login", {
        method: "POST",
        body: { password },
        origin: false,
        authenticated: false,
      })
    ).response.status,
    403,
  );
  const login = await api("/api/admin/login", {
    method: "POST",
    body: { password },
    authenticated: false,
  });
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.get("set-cookie").split(";")[0];
  assert.equal((await api("/api/admin/cafes")).data.length, 27);
  console.log("PASS: public privacy, admin session, and origin safeguards.");

  assert.equal(
    (
      await api("/api/admin/cafes", {
        method: "POST",
        body: { ...cafeInput("Invalid coordinates"), latitude: -6.2 },
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await api("/api/admin/cafes", {
        method: "POST",
        body: {
          ...cafeInput("Invalid photo URL"),
          photoUrl: "http://example.com/image.jpg",
        },
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await api("/api/admin/cafes", {
        method: "POST",
        body: {
          ...cafeInput("Invalid map URL"),
          mapUrl: "javascript:alert(1)",
        },
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await api("/api/admin/cafes", {
        method: "POST",
        body: { ...cafeInput("Invalid key"), photoKey: "../private" },
      })
    ).response.status,
    400,
  );
  assert.equal((await list()).length, 27);
  assert.equal(
    (
      await api("/api/admin/cafes", {
        method: "POST",
        body: { ...cafeInput("Invalid review count"), googleRatingCount: 1.5 },
      })
    ).response.status,
    400,
  );
  console.log(
    "PASS: coordinates, URLs, and photo keys are validated without writing invalid rows.",
  );

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  assert.equal(
    (
      await api("/api/admin/photos", {
        method: "POST",
        raw: Buffer.from("<svg></svg>"),
        headers: { "Content-Type": "image/svg+xml" },
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await api("/api/admin/photos", {
        method: "POST",
        raw: Buffer.from("not an image"),
        headers: { "Content-Type": "image/png" },
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await api("/api/admin/photos", {
        method: "POST",
        raw: Buffer.alloc(3 * 1024 * 1024 + 1),
        headers: { "Content-Type": "image/png" },
      })
    ).response.status,
    400,
  );
  const uploaded = await api("/api/admin/photos", {
    method: "POST",
    raw: png,
    headers: { "Content-Type": "image/png" },
  });
  assert.equal(uploaded.response.status, 201);
  const media = await fetch(`${base}${uploaded.data.photoUrl}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), png);
  const a = await api("/api/admin/cafes", {
    method: "POST",
    body: {
      ...cafeInput("Uji lokal foto"),
      photoKey: uploaded.data.photoKey,
      latitude: -6.226,
      longitude: 106.852,
      provider: "Penyedia uji lokal",
      googleRating: 4.7,
      googleRatingCount: 55,
      testedAt: new Date().toISOString(),
      jitter: 2.5,
    },
  });
  assert.equal(a.response.status, 201);
  const aPublic = (await api(`/api/cafes/${a.data.id}`)).data;
  assert.equal(aPublic.photoUrl, uploaded.data.photoUrl);
  assert.equal(aPublic.latitude, -6.226);
  assert.equal(aPublic.provider, "Penyedia uji lokal");
  assert.equal(aPublic.googleRating, 4.7);
  assert.equal(aPublic.googleRatingCount, 55);
  assert.equal(aPublic.nyambungRatingCount, 0);
  assert.ok(!("wifiPassword" in aPublic) && !("password" in aPublic));
  assert.equal(
    (
      await api(`/api/cafes/${a.data.id}/rating`, {
        method: "POST",
        body: { ratingId: randomUUID(), rating: 5 },
        headers: { "X-Nyambung-Rating": "1" },
        origin: false,
        authenticated: false,
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await api(`/api/cafes/${a.data.id}/rating`, {
        method: "POST",
        body: { ratingId: randomUUID(), rating: 6 },
        headers: { "X-Nyambung-Rating": "1" },
        authenticated: false,
      })
    ).response.status,
    400,
  );
  const ratingDevice = randomUUID();
  const firstRating = await api(`/api/cafes/${a.data.id}/rating`, {
    method: "POST",
    body: { ratingId: ratingDevice, rating: 4 },
    headers: { "X-Nyambung-Rating": "1" },
    authenticated: false,
  });
  assert.equal(firstRating.response.status, 200);
  assert.equal(firstRating.data.nyambungRating, 4);
  assert.equal(firstRating.data.nyambungRatingCount, 1);
  const updatedRating = await api(`/api/cafes/${a.data.id}/rating`, {
    method: "POST",
    body: { ratingId: ratingDevice, rating: 5 },
    headers: { "X-Nyambung-Rating": "1" },
    authenticated: false,
  });
  assert.equal(updatedRating.data.nyambungRatingCount, 1);
  const secondRating = await api(`/api/cafes/${a.data.id}/rating`, {
    method: "POST",
    body: { ratingId: randomUUID(), rating: 3 },
    headers: { "X-Nyambung-Rating": "1" },
    authenticated: false,
  });
  assert.equal(secondRating.data.nyambungRating, 4);
  assert.equal(secondRating.data.nyambungRatingCount, 2);
  const afterRatings = (await api(`/api/cafes/${a.data.id}`)).data;
  assert.equal(afterRatings.googleRating, 4.7);
  assert.equal(afterRatings.nyambungRating, 4);
  assert.equal(afterRatings.nyambungRatingCount, 2);
  const adminA = (await api("/api/admin/cafes")).data.find(
    (cafe) => cafe.id === a.data.id,
  );
  const editedCafe = await api(`/api/admin/cafes/${a.data.id}`, {
    method: "PUT",
    body: { ...adminA, googleRating: 4.8, googleRatingCount: 56 },
  });
  assert.equal(editedCafe.response.status, 200);
  const afterAdminEdit = (await api(`/api/cafes/${a.data.id}`)).data;
  assert.equal(afterAdminEdit.googleRating, 4.8);
  assert.equal(afterAdminEdit.nyambungRating, 4);
  assert.equal(afterAdminEdit.nyambungRatingCount, 2);
  assert.equal(
    (
      await api("/api/admin/photos", {
        method: "DELETE",
        body: { photoKey: uploaded.data.photoKey },
      })
    ).response.status,
    409,
  );
  assert.equal(
    (
      await api("/api/admin/cafes", {
        method: "POST",
        body: {
          ...cafeInput("Duplicate photo"),
          photoKey: uploaded.data.photoKey,
        },
      })
    ).response.status,
    400,
  );
  const unused = await api("/api/admin/photos", {
    method: "POST",
    raw: png,
    headers: { "Content-Type": "image/png" },
  });
  assert.equal(
    (
      await api("/api/admin/photos", {
        method: "DELETE",
        body: { photoKey: unused.data.photoKey },
      })
    ).response.status,
    200,
  );
  assert.equal((await fetch(`${base}${unused.data.photoUrl}`)).status, 404);
  console.log(
    "PASS: image upload/serving, byte/MIME limits, metadata, and linked-photo protection.",
  );

  const b = await api("/api/admin/cafes", {
    method: "POST",
    body: cafeInput("Uji lokal kedua"),
  });
  const c = await api("/api/admin/cafes", {
    method: "POST",
    body: cafeInput("Uji lokal tunggal"),
  });
  assert.equal(b.response.status, 201);
  assert.equal(c.response.status, 201);
  let snapshot = await list();
  assert.equal(snapshot.length, 30);
  const targetIds = [a.data.id, b.data.id];
  assert.equal(
    (
      await api("/api/admin/cafes/bulk-delete", {
        method: "POST",
        body: {
          ids: targetIds,
          all: false,
          expectedCount: 30,
          confirmation: "",
        },
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await api("/api/admin/cafes/bulk-delete", {
        method: "POST",
        body: {
          ids: [...targetIds, "missing-id"],
          all: false,
          expectedCount: 30,
          confirmation: "HAPUS PILIHAN",
        },
      })
    ).response.status,
    409,
  );
  assert.equal(
    (
      await api("/api/admin/cafes/bulk-delete", {
        method: "POST",
        body: {
          ids: snapshot.map((cafe) => cafe.id),
          all: true,
          expectedCount: 29,
          confirmation: "HAPUS SEMUA DATA",
        },
      })
    ).response.status,
    409,
  );
  assert.equal((await list()).length, 30);
  const selectedDeletion = await api("/api/admin/cafes/bulk-delete", {
    method: "POST",
    body: {
      ids: targetIds,
      all: false,
      expectedCount: 30,
      confirmation: "HAPUS PILIHAN",
    },
  });
  assert.equal(selectedDeletion.data.deleted, 2);
  assert.equal((await list()).length, 28);
  assert.equal((await fetch(`${base}${uploaded.data.photoUrl}`)).status, 404);
  assert.equal(
    (await api(`/api/admin/cafes/${c.data.id}`, { method: "DELETE" })).response
      .status,
    200,
  );
  assert.equal((await list()).length, 27);
  snapshot = await list();
  const allDeletion = await api("/api/admin/cafes/bulk-delete", {
    method: "POST",
    body: {
      ids: snapshot.map((cafe) => cafe.id),
      all: true,
      expectedCount: snapshot.length,
      confirmation: "HAPUS SEMUA DATA",
    },
  });
  assert.equal(allDeletion.data.deleted, 27);
  assert.equal((await list()).length, 0);
  console.log(
    "PASS: selective/all delete confirmation, stale-count protection, explicit IDs, and photo cleanup — LOCAL COPY ONLY.",
  );
  console.log(
    "All integration checks passed. Production D1 was never addressed.",
  );
} catch (error) {
  console.error(sanitize(error.stack || error.message));
  if (logs) console.error(sanitize(logs.slice(-6000)));
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    try {
      process.platform === "win32"
        ? server.kill("SIGTERM")
        : process.kill(-server.pid, "SIGTERM");
    } catch {}
    await delay(1000);
    if (server.exitCode === null) {
      try {
        process.platform === "win32"
          ? server.kill("SIGKILL")
          : process.kill(-server.pid, "SIGKILL");
      } catch {}
    }
  }
  await rm(runDir, { recursive: true, force: true });
}
