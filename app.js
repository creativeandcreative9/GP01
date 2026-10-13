import { MORSE, LEARN_ORDER, MorsePlayer } from "./morse.js";
import { MUSE_PHRASES } from "./muse.js";
import { FLOW_PHRASES } from "./flow.js";

const $ = (id) => document.getElementById(id);
const player = new MorsePlayer();
// ステップ練習: 各ステップで追加される文字(累積して練習する)
const STEPS = ["KM", "R", "S", "I", "A", "P", "T", "L", "O"];
const DEFAULTS = { wpm: 15, freq: 600, level: 6, visual: true, step: 0, mode: "listen", museIndex: 0, flowIndex: 0 };
const settings = { ...DEFAULTS, ...load("settings") };
settings.level = Math.min(settings.level, LEARN_ORDER.length);
if (!(settings.step >= 0 && settings.step <= STEPS.length)) settings.step = 0;
const MODE_BTN = { listen: "modeListen", flow: "modeFlow", muse: "modeMuse", key: "modeKey", free: "modeFree" };
if (!(settings.mode in MODE_BTN)) settings.mode = "listen";
settings.museIndex = Math.min(MUSE_PHRASES.length - 1, Math.max(0, Math.floor(+settings.museIndex) || 0));
settings.flowIndex = Math.min(FLOW_PHRASES.length - 1, Math.max(0, Math.floor(+settings.flowIndex) || 0));
const stats = { correct: 0, total: 0, streak: 0, ...load("stats") };

let current = null;   // 出題中の文字
let playing = false;
let answered = false;
let input = "";       // 打鍵モードの入力中の符号
let pressAt = 0;      // 打鍵ボタンを押し始めた時刻(0=押していない)
let commitTimer = null;
let spaceTimer = null;  // フリー打鍵: 自動スペース用
let freeText = "";      // フリー打鍵/FLOW: 確定済みの文字列
let playTok = 0;        // MUSE/FLOW: 世代番号(古いタイマー/コールバックを無効化)
let playTimer = null;
let musePaused = false;

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
const charByCode = {}; // 英字+数字の逆引き(フリー打鍵のデコード用)
for (const [ch, code] of Object.entries(MORSE)) { charByCode[code] = ch; if (/[A-Z]/.test(ch)) letterByCode[code] = ch; }
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
  const act = new Set(activeChars()), all = ["free", "muse", "flow"].includes(settings.mode); // 全文字を使うモードは減光しない
  for (const code in els) if (els[code].ch) els[code].node.classList.toggle("off", !all && !act.has(els[code].ch));
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
  const m = settings.mode;
  const seq = m === "muse" || m === "flow"; // フレーズ番号を出すモード
  $("targetLabel").textContent = m === "free" ? "LAST" : seq ? "PHRASE" : "TARGET";
  $("attemptLabel").textContent = m === "free" ? "CHARS" : seq ? "OF" : "ATTEMPT";
  if (m === "free") {
    $("target").textContent = freeText.trim().slice(-1) || "-";
    $("attempt").textContent = String(freeText.length).padStart(2, "0");
  } else if (seq) {
    $("target").textContent = String((m === "muse" ? settings.museIndex : settings.flowIndex) + 1).padStart(2, "0");
    $("attempt").textContent = (m === "muse" ? MUSE_PHRASES : FLOW_PHRASES).length;
  } else $("attempt").textContent = String(stats.total + (answered ? 0 : 1)).padStart(2, "0");
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

// 判定の共通処理(集計・ランプ・保存は score、聞き取り・打鍵の表示は finish)
function score(ok) {
  answered = true;
  stats.total++;
  if (ok) { stats.correct++; stats.streak++; } else { stats.streak = 0; }
  $("result").textContent = ok ? "正解! Correct!" : `不正解… 正解は ${current}\nWrong — answer: ${current}`;
  $("lampOk").className = "lamp" + (ok ? " ok" : "");
  $("lampNg").className = "lamp" + (ok ? "" : " ng");
  $("next").hidden = false;
  renderStats();
  save();
}

