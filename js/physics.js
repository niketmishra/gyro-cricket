// Shot physics: turn a real swing { power, timing error, swing plane,
// swing direction } into a cricket outcome.
//
// The contact model works like actual batting:
//   1. LINE: your swing direction must pass through the ball's line.
//      Pull across a ball outside off and you hit air (or feather an edge).
//   2. TIMING: outside the timing window you miss. Early on a full straight
//      ball risks LBW; late risks being bowled.
//   3. Only when line and timing are both right does the ball fly, with
//      distance from real swing speed and direction from where you swung.
//
// Coordinates: batter at origin. Direction in degrees: 0 = straight back
// past the bowler, negative = leg side, positive = off side (right hander;
// flipped for lefties). Distances in metres. Pitch is 20 m.

export const BOUNDARY = 62;
export const PITCH_LEN = 20;

// Fielding ring (direction deg, distance m). Roughly a real T20 field.
const FIELDERS = [
  { dir: -115, dist: 22 },  // square leg
  { dir: -70,  dist: 30 },  // mid wicket
  { dir: -30,  dist: 42 },  // long on
  { dir: 5,    dist: 45 },  // straight long off
  { dir: 35,   dist: 30 },  // cover
  { dir: 70,   dist: 25 },  // point
  { dir: 110,  dist: 20 },  // backward point
  { dir: 155,  dist: 16 },  // slip-ish
  { dir: -155, dist: 18 },  // fine leg
];

// window = timing tolerance in seconds. Outside it you MISS, full stop.
// Real batting is unforgiving; these are already generous.
const DIFFICULTY = {
  kids:   { window: 0.30, catchProb: 0.22, bowledProb: 0.40, threshold: 170 },
  normal: { window: 0.22, catchProb: 0.38, bowledProb: 0.52, threshold: 210 },
  pro:    { window: 0.15, catchProb: 0.55, bowledProb: 0.68, threshold: 250 },
};

export function difficultyConfig(level) {
  return DIFFICULTY[level] || DIFFICULTY.normal;
}

// ---------- bowlers, intents ----------
export const BOWLERS = [
  { id: "bummera", name: "J. Bummera", emoji: "⚡", style: "Toe-crushing yorkers", kmh: [138, 152],
    intro: "The sling you cannot read, the yorker you cannot dig out.",
    lengths: { yorker: 0.30, full: 0.16, good: 0.24, back: 0.18, bouncer: 0.12 },
    moves: ["outswing", "straight", "inswing", "straight"] },
  { id: "seraj", name: "M. Seraj", emoji: "🎯", style: "Relentless wobble seam", kmh: [131, 144],
    intro: "The seam wobbles, your edge trembles.",
    lengths: { yorker: 0.10, full: 0.20, good: 0.34, back: 0.24, bouncer: 0.12 },
    moves: ["outswing", "inswing", "straight", "outswing"] },
  { id: "singha", name: "A. Singha", emoji: "🌪️", style: "Left-arm late swing", kmh: [127, 138],
    intro: "New-ball banana swing that arrives later than your plans.",
    lengths: { yorker: 0.20, full: 0.28, good: 0.28, back: 0.16, bouncer: 0.08 },
    moves: ["inswing", "inswing", "outswing", "straight"] },
  { id: "yadev", name: "K. Yadev", emoji: "🌀", style: "Wrist spin, wrong'uns", kmh: [76, 90],
    intro: "The googly giggles as it goes past you.",
    lengths: { yorker: 0.04, full: 0.32, good: 0.36, back: 0.20, bouncer: 0.08 },
    moves: ["legbreak", "offbreak", "legbreak", "straight"] },
  { id: "jadeka", name: "R. Jadeka", emoji: "🗡️", style: "Left-arm darts", kmh: [88, 101],
    intro: "Sir bowls darts. No air, no mercy, no free runs.",
    lengths: { yorker: 0.08, full: 0.26, good: 0.42, back: 0.18, bouncer: 0.06 },
    moves: ["legbreak", "straight", "legbreak", "offbreak"] },
  { id: "patell", name: "A. Patell", emoji: "🛡️", style: "Flat, fast left-arm spin", kmh: [84, 97],
    intro: "Boring, boring, boring, BOWLED. That is the trap.",
    lengths: { yorker: 0.06, full: 0.28, good: 0.40, back: 0.20, bouncer: 0.06 },
    moves: ["straight", "legbreak", "straight", "offbreak"] },
];

