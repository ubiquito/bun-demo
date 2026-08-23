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
  bytes: n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1048576).toFixed(2)} MiB`),
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

// ---------- Engine Room VT screen ----------
// Full-screen crews (htop, vim, less) paint with cursor addressing and the
// alternate screen buffer; line mode turns that into soup. This is a compact,
// hand-rolled VT100/xterm grid — main + alt screens, scroll regions, the full
// SGR palette — just enough terminal that htop looks like htop. Reuses the
// ANSI16/xterm256 palette above; touches nothing the Comms Bay renders with.

const TERM_FG = "#cbd5e1"; // matches .term-screen ink
const TERM_BG = "#05060a"; // matches .term-screen hull

// Best-effort width classes — enough for TUI box art, CJK, and the odd emoji.
const WIDE_CH = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF01-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;
const ZERO_CH = /[\u0300-\u036F\u1AB0-\u1AFF\u20D0-\u20FF\u200B-\u200D\uFE00-\uFE0F\uFEFF]/u;

function createVT({ gridEl, respond, pushScrollback, clearScrollback, onAlt, onDirty }) {
  const BASE = Object.freeze({ fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false });
  let cols = 80, rows = 24;
  let cur = { ...BASE };
  let curSnap = BASE;
  const touch = () => { curSnap = Object.freeze({ ...cur }); };
  // BCE: erased cells keep the live background, so full-screen paints look solid.
  const eraseSnap = () => (cur.bg ? Object.freeze({ ...BASE, bg: cur.bg }) : BASE);

  const blankRow = attr => {
    const a = attr ?? BASE, r = new Array(cols);
    for (let i = 0; i < cols; i++) r[i] = { ch: " ", attr: a };
    return r;
  };
  const freshGrid = () => Array.from({ length: rows }, () => blankRow());

  let grid = freshGrid();
  let stash = null; // the main screen, parked while the alt screen is up
  let alt = false;
  let cx = 0, cy = 0, pendingWrap = false;
  let top = 0, bot = rows - 1; // DECSTBM scroll region, inclusive
  let autowrap = true, cursorOn = true, appCursor = false;
  let savedCursor = null; // ESC 7 / CSI s
  let savedMain = null;   // ?1049 / ?1048 cursor stash

  const clampX = x => Math.max(0, Math.min(cols - 1, x));
  const clampY = y => Math.max(0, Math.min(rows - 1, y));

  // -- dirty rows + DOM painting --
  const rowEls = [];
  const dirty = new Set();
  let allDirty = true;
  let lastCaretY = -1;
  const mark = y => dirty.add(y);
  const markAll = () => { allDirty = true; };
  const markRange = (a, b) => { for (let y = a; y <= b; y++) dirty.add(y); };

  const styleSpan = (span, a, caret) => {
    let fg = a.fg, bg = a.bg;
    if (a.inverse !== !!caret) { const f = fg; fg = bg ?? TERM_BG; bg = f ?? TERM_FG; }
    if (fg) span.style.color = fg;
    if (bg) span.style.backgroundColor = bg;
    if (a.bold) span.style.fontWeight = "700";
    if (a.dim) span.style.opacity = "0.65";
    if (a.italic) span.style.fontStyle = "italic";
    if (a.underline) span.style.textDecoration = "underline";
  };

  // Batch runs of identically-styled cells into single spans (plain text for defaults).
  const paintRow = (div, row, caretX) => {
    div.textContent = "";
    let i = 0;
    while (i < row.length) {
      if (i === caretX) {
        const c = row[i];
        const s = el("span", "t-caret", c.ch === "" ? " " : c.ch);
        styleSpan(s, c.attr, true);
        div.append(s);
        i++;
        continue;
      }
      const a = row[i].attr;
      let text = "";
      let j = i;
      while (j < row.length && j !== caretX && row[j].attr === a) { text += row[j].ch; j++; }
      if (a === BASE) div.append(text);
      else { const s = el("span", null, text); styleSpan(s, a); div.append(s); }
      i = j;
    }
  };

  const staticRow = row => {
    const div = el("div", "t-row");
    let end = row.length;
    while (end > 0 && row[end - 1].ch === " " && row[end - 1].attr === BASE) end--;
    paintRow(div, row.slice(0, end), -1);
    return div;
  };

  const syncRowEls = () => {
    while (rowEls.length < rows) { const d = el("div", "t-row"); rowEls.push(d); gridEl.append(d); }
    while (rowEls.length > rows) rowEls.pop().remove();
  };

  const render = () => {
    syncRowEls();
    const caretY = cursorOn ? cy : -1;
    if (lastCaretY >= 0) dirty.add(lastCaretY);
    if (caretY >= 0) dirty.add(caretY);
    const todo = allDirty ? rowEls.map((_, y) => y) : [...dirty];
    for (const y of todo) {
      if (y >= 0 && y < rows) paintRow(rowEls[y], grid[y], y === caretY ? clampX(cx) : -1);
    }
    lastCaretY = caretY;
    dirty.clear();
    allDirty = false;
  };

  // -- scrolling --
  const scrollUp = n => {
    for (let k = 0; k < n; k++) {
      const gone = grid[top];
      if (!alt && top === 0) pushScrollback(staticRow(gone));
      grid.splice(top, 1);
      grid.splice(bot, 0, blankRow(eraseSnap()));
    }
    markRange(top, bot);
  };
  const scrollDown = n => {
    for (let k = 0; k < n; k++) {
      grid.splice(bot, 1);
      grid.splice(top, 0, blankRow(eraseSnap()));
    }
    markRange(top, bot);
  };
  const lineFeed = () => {
    pendingWrap = false;
    if (cy === bot) scrollUp(1);
    else cy = clampY(cy + 1);
  };

  // -- printing (DECAWM with the classic deferred wrap at the last column) --
  let lastGlyph = null; // for REP (CSI b) — ncurses leans on it for runs of "|" and spaces
  const putChar = (ch, wide) => {
    lastGlyph = wide ? null : ch;
    if (pendingWrap) { pendingWrap = false; cx = 0; lineFeed(); }
    if (wide && cx === cols - 1) {
      if (autowrap) { cx = 0; lineFeed(); }
      else cx = Math.max(0, cols - 2);
    }
    const row = grid[cy];
    row[cx] = { ch, attr: curSnap };
    if (wide && cx + 1 < cols) row[cx + 1] = { ch: "", attr: curSnap };
    mark(cy);
    const w = wide ? 2 : 1;
    if (cx + w < cols) cx += w;
    else { cx = cols - 1; if (autowrap) pendingWrap = true; }
  };

  const attachCombining = ch => {
    const row = grid[cy];
    const x = pendingWrap ? clampX(cx) : Math.max(0, clampX(cx) - 1);
    const cell = row[x];
    row[x] = { ch: (cell.ch || " ") + ch, attr: cell.attr };
    mark(cy);
  };

  // -- erasing --
  const eraseRowSpan = (y, x0, x1) => {
    const a = eraseSnap(), row = grid[y];
    for (let x = Math.max(0, x0); x <= Math.min(cols - 1, x1); x++) row[x] = { ch: " ", attr: a };
    mark(y);
  };
  const eraseLine = mode => {
    if (mode === 1) eraseRowSpan(cy, 0, clampX(cx));
    else if (mode === 2) eraseRowSpan(cy, 0, cols - 1);
    else eraseRowSpan(cy, clampX(cx), cols - 1);
  };
  const eraseDisplay = mode => {
    if (mode === 3) { if (!alt) clearScrollback(); mode = 2; }
    if (mode === 1) {
      for (let y = 0; y < cy; y++) eraseRowSpan(y, 0, cols - 1);
      eraseRowSpan(cy, 0, clampX(cx));
    } else if (mode === 2) {
      for (let y = 0; y < rows; y++) eraseRowSpan(y, 0, cols - 1);
    } else {
      eraseRowSpan(cy, clampX(cx), cols - 1);
      for (let y = cy + 1; y < rows; y++) eraseRowSpan(y, 0, cols - 1);
    }
  };

  // -- line & char surgery (IL/DL/ICH/DCH/ECH), honoring the scroll region --
  const insertLines = n => {
    if (cy < top || cy > bot) return;
    for (let k = 0; k < n; k++) { grid.splice(bot, 1); grid.splice(cy, 0, blankRow(eraseSnap())); }
    markRange(cy, bot);
  };
  const deleteLines = n => {
    if (cy < top || cy > bot) return;
    for (let k = 0; k < n; k++) { grid.splice(cy, 1); grid.splice(bot, 0, blankRow(eraseSnap())); }
    markRange(cy, bot);
  };
  const insertChars = n => {
    const a = eraseSnap(), row = grid[cy], x = clampX(cx);
    const blanks = Array.from({ length: Math.min(n, cols - x) }, () => ({ ch: " ", attr: a }));
    row.splice(x, 0, ...blanks);
    row.length = cols;
    mark(cy);
  };
  const deleteChars = n => {
    const a = eraseSnap(), row = grid[cy], x = clampX(cx);
    row.splice(x, Math.min(n, cols - x));
    while (row.length < cols) row.push({ ch: " ", attr: a });
    mark(cy);
  };
  const eraseChars = n => eraseRowSpan(cy, clampX(cx), clampX(cx) + n - 1);

  // -- main ⇄ alternate screen (smcup/rmcup) --
  const enterAlt = saveCur => {
    if (alt) return;
    if (saveCur) savedMain = { cx, cy, attr: curSnap };
    stash = { grid, top, bot };
    grid = freshGrid();
    alt = true;
    top = 0; bot = rows - 1; cx = 0; cy = 0; pendingWrap = false;
    onAlt(true);
    markAll();
  };
  const exitAlt = restoreCur => {
    if (!alt) return;
    ({ grid, top, bot } = stash);
    stash = null;
    alt = false;
    pendingWrap = false;
    top = Math.min(top, rows - 1);
    bot = Math.min(bot, rows - 1);
    if (restoreCur && savedMain) {
      cx = clampX(savedMain.cx); cy = clampY(savedMain.cy);
      cur = { ...savedMain.attr }; touch();
    } else { cx = clampX(cx); cy = clampY(cy); }
    onAlt(false);
    markAll();
  };

  // -- SGR --
  const applySgr = p => {
    if (!p.length) p = [0];
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === 0) Object.assign(cur, BASE);
      else if (c === 1) cur.bold = true;
      else if (c === 2) cur.dim = true;
      else if (c === 3) cur.italic = true;
      else if (c === 4) cur.underline = true;
      else if (c === 7) cur.inverse = true;
      else if (c === 22) { cur.bold = false; cur.dim = false; }
      else if (c === 23) cur.italic = false;
      else if (c === 24) cur.underline = false;
      else if (c === 27) cur.inverse = false;
      else if (c >= 30 && c <= 37) cur.fg = ANSI16[c - 30];
      else if (c === 39) cur.fg = null;
      else if (c >= 40 && c <= 47) cur.bg = ANSI16[c - 40];
      else if (c === 49) cur.bg = null;
      else if (c >= 90 && c <= 97) cur.fg = ANSI16[c - 82];
      else if (c >= 100 && c <= 107) cur.bg = ANSI16[c - 92];
      else if (c === 38 || c === 48) {
        let v = null;
        if (p[i + 1] === 5) { v = xterm256(p[i + 2] ?? 0); i += 2; }
        else if (p[i + 1] === 2) { v = `rgb(${p[i + 2] | 0} ${p[i + 3] | 0} ${p[i + 4] | 0})`; i += 4; }
        if (c === 38) cur.fg = v; else cur.bg = v;
      }
    }
    touch();
  };

  // -- DEC private modes; the ones we don't emulate are swallowed politely --
  const setMode = (m, on) => {
    if (m === 25) cursorOn = on;
    else if (m === 7) { autowrap = on; if (!on) pendingWrap = false; }
    else if (m === 1) appCursor = on; // DECCKM — arrows switch to SS3 upstairs
    else if (m === 1049) on ? enterAlt(true) : exitAlt(true);
    else if (m === 47 || m === 1047) on ? enterAlt(false) : exitAlt(false);
    else if (m === 1048) {
      if (on) savedMain = { cx, cy, attr: curSnap };
      else if (savedMain) { cx = clampX(savedMain.cx); cy = clampY(savedMain.cy); cur = { ...savedMain.attr }; touch(); }
    }
    // ?2004 bracketed paste, ?1000-1006/1015 mouse, ?12 blink, ?1004 focus,
    // ?2026 sync — acknowledged with a nod and swallowed whole.
  };

  const hardReset = () => {
    cur = { ...BASE }; touch();
    if (alt) exitAlt(false);
    grid = freshGrid();
    cx = 0; cy = 0; top = 0; bot = rows - 1;
    pendingWrap = false; autowrap = true; cursorOn = true; appCursor = false;
    savedCursor = null; savedMain = null;
    markAll();
  };

  const dispatchCsi = (final, params) => {
    if (params.startsWith(">") || params.startsWith("=")) return; // secondary/tertiary DA family
    const priv = params.startsWith("?");
    const raw = (priv ? params.slice(1) : params).replaceAll(":", ";");
    const p = raw.length ? raw.split(";").map(s => (s === "" ? 0 : Math.min(parseInt(s, 10) || 0, 9999))) : [];
    const n = Math.max(p[0] ?? 0, 1);
    switch (final) {
      case "H": case "f": cy = clampY((p[0] || 1) - 1); cx = clampX((p[1] || 1) - 1); pendingWrap = false; break;
      case "A": cy = Math.max(cy >= top ? top : 0, cy - n); pendingWrap = false; break;
      case "B": cy = Math.min(cy <= bot ? bot : rows - 1, cy + n); pendingWrap = false; break;
      case "C": cx = clampX(clampX(cx) + n); pendingWrap = false; break;
      case "D": cx = clampX(clampX(cx) - n); pendingWrap = false; break;
      case "E": cy = Math.min(cy <= bot ? bot : rows - 1, cy + n); cx = 0; pendingWrap = false; break;
      case "F": cy = Math.max(cy >= top ? top : 0, cy - n); cx = 0; pendingWrap = false; break;
      case "G": case "`": cx = clampX((p[0] || 1) - 1); pendingWrap = false; break;
      case "d": cy = clampY((p[0] || 1) - 1); pendingWrap = false; break;
      case "J": eraseDisplay(p[0] ?? 0); break;
      case "K": eraseLine(p[0] ?? 0); break;
      case "L": insertLines(n); break;
      case "M": deleteLines(n); break;
      case "@": insertChars(n); break;
      case "P": deleteChars(n); break;
      case "X": eraseChars(n); break;
      case "b": if (lastGlyph) for (let k = 0; k < Math.min(n, cols); k++) putChar(lastGlyph, false); break; // REP
      case "S": scrollUp(n); break;
      case "T": scrollDown(n); break;
      case "r":
        if (!priv) {
          const t = (p[0] || 1) - 1, b = (p[1] || rows) - 1;
          if (t >= 0 && b < rows && b > t) { top = t; bot = b; cy = 0; cx = 0; pendingWrap = false; }
        }
        break;
      case "m": if (!priv) applySgr(p); break;
      case "h": if (priv) for (const m of p) setMode(m, true); break;
      case "l": if (priv) for (const m of p) setMode(m, false); break;
      case "s": if (!priv) savedCursor = { cx, cy, attr: curSnap }; break;
      case "u":
        if (savedCursor) {
          cx = clampX(savedCursor.cx); cy = clampY(savedCursor.cy);
          cur = { ...savedCursor.attr }; touch(); pendingWrap = false;
        }
        break;
      case "n": // DSR — the two cheap answers a well-mannered terminal gives
        if (p[0] === 6) respond(`\x1b[${cy + 1};${clampX(cx) + 1}R`);
        else if (p[0] === 5) respond("\x1b[0n");
        break;
      case "c": if (!priv) respond("\x1b[?1;2c"); break; // primary DA: VT100 with AVO
      default: break; // t, q, p and other exotics — swallowed, never printed
    }
  };

  // -- the byte-stream state machine (fed decoded text; UTF-8 seams are the
  //    decoder's job upstairs, sequence seams are handled by state carrying over) --
  let state = "ground", csiBuf = "";

  const groundCtl = ch => {
    if (ch === "\r") { cx = 0; pendingWrap = false; }
    else if (ch === "\n" || ch === "\x0b" || ch === "\x0c") lineFeed();
    else if (ch === "\b") { cx = Math.max(0, clampX(cx) - 1); pendingWrap = false; }
    else if (ch === "\t") { cx = Math.min(cols - 1, (Math.floor(cx / 8) + 1) * 8); pendingWrap = false; }
    // BEL, SO/SI, NUL, DEL and the rest of C0: no-ops on this deck
  };

  const feed = text => {
    for (const ch of text) {
      if (state === "ground") {
        if (ch === "\x1b") state = "esc";
        else {
          const code = ch.codePointAt(0);
          if (code < 0x20 || code === 0x7f) groundCtl(ch);
          else if (ZERO_CH.test(ch)) attachCombining(ch);
          else putChar(ch, WIDE_CH.test(ch));
        }
      } else if (state === "esc") {
        state = "ground";
        if (ch === "[") { state = "csi"; csiBuf = ""; }
        else if (ch === "]" || ch === "P" || ch === "X" || ch === "^" || ch === "_") state = "str";
        else if (ch === "(" || ch === ")" || ch === "*" || ch === "+" || ch === "#" || ch === "%") state = "charset";
        else if (ch === "7") savedCursor = { cx, cy, attr: curSnap };
        else if (ch === "8") {
          if (savedCursor) {
            cx = clampX(savedCursor.cx); cy = clampY(savedCursor.cy);
            cur = { ...savedCursor.attr }; touch(); pendingWrap = false;
          }
        }
        else if (ch === "D") lineFeed();
        else if (ch === "M") { pendingWrap = false; if (cy === top) scrollDown(1); else cy = clampY(cy - 1); }
        else if (ch === "E") { cx = 0; lineFeed(); }
        else if (ch === "c") hardReset();
        // '=', '>' keypad modes and unknown escapes: swallowed silently, never printed
      } else if (state === "csi") {
        const code = ch.codePointAt(0);
        if (code >= 0x40 && code <= 0x7e) { state = "ground"; dispatchCsi(ch, csiBuf); }
        else if (code >= 0x20 && code <= 0x3f) { if (csiBuf.length < 64) csiBuf += ch; }
        else if (ch === "\x1b") state = "esc"; // aborted sequence
        else if (code < 0x20) groundCtl(ch);   // C0 inside CSI still executes
        else state = "ground";
      } else if (state === "str") {
        // OSC / DCS / APC / PM / SOS payloads (titles etc.) — swallow to BEL or ST
        if (ch === "\x07") state = "ground";
        else if (ch === "\x1b") state = "strEsc";
      } else if (state === "strEsc") {
        state = ch === "\\" ? "ground" : "str";
      } else { // charset designation: consume the one designator character
        state = "ground";
      }
    }
    onDirty();
  };

  const resize = (newCols, newRows) => {
    newCols = Math.max(20, Math.min(500, newCols | 0));
    newRows = Math.max(5, Math.min(500, newRows | 0));
    if (newCols === cols && newRows === rows) return false;
    cols = newCols; rows = newRows;
    for (const g of stash ? [grid, stash.grid] : [grid]) {
      for (const row of g) {
        if (row.length > cols) row.length = cols;
        else while (row.length < cols) row.push({ ch: " ", attr: BASE });
      }
      while (g.length > rows) g.pop();
      while (g.length < rows) g.push(blankRow());
    }
    top = 0; bot = rows - 1;
    if (stash) { stash.top = 0; stash.bot = rows - 1; }
    cx = clampX(cx); cy = clampY(cy); pendingWrap = false;
    markAll();
    return true;
  };

  const reset = (newCols, newRows) => {
    hardReset();
    resize(newCols, newRows);
    markAll();
  };

  // On engine shutdown: fold what the grid still shows into the scrollback
  // so the flight record survives, then dim the glass.
  const flatten = () => {
    if (alt) exitAlt(true);
    let last = rows - 1;
    const rowBlank = row => row.every(c => c.ch === " " || c.ch === "");
    while (last >= 0 && rowBlank(grid[last])) last--;
    for (let y = 0; y <= last; y++) pushScrollback(staticRow(grid[y]));
    grid = freshGrid();
    cx = 0; cy = 0; pendingWrap = false; cursorOn = false;
    markAll();
  };

  return {
    feed, render, resize, reset, flatten,
    get cols() { return cols; },
    get rows() { return rows; },
    get alt() { return alt; },
    get appCursor() { return appCursor; },
  };
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
    reads.rss.value = `${rssMb.toFixed(1)} MiB`;
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
  const zoomBtn = $("#term-zoom-btn");
  const enginePanel = screen.closest(".panel");
  let utf8 = new TextDecoder(); // streaming: base64 frames may split multibyte chars mid-seam
  let engineLive = false;

  const backlog = el("div", "t-backlog"); // main-screen scrollback + ship notices
  const gridEl = el("div", "t-grid");     // the live VT grid
  screen.append(backlog, gridEl);

  const atBottom = () => screen.scrollTop + screen.clientHeight >= screen.scrollHeight - 12;
  const trimBacklog = () => { while (backlog.children.length > 2000) backlog.firstChild.remove(); };

  const sysLine = text => {
    backlog.append(el("div", "t-line t-sys", text));
    trimBacklog();
    screen.scrollTop = screen.scrollHeight;
  };
  sysLine("engines cold — press Ignite to spin up a real PTY");

  // ~30 fps, rAF-coalesced; the grid only repaints rows that changed.
  let termRaf = 0, lastPaint = 0;
  const paintTerm = now => {
    termRaf = 0;
    if (now - lastPaint < 30) { termRaf = requestAnimationFrame(paintTerm); return; }
    lastPaint = now;
    const stick = vt.alt || atBottom(); // alt screen pins to the grid; main follows the tail politely
    vt.render();
    trimBacklog();
    if (stick) screen.scrollTop = vt.alt ? 0 : screen.scrollHeight;
  };
  const scheduleTerm = () => { if (!termRaf) termRaf = requestAnimationFrame(paintTerm); };

  const vt = createVT({
    gridEl,
    respond: data => sock.send({ type: "engine/write", data }), // DSR/DA answers ride the same line as keystrokes
    pushScrollback: div => backlog.append(div),
    clearScrollback: () => backlog.replaceChildren(),
    onAlt: on => screen.classList.toggle("alt", on),
    onDirty: scheduleTerm,
  });

  // Size the PTY from the glass itself: measure a real character cell, divide.
  const measureGeometry = () => {
    const probe = el("div", "t-probe t-row", "0".repeat(80));
    gridEl.append(probe);
    const rect = probe.getBoundingClientRect();
    probe.remove();
    const cellW = rect.width / 80 || 7.5;
    const cellH = rect.height || 18;
    const cs = getComputedStyle(screen);
    const w = screen.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = screen.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return { cols: Math.max(20, Math.floor(w / cellW)), rows: Math.max(5, Math.floor(h / cellH)) };
  };

  const fitPty = () => {
    const size = measureGeometry();
    vt.resize(size.cols, size.rows);
    screen.dataset.cols = String(vt.cols);
    screen.dataset.rows = String(vt.rows);
    if (engineLive) sock.send({ type: "engine/resize", cols: vt.cols, rows: vt.rows });
    scheduleTerm();
  };
  new ResizeObserver(debounce(fitPty, 200)).observe(screen);

  const b64ToBytes = b64 => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  const onEngine = msg => {
    if (msg.type === "engine/data") {
      vt.feed(utf8.decode(b64ToBytes(msg.data), { stream: true }));
    } else if (msg.type === "engine/exit") {
      engineLive = false;
      vt.flatten(); // the last frame folds into the scrollback — the record survives
      sysLine(`— engine shut down (exit ${msg.code ?? "signal"}) —`);
      engineState.textContent = "engines cold";
      igniteBtn.disabled = false;
      termInput.disabled = true;
      scheduleTerm();
    }
  };

  // Raw keys for the full TUI experience, sent when the glass itself has focus.
  // Cmd/meta combos, Ctrl+V, and Ctrl+C-with-a-selection stay with the browser.
  const KEYSEQ = {
    Enter: "\r", Backspace: "\x7f", Tab: "\t", Escape: "\x1b",
    Delete: "\x1b[3~", Insert: "\x1b[2~", PageUp: "\x1b[5~", PageDown: "\x1b[6~",
    Home: "\x1b[H", End: "\x1b[F",
    // F1-F4 ride SS3, as TERM=xterm-256color promises ncurses; F5+ take the
    // CSI ~ road with the traditional gap at 16.
    F1: "\x1bOP", F2: "\x1bOQ", F3: "\x1bOR", F4: "\x1bOS",
    F5: "\x1b[15~", F6: "\x1b[17~", F7: "\x1b[18~", F8: "\x1b[19~",
    F9: "\x1b[20~", F10: "\x1b[21~", F11: "\x1b[23~", F12: "\x1b[24~",
  };
  const ARROW = { ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D" };

  const keyToBytes = e => {
    if (e.metaKey) return null;
    if (e.key === "Tab" && e.shiftKey) return null; // the fire exit — keyboard crews can still tab out
    if (ARROW[e.key]) return (vt.appCursor ? "\x1bO" : "\x1b[") + ARROW[e.key];
    if (e.ctrlKey) {
      const k = e.key.toLowerCase();
      if (k === "v") return null;
      if (k === "c" && !getSelection()?.isCollapsed) return null;
      if (k.length === 1 && k >= "a" && k <= "z") return String.fromCharCode(k.charCodeAt(0) - 96);
      if (e.key === " ") return "\x00";
      if (e.key === "[") return "\x1b";
      return null;
    }
    if (KEYSEQ[e.key] != null) return KEYSEQ[e.key];
    if (e.altKey && e.key.length === 1) return "\x1b" + e.key;
    if (e.key.length === 1) return e.key;
    return null;
  };

  screen.addEventListener("keydown", e => {
    if (!engineLive) return;
    const seq = keyToBytes(e);
    if (seq == null) return;
    e.preventDefault();
    e.stopPropagation(); // arrows steer the TUI, not the Konami buffer
    sock.send({ type: "engine/write", data: seq });
  });

  screen.addEventListener("paste", e => {
    if (!engineLive) return;
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    sock.send({ type: "engine/write", data: text });
  });

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
    backlog.replaceChildren();
    utf8 = new TextDecoder(); // fresh session, clean seam
    const size = measureGeometry();
    vt.reset(size.cols, size.rows);
    screen.dataset.cols = String(vt.cols);
    screen.dataset.rows = String(vt.rows);
    engineLive = true;
    sock.send({ type: "engine/start" });
    sock.send({ type: "engine/resize", cols: vt.cols, rows: vt.rows });
    engineState.textContent = "engines hot";
    igniteBtn.disabled = true;
    termInput.disabled = false;
    screen.focus();
    scheduleTerm();
  });

  zoomBtn.addEventListener("click", () => {
    const focused = enginePanel.classList.toggle("focused");
    zoomBtn.textContent = focused ? "◱ stow" : "◲ widen";
    zoomBtn.setAttribute("aria-pressed", String(focused));
    fitPty(); // the ResizeObserver would catch it too, but the PTY likes prompt news
    screen.focus();
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

  // -- konami hatch (↑↑↓↓←→←→ b a) — a fresh batch for observant crew --
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
    "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let konamiBuf = [];
  addEventListener("keydown", e => {
    konamiBuf.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (konamiBuf.length > KONAMI.length) konamiBuf.shift();
    if (konamiBuf.length === KONAMI.length && KONAMI.every((k, i) => konamiBuf[i] === k)) {
      konamiBuf = [];
      bunRain();
    }
  });

  function bunRain() {
    console.log("%ckonami accepted — fresh batch inbound", "color: #64748b");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (document.querySelector(".bun-toast")) return;
      const toast = el("div", "bun-toast mono", "the ovens thank you");
      document.body.append(toast);
      setTimeout(() => toast.remove(), 2000);
      return;
    }
    if (document.querySelector(".bun-rain")) return; // one batch at a time — this is a bakery, not a blizzard
    const overlay = el("div", "bun-rain");
    overlay.setAttribute("aria-hidden", "true");
    let falling = 60;
    for (let i = 0; i < falling; i++) {
      const bun = el("span", "bun-drop", "🥐");
      bun.style.left = `${(Math.random() * 100).toFixed(2)}%`;
      bun.style.fontSize = `${(0.7 + Math.random() * 0.7).toFixed(2)}rem`;
      bun.style.animationDuration = `${(2 + Math.random() * 1.5).toFixed(2)}s`;
      bun.style.animationDelay = `${(Math.random() * 1.2).toFixed(2)}s`;
      overlay.append(bun);
    }
    overlay.addEventListener("animationend", e => {
      e.target.remove();
      if (--falling <= 0) overlay.remove();
    });
    document.body.append(overlay);
    // If animations never run (hidden tab, styles pending), the tray still clears.
    setTimeout(() => overlay.remove(), 8000);
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
