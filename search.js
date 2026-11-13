// Public fields only: passwords and private Wi-Fi information are never indexed.
export function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("id")
    .replace(/\b(kecamatan)\b/g, "kec")
    .replace(/\b(jkt)\b/g, "jakarta")
    .replace(/\b(and|dan)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// One insertion, deletion, substitution, or adjacent transposition. Short terms
// stay exact so a short query does not produce a large set of unrelated cafes.
function similarWord(a, b) {
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1)
    return false;
  if (a === b) return true;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length)
    return a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] &&
        a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

export function searchCafe(cafe, input) {
  const query = normalizeSearch(String(input ?? "").slice(0, 200));
  if (!query) return { score: 0, approximate: false, viaWifi: false };
  const fields = [cafe.name, cafe.ssid, cafe.area, cafe.address].map(normalizeSearch);
  const compact = query.replaceAll(" ", "");
  const direct = fields.findIndex((field) => field &&
    (field.includes(query) || field.replaceAll(" ", "").includes(compact)));
  if (direct !== -1)
    return { score: direct * 2 + (fields[direct] === query ? 0 : 1),
      approximate: false, viaWifi: direct === 1 };
  const words = fields.map((field) => field.split(" ").filter(Boolean));
  let approximate = false, viaWifi = false;
  for (const term of query.split(" ")) {
    let field = fields.findIndex((value) => value.includes(term));
    if (field === -1) {
      field = words.findIndex((tokens) => tokens.some((word) => similarWord(term, word)));
      if (field === -1) return null;
      approximate = true;
    }
    if (field === 1) viaWifi = true;
  }
  return { score: approximate ? 20 : 10, approximate, viaWifi };
}