export const INTENTS = {
  defend: { key: "defend", label: "DEFEND", window: 1.5,  power: 0.55, catch: 0.35, bowled: 0.6, angleCap: 16,
    desc: "Soft hands. Keep your wicket." },
  drive:  { key: "drive",  label: "DRIVE",  window: 1.1,  power: 0.85, catch: 0.8,  bowled: 1.0,
    desc: "Proper cricket shots, find the gaps." },
  slog:   { key: "slog",   label: "SLOG",   window: 0.8,  power: 1.18, catch: 1.5,  bowled: 1.45, angleAdd: 8,
    desc: "Clear the front leg. Maximum or bust." },
};

// ---------- delivery generation ----------
const MOVES = {
  straight: { label: "Dead straight",            dirShift: 0,   bowledFactor: 1.0 },
  inswing:  { label: "Swinging IN at you",       dirShift: -15, bowledFactor: 1.3 },
  outswing: { label: "Swinging AWAY",            dirShift: 15,  bowledFactor: 0.7 },
  offbreak: { label: "Off break, turning IN",    dirShift: -19, bowledFactor: 1.25 },
  legbreak: { label: "Leg break, turning AWAY",  dirShift: 19,  bowledFactor: 0.7 },
};

const LENGTHS = [
  { key: "yorker",  label: "YORKER, at your toes",  pitchM: [0.6, 2],   w: 0.13, angleCap: 11, powerMul: 0.8,  bowledFactor: 1.7,  hint: "jam the bat down NOW" },
  { key: "full",    label: "FULL, drive it",        pitchM: [2.5, 4.5], w: 0.22, powerMul: 1,    bowledFactor: 1.25, hint: "swing right on the bounce" },
  { key: "good",    label: "GOOD length",           pitchM: [5, 7.5],   w: 0.30, powerMul: 1,    bowledFactor: 1.0,  hint: "classic timing" },
  { key: "back",    label: "BACK of a length",      pitchM: [7.5, 9.5], w: 0.19, angleAdd: 4,  powerMul: 1,    bowledFactor: 0.7,  hint: "a beat late, punch it" },
  { key: "bouncer", label: "BOUNCER, duck or pull", pitchM: [9.5, 12],  w: 0.16, angleAdd: 10, powerMul: 1.02, bowledFactor: 0.25, catchAdd: 0.08, distMul: 1.05, hint: "wait... then PULL" },
];

// reach = the swing azimuth (-1 leg ... +1 off) that lines up with this
// ball. Your real swing direction must land near it or you play the wrong
// line and miss. shotHint = the shot real batters play at it.
const LINES = [
  { key: "leg",     label: "at leg stump",     xOff: -0.4, reach: -0.42, shotHint: "flick it through the leg side",
    dirNudge: -20, bowledFactor: 0.55, edgeFactor: 0.7, w: 0.17 },
  { key: "middle",  label: "at middle stump",  xOff: 0,    reach: -0.05, shotHint: "play it dead straight",
    dirNudge: -4,  bowledFactor: 1.35, edgeFactor: 0.9, w: 0.27 },
  { key: "off",     label: "at off stump",     xOff: 0.4,  reach: 0.3,   shotHint: "drive through the covers",
    dirNudge: 10,  bowledFactor: 1.1,  edgeFactor: 1.1, w: 0.31 },
  { key: "outside", label: "wide outside off", xOff: 0.9,  reach: 0.6,   shotHint: "reach out and cut it",
    dirNudge: 24,  bowledFactor: 0.3,  edgeFactor: 1.5, w: 0.25 },
];

function weightedPick(arr) {
  let r = Math.random() * arr.reduce((s, a) => s + a.w, 0);
  for (const a of arr) { r -= a.w; if (r <= 0) return a; }
  return arr[arr.length - 1];
}

export function generateDelivery(bowler, allowNoBall = true) {
  const b = bowler || BOWLERS[Math.floor(Math.random() * BOWLERS.length)];
  const kmh = Math.round(rand(b.kmh[0], b.kmh[1]));
  const lenDef = weightedPick(LENGTHS.map(l => ({ ...l, w: b.lengths[l.key] ?? l.w })));
  const pitchM = rand(lenDef.pitchM[0], lenDef.pitchM[1]);
  const line = weightedPick(LINES);
  const moveKey = b.moves[Math.floor(Math.random() * b.moves.length)];

  const total = clamp(19 / (kmh / 3.6), 0.55, 1.1);
  const toBat = clamp(0.2 + pitchM * 0.03, 0.22, 0.6);
  const toBounce = Math.max(0.18, total - toBat);

  return {
    bowler: b, name: b.name, emoji: b.emoji, kmh,
    length: { ...lenDef, pitchM },
    line,
    move: { key: moveKey, ...MOVES[moveKey] },
    toBounce, toBat,
    noBall: allowNoBall && Math.random() < 0.07,
  };
}

