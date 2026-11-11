(() => {
  "use strict";

  const ORIGIN = "https://speed.cloudflare.com";
  const REQUEST_TIMEOUT_MS = 20000;
  const NO_CACHE = { cache: "no-store", mode: "cors", credentials: "omit" };
  const PLANS = {
    balanced: {
      downloads: [1000000, 3000000, 6000000],
      uploads: [500000, 1500000, 3000000],
    },
    thorough: {
      downloads: [2000000, 6000000, 12000000, 20000000],
      uploads: [1000000, 3000000, 6000000],
    },
  };

  function median(values) {
    if (!values.length) return 0;
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2
      ? ordered[middle]
      : (ordered[middle - 1] + ordered[middle]) / 2;
  }

  function rateMbps(bytes, milliseconds) {
    return milliseconds > 0 ? (bytes * 8) / milliseconds / 1000 : 0;
  }

  function abortError(message = "Tes dibatalkan.") {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }

  async function timedFetch(url, options = {}, parentSignal) {
    const controller = new AbortController();
    const started = performance.now();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) throw abortError();
      parentSignal.addEventListener("abort", forwardAbort, { once: true });
    }
    try {
      const response = await fetch(url, {
        ...NO_CACHE,
        ...options,
        signal: controller.signal,
      });
      const headersAt = performance.now();
      if (!response.ok)
        throw new Error(
          `Layanan speed test memberi respons ${response.status}.`,
        );
      const data = await response.arrayBuffer();
      return {
        data,
        headerMs: headersAt - started,
        elapsedMs: performance.now() - started,
      };
    } catch (error) {
      if (parentSignal?.aborted) throw abortError();
      if (error?.name === "AbortError") {
        throw new Error(
          timedOut
            ? "Permintaan terlalu lama; coba lagi saat koneksi lebih stabil."
            : "Tes dibatalkan.",
        );
      }
      if (error instanceof TypeError)
        throw new Error(
          "Layanan speed test tidak dapat dijangkau. Periksa koneksi lalu coba lagi.",
        );
      throw error;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", forwardAbort);
    }
  }

  async function getNetworkInfo(signal) {
    try {
      const response = await fetch("/api/network", {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
      if (!response.ok)
        return {
          provider: null,
          asn: null,
          city: null,
          country: null,
          colo: null,
        };
      const data = await response.json();
      return {
        provider: data?.provider || null,
        asn: data?.asn || null,
        city: data?.city || null,
        country: data?.country || null,
        colo: data?.colo || null,
      };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return {
        provider: null,
        asn: null,
        city: null,
        country: null,
        colo: null,
      };
    }
  }

  async function run(onProgress = () => {}, options = {}) {
    const mode = options?.mode === "thorough" ? "thorough" : "balanced";
    const signal = options?.signal;
    const plan = PLANS[mode];
    const pingSamples = [];
    const downloadRates = [];
    const uploadRates = [];
    let bytesUsed = 0;
    const totalSteps = 1 + 5 + plan.downloads.length + plan.uploads.length;
    let step = 0;
    const progress = (phase, text) =>
      onProgress({
        phase,
        text,
        progress: Math.min(99, Math.round((step / totalSteps) * 100)),
      });
    const advance = () => {
      step += 1;
    };
    if (signal?.aborted) throw abortError();

    progress("warmup", "Menyiapkan koneksi…");
    await timedFetch(
      `${ORIGIN}/__down?bytes=0&nyambung=warmup-${Date.now()}`,
      {},
      signal,
    );
    advance();

    for (let i = 0; i < 5; i += 1) {
      progress("ping", `Mengukur ping (${i + 1}/5)…`);
      const sample = await timedFetch(
        `${ORIGIN}/__down?bytes=0&nyambung=ping-${Date.now()}-${i}`,
        {},
        signal,
      );
      pingSamples.push(sample.headerMs);
      advance();
    }

    for (let i = 0; i < plan.downloads.length; i += 1) {
      const bytes = plan.downloads[i];
      progress(
        "download",
        `Mengukur download (${i + 1}/${plan.downloads.length})…`,
      );
      const sample = await timedFetch(
        `${ORIGIN}/__down?bytes=${bytes}&nyambung=down-${Date.now()}-${i}`,
        {},
        signal,
      );
      const received = sample.data.byteLength || bytes;
      bytesUsed += received;
      downloadRates.push(rateMbps(received, sample.elapsedMs));
      advance();
    }

    for (let i = 0; i < plan.uploads.length; i += 1) {
      const bytes = plan.uploads[i];
      progress("upload", `Mengukur upload (${i + 1}/${plan.uploads.length})…`);
      const payload = new Uint8Array(bytes);
      const sample = await timedFetch(
        `${ORIGIN}/__up?nyambung=up-${Date.now()}-${i}`,
        { method: "POST", body: payload },
        signal,
      );
      bytesUsed += bytes;
      uploadRates.push(rateMbps(bytes, sample.elapsedMs));
      advance();
    }

    const pingMs = median(pingSamples);
    const jitterMs =
      pingSamples.length > 1
        ? median(
            pingSamples
              .slice(1)
              .map((value, index) => Math.abs(value - pingSamples[index])),
          )
        : 0;
    const network = await getNetworkInfo(signal);
    onProgress({ phase: "done", text: "Tes selesai.", progress: 100 });
    return {
      downloadMbps: Math.round(median(downloadRates) * 10) / 10,
      uploadMbps: Math.round(median(uploadRates) * 10) / 10,
      pingMs: Math.round(pingMs * 10) / 10,
      jitterMs: Math.round(jitterMs * 10) / 10,
      provider: network.provider,
      asn: network.asn,
      measuredAt: new Date().toISOString(),
      bytesUsed,
      samples: {
        pingMs: pingSamples,
        downloadMbps: downloadRates,
        uploadMbps: uploadRates,
      },
    };
  }

  window.NyambungSpeedTest = run;
  window.NyambungNetworkInfo = getNetworkInfo;
})();
