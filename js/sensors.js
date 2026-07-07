// Swing detection, rebuilt on the phone's own fused orientation.
//
// WHY: direction used to come from raw gyro dotted with a gravity estimate
// low-passed from the accelerometer. During a swing the accelerometer reads
// gravity PLUS several g of swing acceleration, so the "gravity" reference
// was garbage whenever it mattered — identical swings could read left or
// right at random. The OS already runs professional sensor fusion
// (deviceorientation): drift-corrected orientation that stays true while
// you swing. We use THAT.
//
// Model:
//  - STANCE: while you stand still in the run-up, we capture where the
//    phone points (fused) and true gravity.
//  - We continuously track the horizontal azimuth of whichever phone axis
//    is most horizontal in YOUR grip (any grip works).
//  - SHOT DIRECTION = the bat's azimuth at the instant the ball arrives,
//    relative to stance. Same swing, same answer, every time.
//  - TIMING = the meat of your own swing arc (45% through it): long
//    flowing swings get naturally wider timing windows than stabs.
//  - POWER still comes from the gyro (what it is actually good at).

const IOS = /iP(hone|ad|od)/.test(navigator.userAgent);
const D2R = Math.PI / 180;

const state = {
  supported: typeof DeviceMotionEvent !== "undefined",
  permitted: false,
  listening: false,
  armed: null,
  lastTilt: 30,
  g: { x: 0, y: 9.8, z: 0 },     // live low-pass (display only)
  gStill: { x: 0, y: 9.8, z: 0 },// gravity captured while STILL (trustworthy)
  stillSince: 0,
  stance: null,                  // orientation sample captured while still
  ori: [],                       // ring buffer of fused orientation samples
  oriOk: false,
  live: { rot: 0, az: 0, yaw: 0, pointDeg: null, t: 0 },
};

export function sensorsSupported() {
  return state.supported;
}

export function liveMotion() {
  if (performance.now() - state.live.t > 200) return { rot: 0, az: 0, yaw: 0, pointDeg: null };
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
  window.addEventListener("deviceorientation", onOrientation);
}

/* ---- fused orientation: azimuth of each device axis in the world ---- */
function onOrientation(e) {
  if (e.beta != null) state.lastTilt = e.beta;
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const a = e.alpha * D2R, b = e.beta * D2R, gm = e.gamma * D2R;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);
  const cg = Math.cos(gm), sg = Math.sin(gm);
  // R = Rz(alpha) Rx(beta) Ry(gamma), device -> earth (x east, y north, z up)
  // world coords of the device axes = columns of R
  const X = { x: ca * cg - sa * sb * sg, y: sa * cg + ca * sb * sg, z: -cb * sg };
  const Y = { x: -sa * cb, y: ca * cb, z: sb };
  const Z = { x: ca * sg + sa * sb * cg, y: sa * sg - ca * sb * cg, z: cb * cg };
  const az = (v) => Math.atan2(v.x, v.y) / D2R;      // horizontal azimuth
  const hm = (v) => Math.hypot(v.x, v.y);            // how horizontal it is
  const s = {
    t: performance.now(),
    azX: az(X), azY: az(Y), azZ: az(Z),
    hX: hm(X), hY: hm(Y), hZ: hm(Z),
  };
  state.ori.push(s);
  if (state.ori.length > 400) state.ori.shift();
  state.oriOk = true;

  // live "where the bat points" for the needle
  if (state.stance) {
    const k = bestAxis(state.stance);
    const d = wrap180(s["az" + k] - state.stance["az" + k]);
    state.live.pointDeg = d;
    state.live.t = performance.now();
  }
}

function bestAxis(sample) {
  const hx = sample.hX, hy = sample.hY, hz = sample.hZ;
  if (hy >= hx && hy >= hz) return "Y";
  if (hz >= hx) return "Z";
  return "X";
}
function wrap180(d) {
  return ((d + 540) % 360) - 180;
}