/* =================== the contact model =================== */

export function computeShot(swing, diff, rightHanded = true, delivery = null, intent = INTENTS.drive) {
  const move = delivery ? delivery.move : MOVES.straight;
  const line = delivery ? delivery.line : LINES[1];
  const len = delivery ? delivery.length : LENGTHS[2];
  const W = diff.window * (intent.window || 1);

  /* ---- no swing at all ---- */
  if (!swing) {
    const leaveP = line.key === "outside" ? (intent.key === "defend" ? 0.85 : 0.55) : 0;
    if (Math.random() < leaveP) {
      return out("leave", 0, "LEFT ALONE", "leave", null);
    }
    const p = Math.min(0.92, diff.bowledProb * move.bowledFactor * line.bowledFactor * len.bowledFactor * (intent.bowled || 1));
    if (Math.random() < p) return out("bowled", 0, "OUT!", "bowled", null);
    return out("beaten", 0, "MISSED", "beaten", null);
  }

  const err = swing.timingErr; // seconds; negative = early
  const absErr = Math.abs(err);

  // the direction the bat actually travelled (-1 leg ... +1 off).
  // Button mode can't express direction, so it auto-plays roughly the
  // right line with some slop.
  let az = swing.azimuth;
  if (swing.source === "button" || az == null) az = line.reach + (Math.random() - 0.5) * 0.35;
  if (!rightHanded) az = -az;
  swing.azPlayed = az;

  /* ---- 1. TIMING MISS: outside the window ---- */
  if (absErr > W) {
    // a real swing only JUST out: the bat still clips it off the splice
    if (absErr <= W * 1.3 && swing.power > 0.35) {
      const d0 = hand(clamp((az >= 0 ? 1 : -1) * 30 + err * 120, -60, 60), rightHanded);
      const r1 = Math.random() < 0.25 ? 1 : 0;
      return out(r1 ? "runs" : "mistime", r1, r1 ? "1 RUN" : "MISTIMED", r1 ? "runs1" : "mistime",
        { dir: d0, dist: 4 + Math.random() * 6, airborne: false, hangTime: 0 });
    }
    if (err < 0) {
      // through the shot early; full straight balls trap you in front
      if ((line.key === "leg" || line.key === "middle") &&
          (len.key === "full" || len.key === "yorker" || len.key === "good") &&
          Math.random() < 0.3) {
        return out("lbw", 0, "LBW!", "lbw", null);
      }
      return out("missEarly", 0, "TOO EARLY", "missEarly", null);
    }
    if (Math.random() < Math.min(0.8, diff.bowledProb * 0.75 * line.bowledFactor * len.bowledFactor)) {
      return out("bowled", 0, "OUT!", "bowled", null);
    }
    return out("missLate", 0, "TOO LATE", "missLate", null);
  }

  /* ---- 2. THE CONTACT MODEL, tuned for how a real swing feels ----
     Direction comes from WHERE you swung, almost purely. Timing decides
     how sweetly it comes off. The ball's line drags the shot and trims
     quality; it only causes an air-swing when your timing was poor too,
     because a batter in position gets bat on ball. */
  const rotRate = swing.rotPeak || 500;
  // response curve: moderate side-swipes still reach square positions
  const swingAng = swing.swingDirDeg != null
    ? clamp(swing.swingDirDeg, -115, 115)
    : Math.sign(az) * Math.min(95, Math.pow(Math.abs(az), 0.7) * 105);
  const faceDeg = swingAng + clamp(err * rotRate * 0.35, -35, 35);
  swing.swingAng = swingAng; // exposed so the UI can show what we read
  swing.faceDeg = faceDeg;
  const faceRad = (faceDeg * Math.PI) / 180;
  const coverX = Math.sin(faceRad) * 1.05;  // sweet-spot reach (m)
  const ballX = line.xOff * 1.15;           // ball's line (m)
  const offset = ballX - coverX;
  const absOff = Math.abs(offset);
  // generous plateau: within 80 ms is pure timing bliss
  const tq = absErr <= 0.08 ? 1 : Math.pow(Math.max(0, 1 - (absErr - 0.08) / Math.max(0.05, W - 0.08)), 1.1);

  let offQ, drag;
  if (absOff > 0.65) {
    if (tq > 0.75) {
      // great timing rescues a stretched reach: scrappy but bat on ball
      offQ = 0.45;
      drag = Math.sign(offset) * 25;
    } else if (Math.random() < 0.4) {
      if (offset > 0) {
        if (Math.random() < 0.55) {
          return out("edgeOut", 0, "OUT!", "edgeOut",
            { dir: hand(150 + Math.random() * 20, rightHanded), dist: 14, airborne: true, hangTime: 0.7 });
        }
        return out("edge4", 4, "FOUR!", "edge4",
          { dir: hand(140 + Math.random() * 25, rightHanded), dist: BOUNDARY + 2, airborne: false, hangTime: 0 });
      }
      if (Math.random() < 0.45) {
        return out("bowled", 0, "OUT!", "bowled", null); // inside edge, played on
      }
      return out("runs", 1, "1 RUN", "runs1",
        { dir: hand(-150 - Math.random() * 20, rightHanded), dist: 12, airborne: false, hangTime: 0 });
    } else {
      if (line.key !== "outside" &&
          Math.random() < Math.min(0.75, diff.bowledProb * line.bowledFactor * len.bowledFactor)) {
        return out("bowled", 0, "OUT!", "bowled", null);
      }
      return out("missLine", 0, "WRONG LINE!", "missLine", null);
    }
  } else {
    offQ = absOff <= 0.25 ? 1 : absOff <= 0.45 ? 0.85 : 0.6;
    drag = offset * 22;
  }

  // bouncer taken on too early = top edge, skied
  if (len.key === "bouncer" && tq < 0.3 && err < -0.05 && Math.random() < 0.5) {
    if (Math.random() < 0.55) {
      return out("caught", 0, "CAUGHT!", "caught",
        { dir: hand(-150, rightHanded), dist: 18, airborne: true, hangTime: 2.2 });
    }
    return out("edge4", 4, "FOUR!", "edge4",
      { dir: hand(-160, rightHanded), dist: BOUNDARY + 2, airborne: false, hangTime: 0 });
  }

  // a committed swing always sends the ball SOMEWHERE worth watching
  let quality = tq * offQ;
  if (swing.power > 0.55 && quality < 0.3) quality = 0.3;
  const middled = tq > 0.86 && absOff <= 0.25;
  const contact = middled ? "middle" : quality >= 0.65 ? "solid" : "thick";

  // direction: the swing rules; drag, movement and scratch-noise nudge
  let dir =
    faceDeg +
    drag +
    move.dirShift * (0.2 + 0.5 * (1 - quality)) +
    (Math.random() * 7 - 3.5) * (1.1 - quality);
  dir = ((dir + 540) % 360) - 180;
  dir = hand(dir, rightHanded);
  const glance = Math.abs(dir) > 105;

  // ball speed off the bat
  const paceBonus = delivery ? 0.9 + ((delivery.kmh - 70) / 78) * 0.18 : 1;
  const baseSpeed = (13 + swing.power * 29) * paceBonus * (len.powerMul || 1) * (intent.power || 1);
  const sweet = middled ? 1.18 : quality > 0.8 ? 1.06 : 1;
  const speed = baseSpeed * (0.38 + 0.62 * quality) * sweet * (glance ? 0.72 : 1);

  // launch angle: cross-bat flat, straight-bat drives loft. A hard,
  // well-timed vertical hack is a GUARANTEED lofted straight hit.
  let angle;
  if ((swing.horizFrac ?? 0.4) > 0.5) {
    angle = 7 + swing.power * 16 + (len.angleAdd || 0) * 1.2;
  } else {
    const tiltAngle = Math.min(80, Math.abs(swing.tilt ?? 30));
    angle = 9 + (tiltAngle / 80) * 34 + (len.angleAdd || 0);
    if (swing.power > 0.5) angle = Math.max(angle, 18 + swing.power * 16);
  }
  angle += (intent.angleAdd || 0) + (Math.random() * 8 - 4);
  if (swing.power > 0.8 && quality > 0.75 && intent.key !== "defend") angle = Math.max(angle, 21);
  if (len.angleCap) angle = Math.min(angle, len.angleCap);
  if (intent.angleCap) angle = Math.min(angle, intent.angleCap);

  const finish = (r) => { r.contact = contact; r.quality = quality; return r; };

  const rad = (angle * Math.PI) / 180;
  const airborne = angle > 14;
  let dist = airborne
    ? ((speed * speed * Math.sin(2 * rad)) / 9.81) * 0.82 * (len.distMul || 1)
    : speed * speed * 0.085;
  dist = clamp(dist, 2, 95);
  const hangTime = airborne ? (2 * speed * Math.sin(rad)) / 9.81 : 0;

  if (airborne && dist >= BOUNDARY) {
    return finish(out("six", 6, "SIX!", "six", { dir, dist: Math.min(dist, 92), airborne, hangTime }));
  }

  if (airborne && hangTime > 1.15) {
    const nearest = FIELDERS.reduce((best, f) => {
      const d = fielderDistance(f, dir, dist);
      return d < best.d ? { f, d } : best;
    }, { f: null, d: 1e9 });
    if (nearest.d < 9 && Math.random() < (diff.catchProb + (len.catchAdd || 0) + (nearest.d < 4 ? 0.3 : 0)) * (intent.catch || 1)) {
      return finish(out("caught", 0, "CAUGHT!", "caught", { dir, dist, airborne: true, hangTime }));
    }
  }

  // ground shots must beat the ring fielders (angles wrap for glances)
  let intercepted = null;
  if (!airborne) {
    for (const f of FIELDERS) {
      const ad = Math.abs(angDiff(dir, f.dir));
      if (ad < 12 && f.dist < dist + 3 && (!intercepted || f.dist < intercepted.f.dist)) {
        intercepted = { f, ad };
      }
    }
  }
  if (intercepted) {
    const runs = intercepted.ad < 6 ? 0 : 1;
    return finish(out(runs === 0 ? "fielded" : "runs", runs, runs === 0 ? "NO RUN" : "1 RUN",
      runs === 0 ? "fielded" : "runs1",
      { dir, dist: Math.min(dist, intercepted.f.dist), airborne: false, hangTime: 0 }));
  }
  if (!airborne && dist >= BOUNDARY * 0.62) {
    return finish(out("four", 4, "FOUR!", "four", { dir, dist: BOUNDARY + 2, airborne: false, hangTime: 0 }));
  }

  let runs = 0;
  if (dist >= 45) runs = 3;
  else if (dist >= 26) runs = 2;
  else if (dist >= 10) runs = 1;
  return finish(out(runs === 0 ? "dot" : "runs", runs,
    runs === 0 ? "NO RUN" : `${runs} RUN${runs > 1 ? "S" : ""}`,
    runs === 0 ? "dot" : `runs${runs}`,
    { dir, dist, airborne, hangTime }));
}

function angDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function out(kind, runs, banner, commentaryKey, flight) {
  return { kind, runs, banner, commentaryKey, flight };
}

// Fielding region name for a shot direction, e.g. "over mid wicket".
const REGIONS = [
  [-155, "fine leg"], [-115, "square leg"], [-70, "mid wicket"], [-30, "long on"],
  [0, "straight down the ground"], [30, "long off"], [70, "cover"], [115, "point"], [155, "third man"],
];
export function regionName(dir) {
  let best = REGIONS[0];
  for (const r of REGIONS) if (Math.abs(dir - r[0]) < Math.abs(dir - best[0])) best = r;
  return best[1];
}

// the geometrically ideal shot line for a delivery: where a clean hit
// goes when the bat's sweet spot meets the ball's actual position
export function idealShotDeg(delivery) {
  const bx = delivery.line.xOff * 1.15;
  return (Math.asin(Math.max(-1, Math.min(1, bx / 1.05))) * 180) / Math.PI;
}

export function fielderPositions() {
  return FIELDERS;
}

function fielderDistance(f, dir, dist) {
  const a1 = (f.dir * Math.PI) / 180, a2 = (dir * Math.PI) / 180;
  const x1 = Math.sin(a1) * f.dist, y1 = Math.cos(a1) * f.dist;
  const x2 = Math.sin(a2) * dist,  y2 = Math.cos(a2) * dist;
  return Math.hypot(x1 - x2, y1 - y2);
}

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function hand(dir, rightHanded) { return rightHanded ? dir : -dir; }
