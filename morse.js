// モールス符号テーブルと再生ロジック
export const MORSE = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
  I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.",
  Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-",
  5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
};

// Koch法に近い習得順(段階的に文字を増やす)
export const LEARN_ORDER = "KMRSUAPTLOWINJEF0YVG5Q9ZH38B427C1D6X".split("");

export class MorsePlayer {
  constructor() { this.ctx = null; this.timers = []; }

  ensureContext() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  stop() { this.timers.forEach(clearTimeout); this.timers = []; }

  // onElement(index, symbol, "on"|"off") を音と同期して呼ぶ。完了時 onDone。
  play(code, { wpm = 15, freq = 600 }, onElement, onDone) {
    this.ensureContext();
    this.stop();
    const unit = 1.2 / wpm; // 秒(PARIS基準)
    let t = this.ctx.currentTime + 0.1;
    const start = t;
    [...code].forEach((sym, i) => {
      const dur = (sym === "." ? 1 : 3) * unit;
      this.beep(t, dur, freq);
      const onMs = (t - start + 0.1) * 1000;
      this.timers.push(setTimeout(() => onElement(i, sym, "on"), onMs));
      this.timers.push(setTimeout(() => onElement(i, sym, "off"), onMs + dur * 1000));
      t += dur + unit;
    });
    this.timers.push(setTimeout(onDone, (t - start + 0.1) * 1000));
  }

  beep(at, dur, freq) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.4, at + 0.005); // クリックノイズ防止
    gain.gain.setValueAtTime(0.4, at + dur - 0.005);
    gain.gain.linearRampToValueAtTime(0, at + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.01);
  }
}
