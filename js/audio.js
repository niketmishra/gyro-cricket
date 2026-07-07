// Gyro Cricket audio engine. Everything is synthesized with Web Audio,
// no sound files needed, so the game works fully offline.

let ctx = null;
let master = null;
let crowdGain = null;
let crowdSrc = null;
let enabled = true;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function setSoundEnabled(v) {
  enabled = v;
  if (master) master.gain.value = v ? 0.9 : 0;
}

let noiseBuf = null;
function noiseBuffer() {
  const c = ac();
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function noiseBurst({ dur = 0.1, freq = 1000, q = 1, gain = 0.5, type = "bandpass", when = 0 }) {
  const c = ac();
  const t = c.currentTime + when;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer();
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.05);
}

function tone({ freq = 440, freqEnd = null, dur = 0.15, gain = 0.3, type = "sine", when = 0 }) {
  const c = ac();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

// ---- game sounds ----

// ball pitching on the ground: low thump + dusty slap
export function playBounce(when = 0) {
  if (!enabled) return;
  tone({ freq: 160, freqEnd: 55, dur: 0.12, gain: 0.7, type: "sine", when });
  noiseBurst({ dur: 0.06, freq: 400, q: 0.7, gain: 0.35, when });
}

// ball released from the hand
export function playWhoosh() {
  if (!enabled) return;
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer();
  const f = c.createBiquadFilter();
  f.type = "bandpass"; f.Q.value = 2;
  f.frequency.setValueAtTime(300, t);
  f.frequency.exponentialRampToValueAtTime(2400, t + 0.28);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.35);
}

// bat hitting ball, louder and brighter with power (0..1)
export function playCrack(power) {
  if (!enabled) return;
  const p = Math.max(0.15, Math.min(1, power));
  noiseBurst({ dur: 0.05 + p * 0.04, freq: 1500 + p * 2500, q: 0.8, gain: 0.5 + p * 0.5, type: "highpass" });
  tone({ freq: 700 + p * 500, freqEnd: 180, dur: 0.09, gain: 0.5 + p * 0.4, type: "triangle" });
  tone({ freq: 2400, dur: 0.03, gain: 0.3 * p, type: "square" });
}

// the bat itself cutting through the air (plays on every swing)
export function playBatWhoosh() {
  if (!enabled) return;
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer();
  const f = c.createBiquadFilter();
  f.type = "bandpass"; f.Q.value = 1.4;
  f.frequency.setValueAtTime(500, t);
  f.frequency.exponentialRampToValueAtTime(1900, t + 0.16);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.07);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.22);
}

// the sweetest sound in cricket: ball off the MIDDLE of the bat
export function playMiddled(power = 0.8) {
  if (!enabled) return;
  tone({ freq: 950, freqEnd: 620, dur: 0.07, gain: 0.55 + 0.3 * power, type: "triangle" });
  tone({ freq: 1900, freqEnd: 1450, dur: 0.13, gain: 0.16, type: "sine", when: 0.004 });
  noiseBurst({ dur: 0.04, freq: 2600, q: 1, gain: 0.32 + 0.2 * power, type: "bandpass" });
}

// soft nick off the edge
export function playEdge() {
  if (!enabled) return;
  noiseBurst({ dur: 0.03, freq: 3200, q: 1.5, gain: 0.3, type: "bandpass" });
  tone({ freq: 1800, freqEnd: 900, dur: 0.05, gain: 0.2, type: "triangle" });
}

// stumps shattering: three descending wood knocks + rattle
export function playStumps() {
  if (!enabled) return;
  [0, 0.06, 0.13].forEach((d, i) => {
    tone({ freq: 900 - i * 220, freqEnd: 220 - i * 40, dur: 0.1, gain: 0.6, type: "square", when: d });
    noiseBurst({ dur: 0.08, freq: 1800, q: 1, gain: 0.35, when: d });
  });
}

// bowler run-up: accelerating footstep thumps over `dur` seconds
export function playRunup(dur) {
  if (!enabled) return;
  let t = 0, gap = 0.26;
  while (t < dur - 0.1) {
    tone({ freq: 120, freqEnd: 45, dur: 0.07, gain: 0.28, type: "sine", when: t });
    t += gap;
    gap = Math.max(0.13, gap * 0.9);
  }
}

export function playUiClick() {
  if (!enabled) return;
  tone({ freq: 900, freqEnd: 600, dur: 0.06, gain: 0.15, type: "triangle" });
}

// stadium airhorn for a six
export function playHorn() {
  if (!enabled) return;
  [233, 311, 466].forEach((f, i) => {
    tone({ freq: f, freqEnd: f * 0.97, dur: 0.5, gain: 0.12 - i * 0.02, type: "sawtooth", when: 0.05 });
  });
}