function finish(ok, typed) {
  score(ok);
  const code = MORSE[current];
  $("target").textContent = current;
  clearTree();
  lightPath(code, code.length, false);
  els[code].node.classList.add("target");
  $("trace").textContent = fmtSyms(code);
  $("hint").textContent = `${fmtKana(code)} (${fmtEn(code)})` + (typed && !ok ? `\n入力 You: ${fmtSyms(typed)}` : "");
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
  const m = settings.mode, free = m === "free" || m === "flow";
  if (pressAt || !(m === "free" || ((m === "key" || m === "flow") && current && !answered && !playing))) return;
  clearTimeout(commitTimer);
  clearTimeout(spaceTimer);
  if (free && !input) clearTree(); // 前の文字の点灯を消す
  player.toneOn(settings.freq); // 初回のAudioContext生成時間を押下時間に含めない
  pressAt = performance.now();
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
  if (settings.mode === "free" || settings.mode === "flow") {
    commitTimer = setTimeout(commitFree, Math.max(700, 3 * unitMs())); // 間があいたら1文字確定
    spaceTimer = setTimeout(autoSpace, Math.max(2000, 7 * unitMs())); // 長い間でスペース
  } else commitTimer = setTimeout(commit, Math.max(800, 7 * unitMs())); // 無入力が続いたら1文字確定
}

// ---- フリー打鍵 ----
function renderFree() {
  $("tape").textContent = settings.mode === "flow" ? flowTape() : freeText;
  renderHud();
}

function commitFree() {
  if (!input) return;
  const e = els[input];
  freeText += charByCode[input] || "?";
  clearTree();
  if (e && e.ch) { lightPath(input, input.length, false); e.node.classList.add("target"); }
  input = "";
  $("trace").textContent = $("sym").textContent = "";
  renderFree();
  if (settings.mode === "flow") flowCheck();
}

function autoSpace() {
  if (settings.mode !== "flow" && freeText && !freeText.endsWith(" ")) { freeText += " "; renderFree(); }
}

// 入力中の符号があれば破棄、なければ最後の1文字を消す
function freeBack() {
  if (flowLocked()) return;
  clearTimeout(commitTimer);
  clearTimeout(spaceTimer);
  if (input) { input = ""; clearTree(); $("trace").textContent = $("sym").textContent = ""; }
  else freeText = freeText.slice(0, -1);
  renderFree();
}

function freeSpace() {
  if (flowLocked()) return;
  clearTimeout(commitTimer);
  clearTimeout(spaceTimer);
  commitFree();
  autoSpace();
}

function freeClear() {
  if (flowLocked()) return;
  clearTimeout(commitTimer);
  clearTimeout(spaceTimer);
  input = freeText = "";
  clearTree();
  $("trace").textContent = $("sym").textContent = "";
  renderFree();
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
const isKeyMode = () => ["key", "free", "flow"].includes(settings.mode);
document.addEventListener("keydown", (e) => {
  if (isSpace(e) && isKeyMode()) { e.preventDefault(); if (!e.repeat) keyDown(); }
  else if (e.code === "Backspace" && (settings.mode === "free" || settings.mode === "flow") && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); freeBack(); }
});
document.addEventListener("keyup", (e) => { if (isSpace(e) && isKeyMode()) { e.preventDefault(); keyUp(); } });
$("keyClear").addEventListener("click", clearInput);
$("fSpace").addEventListener("click", freeSpace);
$("fBack").addEventListener("click", freeBack);
$("fClear").addEventListener("click", freeClear);

// ---- 聞き取り上級(MUSE): フレーズを順番に再生 ----
const museLast = MUSE_PHRASES.length - 1;

function stopPlay() { // 再生・待機中のタイマーと音をすべて止める
  playTok++;
  clearTimeout(playTimer);
  player.stop();
}

function museSetIndex(i) {
  settings.museIndex = i;
  save();
  renderHud();
  const log = $("museLog");
  log.innerHTML = "";
  MUSE_PHRASES.slice(0, i).forEach((t) => { const li = document.createElement("li"); li.textContent = t; log.append(li); });
  log.scrollTop = log.scrollHeight;
}

