import { MORSE, LEARN_ORDER, MorsePlayer } from "./morse.js";

const $ = (id) => document.getElementById(id);
const player = new MorsePlayer();
// ステップ練習: 各ステップで追加される文字(累積して練習する)
const STEPS = ["KM", "R", "S", "I", "A", "P", "T", "L", "O"];
const DEFAULTS = { wpm: 15, freq: 600, level: 6, visual: true, step: 0, mode: "listen" };
const settings = { ...DEFAULTS, ...load("settings") };
settings.level = Math.min(settings.level, LEARN_ORDER.length);
if (!(settings.step >= 0 && settings.step <= STEPS.length)) settings.step = 0;
const stats = { correct: 0, total: 0, streak: 0, ...load("stats") };

let current = null;   // 出題中の文字
let playing = false;
let answered = false;
let input = "";       // 打鍵モードの入力中の符号
let pressAt = 0;      // 打鍵ボタンを押し始めた時刻(0=押していない)
let commitTimer = null;

function load(key) {
  try { return JSON.parse(localStorage.getItem("morse." + key)) || {}; } catch { return {}; }
}
function save() {
  try {
    localStorage.setItem("morse.settings", JSON.stringify(settings));
    localStorage.setItem("morse.stats", JSON.stringify(stats));
  } catch { /* 保存不可でも動作は継続 */ }
}

// step=0 は従来どおり(文字数スライダー)、1〜9 はステップ練習
const activeChars = () => settings.step > 0
  ? STEPS.slice(0, settings.step).join("").split("")
  : LEARN_ORDER.slice(0, settings.level);
const fmtSyms = (code) => [...code].map((s) => (s === "." ? "·" : "–")).join(" ");
const fmtKana = (code) => [...code].map((s) => (s === "." ? "ト" : "ツー")).join(" ");
const fmtEn = (code) => [...code].map((s) => (s === "." ? "dit" : "dah")).join(" ");

// ---- モールス符号ツリー(点=左、線=右の二分木。英字のみ) ----
const SVGNS = "http://www.w3.org/2000/svg";
const ROW_Y = [14, 72, 130, 188, 246];
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
  const PAD = 15, step = (384 - PAD * 2) / (order.length - 1);
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
      if (code.endsWith(".")) svg("circle", { class: "shp", cx: c.x, cy: c.y, r: 13 }, node);
      else svg("rect", { class: "shp", x: c.x - 13, y: c.y - 12, width: 26, height: 24, rx: 6 }, node);
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

