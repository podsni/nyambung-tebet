(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const state = { cafes: [], filter: "all", location: null, detailRequest: 0 };
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
      if (mode === "rating") return (num(b.rating) || 0) - (num(a.rating) || 0);
      return (
        (num(b.rating) || 0) * 30 +
        (num(b.down) || 0) * 0.025 -
        ((num(a.rating) || 0) * 30 + (num(a.down) || 0) * 0.025)
      );
    });
  }
  function card(cafe) {
    const download = num(cafe.down),
      c = coords(cafe);
    const km =
      state.location && c
        ? `<span class="distance">${distance(state.location, c).toFixed(1)} km</span>`
        : "";
    return `<article class="cafe-card">${photoMarkup(cafe)}<div class="card-heading"><button class="card-title" type="button" data-detail="${esc(cafe.id)}"><strong>${esc(cafe.name || "Tanpa nama")}</strong><span>${esc(cafe.area || "Area belum dicatat")} ${km}</span></button>${num(cafe.rating) !== null ? `<span class="rating">★ ${esc(num(cafe.rating).toFixed(1))}</span>` : ""}</div><div class="speed"><strong>${download === null ? "—" : Math.round(download)}</strong><span>Mbps download</span>${download !== null && download >= 50 ? "<b>Wi-Fi cepat</b>" : ""}</div><div class="tags"><span>${esc(label("outlets", cafe.outlets))}</span><span>${esc(label("prayer", cafe.prayer))}</span></div><div class="card-footer"><button class="detail-link" type="button" data-detail="${esc(cafe.id)}">Lihat detail →</button><span class="password ${cafe.hasPassword ? "available" : ""}">${cafe.hasPassword ? "Password tercatat" : "Password belum dicatat"}</span><a href="${esc(mapUrl(cafe))}" target="_blank" rel="noopener">Arah ↗</a></div></article>`;
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
        ? `<div class="wifi-box"><strong>${esc(detail.ssid || "Wi-Fi")}</strong><button id="revealPassword" type="button">Tampilkan password</button><code id="wifiPassword" hidden>${esc(detail.wifiPassword)}</code></div>`
        : '<div class="wifi-box"><strong>Password belum dibagikan</strong><span>Konfirmasi langsung ke kafe sebelum tersambung.</span></div>';
      const provider = detail.provider
        ? `<p>Provider tercatat: <strong>${esc(detail.provider)}</strong>.</p>`
        : "";
      const tested = detail.testedAt
        ? `<p class="tested-note">Pengukuran tersimpan · ${esc(new Date(detail.testedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }))}. Ini bukan tes langsung perangkatmu.</p>`
        : "";
      $("#detailContent").innerHTML =
        `<button class="modal-close" type="button" data-close aria-label="Tutup detail">×</button>${photoMarkup(detail, true)}<p class="eyebrow">DETAIL SPOT</p><h2 id="detailTitle">${esc(detail.name || cafe.name)}</h2><p class="detail-area">${esc(detail.area || "")}${detail.hours ? ` · ${esc(detail.hours)}` : ""}</p><div class="detail-stats"><div><strong>${speed(detail.down, "Mbps")}</strong><span>Download</span></div><div><strong>${speed(detail.up, "Mbps")}</strong><span>Upload</span></div><div><strong>${speed(detail.ping, "ms")}</strong><span>Ping</span></div></div><section><h3>Fasilitas & suasana</h3><p>${esc(label("outlets", detail.outlets))} · ${esc(label("prayer", detail.prayer))} · ${esc(label("stability", detail.stability))}${detail.comfort ? ` · Kenyamanan ${esc(detail.comfort)}/5` : ""}${detail.smoking ? ` · ${esc(detail.smoking)}` : ""}</p></section><section><h3>Wi-Fi</h3>${wifi}${provider}${tested}<p>Data berdasarkan catatan kunjungan dan dapat berubah.</p></section><div class="modal-actions"><a class="primary-button" href="${esc(mapUrl(detail))}" target="_blank" rel="noopener">Buka petunjuk arah ↗</a><button class="secondary-button" type="button" data-close>Tutup</button></div>`;
      $("#revealPassword")?.addEventListener("click", () => {
        $("#wifiPassword").hidden = false;
        $("#revealPassword").hidden = true;
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
  function locate() {
    const status = $("#locationStatus"),
      button = $("#locationButton");
    if (!navigator.geolocation || !window.isSecureContext) {
      status.textContent =
        "Lokasi memerlukan browser yang mendukung izin lokasi dan HTTPS.";
      return;
    }
    button.disabled = true;
    status.textContent = "Meminta izin lokasi…";
    const fail = (error) => {
      button.disabled = false;
      state.location = null;
      $("#clearLocation").hidden = true;
      const message =
        error.code === 1
          ? "Izin lokasi ditolak."
          : error.code === 2
            ? "Lokasi tidak tersedia."
            : error.code === 3
              ? "Permintaan lokasi melewati batas waktu."
              : "Gagal meminta lokasi. Periksa izin browser.";
      status.textContent = `${message} Kamu tetap bisa memakai direktori tanpa lokasi.`;
      render();
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          button.disabled = false;
          state.location = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          };
          $("#clearLocation").hidden = false;
          const known = state.cafes.some((cafe) => coords(cafe));
          const accuracy = Number.isFinite(position.coords.accuracy)
            ? ` (akurasi ±${Math.round(position.coords.accuracy)} m)`
            : "";
          status.textContent = known
            ? `Lokasi aktif${accuracy}. Jarak perkiraan ditampilkan; lokasi tidak disimpan.`
            : `Lokasi aktif${accuracy}. Koordinat kafe belum dilengkapi; tombol Arah tetap memakai lokasimu.`;
          if (known) $("#sortSelect").value = "nearest";
          render();
        },
        fail,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    } catch {
      fail({ code: 0 });
    }
  }
  document.addEventListener("click", (event) => {
    const detail = event.target.closest("[data-detail]");
    if (detail) showDetail(detail.dataset.detail);
    if (event.target.closest("[data-close]") && $("#detailModal").open)
      $("#detailModal").close();
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
  $("#locationButton").addEventListener("click", locate);
  $("#clearLocation").addEventListener("click", () => {
    state.location = null;
    $("#clearLocation").hidden = true;
    $("#locationStatus").textContent = "Lokasi dihapus dari tab ini.";
    render();
  });
  async function init() {
    try {
      const data = await request("/api/cafes");
      state.cafes = Array.isArray(data) ? data : [];
      $("#status").hidden = true;
      render();
    } catch (error) {
      $("#status").className = "status error";
      $("#status").textContent =
        `Data kafe tidak dapat dimuat. ${error.message}`;
      $("#resultCount").textContent = "Gagal memuat";
    }
  }
  init();
})();
