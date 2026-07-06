// Swing detection from the phone's accelerometer + gyroscope.
//
// The detector records EVERY gyro sample inside the contact window, then
// analyses them as swing "bursts". A real bat swing sweeps a large angle
// (integrated rotation > ~55 degrees); a nervous pre-ball bat tap does not,
// so waggles are rejected. When several bursts qualify, the one that is
// biggest AND closest to the ball's arrival wins — so moving the bat before
// the ball comes never steals the shot.
//
// Each swing yields: when its rotation peaked (contact moment), how hard
// (peak rate + linear acceleration), its plane (horizFrac), its signed
// direction (azimuth: rotation axis vs gravity, -1 leg ... +1 off), and the
// raw peak rotation rate (used by the physics to rotate the bat face when
// you are early or late).

const IOS = /iP(hone|ad|od)/.test(navigator.userAgent);

const state = {
  supported: typeof DeviceMotionEvent !== "undefined",
  permitted: false,
  listening: false,
  armed: null,
  lastTilt: 30,
  g: { x: 0, y: 9.8, z: 0 }, // low-passed gravity, phone frame
  live: { rot: 0, az: 0, t: 0 },
};

export function sensorsSupported() {
  return state.supported;
}

// most recent rotation sample, for the on-screen swing needle
export function liveMotion() {
  if (performance.now() - state.live.t > 160) return { rot: 0, az: 0 };
  return state.live;
}

export async function requestMotionPermission() {
  if (!state.supported) return false;
  try {
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== "granted") return false;
      if (typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function") {
        try { await DeviceOrientationEvent.requestPermission(); } catch (_) {}
      }
    }
    startListening();
    state.permitted = true;
    return true;
  } catch (_) {
    return false;
  }
}

function startListening() {
  if (state.listening) return;
  state.listening = true;
  window.addEventListener("devicemotion", onMotion);
  window.addEventListener("deviceorientation", (e) => {
    if (e.beta != null) state.lastTilt = e.beta;
  });
}

function onMotion(e) {
  // slow gravity estimate, always running (iOS reports the opposite sign)
  const ag = e.accelerationIncludingGravity;
  if (ag && ag.x != null) {
    const s = IOS ? -1 : 1;
    state.g.x = state.g.x * 0.92 + s * ag.x * 0.08;
    state.g.y = state.g.y * 0.92 + s * ag.y * 0.08;
    state.g.z = state.g.z * 0.92 + s * ag.z * 0.08;
  }

  const r = e.rotationRate || {};
  const rot = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0); // deg/s
  const acc = e.acceleration
    ? Math.hypot(e.acceleration.x || 0, e.acceleration.y || 0, e.acceleration.z || 0)
    : 0;

  // live swing feed for the on-screen needle
  if (rot > 25) {
    const ax = norm({ x: r.beta || 0, y: r.gamma || 0, z: r.alpha || 0 });
    const gn = norm(state.g);
    state.live = { rot, az: ax.x * gn.x + ax.y * gn.y + ax.z * gn.z, t: performance.now() };
  }

  const a = state.armed;
  if (!a || a.done) return;
  const now = performance.now();
  if (now < a.start) return;
  if (!a.gRef) a.gRef = norm(state.g); // freeze gravity before the swing pollutes it

  a.samples.push({ t: now, rot, acc, rx: r.beta || 0, ry: r.gamma || 0, rz: r.alpha || 0 });
  if (a.samples.length > 600) a.samples.shift();
}

// Split window samples into bursts and score them: a genuine swing sweeps
// a big angle; the winner is the big burst nearest the ball's arrival.
function analyze(a) {
  const gateRot = Math.max(90, a.threshold * 0.55);
  const g = a.gRef || { x: 0, y: 1, z: 0 };

  const bursts = [];
  let cur = null;
  for (const s of a.samples) {
    if (s.rot > gateRot) {
      if (!cur) cur = { t0: s.t, t1: s.t, samples: [] };
      cur.samples.push(s);
      cur.t1 = s.t;
    } else if (cur) {
      if (s.t - cur.t1 > 70) { bursts.push(cur); cur = null; }
    }
  }
  if (cur) bursts.push(cur);

  let best = null;
  for (const b of bursts) {
    let peak = 0, tPeak = 0, accPeak = 0, angle = 0, azNum = 0, azDen = 0, prevT = null;
    for (const s of b.samples) {
      if (s.rot > peak) { peak = s.rot; tPeak = s.t; }
      if (s.acc > accPeak) accPeak = s.acc;
      if (prevT != null) angle += s.rot * (s.t - prevT) / 1000; // integrated degrees
      prevT = s.t;
      const m = Math.hypot(s.rx, s.ry, s.rz) || 1;
      const dot = (s.rx * g.x + s.ry * g.y + s.rz * g.z) / m;
      azNum += dot * s.rot;
      azDen += s.rot;
    }
    // waggle filter: too weak, too small a sweep, or too brief
    if (peak < a.threshold || angle < 55 || b.t1 - b.t0 < 40) continue;
    const score = angle * (1 - Math.min(0.6, Math.abs(tPeak - a.tContact) / 900));
    if (!best || score > best.score) {
      best = { score, peak, tPeak, accPeak, angle, az: azNum / Math.max(1, azDen) };
    }
  }
  if (!best) return null;

  const rotPow = clamp01((best.peak - a.threshold) / 460);
  const accPow = clamp01((best.accPeak - 4) / 22);
  const power = Math.min(1, Math.max(accPow, rotPow * 0.72 + accPow * 0.45));
  return {
    time: best.tPeak,
    power,
    batSpeedKmh: Math.round(28 + power * 117),
    tilt: state.lastTilt,
    azimuth: Math.max(-1, Math.min(1, best.az)),
    horizFrac: Math.min(1, Math.abs(best.az)),
    rotPeak: best.peak,
    swingAngleDeg: Math.round(best.angle),
    source: "motion",
  };
}

// Arm detection for one delivery. Resolves at window end with the best
// qualifying swing burst, or null.
export function armSwing(windowStart, windowEnd, threshold = 220, tContact = windowEnd - 250) {
  return new Promise((resolve) => {
    state.armed = {
      start: windowStart,
      end: windowEnd,
      threshold,
      tContact,
      resolve,
      samples: [],
      gRef: null,
      done: false,
    };
    const guard = () => {
      const a = state.armed;
      if (!a || a.done) return;
      if (performance.now() >= a.end + 60) {
        a.done = true;
        a.resolve(analyze(a));
      } else {
        setTimeout(guard, 40);
      }
    };
    setTimeout(guard, 40);
  });
}

export function disarm() {
  if (state.armed && !state.armed.done) {
    state.armed.done = true;
    state.armed.resolve(null);
  }
  state.armed = null;
}

function norm(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