// count-in metronome tick; accent lands exactly on the ideal contact moment
export function playTick(accent = false, when = 0) {
  if (!enabled) return;
  // `when` schedules on the audio clock: sample-accurate, no setTimeout jitter
  tone({ freq: accent ? 1568 : 1046, dur: 0.06, gain: accent ? 0.34 : 0.2, type: "square", when });
}

// dhol-style clap burst for fire streaks and badge unlocks
export function playClaps() {
  if (!enabled) return;
  [0, 0.12, 0.24, 0.46, 0.68].forEach((t) => {
    noiseBurst({ dur: 0.05, freq: 1300, q: 0.8, gain: 0.3, when: t });
    tone({ freq: 230, freqEnd: 170, dur: 0.08, gain: 0.16, type: "sine", when: t });
  });
}

// double heartbeat thump for clutch moments
export function playHeartbeat() {
  if (!enabled) return;
  tone({ freq: 55, freqEnd: 40, dur: 0.12, gain: 0.5, type: "sine" });
  tone({ freq: 50, freqEnd: 38, dur: 0.16, gain: 0.4, type: "sine", when: 0.22 });
}

// ---- crowd ----

export function startCrowd() {
  if (crowdSrc) return;
  const c = ac();
  crowdSrc = c.createBufferSource();
  crowdSrc.buffer = noiseBuffer();
  crowdSrc.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 500;
  const lp2 = c.createBiquadFilter();
  lp2.type = "lowpass"; lp2.frequency.value = 900;
  crowdGain = c.createGain();
  crowdGain.gain.value = 0.05;
  crowdSrc.connect(lp); lp.connect(lp2); lp2.connect(crowdGain); crowdGain.connect(master);
  crowdSrc.start();
}

// intensity 0..1: murmur swell for singles, big cheer for four, full roar for six
export function crowdCheer(intensity) {
  if (!enabled || !crowdGain) return;
  const c = ac();
  const t = c.currentTime;
  const peak = 0.1 + intensity * 0.72;
  crowdGain.gain.cancelScheduledValues(t);
  crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
  crowdGain.gain.linearRampToValueAtTime(peak, t + 0.12);
  crowdGain.gain.exponentialRampToValueAtTime(0.05, t + 1.6 + intensity * 2.4);
  if (intensity > 0.55) {
    // whistles and shouts in the roar
    for (let i = 0; i < 6; i++) {
      tone({ freq: 1900 + Math.random() * 1400, freqEnd: 1400, dur: 0.25, gain: 0.05, type: "sine", when: 0.1 + Math.random() * 1.1 });
    }
    noiseBurst({ dur: 0.9, freq: 800, q: 0.5, gain: 0.12 + intensity * 0.1, when: 0.15 });
  }
}

// collective "ooooh" when the batter is beaten or edges past
export function crowdOoh() {
  if (!enabled || !crowdGain) return;
  const c = ac();
  const t = c.currentTime;
  crowdGain.gain.cancelScheduledValues(t);
  crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
  crowdGain.gain.linearRampToValueAtTime(0.26, t + 0.2);
  crowdGain.gain.exponentialRampToValueAtTime(0.05, t + 1.1);
  tone({ freq: 420, freqEnd: 260, dur: 0.55, gain: 0.09, type: "sawtooth" });
  tone({ freq: 520, freqEnd: 330, dur: 0.55, gain: 0.06, type: "sawtooth" });
}

// collective "awww" when a wicket falls
export function crowdGasp() {
  if (!enabled || !crowdGain) return;
  const c = ac();
  const t = c.currentTime;
  crowdGain.gain.cancelScheduledValues(t);
  crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
  crowdGain.gain.linearRampToValueAtTime(0.35, t + 0.1);
  crowdGain.gain.exponentialRampToValueAtTime(0.04, t + 1.2);
  tone({ freq: 300, freqEnd: 150, dur: 1.0, gain: 0.12, type: "sawtooth" });
  tone({ freq: 380, freqEnd: 190, dur: 1.0, gain: 0.08, type: "sawtooth" });
}

// primes the AudioContext from a user gesture (required on iOS)
export function unlockAudio() {
  ac();
}

// Mobile browsers suspend the AudioContext behind our back (screen off,
// TTS stealing the audio session, tab switch). Commentary keeps working
// because speechSynthesis is a separate engine, so the game sounds die
// silently. Cure: resume on every meaningful gesture and lifecycle event.
export function ensureRunning() {
  const c = ac();
  if (c.state !== "running") { try { c.resume(); } catch (_) {} }
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  });
  window.addEventListener("pointerdown", () => {
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  }, { passive: true, capture: true });
  window.addEventListener("focus", () => {
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  });
}
