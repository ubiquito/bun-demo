// The Flight Deck — plain modern JavaScript, zero dependencies, bundled by
// Bun's HTML import the moment the server does `import dashboard from "./ui/index.html"`.

// ---------- small utilities ----------

const $ = sel => document.querySelector(sel);

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const fmt = {
  ms: n => (n < 1 ? `${(n * 1000).toFixed(0)} µs` : n < 1000 ? `${n.toFixed(n < 10 ? 2 : 1)} ms` : `${(n / 1000).toFixed(2)} s`),
  us: n => (n < 1000 ? `${n.toFixed(1)} µs` : fmt.ms(n / 1000)),
  bytes: n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`),
  int: n => Math.round(n).toLocaleString("en-US"),
  count: (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`,
  clock: s => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
  },
  until: iso => {
    const d = (new Date(iso).getTime() - Date.now()) / 1000;
    if (d <= 1) return "now";
    if (d < 90) return `in ${Math.round(d)}s`;
    if (d < 5400) return `in ${Math.round(d / 60)}m`;
    return `in ${(d / 3600).toFixed(1)}h`;
  },
};

const debounce = (fn, wait) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
};

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Button + result-area lifecycle for every async deck action.
async function run(button, out, workingText, task) {
  button.disabled = true;
  out.setAttribute("aria-busy", "true");
  out.replaceChildren(el("p", "working mono", workingText));
  try {
    await task();
  } catch (err) {
    out.replaceChildren(el("p", "deck-error", `transmission lost — ${err.message}`));
  } finally {
    out.removeAttribute("aria-busy");
    button.disabled = false;
  }
}

// Horizontal per-step timing bars, width scaled to the slowest step.
function timingBars(steps) {
  const max = Math.max(...steps.map(s => s.ms), 0.0001);
  const box = el("div", "bars");
  const fills = [];
  for (const s of steps) {
    const row = el("div", "bar-row");
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill");
    track.append(fill);
    fills.push([fill, Math.max((s.ms / max) * 100, 1.5)]);
    row.append(el("span", "bar-label", s.label), track, el("span", "bar-ms mono", fmt.ms(s.ms)));
    box.append(row);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const [fill, pct] of fills) fill.style.width = `${pct}%`;
  }));
  return box;
}

