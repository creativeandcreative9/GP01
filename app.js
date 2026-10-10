import { MORSE, LEARN_ORDER, MorsePlayer } from "./morse.js";

const $ = (id) => document.getElementById(id);
const player = new MorsePlayer();
const DEFAULTS = { wpm: 15, freq: 600, level: 6, visual: true };
const settings = { ...DEFAULTS, ...load("settings") };
settings.level = Math.min(settings.level, LEARN_ORDER.length);
const stats = { correct: 0, total: 0, streak: 0, ...load("stats") };

let current = null;   // 出題中の文字
let playing = false;
let answered = false;

function load(key) {
  try { return JSON.parse(localStorage.getItem("morse." + key)) || {}; } catch { return {}; }
}
function save() {
  try {
    localStorage.setItem("morse.settings", JSON.stringify(settings));
    localStorage.setItem("morse.stats", JSON.stringify(stats));
  } catch { /* 保存不可でも動作は継続 */ }
}

const activeChars = () => LEARN_ORDER.slice(0, settings.level);

// ---- モールス符号ツリー(点=左、線=右の二分木。英字のみ) ----
const SVGNS = "http://www.w3.org/2000/svg";
const ROW_Y = [14, 70, 126, 182, 238];
const letterByCode = {};
for (const [ch, code] of Object.entries(MORSE)) if (/[A-Z]/.test(ch)) letterByCode[code] = ch;
const els = {}; // code -> { edge, node }

function svg(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.append(e);
  return e;
}

function buildTree() {
  const root = $("tree");
  const order = []; // 通りがけ順(左の子→自分→右の子)で横位置を決める。"" は開始点
  (function walk(code) {
    if (code && !letterByCode[code]) return;
    walk(code + "."); order.push(code); walk(code + "-");
  })("");
  const PAD = 18, step = (384 - PAD * 2) / (order.length - 1);
  const pos = {};
  // 最下段は線(-)で終わる文字を一段下げて、隣と重ならないようにする
  order.forEach((c, i) => { pos[c] = { x: PAD + i * step, y: ROW_Y[c.length] + (c.length === 4 && c.endsWith("-") ? 24 : 0) }; });

  const edges = svg("g", {}, root), nodes = svg("g", {}, root);
  for (const code of order) {
    const c = pos[code];
    let edge;
    if (code === "") {
      edge = svg("path", { class: "edge", d: `M${c.x} 0V${c.y}` }, edges);
    } else {
      const p = pos[code.slice(0, -1)], mid = p.y + 28;
      edge = svg("path", { class: "edge", d: `M${p.x} ${p.y}V${mid}H${c.x}V${c.y}` }, edges);
    }
    const node = svg("g", { class: "node", "data-ch": letterByCode[code] || "" }, nodes);
    if (code === "") {
      svg("circle", { class: "shp", cx: c.x, cy: c.y, r: 3.5 }, node);
    } else {
      if (code.endsWith(".")) svg("circle", { class: "shp", cx: c.x, cy: c.y, r: 11 }, node);
      else svg("rect", { class: "shp", x: c.x - 12, y: c.y - 10, width: 24, height: 20, rx: 5 }, node);
      svg("text", { x: c.x, y: c.y }, node).textContent = letterByCode[code];
    }
    els[code] = { edge, node, ch: letterByCode[code] };
  }
}

function refreshTreeLevel() {
  const act = new Set(activeChars());
  for (const code in els) if (els[code].ch) els[code].node.classList.toggle("off", !act.has(els[code].ch));
}

function clearTree() {
  for (const code in els) {
    els[code].edge.classList.remove("lit");
    els[code].node.classList.remove("lit", "now", "target");
  }
}

// 開始点から code の n 文字目までの経路を点灯(now=true で先頭ノードを強調)
function lightPath(code, n, now) {
  for (const code2 in els) els[code2].node.classList.remove("now");
  for (let k = 0; k <= n; k++) {
    const e = els[code.slice(0, k)];
    e.edge.classList.add("lit");
    e.node.classList.add("lit");
  }
  if (now) els[code.slice(0, n)].node.classList.add("now");
}

function renderHud() {
  $("attempt").textContent = String(stats.total + (answered ? 0 : 1)).padStart(2, "0");
}