// フレーズ再生中、要素ごとにツリーを点灯(MUSE/FLOW共通)
const phraseLamp = (text, tok, vis) => (ci, k, sym, state) => {
  if (tok !== playTok || !vis) return;
  const code = MORSE[text[ci]];
  if (state === "on") {
    if (k === 0) clearTree();
    lightPath(code, k + 1, true);
    $("sym").textContent = sym === "." ? "ト dit" : "ツー dah";
  } else {
    els[code.slice(0, k + 1)].node.classList.remove("now");
    $("sym").textContent = "";
  }
};

function musePlay() {
  const tok = ++playTok, i = settings.museIndex, text = MUSE_PHRASES[i];
  clearTimeout(playTimer);
  const vis = settings.visual, tape = $("tape");
  tape.textContent = $("result").textContent = $("trace").textContent = $("sym").textContent = "";
  clearTree();
  player.playText(text, settings, phraseLamp(text, tok, vis), (ci) => { if (tok === playTok && vis) tape.textContent = text.slice(0, ci + 1); }, () => {
    if (tok !== playTok) return;
    tape.textContent = text;
    $("trace").textContent = $("sym").textContent = "";
    clearTree();
    if (i === museLast) { $("result").textContent = "おわり — 最初から聞くには「次」\nThe end — press Next to start over"; return; }
    playTimer = setTimeout(() => { if (tok === playTok) museGo(i + 1); }, Math.max(2500, 14 * unitMs())); // 一息おいて次へ
  });
}

function museGo(i) {
  stopPlay();
  musePaused = false;
  $("pause").innerHTML = '一時停止<span class="en">Pause</span>';
  $("start").hidden = true;
  if (i !== settings.museIndex) museSetIndex(i);
  musePlay();
}

function musePause() {
  if (musePaused) { musePaused = false; $("pause").innerHTML = '一時停止<span class="en">Pause</span>'; musePlay(); return; }
  stopPlay();
  musePaused = true;
  $("pause").innerHTML = '再開<span class="en">Resume</span>';
}

// ---- 聞き取り中級(FLOW): フレーズを聞いて打鍵で再現 ----
const flowLast = FLOW_PHRASES.length - 1;
const FLOW_HINT = "フレーズを聞いて、打鍵で再現しよう\nListen, then key the phrase back";
const flowLocked = () => settings.mode === "flow" && answered; // 判定後は次へ進むまで入力不可
const noSp = (t) => t.replace(/ /g, "");

// マスクの文字位置に入力済みの文字を順に埋める(はみ出しは末尾に追加)。語間のスペースは維持
function flowFill() {
  const t = [...noSp(freeText)];
  let k = 0;
  return [...current].map((c) => (c === " " ? " " : t[k++] || "_")).join("") + t.slice(k).join("");
}
const flowTape = () => (!current ? "" : answered ? current : flowFill()); // 判定前に答えは出さない

function releaseKey() {
  if (!pressAt) return;
  pressAt = 0;
  player.toneOff();
  $("key").classList.remove("down");
}

function flowPlay() {
  stopPlay();
  releaseKey();
  clearTimeout(commitTimer); // 入力途中の符号は破棄(確定済みの文字は残す)
  clearTimeout(spaceTimer);
  input = "";
  const tok = playTok, text = current;
  playing = true;
  $("play").disabled = true;
  $("trace").textContent = $("sym").textContent = "";
  clearTree();
  renderFree();
  player.playText(text, settings, phraseLamp(text, tok, settings.visual), () => {}, () => {
    if (tok !== playTok) return;
    playing = false;
    $("play").disabled = false;
    $("trace").textContent = $("sym").textContent = "";
    clearTree();
  });
}

function flowGo(i) {
  stopPlay();
  if (i !== settings.flowIndex) { settings.flowIndex = i; save(); }
  current = FLOW_PHRASES[i];
  answered = false;
  freeText = "";
  $("start").hidden = true;
  $("result").textContent = "";
  $("hint").textContent = FLOW_HINT;
  $("lampOk").className = $("lampNg").className = "lamp";
  flowPlay();
}

