(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const state = {
    cafes: [],
    editing: null,
    filter: "",
    selected: new Set(),
    pendingUpload: null,
    objectUrl: "",
  };
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(options.headers || {}) },
      ...options,
    });
    let body = null;
    try {
      body = await response.json();
    } catch {}
    if (!response.ok)
      throw new Error(
        body?.error || body?.message || `Permintaan gagal (${response.status})`,
      );
    return body;
  };
  const mutation = (url, options = {}) =>
    request(url, {
      ...options,
      headers: { "X-Nyambung-Admin": "1", ...(options.headers || {}) },
    });
  const setStatus = (m, t = "") => {
    const e = $("#adminStatus");
    e.textContent = m;
    e.className = `status ${t}`;
  };
  const toLocalDateTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const toUtcIso = (value) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  };
  const visibleCafes = () =>
    state.cafes.filter(
      (c) =>
        !state.filter ||
        `${c.name} ${c.area}`.toLowerCase().includes(state.filter),
    );
  function render() {
    const cafes = visibleCafes();
    $("#cafeList").innerHTML = cafes.length
      ? cafes
          .map(
            (c) =>
              `<article class="cafe-row"><label class="row-check"><input type="checkbox" data-select="${esc(c.id)}" ${state.selected.has(String(c.id)) ? "checked" : ""} aria-label="Pilih ${esc(c.name)}"></label><div class="cafe-info"><strong>${esc(c.name)}</strong><span>${esc(c.area || "Area belum dicatat")} · ${c.down != null ? `${esc(c.down)} Mbps` : "Wi-Fi belum dicatat"}${c.provider ? ` · ${esc(c.provider)}` : ""}${c.hasPassword ? " · password publik" : ""}</span></div><div class="row-actions"><button type="button" data-edit="${esc(c.id)}">Edit</button><button class="danger" type="button" data-delete="${esc(c.id)}">Hapus</button></div></article>`,
          )
          .join("")
      : '<div class="empty">Tidak ada kafe yang cocok.</div>';
    updateSelectionUI(cafes);
  }
  function updateSelectionUI(cafes = visibleCafes()) {
    const valid = new Set(state.cafes.map((c) => String(c.id)));
    state.selected = new Set([...state.selected].filter((id) => valid.has(id)));
    $("#selectedCount").textContent = `${state.selected.size} dipilih`;
    const all =
      !!cafes.length && cafes.every((c) => state.selected.has(String(c.id)));
    const box = $("#selectAllVisible");
    box.checked = all;
    box.indeterminate =
      !all && cafes.some((c) => state.selected.has(String(c.id)));
    $("#bulkDeleteButton").disabled = !state.selected.size;
    $("#deleteAllButton").disabled = !state.cafes.length;
  }
  async function loadCafes() {
    setStatus("Memuat data…");
    try {
      const data = await request("/api/admin/cafes");
      state.cafes = Array.isArray(data) ? data : [];
      state.selected.clear();
      render();
      setStatus(`${state.cafes.length} kafe terdaftar.`);
    } catch (e) {
      setStatus(e.message, "error");
    }
  }
  function revokePreview() {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = "";
    }
  }
  function setPreview(url = "") {
    const img = $("#photoPreview");
    if (!url) {
      img.hidden = true;
      img.removeAttribute("src");
      return;
    }
    img.src = url;
    img.hidden = false;
  }
  function showForm(cafe = null) {
    state.editing = cafe;
    state.pendingUpload = null;
    revokePreview();
    const f = $("#cafeForm");
    f.reset();
    $("#formTitle").textContent = cafe ? "Edit kafe" : "Tambah kafe";
    f.elements.id.value = cafe?.id || "";
    const fields = [
      "name",
      "area",
      "rating",
      "price",
      "down",
      "up",
      "ping",
      "jitter",
      "provider",
      "testedAt",
      "hours",
      "outlets",
      "prayer",
      "stability",
      "comfort",
      "smoking",
      "mapUrl",
      "ssid",
      "latitude",
      "longitude",
    ];
    fields.forEach((k) => {
      if (cafe?.[k] !== undefined && cafe?.[k] !== null)
        f.elements[k].value =
          k === "testedAt" ? toLocalDateTime(cafe[k]) : cafe[k];
    });
    f.elements.photoKey.value = cafe?.photoKey || "";
    f.elements.photoUrl.value = cafe?.photoKey ? "" : cafe?.photoUrl || "";
    f.elements.wifiConsent.checked = Boolean(cafe?.wifiPublic);
    f.elements.password.value = "";
    f.elements.password.placeholder = cafe?.password
      ? "Kosongkan untuk mempertahankan password tersimpan"
      : "";
    f.elements.removePassword.checked = false;
    f.elements.removePhoto.checked = false;
    setPreview(cafe?.photoKey ? cafe?.photoUrl || "" : cafe?.photoUrl || "");
    $("#photoStatus").textContent = "";
    $("#formError").textContent = "";
    $("#cafeDialog").showModal();
  }
  function readForm() {
    const f = $("#cafeForm"),
      d = {};
    [
      "name",
      "area",
      "hours",
      "outlets",
      "prayer",
      "stability",
      "smoking",
      "mapUrl",
      "ssid",
      "provider",
    ].forEach((k) => {
      const v = String(f.elements[k].value || "").trim();
      if (v || ["name", "area", "outlets", "prayer", "stability"].includes(k))
        d[k] = v;
    });
    const testedAt = String(f.elements.testedAt.value || "").trim();
    if (testedAt) d.testedAt = toUtcIso(testedAt);
    [
      "rating",
      "price",
      "down",
      "up",
      "ping",
      "jitter",
      "comfort",
      "latitude",
      "longitude",
    ].forEach((k) => {
      const v = String(f.elements[k].value || "").trim();
      d[k] = v === "" ? null : Number(v);
    });
    const lat = d.latitude,
      lon = d.longitude;
    if (
      (lat === null) !== (lon === null) ||
      (lat !== null && (lat < -90 || lat > 90)) ||
      (lon !== null && (lon < -180 || lon > 180))
    )
      throw new Error(
        "Latitude dan longitude harus diisi berpasangan dengan rentang yang valid.",
      );
    const p = f.elements.password.value.trim();
    d.password =
      p ||
      (state.editing?.password && !f.elements.removePassword.checked
        ? state.editing.password
        : "");
    d.wifiPublic =
      Boolean(f.elements.wifiConsent.checked) &&
      !f.elements.removePassword.checked;
    d.photoKey = f.elements.photoKey.value || "";
    d.photoUrl = f.elements.photoUrl.value.trim();
    if (f.elements.removePhoto.checked) {
      d.photoKey = "";
      d.photoUrl = "";
    }
    return d;
  }
  async function uploadPending() {
    if (!state.pendingUpload || $("#cafeForm").elements.removePhoto.checked)
      return null;
    $("#photoStatus").textContent = "Mengunggah foto…";
    const result = await mutation("/api/admin/photos", {
      method: "POST",
      headers: { "Content-Type": state.pendingUpload.type },
      body: state.pendingUpload.blob,
    });
    if (!result?.photoKey) throw new Error("Respons upload foto tidak valid.");
    $("#photoStatus").textContent = "Foto siap disimpan.";
    return result;
  }
  function openConfirm({ all = false, cafes = [], single = false }) {
    const dialog = $("#confirmDialog"),
      phrase = single ? "" : all ? "HAPUS SEMUA DATA" : "HAPUS PILIHAN";
    $("#confirmTitle").textContent = single
      ? "Hapus kafe ini?"
      : all
        ? "Hapus semua data?"
        : "Hapus kafe terpilih?";
    $("#confirmMessage").textContent = single
      ? `Anda akan menghapus “${cafes[0]?.name || "kafe ini"}”.`
      : all
        ? `Anda akan menghapus seluruh ${state.cafes.length} data kafe.`
        : `Anda akan menghapus ${cafes.length} kafe terpilih.`;
    $("#confirmNames").innerHTML = cafes.length
      ? cafes
          .map(
            (c) =>
              `<div>${esc(c.name)} <span>${esc(c.area || "")}</span></div>`,
          )
          .join("")
      : "Semua data kafe";
    $("#confirmPhraseLabel").textContent = phrase || "konfirmasi";
    $("#confirmPhrase").value = "";
    $("#confirmPhrase").hidden = single;
    $("#confirmPhraseLabel").hidden = single;
    $("#confirmSubmit").disabled = !single;
    dialog.dataset.single = single ? "true" : "false";
    dialog.dataset.all = all ? "true" : "false";
    dialog.dataset.ids = JSON.stringify(cafes.map((c) => c.id));
    dialog.showModal();
    setTimeout(() => $("#confirmCancel").focus(), 0);
  }
  $("#confirmPhrase").addEventListener("input", (e) => {
    $("#confirmSubmit").disabled =
      e.target.value !== $("#confirmPhraseLabel").textContent;
  });
  $("#confirmCancel").addEventListener("click", () =>
    $("#confirmDialog").close(),
  );
  $("#confirmForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const all = $("#confirmDialog").dataset.all === "true",
      single = $("#confirmDialog").dataset.single === "true",
      ids = JSON.parse($("#confirmDialog").dataset.ids || "[]");
    if (
      !single &&
      $("#confirmPhrase").value !== (all ? "HAPUS SEMUA DATA" : "HAPUS PILIHAN")
    )
      return;
    const b = $("#confirmSubmit");
    b.disabled = true;
    b.textContent = "Menghapus…";
    try {
      if (single)
        await mutation(`/api/admin/cafes/${encodeURIComponent(ids[0])}`, {
          method: "DELETE",
        });
      else
        await mutation("/api/admin/cafes/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids,
            all,
            expectedCount: state.cafes.length,
            confirmation: all ? "HAPUS SEMUA DATA" : "HAPUS PILIHAN",
          }),
        });
      $("#confirmDialog").close();
      await loadCafes();
    } catch (e) {
      $("#confirmMessage").textContent = e.message;
      b.disabled = false;
    } finally {
      b.textContent = "Hapus sekarang";
    }
  });
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.submitter;
    b.disabled = true;
    $("#loginError").textContent = "";
    try {
      await request("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nyambung-Admin": "1",
        },
        body: JSON.stringify({ password: $("#loginPassword").value }),
      });
      $("#loginPassword").value = "";
      await boot();
    } catch (err) {
      $("#loginError").textContent = err.message || "Login gagal.";
    } finally {
      b.disabled = false;
    }
  });
  async function boot() {
    try {
      const s = await request("/api/admin/session");
      $("#loginView").hidden = !!s?.authenticated;
      $("#dashboardView").hidden = !s?.authenticated;
      $("#adminNav").hidden = !s?.authenticated;
      if (s?.authenticated) await loadCafes();
    } catch (e) {
      $("#loginView").hidden = false;
      $("#dashboardView").hidden = true;
      $("#loginError").textContent = e.message;
    }
  }
  $("#logoutButton").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      await mutation("/api/admin/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } finally {
      location.reload();
    }
  });
  $("#newCafeButton").addEventListener("click", () => showForm());
  $("#cafeSearch").addEventListener("input", (e) => {
    state.filter = e.target.value.trim().toLowerCase();
    render();
  });
  $("#selectAllVisible").addEventListener("change", (e) => {
    visibleCafes().forEach((c) =>
      e.target.checked
        ? state.selected.add(String(c.id))
        : state.selected.delete(String(c.id)),
    );
    render();
  });
  $("#bulkDeleteButton").addEventListener("click", () =>
    openConfirm({
      cafes: state.cafes.filter((c) => state.selected.has(String(c.id))),
    }),
  );
  $("#deleteAllButton").addEventListener("click", () =>
    openConfirm({ all: true, cafes: state.cafes }),
  );
  $("#cafeList").addEventListener("change", (e) => {
    if (e.target.matches("[data-select]")) {
      const id = e.target.dataset.select;
      e.target.checked ? state.selected.add(id) : state.selected.delete(id);
      updateSelectionUI();
    }
  });
  $("#cafeList").addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit)
      return showForm(
        state.cafes.find((c) => String(c.id) === edit.dataset.edit),
      );
    const btn = e.target.closest("[data-delete]");
    if (!btn) return;
    const cafe = state.cafes.find((c) => String(c.id) === btn.dataset.delete);
    if (cafe) openConfirm({ cafes: [cafe], single: true });
  });
  $("#cafeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget,
      b = f.querySelector("[type=submit]");
    $("#formError").textContent = "";
    let uploaded = null;
    try {
      const password = f.elements.password.value.trim();
      if (
        (password ||
          (state.editing?.password &&
            !f.elements.removePassword.checked &&
            f.elements.wifiConsent.checked)) &&
        !f.elements.wifiConsent.checked
      )
        throw new Error(
          "Centang persetujuan sebelum membagikan password Wi-Fi.",
        );
      const d = readForm();
      if (d.mapUrl) {
        const u = new URL(d.mapUrl);
        if (!["http:", "https:"].includes(u.protocol))
          throw new Error("Link Maps harus berupa URL http:// atau https://.");
      }
      if (d.photoUrl) {
        const photoUrl = new URL(d.photoUrl);
        if (photoUrl.protocol !== "https:")
          throw new Error("URL foto harus menggunakan HTTPS.");
      }
      b.disabled = true;
      b.textContent = "Menyimpan…";
      uploaded = await uploadPending();
      if (uploaded) {
        d.photoKey = uploaded.photoKey;
        d.photoUrl = "";
      }
      const id = f.elements.id.value;
      await mutation(
        id ? `/api/admin/cafes/${encodeURIComponent(id)}` : "/api/admin/cafes",
        {
          method: id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(d),
        },
      );
      $("#cafeDialog").close();
      await loadCafes();
    } catch (err) {
      if (uploaded?.photoKey) {
        try {
          await mutation("/api/admin/photos", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photoKey: uploaded.photoKey }),
          });
        } catch (cleanupError) {
          console.warn("Photo cleanup failed", cleanupError);
        }
      }
      $("#formError").textContent = err.message || "Gagal menyimpan.";
    } finally {
      b.disabled = false;
      b.textContent = "Simpan perubahan";
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) $("#cafeDialog").close();
  });
  window.__NyambungAdmin = {
    setPendingUpload(file) {
      state.pendingUpload = file;
    },
  };
  boot();
})();
