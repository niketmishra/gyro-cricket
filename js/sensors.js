// Swing detection from the phone's accelerometer + gyroscope.
//
// Physics: a bat swing is a rotation. The gyroscope gives the rotation-rate
// VECTOR in the phone frame; its direction is the swing's rotation axis and
// its magnitude is how fast the bat is moving. Comparing that axis with
// gravity (low-passed accelerometer) classifies the swing in the real world:
//
//   axis parallel to gravity      -> bat sweeping HORIZONTALLY (pull / cut),
//                                    and the SIGN says leg side vs off side
//   axis perpendicular to gravity -> straight-bat VERTICAL swing (drive)
//
// So each swing yields: when it happened (rotation peak), how hard
// (peak rate + linear acceleration), its plane (horizFrac 0..1) and its
// signed direction (azimuth -1..1, 0 = straight).

const IOS = /iP(hone|ad|od)/.test(navigator.userAgent);

const state = {
  supported: typeof DeviceMotionEvent !== "undefined",
  permitted: false,
  listening: false,
  armed: null,
  lastTilt: 30,
  g: { x: 0, y: 9.8, z: 0 }, // low-passed gravity, phone frame (upright portrait default)
  live: { rot: 0, az: 0, t: 0 },
};

// most recent rotation sample, for drawing the live swing needle.
// Returns zeros when the phone has been still for a beat.
export function liveMotion() {
  if (performance.now() - state.live.t > 160) return { rot: 0, az: 0 };
  return state.live;
}

export function sensorsSupported() {
  return state.supported;
}

// Must be called from a user gesture on iOS.
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
  // keep a slow gravity estimate running at all times (iOS reports the
  // opposite sign convention to the spec, normalize to one convention)
  const ag = e.accelerationIncludingGravity;
  if (ag && ag.x != null) {
    const s = IOS ? -1 : 1;
    state.g.x = state.g.x * 0.92 + s * ag.x * 0.08;
    state.g.y = state.g.y * 0.92 + s * ag.y * 0.08;
    state.g.z = state.g.z * 0.92 + s * ag.z * 0.08;
  }

  // live swing feed for the on-screen swing meter
  {
    const r0 = e.rotationRate || {};
    const rotNow = Math.hypot(r0.alpha || 0, r0.beta || 0, r0.gamma || 0);
    if (rotNow > 25) {
      const ax = norm({ x: r0.beta || 0, y: r0.gamma || 0, z: r0.alpha || 0 });
      const gn = norm(state.g);
      state.live = { rot: rotNow, az: ax.x * gn.x + ax.y * gn.y + ax.z * gn.z, t: performance.now() };
    }
  }

  const a = state.armed;
  if (!a || a.done) return;
  const now = performance.now();
  if (now < a.start) return;
  // freeze the gravity reference the moment the window opens, before the
  // swing itself pollutes the accelerometer
  if (!a.gRef) a.gRef = norm(state.g);

  const r = e.rotationRate || {};
  const rot = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0); // deg/s
  const acc = e.acceleration
    ? Math.hypot(e.acceleration.x || 0, e.acceleration.y || 0, e.acceleration.z || 0)
    : 0;

  if (rot > a.peakRot) {
    a.peakRot = rot;
    a.peakTime = now;
    a.tiltAtPeak = state.lastTilt;
    // rotation axis in phone coords: beta = about x, gamma = about y, alpha = about z
    a.omega = { x: r.beta || 0, y: r.gamma || 0, z: r.alpha || 0 };
  }
  if (acc > a.peakAcc) a.peakAcc = acc;

  const swungHard = a.peakRot > a.threshold;
  const peakPassed = swungHard && (rot < a.peakRot * 0.45 || now - a.peakTime > 280);
  if ((peakPassed || now >= a.end) && swungHard) {
    a.done = true;
    a.resolve(makeSwing(a));
  } else if (now >= a.end) {
    a.done = true;
    a.resolve(null); // no swing detected
  }
}

function makeSwing(a) {
  const axis = norm(a.omega || { x: 1, y: 0, z: 0 });
  const g = a.gRef || { x: 0, y: 1, z: 0 };
  // component of the rotation axis along gravity: +/-1 = horizontal swing,
  // 0 = vertical straight-bat swing. Sign = which way the bat swept.
  const vert = axis.x * g.x + axis.y * g.y + axis.z * g.z;
  const horizFrac = Math.min(1, Math.abs(vert));
  const azimuth = Math.max(-1, Math.min(1, vert));

  // Many phone gyros saturate around 500 deg/s, far below a real hard
  // swing, so power leans on whichever sensor read higher: gyro for
  // controlled swings, accelerometer when the gyro tops out.
  const rotPow = clamp01((a.peakRot - a.threshold) / 460);
  const accPow = clamp01((a.peakAcc - 4) / 22);
  const power = Math.min(1, Math.max(accPow, rotPow * 0.72 + accPow * 0.45));

  return {
    time: a.peakTime,
    power,
    batSpeedKmh: Math.round(28 + power * 117),
    tilt: a.tiltAtPeak,
    azimuth,
    horizFrac,
    source: "motion",
  };
}

// Arm detection for one delivery. Resolves with a swing object or null.
export function armSwing(windowStart, windowEnd, threshold = 220) {
  return new Promise((resolve) => {
    state.armed = {
      start: windowStart,
      end: windowEnd,
      threshold,
      resolve,
      peakRot: 0,
      peakAcc: 0,
      peakTime: 0,
      tiltAtPeak: 30,
      omega: null,
      gRef: null,
      done: false,
    };
    // Safety timer in case motion events stop arriving. setTimeout, not rAF,
    // so it still fires when the browser throttles animation.
    const guard = () => {
      const a = state.armed;
      if (a && !a.done) {
        if (performance.now() >= a.end + 120) {
          a.done = true;
          a.resolve(a.peakRot > a.threshold ? makeSwing(a) : null);
        } else {
          setTimeout(guard, 50);
        }
      }
    };
    setTimeout(guard, 50);
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
