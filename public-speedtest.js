(() => {
  "use strict";

  const button = document.querySelector("#publicSpeedTestButton");
  const cancel = document.querySelector("#publicSpeedTestCancel");
  const modeSelect = document.querySelector("#publicSpeedTestMode");
  const status = document.querySelector("#publicSpeedTestStatus");
  const progress = document.querySelector("#publicSpeedTestProgress");
  const results = document.querySelector("#publicSpeedTestResults");
  const networkInfo = document.querySelector("#networkInfo");
  const summary = document.querySelector("#publicTestSummary");
  if (!button || !status || !progress || !window.NyambungSpeedTest) return;

  const put = (id, value) => {
    const node = document.querySelector(id);
    if (node) node.textContent = value;
  };
  const formatBytes = (bytes) =>
    bytes >= 1000000
      ? `${(bytes / 1000000).toFixed(1)} MB`
      : `${Math.round(bytes / 1000)} KB`;
  const connectionType = () =>
    navigator.connection?.effectiveType
      ? `Jenis koneksi browser: ${navigator.connection.effectiveType}.`
      : "";

  function showNetwork(info) {
    if (!networkInfo) return;
    const identity = [info?.provider, info?.asn ? `ASN ${info.asn}` : ""]
      .filter(Boolean)
      .join(" · ");
    const place = [
      info?.city,
      info?.country,
      info?.colo ? `colo ${info.colo}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    networkInfo.textContent = identity
      ? `Jaringan terdeteksi: ${identity}${place ? ` (${place})` : ""}. ${connectionType()}`
      : `Penyedia jaringan tidak teridentifikasi oleh metadata Cloudflare. ${connectionType()} Ini bukan nama ISP yang dipastikan.`;
  }

  function loadNetworkInfo() {
    if (!window.NyambungNetworkInfo) {
      showNetwork({});
      return;
    }
    window
      .NyambungNetworkInfo()
      .then(showNetwork)
      .catch(() => showNetwork({}));
  }

  let activeController = null;
  let running = false;
  loadNetworkInfo();

  if (modeSelect) {
    modeSelect.title =
      "Balanced memakai hingga 15 MB; Thorough memakai hingga 50 MB gabungan download dan upload.";
  }

  if (cancel) {
    cancel.hidden = true;
    cancel.addEventListener("click", () => activeController?.abort());
  }

  button.addEventListener("click", async () => {
    if (running) return;
    running = true;
    activeController = new AbortController();
    const mode = modeSelect?.value === "thorough" ? "thorough" : "balanced";
    const upperBound = mode === "thorough" ? "50 MB" : "15 MB";
    button.disabled = true;
    if (cancel) {
      cancel.hidden = false;
      cancel.disabled = false;
    }
    results && (results.hidden = true);
    if (summary) summary.textContent = "";
    progress.hidden = false;
    progress.value = 0;
    status.className = "speedtest-status";
    status.textContent = `Menyiapkan tes ${mode} (hingga ${upperBound})…`;
    try {
      const result = await window.NyambungSpeedTest(
        (update) => {
          status.textContent = update.text;
          progress.value = update.progress;
        },
        { signal: activeController.signal, mode },
      );
      put("#publicDownload", Number(result.downloadMbps).toFixed(1));
      put("#publicUpload", Number(result.uploadMbps).toFixed(1));
      put("#publicPing", Number(result.pingMs).toFixed(1));
      put("#publicJitter", Number(result.jitterMs).toFixed(1));
      if (summary) {
        const when = new Date(result.measuredAt).toLocaleString("id-ID");
        const downloadHint =
          result.downloadMbps >= 25
            ? "cukup longgar untuk video HD pada satu perangkat"
            : result.downloadMbps >= 5
              ? "umumnya memadai untuk video HD ringan"
              : "mungkin terbatas untuk video HD";
        const latencyHint =
          result.pingMs <= 50
            ? "respons rendah"
            : result.pingMs <= 100
              ? "respons sedang"
              : "respons tinggi";
        summary.textContent = `Diukur ${when}; data terpakai ${formatBytes(result.bytesUsed)}. ${downloadHint}; ${latencyHint}. Ini mengukur throughput HTTP perangkat saat ini, bukan kecepatan jalur mentah secara mutlak.`;
      }
      results && (results.hidden = false);
      status.textContent =
        "Selesai. Hasil mengukur koneksi perangkat ini saat ini.";
      progress.value = 100;
    } catch (error) {
      const cancelled = error?.name === "AbortError";
      status.className = cancelled
        ? "speedtest-status"
        : "speedtest-status error";
      status.textContent = cancelled
        ? "Tes dibatalkan. Hasil sebelumnya tidak dipakai."
        : error?.message || "Speed test gagal. Coba lagi.";
    } finally {
      running = false;
      activeController = null;
      button.disabled = false;
      button.textContent = "Ulangi tes";
      if (cancel) {
        cancel.hidden = true;
        cancel.disabled = true;
      }
      progress.hidden = true;
    }
  });
})();