// 開始点から code の n 文字目までの経路を点灯(now=true で先頭ノードを強調)。ツリーに無い符号は途中まで。
function lightPath(code, n, now) {
  for (const k in els) els[k].node.classList.remove("now");
  for (let k = 0; k <= n; k++) {
    const e = els[code.slice(0, k)];
    if (!e) return;
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

// ---- 出題・再生・判定 ----
function play() {
  if (!current || playing) return;
  clearInput();
  playing = true;
  $("play").disabled = true;
  const code = MORSE[current];
  const visual = settings.visual || settings.mode === "key";
  $("hint").textContent = "";
  $("trace").textContent = "";
  if (!answered) clearTree();
  player.play(code, settings, (i, sym, state) => {
    if (!visual) return;
    if (state === "on") {
      lightPath(code, i + 1, true);
      $("trace").textContent = fmtSyms(code.slice(0, i + 1));
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
  input = "";
  clearTimeout(commitTimer);
  $("result").textContent = "";
  $("sym").textContent = "";
  $("trace").textContent = "";
  $("target").textContent = settings.mode === "key" ? current : "?";
  $("hint").textContent = settings.mode === "key" ? "対象の文字を打鍵してください Tap out the target letter" : "";
  $("lampOk").className = $("lampNg").className = "lamp";
  $("next").hidden = true;
  document.querySelectorAll("#keys button").forEach((b) => (b.className = ""));
  clearTree();
  renderHud();
  if (settings.mode === "listen") play();
}

// 判定の共通処理(聞き取り・打鍵の両方)
function finish(ok, typed) {
  answered = true;
  stats.total++;
  if (ok) { stats.correct++; stats.streak++; } else { stats.streak = 0; }
  const code = MORSE[current];
  $("result").textContent = ok ? "正解! Correct!" : `不正解… 正解は ${current}\nWrong — answer: ${current}`;
  $("target").textContent = current;
  $("lampOk").className = "lamp" + (ok ? " ok" : "");
  $("lampNg").className = "lamp" + (ok ? "" : " ng");
  clearTree();
  lightPath(code, code.length, false);
  els[code].node.classList.add("target");
  $("trace").textContent = fmtSyms(code);
  $("hint").textContent = `${fmtKana(code)} (${fmtEn(code)})` + (typed && !ok ? `\n入力 You: ${fmtSyms(typed)}` : "");
  $("next").hidden = false;
  renderStats();
  save();
}

function answer(ch, btn) {
  if (!current || answered) return;
  const ok = ch === current;
  btn.classList.add(ok ? "ok" : "ng");
  if (!ok) document.querySelector(`#keys [data-ch="${current}"]`).classList.add("ok");
  finish(ok);
}

// ---- 打鍵モード ----
const unitMs = () => 1200 / settings.wpm;

function keyDown() {
  if (settings.mode !== "key" || !current || answered || playing || pressAt) return;
  clearTimeout(commitTimer);
  pressAt = performance.now();
  player.toneOn(settings.freq);
  $("key").classList.add("down");
}

function keyUp() {
  if (!pressAt) return;
  const dur = performance.now() - pressAt;
  pressAt = 0;
  player.toneOff();
  $("key").classList.remove("down");
  const sym = dur >= Math.max(180, 2 * unitMs()) ? "-" : "."; // 長押し=ツー
  input += sym;
  lightPath(input, input.length, true);
  $("trace").textContent = fmtSyms(input);
  $("sym").textContent = sym === "." ? "ト dit" : "ツー dah";
  commitTimer = setTimeout(commit, Math.max(800, 7 * unitMs())); // 無入力が続いたら1文字確定
}

function commit() {
  if (!input || answered) return;
  $("sym").textContent = "";
  finish(MORSE[current] === input, input);
}

function clearInput() {
  if (answered || settings.mode !== "key") return;
  clearTimeout(commitTimer);
  input = "";
  clearTree();
  $("trace").textContent = "";
  $("sym").textContent = "";
}

const keyBtn = $("key");
keyBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); keyBtn.setPointerCapture(e.pointerId); keyDown(); });
keyBtn.addEventListener("pointerup", keyUp);
keyBtn.addEventListener("pointercancel", keyUp);
keyBtn.addEventListener("contextmenu", (e) => e.preventDefault());
const isSpace = (e) => e.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
document.addEventListener("keydown", (e) => { if (isSpace(e) && settings.mode === "key") { e.preventDefault(); if (!e.repeat) keyDown(); } });
document.addEventListener("keyup", (e) => { if (isSpace(e) && settings.mode === "key") keyUp(); });
$("keyClear").addEventListener("click", clearInput);

// ---- モード切替・設定 ----
function resetSession() {
  player.stop();
  playing = false;
  $("play").disabled = false;
  renderKeys();
  refreshTreeLevel();
  current = null;
  answered = false;
  input = "";
  clearTimeout(commitTimer);
  clearTree();
  $("target").textContent = "?";
  $("trace").textContent = $("sym").textContent = $("hint").textContent = $("result").textContent = "";
  $("lampOk").className = $("lampNg").className = "lamp";
  $("next").hidden = true;
  renderHud();
  const key = settings.mode === "key";
  $("keys").hidden = key;
  $("keyPad").hidden = !key;
  $("start").hidden = key;
  $("play").innerHTML = key ? 'お手本を聞く<span class="en">Hear model</span>' : 'もう一度聞く<span class="en">Listen again</span>';
  $("modeListen").classList.toggle("on", !key);
  $("modeKey").classList.toggle("on", key);
  if (key) next(); // 打鍵モードはすぐ出題(音は打鍵時に鳴る)
}

function setMode(mode) {
  if (settings.mode === mode) return;
  settings.mode = mode;
  save();
  resetSession();
}
$("modeListen").addEventListener("click", () => setMode("listen"));
$("modeKey").addEventListener("click", () => setMode("key"));

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
$("level").addEventListener("change", resetSession);

const stepSel = $("step");
stepSel.innerHTML = '<option value="0">標準 Standard(文字数で指定 by count)</option>' + STEPS.map((_, i) =>
  `<option value="${i + 1}">ステップ ${i + 1} Step ${i + 1}: ${STEPS.slice(0, i + 1).join("").split("").join(", ")}</option>`).join("");
stepSel.value = settings.step;
$("level").disabled = settings.step > 0; // ステップ選択中は文字数スライダーを無効化
stepSel.addEventListener("change", () => {
  settings.step = +stepSel.value;
  $("level").disabled = settings.step > 0;
  save();
  resetSession();
});

$("visual").checked = settings.visual;
$("visual").addEventListener("change", (e) => { settings.visual = e.target.checked; save(); });

$("start").addEventListener("click", () => { $("start").hidden = true; next(); }); // 音声再生にはユーザー操作が必要
$("play").addEventListener("click", play);
$("next").addEventListener("click", next);
$("reset").addEventListener("click", () => { Object.assign(stats, { correct: 0, total: 0, streak: 0 }); renderStats(); save(); });

buildTree();
renderStats();
resetSession();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