// 入力文字数(スペース除く)がフレーズに達したら判定
function flowCheck() {
  if (answered || noSp(freeText).length < noSp(current).length) return;
  clearTimeout(commitTimer);
  clearTimeout(spaceTimer);
  const ok = noSp(freeText) === noSp(current);
  const typed = flowFill();
  score(ok);
  clearTree();
  $("trace").textContent = $("sym").textContent = "";
  $("hint").textContent = ok ? "" : `入力 You: ${typed}`;
  renderFree();
}

// ---- モード切替・設定 ----
function resetSession() {
  player.stop();
  stopPlay();
  musePaused = false;
  clearTimeout(spaceTimer);
  releaseKey();
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
  const m = settings.mode, key = m === "key", free = m === "free", muse = m === "muse", flow = m === "flow";
  if (flow) freeText = "";
  const pi = muse ? settings.museIndex : settings.flowIndex;
  $("keys").hidden = key || free || muse || flow;
  $("keyPad").hidden = !(key || free || flow);
  $("keyClear").hidden = free || flow;
  $("freeBtns").hidden = !(free || flow);
  $("start").hidden = key || free;
  $("start").innerHTML = (muse || flow) && pi > 0 ? `続きから #${pi + 1}<span class="en">Resume</span>` : 'スタート<span class="en">Start</span>';
  document.querySelector(".actions").hidden = free;
  $("prev").hidden = $("pause").hidden = !muse;
  $("pause").innerHTML = '一時停止<span class="en">Pause</span>';
  $("play").innerHTML = muse ? 'もう一度<span class="en">Repeat</span>' : key ? 'お手本を聞く<span class="en">Hear model</span>' : 'もう一度聞く<span class="en">Listen again</span>';
  $("next").innerHTML = muse ? '次 ▶<span class="en">Next</span>' : '次へ<span class="en">Next</span>';
  $("next").hidden = !(muse || flow);
  document.querySelector(".lamps").hidden = free || muse;
  $("tape").hidden = !(free || muse || flow);
  $("tape").classList.toggle("cur", free);
  $("tape").textContent = free ? freeText : "";
  $("museLog").hidden = !muse;
  if (muse) museSetIndex(settings.museIndex);
  $("hint").textContent = free ? "自由に打鍵 — 間をあけると文字が確定、長めの間でスペース\nTap freely — pause to commit a letter, longer pause for a space"
    : muse ? "フレーズを順番に聞き取ります(全100)\nListen to 100 phrases in order" : flow ? FLOW_HINT : "";
  for (const k in MODE_BTN) $(MODE_BTN[k]).classList.toggle("on", k === m);
  renderHud();
  if (key) next(); // 打鍵モードはすぐ出題(音は打鍵時に鳴る)
}

function setMode(mode) {
  if (settings.mode === mode) return;
  settings.mode = mode;
  freeText = "";
  save();
  resetSession();
}
$("modeListen").addEventListener("click", () => setMode("listen"));
$("modeKey").addEventListener("click", () => setMode("key"));
$("modeFree").addEventListener("click", () => setMode("free"));
$("modeMuse").addEventListener("click", () => setMode("muse"));
$("modeFlow").addEventListener("click", () => setMode("flow"));

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

const isMuse = () => settings.mode === "muse", isFlow = () => settings.mode === "flow";
$("start").addEventListener("click", () => { $("start").hidden = true; isMuse() ? museGo(settings.museIndex) : isFlow() ? flowGo(settings.flowIndex) : next(); }); // 音声再生にはユーザー操作が必要
$("play").addEventListener("click", () => (isMuse() ? museGo(settings.museIndex) : isFlow() ? (current ? flowPlay() : flowGo(settings.flowIndex)) : play()));
$("next").addEventListener("click", () => (isMuse() ? museGo(settings.museIndex >= museLast ? 0 : settings.museIndex + 1) : isFlow() ? flowGo(settings.flowIndex >= flowLast ? 0 : settings.flowIndex + 1) : next()));
$("prev").addEventListener("click", () => museGo(Math.max(0, settings.museIndex - 1)));
$("pause").addEventListener("click", musePause);
$("reset").addEventListener("click", () => { Object.assign(stats, { correct: 0, total: 0, streak: 0 }); renderStats(); save(); });

buildTree();
renderStats();
resetSession();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
