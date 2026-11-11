import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const sourceFiles = [
  "index.html",
  "app.js",
  "styles.css",
  "admin.html",
  "admin.js",
  "admin.css",
  "speedtest.js",
  "public-speedtest.js",
  "admin-enhancements.js",
];
const publicDir = new URL("./public/", import.meta.url);
await mkdir(publicDir, { recursive: true });
for (const file of sourceFiles) {
  await copyFile(
    new URL(`./${file}`, import.meta.url),
    new URL(`./public/${file}`, import.meta.url),
  );
}
const securityHeaders = `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: geolocation=(self), camera=(), microphone=()\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' https://speed.cloudflare.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'\n`;
await writeFile(new URL("./public/_headers", import.meta.url), securityHeaders);

const assets = {};
for (const file of sourceFiles) {
  const contentType = file.endsWith(".html")
    ? "text/html; charset=utf-8"
    : file.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/javascript; charset=utf-8";
  assets[`/${file}`] = {
    contentType,
    content: await readFile(
      new URL(`./public/${file}`, import.meta.url),
      "utf8",
    ),
  };
}
const compressedAssets = gzipSync(Buffer.from(JSON.stringify(assets)), {
  level: 9,
}).toString("base64");
const workerSource = await readFile(
  new URL("./worker.js", import.meta.url),
  "utf8",
);
const placeholder = /(['"])__INLINE_STATIC_ASSETS__\1/;
if (!placeholder.test(workerSource))
  throw new Error("Worker static asset placeholder is missing.");
await writeFile(
  new URL("./worker-embedded.js", import.meta.url),
  workerSource.replace(placeholder, JSON.stringify(compressedAssets)),
);
console.log(
  `Built ${sourceFiles.length} public assets and generated worker-embedded.js (${compressedAssets.length} compressed base64 characters).`,
);