/* ---- motion: stillness capture, power, live rot ---- */
function onMotion(e) {
  const ag = e.accelerationIncludingGravity;
  const now = performance.now();
  const r = e.rotationRate || {};
  const rot = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
  const acc = e.acceleration
    ? Math.hypot(e.acceleration.x || 0, e.acceleration.y || 0, e.acceleration.z || 0)
    : 0;

  if (ag && ag.x != null) {
    const sg2 = IOS ? -1 : 1;
    state.g.x = state.g.x * 0.9 + sg2 * ag.x * 0.1;
    state.g.y = state.g.y * 0.9 + sg2 * ag.y * 0.1;
    state.g.z = state.g.z * 0.9 + sg2 * ag.z * 0.1;
  }

  // STILLNESS: the only time the accelerometer tells the truth about
  // gravity, and the moment we trust as the batter's stance
  if (rot < 35 && acc < 1.6) {
    if (!state.stillSince) state.stillSince = now;
    if (now - state.stillSince > 250) {
      state.gStill = { ...state.g };
      const last = state.ori[state.ori.length - 1];
      if (last) state.stance = last;
    }
  } else {
    state.stillSince = 0;
  }

  state.live.rot = rot;
  if (!state.live.t || rot > 25) state.live.t = now;
  const gn = norm(state.gStill);
  state.live.yaw = (r.beta || 0) * gn.x + (r.gamma || 0) * gn.y + (r.alpha || 0) * gn.z;

  const a = state.armed;
  if (!a || a.done) return;
  if (now < a.start) return;
  a.samples.push({ t: now, rot, acc, rx: r.beta || 0, ry: r.gamma || 0, rz: r.alpha || 0 });
  if (a.samples.length > 1000) a.samples.shift();

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

/* ---- analysis ---- */
function analyze(a) {
  // ---- POWER (and fallback timing) from the gyro bursts ----
  const gateRot = Math.max(90, a.threshold * 0.55);
  const bursts = [];
  let cur = null;
  for (const s of a.samples) {
    if (s.rot > gateRot) {
      if (!cur) cur = { t0: s.t, t1: s.t, samples: [] };
      cur.samples.push(s);
      cur.t1 = s.t;
    } else if (cur && s.t - cur.t1 > 90) {
      bursts.push(cur); cur = null;
    }
  }
  if (cur) bursts.push(cur);

  let gb = null; // best gyro burst
  for (const b of bursts) {
    let peak = 0, tPeak = 0, accPeak = 0, angle = 0, prevT = null;
    for (const s of b.samples) {
      if (s.rot > peak) { peak = s.rot; tPeak = s.t; }
      if (s.acc > accPeak) accPeak = s.acc;
      if (prevT != null) angle += s.rot * (s.t - prevT) / 1000;
      prevT = s.t;
    }
    if (peak < a.threshold || angle < 50 || b.t1 - b.t0 < 40) continue;
    const score = angle * (1 - Math.min(0.6, Math.abs(tPeak - a.tContact) / 900));
    if (!gb || score > gb.score) gb = { score, peak, tPeak, accPeak, angle };
  }

  // ---- DIRECTION + TIMING from the fused-orientation trajectory ----
  // Judge the shot by the ENTIRE swing: find every sustained rotation run
  // in the whole window, pick the downswing (fast, big, near the ball's
  // arrival — the backswing is slower and earlier, so it loses), and the
  // shot direction is that run's full start-to-end travel. Because it is
  // pure relative motion, stance errors cannot touch it.
  let shotDeg = null, swingTime = null, runMag = 0;
  if (a.stance && state.oriOk) {
    const k = bestAxis(a.stance);
    const key = "az" + k;
    const series = [];
    let prev = null, off = 0;
    for (const o of state.ori) {
      if (o.t < a.start - 600 || o.t > a.end) continue;
      let v = o[key];
      if (prev != null) {
        const d = v + off - prev;
        if (d > 180) off -= 360;
        else if (d < -180) off += 360;
      }
      const u = v + off;
      series.push({ t: o.t, A: u });
      prev = u;
    }
    if (series.length > 6) {
      // find every sustained monotonic run
      const runs = [];
      let i = 1;
      while (i < series.length) {
        const dt0 = (series[i].t - series[i - 1].t) / 1000 || 0.016;
        const v0 = (series[i].A - series[i - 1].A) / dt0;
        if (Math.abs(v0) <= 45) { i++; continue; }
        const dir = Math.sign(v0);
        const i0 = i - 1;
        let j = i, slow = 0, peakVel = Math.abs(v0);
        while (j < series.length) {
          const dt = (series[j].t - series[j - 1].t) / 1000 || 0.016;
          const v = (series[j].A - series[j - 1].A) / dt;
          if (Math.sign(v) === dir && Math.abs(v) > 45) {
            slow = 0;
            if (Math.abs(v) > peakVel) peakVel = Math.abs(v);
          } else if (++slow > 3) break;
          j++;
        }
        const i1 = Math.min(j - 1, series.length - 1);
        const delta = series[i1].A - series[i0].A;
        if (Math.abs(delta) >= 20) {
          runs.push({
            i0, i1, delta, peakVel,
            tMid: (series[i0].t + series[i1].t) / 2,
          });
        }
        i = Math.max(j, i + 1);
      }
      // the downswing: big, FAST, and close to when the ball arrives
      let bestRun = null, bestScore = 0;
      for (const r2 of runs) {
        const score = Math.abs(r2.delta) *
          (1 - Math.min(0.65, Math.abs(r2.tMid - a.tContact) / 1100)) *
          (0.6 + 0.4 * Math.min(1, r2.peakVel / 400));
        if (score > bestScore) { bestScore = score; bestRun = r2; }
      }
      if (bestRun) {
        runMag = Math.abs(bestRun.delta);
        const tRev = series[bestRun.i0].t, tEnd = series[bestRun.i1].t;
        swingTime = tRev + 0.45 * (tEnd - tRev);
        // the shot = the whole swing's travel
        shotDeg = Math.max(-170, Math.min(170, bestRun.delta * 0.85));
      }
    }
  }

  // nothing usable at all?
  if (!gb && shotDeg == null) return null;

  const peak = gb ? gb.peak : 300 + runMag * 3;
  const accPeak = gb ? gb.accPeak : 8;
  const rotPow = clamp01((peak - a.threshold) / 400);
  const accPow = clamp01((accPeak - 4) / 20);
  const power = Math.min(1, Math.max(accPow, rotPow * 0.72 + accPow * 0.45));

  return {
    time: swingTime ?? (gb ? gb.tPeak : a.tContact),
    power,
    batSpeedKmh: Math.round(28 + power * 117),
    tilt: state.lastTilt,
    swingDirDeg: shotDeg ?? 0,
    sweepFullDeg: shotDeg ?? 0,
    azimuth: shotDeg != null ? Math.max(-1, Math.min(1, shotDeg / 90)) : 0,
    horizFrac: Math.min(1, runMag / Math.max(40, gb ? gb.angle : runMag || 1)),
    rotPeak: peak,
    swingAngleDeg: Math.round(gb ? gb.angle : runMag),
    source: "motion",
  };
}

function wrapNear(target, ref) {
  let v = target;
  while (v - ref > 180) v -= 360;
  while (v - ref < -180) v += 360;
  return v;
}

export function armSwing(windowStart, windowEnd, threshold = 220, tContact = windowEnd - 250) {
  return new Promise((resolve) => {
    state.armed = {
      start: windowStart,
      end: windowEnd,
      threshold,
      tContact,
      resolve,
      samples: [],
      stance: state.stance, // locked at arm time: captured while STILL
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

export function captureSwing(durMs = 8000, threshold = 170) {
  const start = performance.now();
  const p = armSwing(start, start + durMs, threshold, start + durMs / 2);
  const a = state.armed;
  if (a) {
    a.resolveOnBurst = true;
    a.stance = state.stance; // freshest stance
  }
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
