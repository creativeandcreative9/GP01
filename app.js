import { MORSE, LEARN_ORDER, MorsePlayer } from "./morse.js";

const $ = (id) => document.getElementById(id);
const player = new MorsePlayer();
const DEFAULTS = { wpm: 15, freq: 600, level: 6, visual: true };
const settings = { ...DEFAULTS, ...load("settings") };
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
}

function renderPattern(code, activeIndex = -1) {
  const wrap = $("pattern");
  wrap.innerHTML = "";
  [...code].forEach((sym, i) => {
    const s = document.createElement("span");
    s.className = (sym === "." ? "dot" : "dash") + (i === activeIndex ? " on" : "");
    wrap.append(s);
  });
}

function play() {
  if (!current || playing) return;
  playing = true;
  $("play").disabled = true;
  const code = MORSE[current];
  $("hint").textContent = "";
  renderPattern(settings.visual ? code : "");
  player.play(code, settings, (i, sym, state) => {
    if (!settings.visual) return;
    $("flash").classList.toggle("on", state === "on");
    $("sym").textContent = state === "on" ? (sym === "." ? "ト" : "ツー") : "";
    const el = $("pattern").children[i];
    if (el) el.classList.toggle("on", state === "on");
  }, () => { playing = false; $("play").disabled = false; });
}

function next() {
  const pool = activeChars().filter((c) => c !== current);
  current = pool[Math.floor(Math.random() * pool.length)];
  answered = false;
  $("result").textContent = "";
  $("next").hidden = true;
  document.querySelectorAll("#keys button").forEach((b) => (b.className = ""));
  $("pattern").innerHTML = "";
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
  $("result").textContent = ok ? "正解!" : `不正解… 正解は ${current}`;
  renderPattern(MORSE[current]);
  $("hint").textContent = [...MORSE[current]].map((s) => (s === "." ? "ト" : "ツー")).join(" ");
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
bindSetting("level", "level", (e) => +e.value, "levelLabel", (v) => `${v}文字: ${LEARN_ORDER.slice(0, v).join(" ")}`);
$("level").addEventListener("change", () => { renderKeys(); current = null; $("start").hidden = false; });
$("visual").checked = settings.visual;
$("visual").addEventListener("change", (e) => { settings.visual = e.target.checked; save(); });

$("start").addEventListener("click", () => { $("start").hidden = true; next(); }); // 音声再生にはユーザー操作が必要
$("play").addEventListener("click", play);
$("next").addEventListener("click", next);
$("reset").addEventListener("click", () => { Object.assign(stats, { correct: 0, total: 0, streak: 0 }); renderStats(); save(); });

renderKeys();
renderStats();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
