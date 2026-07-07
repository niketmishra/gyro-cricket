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
  if (performance.now() - state.live.t > 160) return { rot: 0, az: 0, yaw: 0 };
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

  // live swing feed for the on-screen needle.
  // Physics: rotation-axis-dot-up > 0 means the bat sweeps counterclockwise
  // seen from above, i.e. toward LEG for a right hander. Internally
  // positive = OFF, hence the negation.
  if (rot > 25) {
    const gn = norm(state.g);
    const yawRate = (r.beta || 0) * gn.x + (r.gamma || 0) * gn.y + (r.alpha || 0) * gn.z;
    state.live = { rot, yaw: yawRate, az: Math.max(-1, Math.min(1, -yawRate / 350)), t: performance.now() };
  }

  const a = state.armed;
  if (!a || a.done) return;
  const now = performance.now();
  if (now < a.start) return;
  if (!a.gRef) a.gRef = norm(state.g); // freeze gravity before the swing pollutes it

  a.samples.push({ t: now, rot, acc, rx: r.beta || 0, ry: r.gamma || 0, rz: r.alpha || 0 });
  if (a.samples.length > 600) a.samples.shift();

  // calibration mode: finish as soon as one clean burst has completed
  if (a.resolveOnBurst) {
    if (a.lastT != null) a.angleAcc = (a.angleAcc || 0) + rot * (now - a.lastT) / 1000;
    a.lastT = now;
    if (rot > (a.maxRot || 0)) a.maxRot = rot;
    if (a.maxRot > a.threshold && (a.angleAcc || 0) > 60 && rot < a.threshold * 0.4) {
      a.done = true;
      a.resolve(analyze(a));
    }
  }
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
    let peak = 0, tPeak = 0, accPeak = 0, angle = 0, prevT = null;
    for (const s of b.samples) {
      if (s.rot > peak) { peak = s.rot; tPeak = s.t; }
      if (s.acc > accPeak) accPeak = s.acc;
      if (prevT != null) angle += s.rot * (s.t - prevT) / 1000; // integrated degrees
      prevT = s.t;
    }
    // waggle filter: too weak, too small a sweep, or too brief
    if (peak < a.threshold || angle < 55 || b.t1 - b.t0 < 40) continue;

    // THE BAT IS A CLOCK HAND. Build the swing's horizontal trajectory
    // S(t) = cumulative signed yaw sweep across the whole burst. Its two
    // extremes are the backswing reversal and the follow-through end.
    // The shot direction = where the hand points when the ball ARRIVES:
    // S(tContact) - S(reversal), read off the real trajectory, ~1:1.
    const Svals = [];
    let S = 0, minS = 0, maxS = 0, iMin = 0, iMax = 0, prevS = null;
    for (let i = 0; i < b.samples.length; i++) {
      const s = b.samples[i];
      if (prevS) {
        const yawRate = s.rx * g.x + s.ry * g.y + s.rz * g.z; // deg/s, signed
        S += yawRate * (s.t - prevS.t) / 1000;
      }
      prevS = s;
      Svals.push(S);
      if (S < minS) { minS = S; iMin = i; }
      if (S > maxS) { maxS = S; iMax = i; }
    }
    const iStart = Math.min(iMin, iMax), iEnd = Math.max(iMin, iMax);
    const tRev = b.samples[iStart].t, tEndT = b.samples[iEnd].t;
    const sweepFull = Svals[iEnd] - Svals[iStart]; // signed full downswing arc

    // where was the bat when the ball reached the stumps?
    let sAtBall;
    if (a.tContact <= tRev) sAtBall = 0;
    else if (a.tContact >= tEndT) sAtBall = sweepFull;
    else {
      let j = iStart;
      while (j < iEnd && b.samples[j + 1].t < a.tContact) j++;
      const s0 = b.samples[j], s1 = b.samples[Math.min(j + 1, iEnd)];
      const f = s1.t > s0.t ? (a.tContact - s0.t) / (s1.t - s0.t) : 0;
      sAtBall = (Svals[j] + (Svals[Math.min(j + 1, iEnd)] - Svals[j]) * f) - Svals[iStart];
    }
    const swingDirDeg = Math.max(-170, Math.min(170, -sAtBall * 0.95));

    // TIMING FROM THE SWING ITSELF: the meat of the arc is ~45% through
    // its own duration. A long flowing swing has a naturally wide sweet
    // window; a stab has a narrow one.
    const horizontalEnough = Math.abs(sweepFull) >= 25;
    const swingTime = horizontalEnough
      ? tRev + 0.45 * (tEndT - tRev)
      : tPeak; // vertical drives: the rotation peak is the contact moment

    const score = angle * (1 - Math.min(0.6, Math.abs(swingTime - a.tContact) / 900));
    if (!best || score > best.score) {
      best = { score, peak, swingTime, accPeak, angle, swingDirDeg, sweepFull };
    }
  }
  if (!best) return null;

  const rotPow = clamp01((best.peak - a.threshold) / 400);
  const accPow = clamp01((best.accPeak - 4) / 20);
  const power = Math.min(1, Math.max(accPow, rotPow * 0.72 + accPow * 0.45));
  return {
    time: best.swingTime,
    power,
    batSpeedKmh: Math.round(28 + power * 117),
    tilt: state.lastTilt,
    swingDirDeg: best.swingDirDeg,
    sweepFullDeg: -best.sweepFull, // full arc, internal sign (+ = OFF)
    azimuth: Math.max(-1, Math.min(1, best.swingDirDeg / 90)),
    horizFrac: Math.min(1, Math.abs(best.sweepFull) / Math.max(40, best.angle)),
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

// one-shot practice-swing capture for grip calibration; resolves as soon
// as a genuine swing burst completes (or null after the timeout)
export function captureSwing(durMs = 8000, threshold = 170) {
  const start = performance.now();
  const p = armSwing(start, start + durMs, threshold, start + durMs / 2);
  const a = state.armed;
  if (a) a.resolveOnBurst = true;
  return p;
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
