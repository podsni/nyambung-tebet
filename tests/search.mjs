import assert from "node:assert/strict";
import { normalizeSearch, searchCafe } from "../search.js";

const cafe = { name: "critasena", ssid: "Citrasena Area", area: "Kec. Klojen, Kota Malang", address: "Jl. Kahuripan No.1", password: "jangan-indeks-ini", wifiPassword: "private-secret" };
for (const query of ["critasena", "CITRASENA", "Citrasena Area", "citra sena", "Klojen", "kecamatan klojen", "Kota Malang", "Kahuripan", "klojen citrasena", "citrasenaa", "cirtasena"]) {
  assert.ok(searchCafe(cafe, query), `Expected match: ${query}`);
}
for (const query of ["surabaya", "jangan-indeks-ini", "private-secret", "citrasena surabaya", "xy", "citrasenazzz"]) {
  assert.equal(searchCafe(cafe, query), null, `Unexpected match: ${query}`);
}
assert.ok(searchCafe({name: "D.M.D.T"}, "dmdt"));
assert.ok(searchCafe({name: "KOPIMANA27"}, "kopimana 27"));
assert.ok(searchCafe({name: "Café & Thé"}, "cafe the"));
assert.ok(searchCafe({name: "Mugs & Hugs Jkt"}, "jakarta hugs"));
assert.ok(searchCafe(cafe, "   "));
assert.equal(searchCafe(cafe, "cirtasena").approximate, true);
assert.equal(searchCafe(cafe, "citrasena").viaWifi, true);
assert.equal(normalizeSearch("  Café — KECAMATAN Klojen  "), "cafe kec klojen");
assert.ok(searchCafe({name:"Origin"},"Origin").score < searchCafe({name:"Origin Coffee"},"Origin").score);
console.log("PASS: name/SSID/area/address search, punctuation/spaces/accents, mixed word order, one typo, ranking and password privacy.");
