import { randomBytes, pbkdf2Sync } from "node:crypto";

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 1024)
    throw new Error("Input terlalu panjang.");
}
const password = input.replace(/\r?\n$/, "");
if (!password || password.length > 200)
  throw new Error("Password harus berisi 1–200 karakter.");
const salt = randomBytes(16);
const iterations = 100000;
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
process.stdout.write(
  `pbkdf2$${iterations}$${salt.toString("base64url")}$${hash.toString("base64url")}\n`,
);