function countUp(node, target, format, unit) {
  const t0 = performance.now(), dur = 900;
  const step = now => {
    const p = Math.min((now - t0) / dur, 1);
    const eased = 1 - (1 - p) ** 3;
    node.replaceChildren(format(target * eased), el("span", "unit", unit));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- SGR (ANSI) → colored <span>s, shared by Comms Bay and Engine Room ----------

const ANSI16 = [
  "#3b4252", "#f87171", "#6ee7b7", "#fde68a", "#7dd3fc", "#f9a8d4", "#67e8f9", "#e2e8f0",
  "#64748b", "#fca5a5", "#a7f3d0", "#fef08a", "#bae6fd", "#fbcfe8", "#a5f3fc", "#f8fafc",
];

function xterm256(n) {
  if (n < 16) return ANSI16[n];
  if (n < 232) {
    const l = [0, 95, 135, 175, 215, 255], k = n - 16;
    return `rgb(${l[(k / 36) | 0]} ${l[((k / 6) | 0) % 6]} ${l[k % 6]})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v} ${v} ${v})`;
}

// Matches SGR sequences (captured), or any other escape sequence (dropped).
const ESCAPES = /\x1b\[([\d;]*)m|\x1b\[[\d;?]*[@-ln-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b./g;

function renderAnsi(text) {
  const frag = document.createDocumentFragment();
  const st = { bold: false, dim: false, italic: false, underline: false, fg: null, bg: null };
  const emit = chunk => {
    if (!chunk) return;
    const span = el("span", null, chunk);
    if (st.fg) span.style.color = st.fg;
    if (st.bg) span.style.backgroundColor = st.bg;
    if (st.bold) span.style.fontWeight = "700";
    if (st.dim) span.style.opacity = "0.6";
    if (st.italic) span.style.fontStyle = "italic";
    if (st.underline) span.style.textDecoration = "underline";
    frag.append(span);
  };
  const apply = params => {
    const p = params.split(";").map(s => (s === "" ? 0 : Number(s)));
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === 0) Object.assign(st, { bold: false, dim: false, italic: false, underline: false, fg: null, bg: null });
      else if (c === 1) st.bold = true;
      else if (c === 2) st.dim = true;
      else if (c === 3) st.italic = true;
      else if (c === 4) st.underline = true;
      else if (c === 22) st.bold = st.dim = false;
      else if (c === 23) st.italic = false;
      else if (c === 24) st.underline = false;
      else if (c >= 30 && c <= 37) st.fg = ANSI16[c - 30];
      else if (c >= 90 && c <= 97) st.fg = ANSI16[c - 82];
      else if (c === 39) st.fg = null;
      else if (c >= 40 && c <= 47) st.bg = ANSI16[c - 40];
      else if (c >= 100 && c <= 107) st.bg = ANSI16[c - 92];
      else if (c === 49) st.bg = null;
      else if (c === 38 || c === 48) {
        const set = v => (c === 38 ? (st.fg = v) : (st.bg = v));
        if (p[i + 1] === 5) { set(xterm256(p[i + 2] ?? 0)); i += 2; }
        else if (p[i + 1] === 2) { set(`rgb(${p[i + 2] | 0} ${p[i + 3] | 0} ${p[i + 4] | 0})`); i += 4; }
      }
    }
  };
  let last = 0;
  for (const m of text.matchAll(ESCAPES)) {
    emit(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) apply(m[1]);
  }
  emit(text.slice(last));
  return frag;
}

// ---------- markdown airlock ----------
// Bun.markdown.html is faithful to CommonMark: raw HTML in the source passes
// straight through. The Comms Bay textarea is live user input, so everything
// coming back from the renderer clears decontamination before touching the DOM —
// no script-capable elements, no on* handlers, no javascript: hatches.

const QUARANTINED = /^(?:script|style|iframe|object|embed|link|meta|base|form)$/;
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction"]);
const BAD_SCHEME = /^(?:javascript|vbscript|data):/i;

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const node of [...doc.querySelectorAll("*")]) {
    if (QUARANTINED.test(node.localName)) { node.remove(); continue; }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const scheme = attr.value.replace(/[\u0000-\u0020]/g, ""); // browsers ignore control chars in schemes; so do we
      if (name.startsWith("on") || (URL_ATTRS.has(name) && BAD_SCHEME.test(scheme))) {
        node.removeAttribute(attr.name);
      }
    }
  }
  return [...doc.body.childNodes];
}

// ---------- sparklines ----------

function sparkline(canvas, color) {
  const ctx = canvas.getContext("2d");
  const data = [];
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    const min = Math.min(...data), max = Math.max(...data);
    const span = max - min || 1;
    const pad = 4;
    const x = i => (i / 59) * (w - 2) + 1;
    const y = v => h - pad - ((v - min) / span) * (h - 2 * pad);
    const start = 60 - data.length; // right-anchored: the window slides in from the right
    ctx.beginPath();
    data.forEach((v, i) => (i === 0 ? ctx.moveTo(x(start + i), y(v)) : ctx.lineTo(x(start + i), y(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineTo(x(59), h);
    ctx.lineTo(x(start), h);
    ctx.closePath();
    ctx.fillStyle = color + "26";
    ctx.fill();
  };
  return {
    push(v) {
      data.push(v);
      if (data.length > 60) data.shift();
      draw();
    },
    redraw: draw,
  };
}

// ---------- WebSocket link ----------

function connectWS(onFrame, onState) {
  let delay = 500;
  let sock;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const open = () => {
    sock = new WebSocket(url);
    sock.onopen = () => { delay = 500; onState(true); };
    sock.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && typeof msg.type === "string") onFrame(msg);
    };
    sock.onclose = () => {
      onState(false);
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 8000);
    };
    sock.onerror = () => sock.close();
  };
  open();
  return { send: obj => { if (sock?.readyState === 1) sock.send(JSON.stringify(obj)); } };
}

// ---------- init ----------

function init() {
  // -- ship status strip --
  const shipLine = $("#ship-line");
  const deckDots = $("#deck-dots");
  let startedAt = null;

  const DECK_META = {
    photonOven: ["oven", "photon-oven"],
    observationDeck: ["obs", "observation-deck"],
    commsBay: ["comms", "comms"],
    chronometer: ["chron", "chronometer"],
    engineRoom: ["engine", "engine-room"],
    cargoHold: ["cargo", "cargo-hold"],
    reactor: ["reactor", "reactor"],
  };

  const uptimeSpan = el("span");
  const tickUptime = () => {
    if (startedAt) uptimeSpan.textContent = ` · T+${fmt.clock((Date.now() - startedAt) / 1000)}`;
  };
  setInterval(tickUptime, 1000);

  fetch("/api/status")
    .then(r => r.json())
    .then(status => {
      startedAt = status.startedAt;
      shipLine.replaceChildren(
        `${status.ship} · bun ${status.bun.version} (${status.bun.revision.slice(0, 7)}) · pid ${status.pid}`,
        uptimeSpan,
      );
      tickUptime();
      deckDots.replaceChildren();
      for (const [key, [short, deckAttr]] of Object.entries(DECK_META)) {
        const deck = status.decks[key];
        if (!deck) continue;
        const li = el("li");
        const dot = el("span", `dot${deck.online ? " on" : ""}`);
        li.append(dot, short);
        li.title = deck.note;
        deckDots.append(li);
        const note = document.querySelector(`[data-note="${key}"]`);
        if (note) { note.textContent = deck.note; note.title = deck.note; }
        if (!deck.online) document.querySelector(`[data-deck="${deckAttr}"]`)?.classList.add("offline");
      }
    })
    .catch(() => { shipLine.textContent = "status link down — is the ship still on the pad?"; });

  // -- telemetry --
  const sparks = {
    rss: sparkline($("#spark-rss"), "#f9a8d4"),
    lag: sparkline($("#spark-lag"), "#7dd3fc"),
    rps: sparkline($("#spark-rps"), "#6ee7b7"),
  };
  const reads = { rss: $("#read-rss"), lag: $("#read-lag"), rps: $("#read-rps") };
  const pendings = $("#pendings");
  let lastFrame = null;

  addEventListener("resize", debounce(() => Object.values(sparks).forEach(s => s.redraw()), 150));

  const onTelemetry = f => {
    const rssMb = f.rss / 1048576;
    sparks.rss.push(rssMb);
    reads.rss.value = `${rssMb.toFixed(1)} MB`;
    sparks.lag.push(f.loopLagMs);
    reads.lag.value = `${f.loopLagMs.toFixed(2)} ms`;
    if (lastFrame && f.t > lastFrame.t) {
      const rps = Math.max(0, (f.requestsServed - lastFrame.requestsServed) / ((f.t - lastFrame.t) / 1000));
      sparks.rps.push(rps);
      reads.rps.value = rps < 10 ? rps.toFixed(1) : fmt.int(rps);
    }
    lastFrame = f;
    pendings.textContent = `pending — ${fmt.count(f.pendingRequests, "request")} · ${fmt.count(f.pendingWebSockets, "websocket")}`;
  };

  // -- engine room terminal --
  const screen = $("#term-screen");
  const engineState = $("#engine-state");
  const igniteBtn = $("#ignite-btn");
  const termInput = $("#term-input");
  const utf8 = new TextDecoder();
  let curLine = null;
  let curText = "";

  const sysLine = text => {
    screen.append(el("div", "t-line t-sys", text));
    screen.scrollTop = screen.scrollHeight;
  };
  sysLine("engines cold — press Ignite to spin up a real PTY");

  const newLine = () => {
    curLine = el("div", "t-line");
    curText = "";
    screen.append(curLine);
    while (screen.children.length > 2000) screen.firstChild.remove();
  };
  const renderCur = () => { if (curLine) curLine.replaceChildren(renderAnsi(curText)); };

  const onEngineData = chunk => {
    if (!curLine) newLine();
    // \r rewinds to line start (progress bars); other cursor movement is stripped by the SGR parser.
    for (const part of chunk.split(/(\r\n|\n|\r)/)) {
      if (part === "") continue;
      if (part === "\n" || part === "\r\n") { renderCur(); newLine(); }
      else if (part === "\r") curText = "";
      else curText += part;
    }
    renderCur();
    screen.scrollTop = screen.scrollHeight;
  };

  const b64ToBytes = b64 => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  const onEngine = msg => {
    if (msg.type === "engine/data") {
      onEngineData(utf8.decode(b64ToBytes(msg.data), { stream: true }));
    } else if (msg.type === "engine/exit") {
      curLine = null;
      sysLine(`— engine shut down (exit ${msg.code ?? "signal"}) —`);
      engineState.textContent = "engines cold";
      igniteBtn.disabled = false;
      termInput.disabled = true;
    }
  };

  // -- the shared socket --
  const linkDot = $("#link-dot");
  let sock = { send: () => {} };
  if (typeof WebSocket === "undefined") {
    pendings.textContent = "this browser has no WebSocket — telemetry stays dark";
    linkDot.classList.add("down");
  } else {
    sock = connectWS(
      msg => {
        if (msg.type === "telemetry") onTelemetry(msg);
        else if (msg.type.startsWith("engine/")) onEngine(msg);
      },
      up => {
        linkDot.classList.toggle("up", up);
        linkDot.classList.toggle("down", !up);
        if (!up) pendings.textContent = "telemetry link down — re-establishing…";
      },
    );
  }

  igniteBtn.addEventListener("click", () => {
    screen.replaceChildren();
    curLine = null;
    newLine();
    sock.send({ type: "engine/start" });
    sock.send({ type: "engine/resize", cols: Math.max(20, Math.floor(screen.clientWidth / 8.2)), rows: 24 });
    engineState.textContent = "engines hot";
    igniteBtn.disabled = true;
    termInput.disabled = false;
    termInput.focus();
  });

  termInput.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    sock.send({ type: "engine/write", data: termInput.value + "\n" });
    termInput.value = "";
  });

  // -- photon oven --
  const bakeBtn = $("#bake-btn");
  const ovenOut = $("#oven-out");
  bakeBtn.addEventListener("click", () => run(bakeBtn, ovenOut, "proofing photons…", async () => {
    const rep = await postJSON("/api/oven/bake", { width: 512 });
    const strip = el("div", "oven-strip");

    const lqip = el("figure", "lqip");
    const lqipImg = el("img");
    lqipImg.src = rep.placeholder;
    lqipImg.alt = "Low-quality inline placeholder of the nebula";
    lqip.append(lqipImg, el("figcaption", null, `placeholder · ${fmt.bytes(rep.placeholder.length)} inline data URL · loads before any request`));
    strip.append(lqip);

    for (const o of rep.outputs) {
      const fig = el("figure");
      const img = el("img");
      img.src = `/api/oven/asset/${encodeURIComponent(o.name)}`;
      img.alt = o.op;
      img.loading = "lazy";
      const cap = el("figcaption", null, `${o.format} · ${o.width}×${o.height} · ${fmt.bytes(o.bytes)} · ${fmt.ms(o.ms)}`);
      if (o.fallback) cap.append(el("div", "fallback-note", o.fallback));
      fig.append(img, cap);
      strip.append(fig);
    }

    ovenOut.replaceChildren(
      strip,
      el("p", "source-line mono",
        `source ${rep.source.name} · ${rep.source.width}×${rep.source.height} ${rep.source.format} · ${fmt.bytes(rep.source.bytes)} → full pipeline in ${fmt.ms(rep.totalMs)}`),
      timingBars(rep.outputs.map(o => ({ label: o.op, ms: o.ms }))),
    );
  }));

  // -- observation deck --
  const snapBtn = $("#snap-btn");
  const obsOut = $("#obs-out");
  snapBtn.addEventListener("click", () => run(snapBtn, obsOut, "extending the camera boom…", async () => {
    const rep = await postJSON("/api/observation/snapshot", {});
    if (!rep.ok) {
      obsOut.replaceChildren(el("p", "deck-idle", rep.reason ?? "the observation deck is quiet today"));
      return;
    }
    const fig = el("figure", "snapshot");
    const img = el("img");
    img.src = `/api/observation/asset/${encodeURIComponent(rep.asset.name)}`;
    img.alt = `Screenshot of ${rep.title ?? rep.url}`;
    const facts = rep.evaluated ? ` · evaluated: ${Object.entries(rep.evaluated).map(([k, v]) => `${k}=${v}`).join(", ")}` : "";
    fig.append(img, el("figcaption", null,
      `recursion achieved — ${rep.asset.width}×${rep.asset.height} · ${fmt.bytes(rep.asset.bytes)} · via ${rep.backend ?? "webview"}${facts}`));
    obsOut.replaceChildren(fig, timingBars([
      { label: "spawn browser", ms: rep.timings.spawnMs },
      { label: "navigate", ms: rep.timings.navigateMs },
      { label: "screenshot", ms: rep.timings.screenshotMs },
    ]));
  }));

  // -- comms bay --
  const commsSrc = $("#comms-src");
  const commsHtml = $("#comms-html");
  const commsAnsi = $("#comms-ansi");
  const commsHtmlUs = $("#comms-html-us");
  const commsAnsiUs = $("#comms-ansi-us");
  const renderComms = async () => {
    try {
      const rep = await postJSON("/api/comms/render", { markdown: commsSrc.value });
      // Our own server, but not only our own markdown — the textarea is
      // anyone's pen, so the transmission goes through the airlock first.
      commsHtml.replaceChildren(...sanitizeHtml(rep.html));
      commsAnsi.replaceChildren(renderAnsi(rep.ansi));
      commsHtmlUs.textContent = `Bun.markdown.html · ${fmt.us(rep.timings.htmlUs)} for ${fmt.int(rep.chars)} chars`;
      commsAnsiUs.textContent = `Bun.markdown.ansi · ${fmt.us(rep.timings.ansiUs)}`;
    } catch (err) {
      commsHtmlUs.textContent = `comms static — ${err.message}`;
      commsAnsiUs.textContent = "";
    }
  };
  commsSrc.addEventListener("input", debounce(renderComms, 150));
  renderComms();

  // -- chronometer --
  const cronExpr = $("#cron-expr");
  const cronOut = $("#cron-out");
  const scanWindows = async () => {
    try {
      const res = await fetch(`/api/chronometer/windows?expr=${encodeURIComponent(cronExpr.value.trim())}&count=5`);
      const rep = await res.json();
      if (!rep.valid) {
        cronOut.replaceChildren(el("p", "cron-error", rep.error ?? "that schedule doesn't parse — the chronometer squints at it"));
        return;
      }
      const list = el("ul", "cron-list");
      for (const iso of rep.next) {
        const li = el("li");
        const until = el("span", "until", fmt.until(iso));
        until.dataset.until = iso;
        li.append(el("span", "when", new Date(iso).toLocaleString(undefined, {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
        })), until);
        list.append(li);
      }
      cronOut.replaceChildren(list);
      if (rep.jobs?.length) {
        cronOut.append(el("p", "cron-jobs mono",
          `live jobs — ${rep.jobs.map(j => `${j.name} (${j.expr}) ×${j.runs}`).join(" · ")}`));
      }
    } catch (err) {
      cronOut.replaceChildren(el("p", "deck-error", `chronometer unreachable — ${err.message}`));
    }
  };
  cronExpr.addEventListener("input", debounce(scanWindows, 250));
  scanWindows();
  setInterval(() => {
    document.querySelectorAll("[data-until]").forEach(node => { node.textContent = fmt.until(node.dataset.until); });
  }, 1000);

  // -- cargo hold --
  const cargoBtn = $("#cargo-btn");
  const cargoOut = $("#cargo-out");
  cargoBtn.addEventListener("click", () => run(cargoBtn, cargoOut, "opening the hold…", async () => {
    const rep = await postJSON("/api/cargo/inspect", {});
    const table = el("table", "cargo-table");
    const head = el("tr");
    for (const h of ["dialect", "sample", "parse", ""]) head.append(el("th", null, h));
    table.append(head);
    for (const d of rep.dialects) {
      const tr = el("tr");
      tr.append(
        el("td", "mono", d.name),
        el("td", "sample", d.sample),
        el("td", "us", fmt.us(d.parseUs)),
        (() => { const td = el("td"); td.append(el("span", `ok-dot${d.ok ? "" : " bad"}`)); return td; })(),
      );
      table.append(tr);
    }
    const a = rep.archive;
    const card = el("div", "archive-card");
    card.append(el("h3", null, `${a.name} · ${a.format} · ${fmt.bytes(a.bytes)}`));
    const files = el("ul", "archive-files");
    for (const f of a.files) files.append(el("li", null, `${f.path} — ${fmt.bytes(f.size)}`));
    card.append(
      files,
      timingBars([{ label: "pack", ms: a.packMs }, { label: "extract", ms: a.extractMs }]),
      el("p", `archive-verdict ${a.roundtripOk ? "verdict-ok" : "verdict-bad"}`,
        a.roundtripOk ? "roundtrip verified — every byte came home" : "roundtrip mismatch — cargo lost in transit"),
    );
    cargoOut.replaceChildren(table, card);
  }));

  // -- reactor --
  const burstBtn = $("#burst-btn");
  const burstOut = $("#burst-out");
  burstBtn.addEventListener("click", () => run(burstBtn, burstOut, "feeding the reactor for 2 seconds…", async () => {
    const rep = await postJSON("/api/reactor/burst", { durationMs: 2000 });
    const big = el("p", "big-number");
    burstOut.replaceChildren(
      big,
      el("p", "burst-sub mono",
        `${fmt.int(rep.requests)} requests in ${fmt.ms(rep.durationMs)} · concurrency ${rep.concurrency} · ${fmt.bytes(rep.bytesMoved)} moved`),
      timingBars([
        { label: "latency p50", ms: rep.latency.p50Ms },
        { label: "latency p99", ms: rep.latency.p99Ms },
        { label: "latency max", ms: rep.latency.maxMs },
      ]),
    );
    countUp(big, rep.reqPerSec, v => fmt.int(v), "req/s");
  }));

  const raceBtn = $("#race-btn");
  const raceOut = $("#race-out");
  raceBtn.addEventListener("click", () => run(raceBtn, raceOut, "rolling both engines to the start line…", async () => {
    const rep = await postJSON("/api/reactor/startup-race", {});
    const lanes = el("div", "race-lanes");
    const maxMedian = Math.max(...rep.lanes.filter(l => l.available).map(l => l.medianMs), 0.0001);
    const fills = [];
    for (const lane of rep.lanes) {
      const isBun = /^bun/i.test(lane.runtime);
      const row = el("div", `lane ${isBun ? "lane-bun" : "lane-other"}${lane.available ? "" : " unavailable"}`);
      const head = el("div", "lane-head");
      head.append(
        el("span", "lane-name", lane.runtime),
        el("span", "lane-time mono", lane.available
          ? `median ${fmt.ms(lane.medianMs)} · best ${fmt.ms(lane.bestMs)}`
          : "not aboard this vessel"),
      );
      const track = el("div", "lane-track");
      const fill = el("div", "lane-fill");
      track.append(fill);
      if (lane.available) fills.push([fill, Math.max((lane.medianMs / maxMedian) * 100, 2)]);
      row.append(head, track);
      lanes.append(row);
    }
    raceOut.replaceChildren(lanes, el("p", "race-note", `${rep.note} · ${rep.runs} runs each, cold starts, this machine`));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const [fill, pct] of fills) fill.style.width = `${pct}%`;
    }));
  }));
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
