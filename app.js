(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const TEBET_FALLBACK = Object.freeze({ lat: -6.2265, lon: 106.8515 });
  const state = {
    cafes: [],
    filter: "all",
    location: { ...TEBET_FALLBACK },
    locationSource: "tebet",
    locationLabelRequest: 0,
    detailRequest: 0,
    ratingDeviceId: "",
    userRatings: loadUserRatings(),
  };
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const num = (value) =>
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value))
      ? Number(value)
      : null;
  function loadUserRatings() {
    try {
      const value = JSON.parse(localStorage.getItem("nyambung-user-ratings") || "{}");
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    } catch {
      return {};
    }
  }
  function ratingDeviceId() {
    if (state.ratingDeviceId) return state.ratingDeviceId;
    try {
      const saved = localStorage.getItem("nyambung-rating-device");
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved || ""))
        return (state.ratingDeviceId = saved);
      state.ratingDeviceId = crypto.randomUUID();
      localStorage.setItem("nyambung-rating-device", state.ratingDeviceId);
    } catch {
      state.ratingDeviceId = crypto.randomUUID();
    }
    return state.ratingDeviceId;
  }
  function saveUserRating(cafeId, rating) {
    state.userRatings[String(cafeId)] = rating;
    try {
      localStorage.setItem(
        "nyambung-user-ratings",
        JSON.stringify(state.userRatings),
      );
    } catch {
      // The rating is still saved on the server; this cache only remembers the device's choice.
    }
  }
  const displayedRating = (cafe) =>
    num(cafe.nyambungRatingCount) > 0
      ? num(cafe.nyambungRating)
      : num(cafe.googleRating);
  const speed = (value, unit) =>
    num(value) === null ? "—" : `${Math.round(num(value))} ${unit}`;
  const labels = {
    outlets: {
      many: "Banyak colokan",
      some: "Sebagian ada",
      few: "Colokan terbatas",
      varies: "Tergantung kursi",
      unknown: "Colokan belum dicek",
    },
    prayer: {
      yes: "Ada mushola",
      no: "Belum ada mushola",
      shared: "Mushola bersama",
      unknown: "Mushola belum dicek",
    },
    stability: {
      stable: "Cenderung stabil",
      moderate: "Stabilitas sedang",
      unstable: "Pernah tidak stabil",
      unknown: "Stabilitas belum dicatat",
    },
  };
  const label = (group, value) => labels[group][value] || labels[group].unknown;
  function coords(cafe) {
    const lat = num(cafe?.latitude),
      lon = num(cafe?.longitude);
    return lat !== null &&
      lon !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
      ? { lat, lon }
      : null;
  }
  function distance(a, b) {
    const dLat = ((b.lat - a.lat) * Math.PI) / 180,
      dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((b.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function mapUrl(cafe) {
    const c = coords(cafe);
    const destination = c
      ? `${c.lat},${c.lon}`
      : `${cafe.name || ""} ${cafe.area || ""}`.trim();
    if (state.location)
      return `https://www.google.com/maps/dir/?api=1&origin=${state.location.lat},${state.location.lon}&destination=${encodeURIComponent(destination)}`;
    if (c)
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
    if (cafe.mapUrl) {
      try {
        const url = new URL(cafe.mapUrl);
        if (["http:", "https:"].includes(url.protocol)) return url.href;
      } catch {}
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
  }
  function late(hours) {
    const end = String(hours || "").split(/[–—-]/)[1] || "";
    const [hour, minute] = end.trim().split(":").map(Number);
    return (
      Number.isFinite(hour) &&
      (hour > 22 || hour < 5 || (hour === 22 && minute > 0))
    );
  }
  async function request(url) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(body?.error || `Permintaan gagal (${response.status})`);
    return body;
  }
  function copyTextFallback(value) {
    const field = document.createElement("textarea");
    field.value = value;
    field.readOnly = true;
    field.tabIndex = -1;
    field.className = "clipboard-temp";
    field.setAttribute("aria-hidden", "true");
    document.body.append(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      field.remove();
    }
    if (!copied) throw new Error("Clipboard tidak tersedia.");
  }
  function safePhoto(cafe) {
    if (!cafe?.photoUrl) return "";
    try {
      const url = new URL(cafe.photoUrl, location.origin);
      return url.protocol === "https:" ||
        (url.origin === location.origin && url.pathname.startsWith("/media/"))
        ? url.href
        : "";
    } catch {
      return "";
    }
  }
  function photoMarkup(cafe, detail = false) {
    const src = safePhoto(cafe),
      className = `cafe-photo ${detail ? "detail-photo" : ""}`;
    return src
      ? `<div class="${className}"><img src="${esc(src)}" alt="Foto ${esc(cafe.name || "kafe")}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span>Foto tidak tersedia</span></div>`
      : `<div class="${className} photo-placeholder" aria-label="Foto belum ditambahkan"><span>Foto belum ditambahkan</span></div>`;
  }
  // Capture image failures without inline event handlers, which the CSP forbids.
  document.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.closest(".cafe-photo")) {
        image.closest(".cafe-photo").classList.add("photo-missing");
        image.remove();
      }
    },
    true,
  );
  function updateAreas() {
    const select = $("#areaSelect"),
      current = select.value;
    const areas = [
      ...new Set(state.cafes.map((cafe) => cafe.area).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "id"));
    select.innerHTML =
      '<option value="all">Semua area</option>' +
      areas
        .map((area) => `<option value="${esc(area)}">${esc(area)}</option>`)
        .join("");
    if (areas.includes(current)) select.value = current;
  }
  function matches(cafe) {
    const query = $("#searchInput").value.trim().toLowerCase(),
      area = $("#areaSelect").value;
    if (
      query &&
      !`${cafe.name || ""} ${cafe.area || ""}`.toLowerCase().includes(query)
    )
      return false;
    if (area !== "all" && cafe.area !== area) return false;
    switch (state.filter) {
      case "fast":
        return num(cafe.down) >= 50;
      case "outlets":
        return cafe.outlets === "many";
      case "prayer":
        return cafe.prayer === "yes";
      case "late":
        return late(cafe.hours);
      case "password":
        return Boolean(cafe.hasPassword);
      default:
        return true;
    }
  }
  function sorted(list) {
    const mode = $("#sortSelect").value;
    return [...list].sort((a, b) => {
      if (mode === "nearest" && state.location) {
        const ca = coords(a),
          cb = coords(b);
        if (!ca && !cb) return 0;
        if (!ca) return 1;
        if (!cb) return -1;
        return distance(state.location, ca) - distance(state.location, cb);
      }
      if (mode === "name")
        return String(a.name || "").localeCompare(String(b.name || ""), "id");
      if (mode === "wifi") return (num(b.down) || 0) - (num(a.down) || 0);
      if (mode === "upload") return (num(b.up) || 0) - (num(a.up) || 0);
      if (mode === "outlets") {
        const rank = { many: 4, some: 3, varies: 2, few: 1, unknown: 0 };
        return (rank[b.outlets] || 0) - (rank[a.outlets] || 0);
      }
      if (mode === "rating")
        return (num(b.nyambungRating) || 0) - (num(a.nyambungRating) || 0);
      if (mode === "google-rating")
        return (num(b.googleRating) || 0) - (num(a.googleRating) || 0);
      return (
        (displayedRating(b) || 0) * 30 +
        (num(b.down) || 0) * 0.025 -
        ((displayedRating(a) || 0) * 30 + (num(a.down) || 0) * 0.025)
      );
    });
  }
  function ratingMarkup(cafe) {
    const google = num(cafe.googleRating);
    const community = num(cafe.nyambungRating);
    const communityCount = num(cafe.nyambungRatingCount) || 0;
    if (google === null && !communityCount) return "";
    return `<div class="rating-list" aria-label="Rating dari sumber berbeda">${google === null ? "" : `<span class="rating rating-google">★ ${google.toFixed(1)} <small>Google Maps</small></span>`}${communityCount ? `<span class="rating rating-community">★ ${(community || 0).toFixed(1)} <small>Nyambung · ${communityCount}</small></span>` : ""}</div>`;
  }
  function card(cafe) {
    const download = num(cafe.down),
      c = coords(cafe);
    const km =
      state.location && c
        ? `<span class="distance" title="${state.locationSource === "tebet" ? "Perkiraan jarak dari pusat Tebet" : "Jarak garis lurus perkiraan dari lokasimu"}">${state.locationSource === "tebet" ? "~" : ""}${distance(state.location, c).toFixed(1)} km</span>`
        : "";
    return `<article class="cafe-card">${photoMarkup(cafe)}<div class="card-heading"><button class="card-title" type="button" data-detail="${esc(cafe.id)}"><strong>${esc(cafe.name || "Tanpa nama")}</strong><span>${esc(cafe.area || "Area belum dicatat")} ${km}</span></button></div>${ratingMarkup(cafe)}<div class="speed"><strong>${download === null ? "—" : Math.round(download)}</strong><span>Mbps download</span>${download !== null && download >= 50 ? "<b>Wi-Fi cepat</b>" : ""}</div><div class="tags"><span>${esc(label("outlets", cafe.outlets))}</span><span>${esc(label("prayer", cafe.prayer))}</span></div><div class="card-footer"><button class="detail-link" type="button" data-detail="${esc(cafe.id)}">Lihat detail →</button><span class="password ${cafe.hasPassword ? "available" : ""}">${cafe.hasPassword ? "Password tercatat" : "Password belum dicatat"}</span><a href="${esc(mapUrl(cafe))}" target="_blank" rel="noopener">Arah ↗</a></div></article>`;
  }
  function render() {
    updateAreas();
    const nearest = $("#sortSelect").querySelector('option[value="nearest"]');
    const hasCoordinates = state.cafes.some((cafe) => coords(cafe));
    nearest.disabled = !state.location || !hasCoordinates;
    nearest.textContent = !state.location
      ? "Terdekat (aktifkan lokasi)"
      : !hasCoordinates
        ? "Terdekat (koordinat belum ada)"
        : state.locationSource === "tebet"
          ? "Terdekat dari Tebet (perkiraan)"
        : "Terdekat";
    if (nearest.disabled && $("#sortSelect").value === "nearest")
      $("#sortSelect").value = "recommended";
    const results = sorted(state.cafes.filter(matches));
    $("#cafeGrid").innerHTML = results.map(card).join("");
    $("#resultCount").textContent = `${results.length} tempat`;
    $("#emptyState").hidden = results.length !== 0;
    $("#cafeGrid").hidden = results.length === 0;
  }
  async function showDetail(id) {
    const cafe = state.cafes.find((item) => String(item.id) === String(id));
    if (!cafe) return;
    const modal = $("#detailModal"),
      ticket = ++state.detailRequest;
    $("#detailContent").innerHTML =
      '<div class="modal-loading">Memuat detail…</div>';
    modal.showModal();
    try {
      const detail = await request(`/api/cafes/${encodeURIComponent(id)}`);
      if (!modal.open || ticket !== state.detailRequest) return;
      const wifi = detail.wifiPassword
        ? `<div class="wifi-box"><strong>${esc(detail.ssid || "Wi-Fi")}</strong><button id="revealPassword" type="button">Tampilkan password</button><code id="wifiPassword" hidden>${esc(detail.wifiPassword)}</code><button id="copyWifiPassword" type="button" hidden>Salin password</button><span id="wifiCopyStatus" class="wifi-copy-status" role="status" aria-live="polite"></span></div>`
        : '<div class="wifi-box"><strong>Password belum dibagikan</strong><span>Konfirmasi langsung ke kafe sebelum tersambung.</span></div>';
      const provider = detail.provider
        ? `<p>Provider tercatat: <strong>${esc(detail.provider)}</strong>.</p>`
        : "";
      const tested = detail.testedAt
        ? `<p class="tested-note">Pengukuran tersimpan · ${esc(new Date(detail.testedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }))}. Ini bukan tes langsung perangkatmu.</p>`
        : "";
      const googleRating = num(detail.googleRating);
      const googleRatingCount = num(detail.googleRatingCount);
      const communityRating = num(detail.nyambungRating);
      const communityCount = num(detail.nyambungRatingCount) || 0;
      const myRating = Number(state.userRatings[String(detail.id)]) || 0;
      const ratingOptions = [1, 2, 3, 4, 5]
        .map(
          (value) =>
            `<label><input type="radio" name="communityRating" value="${value}" ${myRating === value ? "checked" : ""} required><span aria-hidden="true">★</span><span class="visually-hidden">${value} dari 5 bintang</span></label>`,
        )
        .join("");
      const googleSummary =
        googleRating === null
          ? "Belum ada data Google Maps"
          : `★ ${googleRating.toFixed(1)}/5 · ${googleRatingCount === null ? "jumlah ulasan tidak diketahui" : `${googleRatingCount} ulasan`}`;
      const communitySummary = communityCount
        ? `★ ${(communityRating || 0).toFixed(1)}/5 · ${communityCount} rating pengguna`
        : "Belum ada rating pengguna";
      const ratingPanel = `<section class="rating-panel" aria-labelledby="ratingPanelTitle"><h3 id="ratingPanelTitle">Rating dari dua sumber</h3><p class="rating-source"><strong>Google Maps</strong><span>${esc(googleSummary)}</span></p><p class="rating-source"><strong>Nyambung</strong><span><b id="nyambungAggregate">${esc(communityCount ? `★ ${(communityRating || 0).toFixed(1)}/5` : "—")}</b> <span id="nyambungCount">${esc(communityCount ? `· ${communityCount} rating pengguna` : "· Belum ada rating pengguna")}</span></span></p><form id="ratingForm" data-cafe-id="${esc(detail.id)}"><fieldset class="rating-picker"><legend>Beri rating Nyambung</legend>${ratingOptions}</fieldset><button class="secondary-button" type="submit">${myRating ? "Perbarui rating" : "Kirim rating"}</button><p id="ratingStatus" class="rating-status" role="status" aria-live="polite">${myRating ? `Ratingmu saat ini ${myRating}/5; kamu dapat mengubahnya.` : "Satu rating per browser; rating Google Maps tidak berubah."}</p></form></section>`;
      $("#detailContent").innerHTML =
        `<button class="modal-close" type="button" data-close aria-label="Tutup detail">×</button>${photoMarkup(detail, true)}<p class="eyebrow">DETAIL SPOT</p><h2 id="detailTitle">${esc(detail.name || cafe.name)}</h2><p class="detail-area">${esc(detail.area || "")}${detail.hours ? ` · ${esc(detail.hours)}` : ""}</p>${detail.address ? `<p class="detail-address">Alamat: ${esc(detail.address)}</p>` : ""}${ratingPanel}<div class="detail-stats"><div><strong>${speed(detail.down, "Mbps")}</strong><span>Download</span></div><div><strong>${speed(detail.up, "Mbps")}</strong><span>Upload</span></div><div><strong>${speed(detail.ping, "ms")}</strong><span>Ping</span></div></div><section><h3>Fasilitas & suasana</h3><p>${esc(label("outlets", detail.outlets))} · ${esc(label("prayer", detail.prayer))} · ${esc(label("stability", detail.stability))}${detail.comfort ? ` · Kenyamanan ${esc(detail.comfort)}/5` : ""}${detail.smoking ? ` · ${esc(detail.smoking)}` : ""}</p></section><section><h3>Wi-Fi</h3>${wifi}${provider}${tested}<p>Data berdasarkan catatan kunjungan dan dapat berubah.</p></section><div class="modal-actions"><a class="primary-button" href="${esc(mapUrl(detail))}" target="_blank" rel="noopener">Buka petunjuk arah ↗</a><button class="secondary-button" type="button" data-close>Tutup</button></div>`;
      $("#revealPassword")?.addEventListener("click", () => {
        $("#wifiPassword").hidden = false;
        $("#copyWifiPassword").hidden = false;
        $("#revealPassword").hidden = true;
      });
      $("#copyWifiPassword")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const status = $("#wifiCopyStatus");
        const password = $("#wifiPassword")?.textContent || "";
        button.disabled = true;
        button.textContent = "Menyalin…";
        try {
          if (navigator.clipboard?.writeText && window.isSecureContext) {
            try {
              await navigator.clipboard.writeText(password);
            } catch {
              copyTextFallback(password);
            }
          } else {
            copyTextFallback(password);
          }
          status.textContent = "Password berhasil disalin.";
          status.className = "wifi-copy-status success";
          button.textContent = "Tersalin";
        } catch {
          status.textContent = "Tidak berhasil menyalin. Tekan lama password untuk menyalinnya manual.";
          status.className = "wifi-copy-status error";
          button.textContent = "Coba salin lagi";
        } finally {
          button.disabled = false;
        }
      });
    } catch (error) {
      if (!modal.open || ticket !== state.detailRequest) return;
      $("#detailContent").innerHTML =
        `<button class="modal-close" type="button" data-close aria-label="Tutup detail">×</button><p class="eyebrow">DETAIL SPOT</p><h2>Detail tidak tersedia</h2><p class="error-text">${esc(error.message)}</p><button class="secondary-button" type="button" data-close>Tutup</button>`;
    }
  }
  function reset() {
    state.filter = "all";
    $("#searchInput").value = "";
    $("#areaSelect").value = "all";
    $("#sortSelect").value = "recommended";
    document
      .querySelectorAll(".filter")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.filter === "all"),
      );
    render();
  }
  function setHeaderLocation(label) {
    $(".header-location").textContent = label;
  }
  async function resolveLocationArea(lat, lon) {
    const rounded = (value) => Math.round(value * 1000) / 1000;
    const response = await fetch("/api/location/label", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Nyambung-Location": "1",
      },
      body: JSON.stringify({ latitude: rounded(lat), longitude: rounded(lon) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.label)
      throw new Error(data.error || "Nama area belum tersedia.");
    return data.label;
  }
  function locate(options = {}) {
    const automatic = Boolean(options?.automatic);
    const status = $("#locationStatus"),
      button = $("#locationButton");
    const useTebetFallback = (message) => {
      state.location = { ...TEBET_FALLBACK };
      state.locationSource = "tebet";
      state.locationLabelRequest += 1;
      setHeaderLocation("Tebet, Jakarta · perkiraan");
      $("#nearestSortOption").textContent = "Terdekat dari Tebet (perkiraan)";
      $("#clearLocation").hidden = true;
      status.textContent = `${message} Jarak tetap diperkirakan dari pusat Tebet, Jakarta; gunakan lokasi saya untuk hasil yang lebih akurat.`;
      if (state.cafes.some((cafe) => coords(cafe)))
        $("#sortSelect").value = "nearest";
      render();
    };
    if (!navigator.geolocation || !window.isSecureContext) {
      useTebetFallback(
        "Browser ini tidak mendukung lokasi atau halaman tidak dibuka lewat HTTPS.",
      );
      return;
    }
    if (!automatic) button.disabled = true;
    status.textContent = automatic
      ? "Izin lokasi sudah aktif; mendeteksi area perangkat…"
      : "Meminta izin lokasi…";
    if (!automatic) setHeaderLocation("Mendeteksi lokasi…");
    const succeed = (position) => {
      const lat = position?.coords?.latitude,
        lon = position?.coords?.longitude;
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ) {
        fail({ code: 2 }, false);
        return;
      }
      button.disabled = false;
      state.location = { lat, lon };
      state.locationSource = "device";
      $("#clearLocation").hidden = false;
      $("#nearestSortOption").textContent = "Terdekat dari lokasi saya";
      const requestId = ++state.locationLabelRequest;
      setHeaderLocation("Menentukan area…");
      const known = state.cafes.some((cafe) => coords(cafe));
      const accuracy = Number.isFinite(position.coords.accuracy)
        ? ` (akurasi ±${Math.round(position.coords.accuracy)} m)`
        : "";
      status.textContent = known
        ? `Lokasi GPS aktif${accuracy}. Jarak garis lurus dihitung di tab ini; untuk nama area, hanya koordinat yang dibulatkan sekitar 100 m dikirim ke OpenStreetMap. Asal dibagikan ke Google Maps hanya jika kamu membuka petunjuk arah.`
        : `Lokasi GPS aktif${accuracy}, tetapi koordinat kafe belum dilengkapi. Nama area dicari memakai titik yang dibulatkan sekitar 100 m lewat OpenStreetMap; asal dikirim ke Google Maps hanya jika kamu membuka petunjuk arah.`;
      if (known) $("#sortSelect").value = "nearest";
      render();
      resolveLocationArea(lat, lon)
        .then((area) => {
          if (
            requestId !== state.locationLabelRequest ||
            state.locationSource !== "device"
          )
            return;
          setHeaderLocation(area);
          status.textContent = `Lokasi terdeteksi: ${area}${accuracy}. Untuk jarak dipakai titik GPS perangkat; ke OpenStreetMap hanya dikirim titik yang dibulatkan sekitar 100 m.`;
        })
        .catch(() => {
          if (requestId !== state.locationLabelRequest) return;
          setHeaderLocation("Lokasi GPS aktif");
          status.textContent = `Lokasi GPS aktif${accuracy}, tetapi nama area belum tersedia. Jarak tetap memakai titik perangkat di tab ini.`;
        });
    };
    const fail = (error, canRetry = true) => {
      if (canRetry && (error.code === 2 || error.code === 3)) {
        status.textContent =
          "GPS belum tersedia; mencoba lokasi jaringan dengan konsumsi daya lebih rendah…";
        try {
          navigator.geolocation.getCurrentPosition(
            succeed,
            (retryError) => fail(retryError, false),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
          );
          return;
        } catch {
          // Use the neighborhood fallback if the browser rejects the retry.
        }
      }
      const message =
        error.code === 1
          ? "Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser jika ingin mencoba lagi."
          : error.code === 2
            ? "Lokasi perangkat tidak tersedia."
            : error.code === 3
              ? "Pencarian lokasi melewati batas waktu."
              : "Lokasi perangkat gagal dideteksi. Periksa izin browser.";
      button.disabled = false;
      useTebetFallback(message);
    };
    try {
      navigator.geolocation.getCurrentPosition(
        succeed,
        fail,
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
      );
    } catch {
      fail({ code: 0 }, false);
    }
  }
  document.addEventListener("click", (event) => {
    const detail = event.target.closest("[data-detail]");
    if (detail) showDetail(detail.dataset.detail);
    if (event.target.closest("[data-close]") && $("#detailModal").open)
      $("#detailModal").close();
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("#ratingForm");
    if (!form) return;
    event.preventDefault();
    const cafeId = form.dataset.cafeId;
    const rating = Number(
      form.querySelector('input[name="communityRating"]:checked')?.value,
    );
    const button = form.querySelector('[type="submit"]');
    const status = form.querySelector("#ratingStatus");
    button.disabled = true;
    status.textContent = "Menyimpan rating…";
    status.className = "rating-status";
    try {
      const response = await fetch(
        `/api/cafes/${encodeURIComponent(cafeId)}/rating`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Nyambung-Rating": "1",
          },
          body: JSON.stringify({ ratingId: ratingDeviceId(), rating }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || `Rating gagal disimpan (${response.status}).`);
      saveUserRating(cafeId, rating);
      const cafe = state.cafes.find((item) => String(item.id) === String(cafeId));
      if (cafe) {
        cafe.nyambungRating = data.nyambungRating;
        cafe.nyambungRatingCount = data.nyambungRatingCount;
      }
      render();
      if ($("#ratingForm")?.dataset.cafeId === cafeId) {
        $("#nyambungAggregate").textContent = `★ ${Number(data.nyambungRating).toFixed(1)}/5`;
        $("#nyambungCount").textContent = `· ${data.nyambungRatingCount} rating pengguna`;
        $("#ratingStatus").textContent =
          data.message || "Rating Nyambung tersimpan. Terima kasih!";
        $("#ratingStatus").className = "rating-status success";
        $("#ratingForm [type=submit]").textContent = "Perbarui rating";
      }
    } catch (error) {
      status.textContent = error.message || "Rating gagal disimpan. Coba lagi.";
      status.className = "rating-status error";
    } finally {
      button.disabled = false;
    }
  });
  $("#detailModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $("#detailModal").addEventListener("cancel", (event) => {
    event.preventDefault();
    event.currentTarget.close();
  });
  $("#filterRow").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    document
      .querySelectorAll(".filter")
      .forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
  $("#searchInput").addEventListener("input", render);
  $("#areaSelect").addEventListener("change", render);
  $("#sortSelect").addEventListener("change", render);
  $("#clearFilters").addEventListener("click", reset);
  $("#locationButton").addEventListener("click", () => locate());
  $("#clearLocation").addEventListener("click", () => {
    state.location = { ...TEBET_FALLBACK };
    state.locationSource = "tebet";
    state.locationLabelRequest += 1;
    setHeaderLocation("Tebet, Jakarta · perkiraan");
    $("#nearestSortOption").textContent = "Terdekat dari Tebet (perkiraan)";
    $("#clearLocation").hidden = true;
    $("#locationStatus").textContent =
      "Lokasi perangkat dihapus dari tab ini. Jarak kembali diperkirakan dari pusat Tebet, Jakarta.";
    render();
  });
  function locateAutomaticallyIfAlreadyAllowed() {
    if (!navigator.geolocation || !navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (permission.state === "granted") locate({ automatic: true });
      })
      .catch(() => {});
  }
  async function init() {
    try {
      const data = await request("/api/cafes");
      state.cafes = Array.isArray(data) ? data : [];
      $("#status").hidden = true;
      render();
      locateAutomaticallyIfAlreadyAllowed();
    } catch (error) {
      $("#status").className = "status error";
      $("#status").textContent =
        `Data kafe tidak dapat dimuat. ${error.message}`;
      $("#resultCount").textContent = "Gagal memuat";
    }
  }
  init();
})();