function renderKeys() {
  const wrap = $("keys");
  wrap.innerHTML = "";
  activeChars().forEach((ch) => {
    const b = document.createElement("button");
    b.textContent = ch;
    b.dataset.ch = ch;
    b.addEventListener("click", () => answer(ch, b));
    wrap.append(b);
  });
}

function renderStats() {
  $("score").textContent = `${stats.correct} / ${stats.total}`;
  $("streak").textContent = stats.streak;
  renderHud();
}

function play() {
  if (!current || playing) return;
  playing = true;
  $("play").disabled = true;
  const code = MORSE[current];
  $("hint").textContent = "";
  $("trace").textContent = "";
  if (!answered) clearTree();
  player.play(code, settings, (i, sym, state) => {
    if (!settings.visual) return;
    if (state === "on") {
      lightPath(code, i + 1, true);
      $("trace").textContent = [...code.slice(0, i + 1)].map((s) => (s === "." ? "·" : "–")).join(" ");
      $("sym").textContent = sym === "." ? "ト dit" : "ツー dah";
    } else {
      els[code.slice(0, i + 1)].node.classList.remove("now");
      $("sym").textContent = "";
    }
  }, () => { playing = false; $("play").disabled = false; });
}

function next() {
  const pool = activeChars().filter((c) => c !== current);
  current = pool[Math.floor(Math.random() * pool.length)];
  answered = false;
  $("result").textContent = "";
  $("target").textContent = "?";
  $("lampOk").className = $("lampNg").className = "lamp";
  $("next").hidden = true;
  document.querySelectorAll("#keys button").forEach((b) => (b.className = ""));
  clearTree();
  renderHud();
  play();
}

function answer(ch, btn) {
  if (!current || answered) return;
  answered = true;
  stats.total++;
  const ok = ch === current;
  if (ok) { stats.correct++; stats.streak++; } else { stats.streak = 0; }
  btn.classList.add(ok ? "ok" : "ng");
  if (!ok) document.querySelector(`#keys [data-ch="${current}"]`).classList.add("ok");
  $("result").textContent = ok ? "正解! Correct!" : `不正解… 正解は ${current}\nWrong — answer: ${current}`;
  $("target").textContent = current;
  $("lampOk").className = "lamp" + (ok ? " ok" : "");
  $("lampNg").className = "lamp" + (ok ? "" : " ng");
  const code = MORSE[current];
  clearTree();
  lightPath(code, code.length, false);
  els[code].node.classList.add("target");
  $("trace").textContent = [...code].map((s) => (s === "." ? "·" : "–")).join(" ");
  $("hint").textContent = [...code].map((s) => (s === "." ? "ト" : "ツー")).join(" ") + "  (" + [...code].map((s) => (s === "." ? "dit" : "dah")).join(" ") + ")";
  $("next").hidden = false;
  renderStats();
  save();
}

// 設定
function bindSetting(id, key, parse, labelId, fmt) {
  const el = $(id);
  el.value = settings[key];
  const upd = () => { settings[key] = parse(el); if (labelId) $(labelId).textContent = fmt(settings[key]); save(); };
  el.addEventListener("input", upd);
  if (labelId) $(labelId).textContent = fmt(settings[key]);
}
bindSetting("wpm", "wpm", (e) => +e.value, "wpmLabel", (v) => `${v} WPM`);
bindSetting("freq", "freq", (e) => +e.value, "freqLabel", (v) => `${v} Hz`);
bindSetting("level", "level", (e) => +e.value, "levelLabel", (v) => `${v}文字 letters: ${LEARN_ORDER.slice(0, v).join(" ")}`);
$("level").addEventListener("change", () => { renderKeys(); refreshTreeLevel(); current = null; $("start").hidden = false; });
$("visual").checked = settings.visual;
$("visual").addEventListener("change", (e) => { settings.visual = e.target.checked; save(); });

$("start").addEventListener("click", () => { $("start").hidden = true; next(); }); // 音声再生にはユーザー操作が必要
$("play").addEventListener("click", play);
$("next").addEventListener("click", next);
$("reset").addEventListener("click", () => { Object.assign(stats, { correct: 0, total: 0, streak: 0 }); renderStats(); save(); });

buildTree();
refreshTreeLevel();
renderKeys();
renderStats();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
