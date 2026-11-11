(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const mapInput = $('[name="mapUrl"]'),
    mapButton = $("#resolveMapButton"),
    mapStatus = $("#mapResolveStatus");
  let lastResolvedUrl = "",
    resolving = false;
  async function resolveMap() {
    const url = String(mapInput?.value || "").trim();
    if (!url) {
      mapStatus.textContent = "Tempel tautan Google Maps terlebih dahulu.";
      mapStatus.className = "field-status error";
      return;
    }
    if (resolving || url === lastResolvedUrl) return;
    resolving = true;
    mapButton.disabled = true;
    mapButton.textContent = "Membaca lokasi…";
    mapStatus.textContent = "Mencari nama tempat, area, dan koordinat…";
    mapStatus.className = "field-status";
    try {
      const r = await fetch(
        `/api/maps/resolve?url=${encodeURIComponent(url)}`,
        {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          cache: "no-store",
        },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data.error || "Tautan Maps tidak dapat dibaca.");
      const f = $("#cafeForm");
      if (data.name) f.elements.name.value = data.name;
      if (data.area) f.elements.area.value = data.area;
      if (data.latitude !== null && data.latitude !== undefined)
        f.elements.latitude.value = data.latitude;
      if (data.longitude !== null && data.longitude !== undefined)
        f.elements.longitude.value = data.longitude;
      if (data.googleRating !== null && data.googleRating !== undefined)
        f.elements.googleRating.value = data.googleRating;
      if (
        data.googleRatingCount !== null &&
        data.googleRatingCount !== undefined
      )
        f.elements.googleRatingCount.value = data.googleRatingCount;
      lastResolvedUrl = url;
      const googleRating =
        data.googleRating == null
          ? "rating Google belum terbaca"
          : `Google Maps ★ ${Number(data.googleRating).toFixed(1)}${data.googleRatingCount == null ? "" : ` · ${data.googleRatingCount} ulasan`}`;
      mapStatus.textContent = `Terisi: ${data.name || "nama tempat"} · ${data.area || "area belum terbaca"}${data.latitude != null ? " · koordinat tersedia" : ""} · ${googleRating}. Semua isian dapat diedit; periksa sebelum menyimpan.`;
      mapStatus.className = "field-status success";
    } catch (e) {
      mapStatus.textContent = e.message || "Tautan Maps tidak dapat dibaca.";
      mapStatus.className = "field-status error";
    } finally {
      resolving = false;
      mapButton.disabled = false;
      mapButton.textContent = "Impor dari Google Maps";
    }
  }
  mapButton?.addEventListener("click", resolveMap);
  mapInput?.addEventListener("input", () => {
    if (mapInput.value.trim() !== lastResolvedUrl) lastResolvedUrl = "";
  });
  mapInput?.addEventListener("paste", () => setTimeout(resolveMap, 80));
  mapInput?.addEventListener("change", resolveMap);
  window.__NyambungAdmin = window.__NyambungAdmin || {};
  window.__NyambungAdmin.resetMapResolver = () => {
    lastResolvedUrl = "";
    mapStatus.textContent =
      "Tempel tautan Google Maps untuk mengisi data tempat secara otomatis; periksa sebelum menyimpan.";
    mapStatus.className = "field-status";
  };
  $("#useCurrentLocation")?.addEventListener("click", () => {
    const b = $("#useCurrentLocation"),
      s = mapStatus;
    if (!navigator.geolocation) {
      s.textContent = "Browser ini tidak mendukung lokasi.";
      s.className = "field-status error";
      return;
    }
    b.disabled = true;
    b.textContent = "Meminta izin lokasi…";
    s.textContent =
      "Izinkan lokasi pada browser. Gunakan hanya saat berada di kafe.";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $("#cafeForm").elements.latitude.value = pos.coords.latitude.toFixed(6);
        $("#cafeForm").elements.longitude.value =
          pos.coords.longitude.toFixed(6);
        s.textContent = "Lokasi saat ini terisi. Periksa sebelum menyimpan.";
        s.className = "field-status success";
        b.disabled = false;
        b.textContent = "Gunakan lokasi saat ini";
      },
      (err) => {
        s.textContent =
          err.code === 1
            ? "Izin lokasi ditolak. Aktifkan izin lalu coba lagi."
            : err.code === 3
              ? "Lokasi tidak ditemukan sebelum batas waktu."
              : "Lokasi tidak tersedia.";
        s.className = "field-status error";
        b.disabled = false;
        b.textContent = "Gunakan lokasi saat ini";
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
  const fileInput = $('[name="photoFile"]'),
    preview = $("#photoPreview"),
    photoStatus = $("#photoStatus");
  let objectUrl = "";
  const toLocalDateTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  function revoke() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
  }
  function processImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
        reject(new Error("Pilih foto JPEG, PNG, atau WebP."));
        return;
      }
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(
            1,
            1600 / Math.max(img.naturalWidth, img.naturalHeight),
          ),
          c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const type = file.type === "image/png" ? "image/webp" : "image/jpeg";
        c.toBlob(
          (blob) => {
            if (!blob || blob.size > 2 * 1024 * 1024) {
              reject(
                new Error(
                  "Foto setelah diproses harus berukuran maksimal 2 MB.",
                ),
              );
              return;
            }
            resolve({ blob, type });
          },
          type,
          type === "image/webp" ? 0.82 : 0.84,
        );
      };
      img.onerror = () => reject(new Error("Foto tidak dapat dibaca."));
      img.src = URL.createObjectURL(file);
    });
  }
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    photoStatus.textContent = "Memproses foto…";
    photoStatus.className = "field-status";
    try {
      const processed = await processImage(file);
      if ($('[name="removePhoto"]')?.checked) return;
      window.__NyambungAdmin?.setPendingUpload(processed);
      revoke();
      objectUrl = URL.createObjectURL(processed.blob);
      preview.src = objectUrl;
      preview.hidden = false;
      photoStatus.textContent = "Foto siap diunggah saat formulir disimpan.";
      photoStatus.className = "field-status success";
    } catch (e) {
      fileInput.value = "";
      window.__NyambungAdmin?.setPendingUpload(null);
      photoStatus.textContent = e.message;
      photoStatus.className = "field-status error";
    }
  });
  $('[name="photoUrl"]')?.addEventListener("input", (e) => {
    if (e.target.value.trim()) {
      $('[name="photoKey"]').value = "";
      $('[name="removePhoto"]').checked = false;
    }
  });
  $('[name="removePhoto"]')?.addEventListener("change", (e) => {
    if (e.target.checked) {
      $('[name="photoUrl"]').value = "";
      $('[name="photoKey"]').value = "";
      fileInput.value = "";
      window.__NyambungAdmin?.setPendingUpload(null);
      revoke();
      preview.hidden = true;
    }
  });
  const speedButton = $("#runSpeedTestButton"),
    speedStatus = $("#adminSpeedTestStatus");
  speedButton?.addEventListener("click", async () => {
    speedButton.disabled = true;
    speedButton.textContent = "Tes sedang berjalan…";
    speedStatus.className = "field-status";
    speedStatus.textContent = "Uji berjalan pada koneksi perangkat saat ini…";
    try {
      const result = await window.NyambungSpeedTest(
        (update) => {
          if (update?.text) speedStatus.textContent = update.text;
        },
        { mode: "admin" },
      );
      const f = $("#cafeForm");
      [
        ["downloadMbps", "down"],
        ["uploadMbps", "up"],
        ["pingMs", "ping"],
        ["jitterMs", "jitter"],
      ].forEach(([a, b]) => {
        if (Number.isFinite(Number(result?.[a])))
          f.elements[b].value = Number(result[a]).toFixed(1);
      });
      if (result?.provider) f.elements.provider.value = result.provider;
      if (result?.measuredAt)
        f.elements.testedAt.value = toLocalDateTime(result.measuredAt);
      speedStatus.className = "field-status success";
      speedStatus.textContent =
        "Hasil tes terisi. Periksa lalu simpan perubahan.";
    } catch (e) {
      speedStatus.className = "field-status error";
      speedStatus.textContent = e.message || "Speed test gagal. Coba lagi.";
    } finally {
      speedButton.disabled = false;
      speedButton.textContent = "Uji Wi-Fi & isi kecepatan";
    }
  });
})();
