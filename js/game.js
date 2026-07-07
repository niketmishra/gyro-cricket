import * as audio from "./audio.js?v=22";
import * as sensors from "./sensors.js?v=22";
import { computeShot, generateDelivery, regionName, difficultyConfig, fielderPositions, BOUNDARY, BOWLERS, INTENTS, idealShotDeg } from "./physics.js?v=22";
import { pickLine, speak, setVoiceEnabled } from "./commentary.js?v=22";

/* ============================== settings ============================== */
const settings = loadJSON("gyroCricketSettings", {
  sound: true, voice: true, haptics: true, rightHanded: true, difficulty: "normal", intent: "drive",
  gyroFlip: false, gyroSign: 0, timingBias: 0, batter: "kholi",
});
// migrate the old boolean flip into the calibration sign
if (settings.gyroFlip && !settings.gyroSign) { settings.gyroSign = -1; }
// the sensor sign convention changed in v14: recalibrate once
if (settings.calibV !== 2) {
  settings.calibV = 2;
  settings.gyroSign = 0;
  localStorage.setItem("gyroCricketSettings", JSON.stringify(settings));
}
if (!settings.v2) {
  settings.v2 = true;
  if (settings.difficulty === "kids") settings.difficulty = "normal";
  localStorage.setItem("gyroCricketSettings", JSON.stringify(settings));
}
const best = loadJSON("gyroCricketBest", { score: 0, six: 0, batSpeed: 0, longestSix: 0, perfectLife: 0 });
const badges = loadJSON("gyroCricketBadges", {});

function loadJSON(key, def) {
  try { return Object.assign({}, def, JSON.parse(localStorage.getItem(key) || "{}")); }
  catch (_) { return { ...def }; }
}
const saveSettings = () => localStorage.setItem("gyroCricketSettings", JSON.stringify(settings));
const saveBest = () => localStorage.setItem("gyroCricketBest", JSON.stringify(best));
const saveBadges = () => localStorage.setItem("gyroCricketBadges", JSON.stringify(badges));

/* ============================== rosters ============================== */
const BATTERS = [
  { id: "kholi",    name: "V. KHOLI",    tag: "The Chase Master", emoji: "🏏", num: 18 },
  { id: "sharmen",  name: "R. SHARMEN",  tag: "The Hitman", emoji: "💥", num: 45 },
  { id: "gilley",   name: "S. GILLEY",   tag: "The Prince", emoji: "👑", num: 77 },
  { id: "jaisvel",  name: "Y. JAISVEL",  tag: "Fearless Southpaw", emoji: "⚡", num: 64 },
  { id: "asharmen", name: "A. SHARMEN",  tag: "Powerplay Dynamite", emoji: "🧨", num: 4 },
  { id: "sooryven", name: "V. SOORYVEN", tag: "Mr 360", emoji: "🌀", num: 63 },
  { id: "ayar",     name: "S. AYAR",     tag: "The Pull King", emoji: "🎯", num: 41 },
  { id: "pante",    name: "R. PANTE",    tag: "The Entertainer", emoji: "🧤", num: 17 },
  { id: "pandar",   name: "H. PANDAR",   tag: "The Finisher", emoji: "💪", num: 33 },
];
const batterDef = () => BATTERS.find((b) => b.id === settings.batter) || BATTERS[0];
if (!BATTERS.some((b) => b.id === settings.batter)) { settings.batter = "kholi"; saveSettings(); }

const BANTER = {
  bummera: {
    taunt: ["Your toes. My yorker. Say goodbye.", "You cannot pick my action. Nobody can.", "Smile now. The yorker is coming.", "Even the bat sponsor is nervous."],
    afterSix: ["Interesting. The next one is at your boots.", "Enjoy it. The yorker remembers.", "One ball. That is all I need."],
    afterWicket: ["Toe-crusher special. NEXT!", "Told you to protect the base.", "The stumps never lie."],
  },
  seraj: {
    taunt: ["The seam is wobbling. Are you?", "Every ball asks a question. Answer carefully.", "I do not bowl loose balls. Ever.", "Full house tonight. They came for your edge."],
    afterSix: ["Good shot. It changes nothing.", "You woke up the wrong bowler.", "The next one seams the OTHER way."],
    afterWicket: ["The edge always comes to Seraj!", "Passion beats talent. GONE!", "That is the wobble ball, my friend."],
  },
  singha: {
    taunt: ["Left arm, late swing, early exit.", "It starts on leg and finishes with your off stump.", "New ball in my hand. Bad news for you.", "The banana bends late. Very late."],
    afterSix: ["Big swing, bigger risk. Noted.", "The next one bends twice as much.", "Brave. The swing is just warming up."],
    afterWicket: ["Bent it like a dream! GONE!", "The late swing collects again.", "That is why they throw me the new ball."],
  },
  yadev: {
    taunt: ["Leggie or googly? Flip a coin.", "The ball will giggle on the way past.", "I spin it on glass. This pitch is a gift.", "Watch my wrist. It lies."],
    afterSix: ["The googly is loading.", "Hit the leggie? Fine. Pick the wrong'un.", "Flight is a trap, my friend."],
    afterWicket: ["The wrong'un GIGGLES!", "Never read a wrist spinner from the hand.", "Deceived in the air, beaten off the pitch."],
  },
  jadeka: {
    taunt: ["Sir does not bowl bad balls.", "Dart after dart after dart. Blink and it's over.", "The rocket arm is waiting for a single. Try me.", "No air. No room. No hope."],
    afterSix: ["Hm. That never happens twice.", "A sword only needs one swing.", "Enjoy the highlight reel, superstar."],
    afterWicket: ["The dart hits the board!", "Sir strikes. Bring the next one.", "Fast, flat, fatal."],
  },
  patell: {
    taunt: ["Boring balls win matches.", "Six balls, same spot. Can you survive the boredom?", "I am rushing you. You just don't feel it yet.", "The arm ball is invisible. Good luck."],
    afterSix: ["Fine. Back to the boring plan.", "One highlight does not change the spreadsheet.", "The arm ball sends its regards."],
    afterWicket: ["The invisible arm ball STRIKES!", "Bored out. My favourite dismissal.", "Same spot, different result."],
  },
};

/* ============================== dom ============================== */
const $ = (id) => document.getElementById(id);
const screens = document.querySelectorAll(".screen");
const show = (id) => screens.forEach((s) => s.classList.toggle("active", s.id === id));
const SHEET_VIEWS = ["view-scout", "view-live", "view-result", "view-break"];
function sheetView(id) {
  SHEET_VIEWS.forEach((v) => $(v).classList.toggle("hidden", v !== id));
}

/* ============================== match state ============================== */
const MODES = {
  quick:    { balls: 12, wkts: 3, label: "Quick Match" },
  chase:    { balls: 12, wkts: 3, label: "Run Chase" },
  practice: { balls: Infinity, wkts: Infinity, label: "Practice Nets" },
  survival: { balls: Infinity, wkts: 1, label: "Survival" },
  duel1:    { balls: 12, wkts: 3, label: "Friend Duel" },
  duel2:    { balls: 12, wkts: 3, label: "Friend Duel" },
};

const match = {
  mode: "quick", runs: 0, wickets: 0, balls: 0,
  maxBalls: 12, maxWkts: 3, target: null,
  over: false, buttonMode: false,
  freeHit: false, streak: 0, overRunsStart: 0,
  lastLegal: true, breakShownAt: -1, lastBowlerId: null,
  history: [], wheel: [], vsBowler: {},
  stats: { sixes: 0, fours: 0, bestBat: 0, longestSix: 0, swings: 0, perfect: 0, dots: 0 },
  bowlingOrder: [], nextDelivery: null,
};

const duel = { active: false, justFinished: false, p1: "PLAYER 1", p2: "PLAYER 2", p1Runs: 0, p1Wkts: 0, target: 0 };

let currentDelivery = null;
let markerVisible = false;
let pendingMode = "quick";
const runupState = { active: false, t0: 0, dur: 1 };

function batterName() {
  if (duel.active) return match.mode === "duel2" ? duel.p2 : duel.p1;
  return batterDef().name;
}

/* ============================== navigation ============================== */
$("btn-splash-start").addEventListener("click", () => { audio.unlockAudio(); audio.playUiClick(); show("screen-grip"); });
$("btn-grip-ok").addEventListener("click", () => { audio.playUiClick(); goHome(); });
$("btn-howto").addEventListener("click", () => { audio.playUiClick(); show("screen-howto"); });
$("btn-howto-back").addEventListener("click", () => { audio.playUiClick(); goHome(); });
$("btn-settings").addEventListener("click", () => { audio.playUiClick(); show("screen-settings"); });
$("btn-settings-back").addEventListener("click", () => { audio.playUiClick(); goHome(); });
$("btn-home").addEventListener("click", () => goHome());
$("btn-quit").addEventListener("click", () => {
  sensors.disarm();
  match.over = true;
  duel.active = false;
  stopMarkerLoop(); stopTimingRing();
  document.body.classList.remove("fire", "clutch");
  goHome();
});
$("btn-again").addEventListener("click", () => {
  if (duel.justFinished) {
    [duel.p1, duel.p2] = [duel.p2, duel.p1];
    duel.active = true; duel.justFinished = false;
    return startMatch("duel1");
  }
  startMatch(match.mode === "duel2" ? "quick" : match.mode);
});

function goHome() {
  show("screen-home");
  $("best-strip").textContent = best.score > 0
    ? `🏆 Best ${best.score} · 💨 ${best.batSpeed} km/h bat · 🚀 ${best.longestSix} m six`
    : "Play your first match to set some records!";
  const greets = [
    "Night match. Full house. You're on strike.",
    "The floodlights are on. Time to swing.",
    "Crowd's chanting your name out there.",
    "Fresh pitch, hard ball, big boundaries.",
  ];
  $("home-greeting").textContent = greets[Math.floor(Math.random() * greets.length)];
  $("btn-batter").textContent = `${batterDef().emoji} ${batterDef().name}`;
  renderBadges();
}

/* batter picker */
$("btn-batter").addEventListener("click", () => { audio.playUiClick(); renderBatterGrid(); show("screen-batter"); });
$("btn-batter-back").addEventListener("click", () => { audio.playUiClick(); goHome(); });
function renderBatterGrid() {
  $("batter-grid").innerHTML = BATTERS.map((b) =>
    `<button class="batter-card ${b.id === settings.batter ? "sel" : ""}" data-batter="${b.id}">
       <span class="be">${b.emoji}</span><b>${b.name}</b><small>${b.tag}</small>
     </button>`).join("");
  document.querySelectorAll(".batter-card").forEach((c) => {
    c.addEventListener("click", () => {
      settings.batter = c.dataset.batter; saveSettings(); audio.playUiClick();
      renderBatterGrid();
    });
  });
}

/* settings */
bindToggle("set-sound", settings.sound, (v) => { settings.sound = v; audio.setSoundEnabled(v); });
bindToggle("set-voice", settings.voice, (v) => { settings.voice = v; setVoiceEnabled(v); });
bindToggle("set-haptics", settings.haptics, (v) => { settings.haptics = v; });
bindToggle("set-hand", settings.rightHanded, (v) => { settings.rightHanded = v; }, ["RIGHT", "LEFT"]);
audio.setSoundEnabled(settings.sound);
setVoiceEnabled(settings.voice);

function bindToggle(id, initial, onChange, labels = ["ON", "OFF"]) {
  const el = $(id);
  const paint = (v) => { el.dataset.on = v; el.textContent = v ? labels[0] : labels[1]; };
  paint(initial);
  el.addEventListener("click", () => {
    const v = el.dataset.on !== "true";
    paint(v); onChange(v); saveSettings(); audio.playUiClick();
  });
}
{
  const el = $("set-difficulty");
  const order = ["kids", "normal", "pro"];
  el.textContent = settings.difficulty.toUpperCase();
  el.addEventListener("click", () => {
    settings.difficulty = order[(order.indexOf(settings.difficulty) + 1) % order.length];
    el.textContent = settings.difficulty.toUpperCase();
    saveSettings(); audio.playUiClick();
  });
}

$("set-recal").addEventListener("click", () => {
  settings.gyroSign = 0;
  settings.timingBias = 0;
  saveSettings();
  audio.playUiClick();
  toast("🧭 Calibration reset. You'll shadow-swing before the next match.");
});

/* mode select */
document.querySelectorAll(".menu-card").forEach((card) => {
  card.addEventListener("click", () => {
    audio.playUiClick();
    if (card.dataset.mode === "duel") return show("screen-duel");
    pendingMode = card.dataset.mode;
    launchPending();
  });
});
function launchPending() {
  if (!sensors.sensorsSupported()) { match.buttonMode = true; return startMatch(pendingMode); }
  if (match.buttonMode) return startMatch(pendingMode);
  show("screen-setup");
}
$("btn-enable-motion").addEventListener("click", async () => {
  audio.unlockAudio();
  const ok = await sensors.requestMotionPermission();
  if (ok) {
    match.buttonMode = false;
    if (!settings.gyroSign) return runCalibration();
    startMatch(pendingMode);
  }
  else {
    $("setup-copy").textContent =
      "Could not get motion access. On iPhone allow Motion and Orientation in Safari settings, or play in Button Mode.";
  }
});
$("btn-button-mode").addEventListener("click", () => { match.buttonMode = true; startMatch(pendingMode); });

/* one-time grip calibration: a single shadow swing toward the OFF side
   teaches us which way your phone's gyro reads, whatever way you hold it */
async function runCalibration() {
  const copy = $("setup-copy");
  const b1 = $("btn-enable-motion"), b2 = $("btn-button-mode");
  const cal = $("cal-canvas");
  b1.classList.add("hidden"); b2.classList.add("hidden");
  cal.classList.remove("hidden");
  let calOn = true, lastRead = null;
  const cctx = cal.getContext("2d");
  const drawCal = () => {
    if (!calOn) return;
    const W = cal.width, H = cal.height, gx = W / 2, gy = H - 12, R = H - 34;
    cctx.clearRect(0, 0, W, H);
    cctx.strokeStyle = "rgba(242,246,255,.25)";
    cctx.lineWidth = 5;
    cctx.beginPath(); cctx.arc(gx, gy, R, Math.PI * 1.02, Math.PI * 1.98); cctx.stroke();
    // the dotted gold target line: swing exactly along this
    const ta = (45 * Math.PI) / 180;
    cctx.setLineDash([5, 6]);
    cctx.strokeStyle = "#ffd54a";
    cctx.lineWidth = 3;
    cctx.beginPath();
    cctx.moveTo(gx, gy);
    cctx.lineTo(gx + Math.sin(ta) * R, gy - Math.cos(ta) * R);
    cctx.stroke();
    cctx.setLineDash([]);
    cctx.fillStyle = "#ffd54a";
    cctx.font = "800 12px 'Space Grotesk', sans-serif";
    cctx.textAlign = "center";
    cctx.fillText("SWING HERE ↗", gx + Math.sin(ta) * R * 0.55, gy - Math.cos(ta) * R * 0.55 - 14);
    // your live swing, mirrored on the needle in real time
    const lm = sensors.liveMotion();
    if (lm.pointDeg != null || lm.rot > 50) {
      const deg = Math.max(-90, Math.min(90, lm.pointDeg != null ? lm.pointDeg : -(lm.yaw || 0) * 0.2));
      const a2 = (deg * Math.PI) / 180;
      cctx.save();
      cctx.shadowColor = "rgba(182,255,59,.9)";
      cctx.shadowBlur = 8;
      cctx.strokeStyle = "#b6ff3b";
      cctx.lineWidth = 4;
      cctx.lineCap = "round";
      cctx.beginPath(); cctx.moveTo(gx, gy);
      cctx.lineTo(gx + Math.sin(a2) * (R - 8), gy - Math.cos(a2) * (R - 8));
      cctx.stroke();
      cctx.restore();
    }
    if (lastRead != null) {
      cctx.fillStyle = "#b6ff3b";
      cctx.font = "800 14px 'Space Grotesk', sans-serif";
      cctx.fillText(`READ: ${Math.round(Math.abs(lastRead))}°`, gx, 18);
    }
    nextFrame(drawCal);
  };
  nextFrame(drawCal);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      copy.innerHTML = "🏏 <b>CALIBRATION.</b> Hold the phone like a bat. Now swing FLAT along the <b style=\"color:#ffd54a\">dotted gold line</b> — one full shadow swing to YOUR RIGHT. Watch the green needle follow you.";
      const sw = await sensors.captureSwing(9000, 170);
      const calDeg = sw ? (sw.sweepFullDeg ?? sw.swingDirDeg ?? (sw.azimuth || 0) * 90) : 0;
      lastRead = sw ? calDeg : null;
      if (sw && Math.abs(calDeg) >= 25) {
        settings.gyroSign = calDeg >= 0 ? 1 : -1;
        settings.gyroFlip = false;
        saveSettings();
        copy.textContent = `Locked in! Your swing read ${Math.abs(Math.round(calDeg))}° along the line. Walking out to the middle...`;
        audio.playClaps();
        await wait(1200);
        return startMatch(pendingMode);
      }
      copy.textContent = sw
        ? `Read only ${Math.abs(Math.round(calDeg))}° — too straight to trust. Sweep FLAT and FAR along the dotted line, like a big square cut.`
        : "No swing felt. Give it a real shadow swing, like you mean it!";
      await wait(1400);
    }
    settings.gyroSign = 1;
    saveSettings();
    startMatch(pendingMode);
  } finally {
    calOn = false;
    cal.classList.add("hidden");
    b1.classList.remove("hidden");
    b2.classList.remove("hidden");
  }
}

/* duel setup */
$("btn-duel-back").addEventListener("click", () => { audio.playUiClick(); goHome(); });
$("btn-duel-start").addEventListener("click", () => {
  audio.playUiClick();
  duel.p1 = ($("duel-p1").value.trim() || "PLAYER 1").toUpperCase().slice(0, 12);
  duel.p2 = ($("duel-p2").value.trim() || "PLAYER 2").toUpperCase().slice(0, 12);
  duel.active = true; duel.justFinished = false;
  pendingMode = "duel1";
  launchPending();
});
$("btn-handover-go").addEventListener("click", () => { audio.playUiClick(); startMatch("duel2"); });

/* intent picker */
let intentKey = settings.intent in INTENTS ? settings.intent : "drive";
document.querySelectorAll(".intent").forEach((btn) => {
  btn.addEventListener("click", () => {
    intentKey = btn.dataset.intent;
    settings.intent = intentKey; saveSettings();
    document.querySelectorAll(".intent").forEach((b) => b.classList.toggle("sel", b === btn));
    audio.playUiClick();
  });
});
function paintIntent() {
  document.querySelectorAll(".intent").forEach((b) => b.classList.toggle("sel", b.dataset.intent === intentKey));
}

/* ============================== badges ============================== */
const BADGES = [
  { id: "six1",   emoji: "🚀", name: "First Six" },
  { id: "fire",   emoji: "🔥", name: "On Fire" },
  { id: "three6", emoji: "🎆", name: "Triple Maximum" },
  { id: "fifty",  emoji: "🥇", name: "Half Century" },
  { id: "chase",  emoji: "🎯", name: "Chase Master" },
  { id: "duel",   emoji: "🆚", name: "Duel Winner" },
  { id: "aplus",  emoji: "⭐", name: "A+ Batting" },
  { id: "p10",    emoji: "⚡", name: "10 Perfect Shots" },
];
function unlockBadge(id) {
  if (badges[id]) return;
  badges[id] = true;
  saveBadges();
  const b = BADGES.find((x) => x.id === id);
  toast(`🏅 BADGE UNLOCKED · ${b.emoji} ${b.name}`);
  audio.playClaps();
}
function renderBadges() {
  $("badge-shelf").innerHTML = BADGES.map((b) =>
    `<span class="bdg ${badges[b.id] ? "on" : ""}" title="${b.name}">${b.emoji}</span>`).join("");
}
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden", "pop");
  void t.offsetWidth;
  t.classList.add("pop");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}

/* ============================== match flow ============================== */
function startMatch(mode) {
  const cfg = MODES[mode];
  Object.assign(match, {
    mode, runs: 0, wickets: 0, balls: 0,
    maxBalls: cfg.balls, maxWkts: cfg.wkts,
    target: mode === "chase" ? 16 + Math.floor(Math.random() * 17) : mode === "duel2" ? duel.target : null,
    over: false, freeHit: false, streak: 0, overRunsStart: 0,
    lastLegal: true, breakShownAt: -1, lastBowlerId: null,
    history: [], wheel: [], vsBowler: {}, nextDelivery: null,
    stats: { sixes: 0, fours: 0, bestBat: 0, longestSix: 0, swings: 0, perfect: 0, dots: 0 },
    bowlingOrder: shuffle([...BOWLERS]),
  });
  show("screen-game");
  resizeCanvases();
  audio.startCrowd();
  document.body.classList.remove("fire", "clutch");
  $("ball-strip").innerHTML = "";
  $("result-banner").classList.add("hidden");
  $("hud-batspeed").textContent = "--";
  setCue(""); setCommentary("");
  paintHud();
  const welcome = duel.active
    ? `${batterName()} walks out to the middle. ${match.bowlingOrder[0].name} has the ball. The duel is on!`
    : pickLine("welcome", { bat: batterName(), bowl: match.bowlingOrder[0].name });
  setCommentary(welcome);
  speak(welcome, 0.5);
  prepareNextBall(true);
}

function currentBowler() {
  const overIdx = Math.floor(match.balls / 6);
  return match.bowlingOrder[overIdx % match.bowlingOrder.length];
}

function matchDone() {
  return (
    match.wickets >= match.maxWkts ||
    match.balls >= match.maxBalls ||
    (match.target != null && match.runs >= match.target)
  );
}

/* --------- SCOUT --------- */
function prepareNextBall(first = false) {
  if (match.over) return;
  if (matchDone()) return endMatch();

  const d = generateDelivery(currentBowler(), match.mode !== "practice");
  match.nextDelivery = d;
  currentDelivery = d;
  markerVisible = true;
  runupState.active = false;
  batReadyP = 0;
  lastSwingDir = null;
  startMarkerLoop();

  const ballInOver = (match.balls % 6) + 1;
  let overText = isFinite(match.maxBalls)
    ? `OVER ${Math.floor(match.balls / 6) + 1} · BALL ${ballInOver}`
    : `BALL ${match.balls + 1}`;
  overText += ` · ${batterName()}`;

  let clutch = false;
  if (match.target != null) {
    const need = match.target - match.runs;
    const left = match.maxBalls - match.balls;
    clutch = need > 0 && left <= 6;
    if (need > 0 && left <= 3) {
      overText = left === 1 ? `THE FINAL BALL · NEED ${need}` : `NEED ${need} OFF ${left} · ${batterName()}`;
    }
    if (need > 0 && left <= 6) audio.playHeartbeat();
    // the last ball of a chase plays in cinematic slow motion
    if (need > 0 && left === 1) { d.toBounce *= 1.2; d.toBat *= 1.2; }
  }
  document.body.classList.toggle("clutch", clutch);
  $("scout-overball").textContent = overText;

  $("scout-freehit").classList.toggle("hidden", !match.freeHit);
  $("scout-avatar").textContent = d.bowler.emoji;
  $("scout-bowler-name").textContent = d.bowler.name;
  $("scout-bowler-style").textContent = d.bowler.style;
  countUp($("scout-speed"), d.kmh, 600);
  $("tag-length").textContent = d.length.label.toUpperCase();
  $("tag-line").textContent = d.line.label.toUpperCase();
  $("tag-move").textContent = `${moveArrow(d)} ${d.move.label.toUpperCase()}`;
  $("scout-hint").textContent = `"${d.length.hint}, ${d.line.shotHint}"`;
  {
    const idealRaw = idealShotDeg(d);
    const ideal = settings.rightHanded ? idealRaw : -idealRaw;
    const side = idealRaw < -6 ? "LEG" : idealRaw > 6 ? "OFF" : "STRAIGHT";
    $("tag-target").textContent = `🎯 BEST LINE: ${regionName(ideal).toUpperCase()} · ${Math.abs(Math.round(idealRaw))}° ${side}`;
  }

  const bnt = BANTER[d.bowler.id];
  if (bnt) {
    let pool = bnt.taunt;
    const last = match.history[match.history.length - 1];
    if (last && match.lastBowlerId === d.bowler.id) {
      if (last.runs === 6) pool = bnt.afterSix;
      else if (["bowled", "caught", "edgeOut", "lbw"].includes(last.kind)) pool = bnt.afterWicket;
    }
    $("scout-banter").textContent = `“${pool[Math.floor(Math.random() * pool.length)]}”`;
  }

  const leftPct = 50 + (settings.rightHanded ? 1 : -1) * d.line.xOff * 30;
  const topPct = 10 + (1 - Math.min(1, d.length.pitchM / 20)) * 76;
  const dotEl = $("mp-dot");
  dotEl.style.left = `${leftPct}%`;
  dotEl.style.top = `${topPct}%`;
  const arrow = $("mp-arrow");
  const shift = (settings.rightHanded ? 1 : -1) * d.move.dirShift;
  arrow.classList.toggle("hidden", !shift);
  if (shift) {
    arrow.textContent = shift < 0 ? "←" : "→";
    arrow.style.left = `${leftPct + Math.sign(shift) * 26}%`;
    arrow.style.top = `${topPct + 9}%`;
  }
  paintIntent();
  sheetView("view-scout");
  if (!first) setCommentary("");
  $("result-banner").classList.add("hidden");
}

$("btn-ready").addEventListener("click", () => {
  if (!match.nextDelivery || match.over) return;
  audio.ensureRunning(); // heal a suspended context before the soundscape
  audio.playUiClick();
  runDelivery(match.nextDelivery, INTENTS[intentKey]);
});
$("btn-next-ball").addEventListener("click", () => {
  audio.playUiClick();
  const overJustEnded = match.balls > 0 && match.balls % 6 === 0 && !matchDone();
  if (overJustEnded && match.lastLegal !== false && match.balls !== match.breakShownAt) {
    match.breakShownAt = match.balls;
    return showOverBreak();
  }
  prepareNextBall();
});
$("btn-break-continue").addEventListener("click", () => { audio.playUiClick(); prepareNextBall(); });

function showOverBreak() {
  const overNo = match.balls / 6;
  const overRuns = match.runs - match.overRunsStart;
  match.overRunsStart = match.runs;
  $("break-title").textContent = `END OF OVER ${overNo}`;
  $("break-sub").textContent = `${overRuns} run${overRuns === 1 ? "" : "s"} off it. ${scoreline()}`;
  const nb = currentBowler();
  $("break-bowler").innerHTML =
    `<span class="em">${nb.emoji}</span><span><b>${nb.name}</b> takes the ball<small>${nb.intro}</small></span>`;
  sheetView("view-break");
  const line = `${pickLine("overEnd")} ${nb.name} to bowl the next.`;
  setCommentary(line); speak(line, 0.3);
}

function scoreline() {
  if (match.target == null) return `You're ${match.runs}/${match.wickets}.`;
  const need = match.target - match.runs;
  return need > 0 ? `Need ${need} off ${match.maxBalls - match.balls}.` : "Target down!";
}

/* --------- READY -> run-up -> delivery --------- */
async function runDelivery(delivery, intent) {
  match.nextDelivery = null;
  sheetView("view-live");
  $("btn-swing").classList.toggle("hidden", !match.buttonMode);
  $("result-banner").classList.add("hidden");
  hideTimingChip();
  setCommentary("");

  const diff = difficultyConfig(settings.difficulty);
  const effWindow = diff.window * (intent.window || 1);

  const hint = $("live-hint");
  const fill = $("runup-fill");
  fill.style.width = "0%";
  hint.textContent = "Field set. Batter takes guard...";
  setCue(match.freeHit ? "⚡ FREE HIT ⚡" : "");
  const T_RUNUP = 4400;
  const t0 = performance.now();
  runupState.active = true; runupState.t0 = t0 + 1300; runupState.dur = T_RUNUP - 1300;
  const runupTimer = setInterval(() => {
    const p = Math.min(1, (performance.now() - t0) / T_RUNUP);
    fill.style.width = `${p * 100}%`;
    if (p >= 1) clearInterval(runupTimer);
  }, 50);
  await wait(1300);
  if (bail()) return;
  hint.textContent = `${delivery.bowler.name} charging in...`;
  audio.playRunup(2.9);

  // count-in scheduled on the AUDIO clock: sample-accurate, no jitter
  const tContactPred = t0 + T_RUNUP + (delivery.toBounce + delivery.toBat) * 1000;
  [[2000, "•"], [1000, "• •"], [0, null]].forEach(([msBefore, dots]) => {
    const d = tContactPred - msBefore - performance.now();
    if (d > 0) {
      audio.playTick(msBefore === 0, d / 1000);
      if (dots) setTimeout(() => { if (!bail() && !match.freeHit) setCue(dots); }, d);
    }
  });

  await wait(T_RUNUP - 1300);
  if (bail()) return;

  runupState.active = false;
  hint.textContent = match.buttonMode ? "RELEASE AT THE BOUNCE!" : "SWING AFTER THE BOUNCE!";
  audio.playWhoosh();
  setCue("👀");
  const tRelease = performance.now();
  const tBounce = tRelease + delivery.toBounce * 1000;
  const tContact = tBounce + delivery.toBat * 1000;
  audio.playBounce(delivery.toBounce); // audio-clock precise
  setTimeout(() => { setCue("SWING!", true); vibrate(30); }, delivery.toBounce * 1000);
  startTimingRing(tRelease, tBounce, tContact);

  // capture EVERYTHING: full backlift through full follow-through,
  // 1.4s before the ball to 0.7s after
  const windowStart = tContact - effWindow * 1000 - 1400;
  const windowEnd = tContact + effWindow * 1000 + 700;
  let swing = match.buttonMode
    ? await buttonSwing(windowEnd)
    : await sensors.armSwing(windowStart, windowEnd, diff.threshold, tContact);
  stopTimingRing();
  if (bail()) return;

  if (swing) {
    swing.timingErr = (swing.time - tContact) / 1000;
    match.stats.swings++;
    if (Math.abs(swing.timingErr) < 0.08) match.stats.perfect++;
    $("hud-batspeed").textContent = swing.batSpeedKmh;
    match.stats.bestBat = Math.max(match.stats.bestBat, swing.batSpeedKmh);
    showTimingChip(swing.timingErr);
    if (swing.source === "motion") {
      const sgn = settings.gyroSign || 1;
      if (swing.azimuth != null) swing.azimuth *= sgn;
      if (swing.swingDirDeg != null) swing.swingDirDeg *= sgn;
      if (swing.sweepFullDeg != null) swing.sweepFullDeg *= sgn;
    }
    if (swing.source === "motion") {
      // rhythm-game latency correction: remove this device's constant lag
      swing.timingErr -= settings.timingBias || 0;
      learnTimingBias(swing.timingErr, effWindow);
    }
  }

  const result = computeShot(swing, diff, settings.rightHanded, delivery, intent);
  if (swing) triggerBatSwing(swing);
  learnCalibration(swing, delivery);
  await presentResult(result, swing, diff, delivery, intent);

  function bail() { return match.over || !$("screen-game").classList.contains("active"); }
}

/* --------- device latency auto-learning --------- */
const biasHist = [];
function learnTimingBias(err, W) {
  if (Math.abs(err) > W * 1.6) return; // only genuine attempts teach us
  biasHist.push(err);
  if (biasHist.length > 9) biasHist.shift();
  if (biasHist.length >= 5 && biasHist.length % 3 === 0) {
    const sorted = [...biasHist].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    settings.timingBias = Math.max(-0.12, Math.min(0.12, (settings.timingBias || 0) + med * 0.3));
    saveSettings();
  }
}

/* --------- swing-direction auto-calibration --------- */
const calibHist = [];
function learnCalibration(swing, delivery) {
  if (!swing || swing.source !== "motion" || swing.azPlayed == null || !delivery) return;
  const reach = delivery.line.reach;
  const mmRaw = Math.abs(swing.azPlayed - reach);
  const mmFlip = Math.abs(-swing.azPlayed - reach);
  calibHist.push(mmFlip < mmRaw - 0.2 ? 1 : mmRaw < mmFlip - 0.2 ? -1 : 0);
  if (calibHist.length > 6) calibHist.shift();
  const s = calibHist.reduce((a, b) => a + b, 0);
  if (s >= 3) {
    settings.gyroSign = -(settings.gyroSign || 1);
    saveSettings();
    calibHist.length = 0;
    setTimeout(() => setCommentary("🧭 Swing direction auto-calibrated to your grip."), 2600);
  }
}

/* --------- timing chip --------- */
function showTimingChip(err) {
  const chip = $("timing-chip");
  const ms = Math.round(err * 1000);
  chip.className = "timing-chip";
  if (Math.abs(ms) <= 60) { chip.classList.add("perfect"); chip.textContent = "PERFECT ⚡"; }
  else if (ms < 0) { chip.classList.add("early"); chip.textContent = `${-ms} ms EARLY`; }
  else { chip.classList.add("late"); chip.textContent = `${ms} ms LATE`; }
  setTimeout(hideTimingChip, 1400);
}
function hideTimingChip() { $("timing-chip").classList.add("hidden"); $("timing-chip").classList.remove("perfect", "late", "early"); }

/* --------- result --------- */
async function presentResult(result, swing, diff, delivery, intent) {
  const legal = !delivery.noBall;
  const onFreeHit = match.freeHit;
  if (legal) match.balls++;
  match.lastLegal = legal;
  match.lastBowlerId = delivery.bowler.id;
  markerVisible = false;
  batReadyP = 0;

  const isWicket = ["bowled", "caught", "edgeOut", "lbw"].includes(result.kind);
  const reprieved = isWicket && (!legal || onFreeHit);
  const wicketCounted = isWicket && !reprieved;

  if (result.runs >= 4) match.streak++;
  else if (result.kind !== "leave") match.streak = 0;
  const onFire = match.streak >= 3;
  if (onFire && match.streak === 3) audio.playClaps();
  document.body.classList.toggle("fire", onFire);
  $("hud-fire").classList.toggle("hidden", !onFire);

  if (wicketCounted) {
    match.wickets++;
    if (result.kind === "bowled") { audio.playStumps(); shatterStumps(); }
    else if (result.kind === "lbw") audio.playBounce();
    else audio.playCrack(0.25);
    audio.crowdGasp();
    vibrate([80, 60, 120]);
    document.body.classList.add("shake");
    setTimeout(() => document.body.classList.remove("shake"), 500);
  } else if (reprieved) {
    if (result.kind === "bowled") { audio.playStumps(); shatterStumps(); }
    else audio.playCrack(0.25);
    audio.crowdGasp();
    setTimeout(() => audio.crowdCheer(0.8), 900);
    vibrate([80, 60, 200]);
  } else if (["beaten", "leave", "missLine", "missEarly", "missLate"].includes(result.kind)) {
    setTimeout(() => audio.playBounce(), 200);
    if (result.kind !== "leave") setTimeout(() => audio.crowdOoh(), 350);
  } else if (result.kind === "edge4") {
    audio.playEdge();
    audio.crowdOoh();
    setTimeout(() => audio.crowdCheer(0.75), 500);
  } else if (swing) {
    // contact feel: a middled ball PINGS, a thick one thuds
    if (result.contact === "middle") {
      audio.playMiddled(swing.power);
      vibrate([35, 20, 70]);
    } else {
      audio.playCrack(swing.power * (result.contact === "thick" ? 0.55 : 1));
      vibrate(swing.power > 0.7 ? [40, 30, 60] : 40);
    }
    const cheer = { six: 1, four: 0.85, runs: 0.4, dot: 0.15, fielded: 0.2 }[result.kind] ?? 0.15;
    audio.crowdCheer(onFire ? Math.min(1, cheer + 0.2) : cheer);
    if (result.kind === "six") setTimeout(() => audio.crowdCheer(0.7), 1200);
  }

  match.runs += result.runs + (legal ? 0 : 1);
  if (result.runs === 6) {
    match.stats.sixes++;
    if (result.flight) match.stats.longestSix = Math.max(match.stats.longestSix, Math.round(result.flight.dist));
    audio.playHorn();
    fireworks(onFire ? 2 : 1);
  }
  if (result.runs === 4) match.stats.fours++;
  if (result.runs === 0 && legal) match.stats.dots++;
  if (result.flight) match.wheel.push({ dir: result.flight.dir, dist: result.flight.dist, runs: result.runs });
  match.freeHit = !legal;

  const tally = (match.vsBowler[delivery.bowler.id] ||= { name: delivery.bowler.name, runs: 0, balls: 0 });
  tally.runs += result.runs;
  if (legal) tally.balls++;

  let key = result.commentaryKey;
  if (reprieved) key = !legal ? "noBallSave" : "freeHitSave";
  const recentSixes = match.history.slice(-2).filter((h) => h.runs === 6).length;
  if (result.runs === 6 && recentSixes === 2) key = "hattrick6";
  const nameCtx = { bat: batterName(), bowl: delivery.bowler.name };
  const line = pickLine(key, nameCtx);
  const excitement = reprieved ? 1 : isWicket ? 0.95 : result.runs >= 4 ? 1 : result.runs > 0 ? 0.45 : 0.25;

  const banner = $("result-banner");
  banner.className = "result-banner hidden";
  let main, sub;
  if (reprieved) {
    banner.classList.add("four");
    main = !legal ? "NO BALL!" : "NOT OUT!";
    sub = !legal ? "Free hit coming up" : "Free hit, cannot be out";
  } else {
    banner.classList.add(result.runs === 6 ? "six" : result.runs === 4 ? "four" : isWicket ? "out" : "runs");
    main = result.banner;
    sub = bannerSub(result, swing, delivery);
  }
  $("rb-main").textContent = main;
  $("rb-sub").textContent = sub;
  setCue("");

  // staging: swing-and-miss beat, or contact flash + perspective launch,
  // then the top-down broadcast replay
  lastSwingDir = swing && swing.swingAng != null
    ? (settings.rightHanded ? swing.swingAng : -swing.swingAng)
    : null;
  if (swing && !result.flight) await missBeat(delivery);
  if (result.flight) {
    if (swing && Math.abs(result.flight.dir) <= 75) await animateHitPersp(result.flight);
    await animateFlight(result.flight, result.kind);
  }
  banner.classList.remove("hidden");
  if (result.runs === 6) flashArena("flash-six");
  else if (result.runs === 4) flashArena("flash-four");
  setCommentary(line);
  speak(line, excitement);

  if (!legal && !reprieved) {
    setTimeout(() => { const l = pickLine("noBall", nameCtx); setCommentary(l); speak(l, 0.7); }, 1700);
  }
  if (match.runs >= 50 && match.runs - result.runs < 50) {
    setTimeout(() => { const l = pickLine("fifty", nameCtx); setCommentary(l); speak(l, 1); fireworks(2); }, 1800);
  }

  if (result.runs === 6) unlockBadge("six1");
  if (match.stats.sixes >= 3) unlockBadge("three6");
  if (onFire) unlockBadge("fire");
  if (match.runs >= 50) unlockBadge("fifty");

  match.history.push(result);
  addBallChip(result, wicketCounted, !legal);
  paintHud();
  fillResultGrid(delivery, swing, result, diff, intent, { legal, reprieved });
  await wait(result.flight ? 500 : 900);
  if (match.over) return;
  if (matchDone()) return endMatch();
  sheetView("view-result");
}

function bannerSub(result, swing, delivery) {
  const f = result.flight;
  switch (result.kind) {
    case "six": return `+6 · ${Math.round(f.dist)} m over ${regionName(f.dir)}`;
    case "four": return `+4 · pierced ${regionName(f.dir)}`;
    case "runs": return `+${result.runs} · into ${regionName(f.dir)}`;
    case "edge4": return "+4 · off the edge, lucky!";
    case "bowled": return `${delivery.kmh} km/h ${delivery.length.key} was too good`;
    case "caught": return `taken at ${regionName(f.dir)}`;
    case "edgeOut": return "thin edge, keeper takes it";
    case "beaten": return "beaten all ends up";
    case "dot": return `dead-batted to ${regionName(f.dir)}`;
    case "mistime": return "off the splice, no timing";
    case "missLine": return `ball was ${delivery.line.label}, bat went the other way`;
    case "missEarly": return "swing finished before the ball arrived";
    case "missLate": return "the ball beat the bat";
    case "lbw": return "trapped dead in front";
    case "leave": return "well judged outside off";
    case "fielded": return `cut off at ${regionName(f.dir)}`;
    default: return "";
  }
}

function flashArena(cls) {
  const a = document.querySelector(".arena");
  a.classList.remove("flash-six", "flash-four");
  void a.offsetWidth;
  a.classList.add(cls);
  setTimeout(() => a.classList.remove(cls), 750);
}

function fillResultGrid(delivery, swing, result, diff, intent, flags) {
  const nb = flags.legal ? "" : ` <span class="rg-bad">NO BALL</span>`;
  const bowlCol = `
    <div class="rg-col">
      <div class="rg-head bowl">BOWLING${nb}</div>
      <div class="rg-line">${delivery.emoji} <b>${delivery.kmh}</b> km/h · ${delivery.bowler.name}</div>
      <div class="rg-line">${delivery.length.label} <small>· ${delivery.line.label}</small></div>
      <div class="rg-line">${moveArrow(delivery)} ${delivery.move.label}</div>
    </div>`;
  let batCol;
  if (!swing) {
    const note =
      result.kind === "bowled" ? "The stumps paid the price" :
      result.kind === "leave" ? "Good judgement, shouldered arms" :
      "Beaten. Swing at the thock sound";
    batCol = `
      <div class="rg-col">
        <div class="rg-head bat">BATTING · ${INTENTS[intentKey].label}</div>
        <div class="rg-line ${result.kind === "leave" ? "" : "rg-bad"}">${result.kind === "leave" ? "Left alone" : "No bat on ball"}</div>
        <div class="rg-line"><small>${note}</small></div>
      </div>`;
  } else if (["missLine", "missEarly", "missLate", "lbw", "bowled"].includes(result.kind)) {
    const why =
      result.kind === "missLine" ? `Ball ${delivery.line.label}, you swung ${describeSwing(swing)}. Match the line!` :
      result.kind === "missEarly" || result.kind === "lbw" ? `${Math.abs(Math.round(swing.timingErr * 1000))} ms early. Wait for the thock.` :
      `${Math.round(swing.timingErr * 1000)} ms late. Start the swing at the bounce.`;
    batCol = `
      <div class="rg-col">
        <div class="rg-head bat">BATTING · ${intent.label}</div>
        <div class="rg-line">💨 <b>${swing.batSpeedKmh}</b> km/h · ${describeSwing(swing)}</div>
        <div class="rg-line rg-bad">SWING AND A MISS</div>
        <div class="rg-line"><small>${why}</small></div>
      </div>`;
  } else {
    const ms = Math.round(swing.timingErr * 1000);
    const effWindow = diff.window * (intent.window || 1);
    const timing = Math.abs(ms) <= 60 ? `<span class="rg-perfect">PERFECT</span>` : ms < 0 ? `<b>${-ms} ms</b> early` : `<b>${ms} ms</b> late`;
    const q = Math.max(0, 1 - Math.abs(swing.timingErr) / effWindow);
    const stars = "★".repeat(Math.max(1, Math.round(q * 5))).padEnd(5, "☆");
    const shotLine = result.flight
      ? `${Math.round(result.flight.dist)} m ${result.flight.airborne ? "over" : "along"} ${regionName(result.flight.dir)}`
      : "no ball to hit";
    batCol = `
      <div class="rg-col">
        <div class="rg-head bat">BATTING · ${intent.label}</div>
        <div class="rg-line">💨 <b>${swing.batSpeedKmh}</b> km/h · ${describeSwing(swing)} · ${timing}</div>
        <div class="rg-line"><small>Swing read: ${swing.swingAng != null ? (swing.swingAng < -8 ? "LEG" : swing.swingAng > 8 ? "OFF" : "STRAIGHT") + " " + Math.abs(Math.round(swing.swingAng)) + "°" : "n/a"} · target ${Math.round(idealShotDeg(delivery))}°</small></div>
        <div class="rg-line">Contact <span class="rg-stars">${stars}</span>${result.contact === "middle" ? ' <span class="rg-perfect">MIDDLED!</span>' : ""}</div>
        <div class="rg-line">📍 ${shotLine}</div>
      </div>`;
  }
  let coach = "";
  if (match.mode === "practice") {
    let tip;
    if (!swing) tip = "No swing detected. Give it a proper whack right after the bounce.";
    else {
      const ms = Math.round(swing.timingErr * 1000);
      if (Math.abs(ms) <= 60) tip = "That's the sweet spot. Do exactly that again.";
      else if (ms < -120) tip = `${-ms} ms early. Let the ball come to you, swing at the thock.`;
      else if (ms > 120) tip = `${ms} ms late. Start your swing the instant you hear the bounce.`;
      else tip = ms < 0 ? "A touch early. So close." : "A touch late. So close.";
    }
    coach = `<div class="rg-coach">🎓 COACH: ${tip}</div>`;
  }
  $("result-grid").innerHTML = bowlCol + batCol + coach;
}

/* --------- hud --------- */
function paintHud() {
  $("hud-runs").textContent = match.runs;
  $("hud-wkts").textContent = match.wickets;
  $("hud-overs").textContent = isFinite(match.maxBalls)
    ? `${Math.floor(match.balls / 6)}.${match.balls % 6} / ${Math.floor(match.maxBalls / 6)}.0 OV`
    : `${match.balls} BALLS`;
  const tgt = $("hud-target");
  if (match.target != null) {
    const need = match.target - match.runs;
    tgt.textContent = need > 0 ? `NEED ${need} OFF ${match.maxBalls - match.balls}` : "TARGET DOWN!";
  } else tgt.textContent = "";
  $("hud-freehit").classList.toggle("hidden", !match.freeHit);
}

function addBallChip(result, wicketCounted, noBall) {
  const chip = document.createElement("div");
  chip.className = "ball-chip";
  if (noBall) { chip.classList.add("bnb"); chip.textContent = "nb"; }
  else if (wicketCounted) { chip.classList.add("bw"); chip.textContent = "W"; }
  else if (result.runs === 4) { chip.classList.add("b4"); chip.textContent = "4"; }
  else if (result.runs === 6) { chip.classList.add("b6"); chip.textContent = "6"; }
  else chip.textContent = result.runs > 0 ? result.runs : "·";
  const strip = $("ball-strip");
  strip.appendChild(chip);
  const maxChips = innerWidth < 430 ? 6 : 8;
  while (strip.children.length > maxChips) strip.removeChild(strip.firstChild);
}

function setCue(text, flash = false) {
  const cue = $("ball-cue");
  cue.textContent = text;
  cue.classList.toggle("flash", flash);
}
function setCommentary(text) {
  $("commentary").innerHTML = text ? `<span class="mic">🎙</span> ${text}` : "";
}
function vibrate(pattern) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

/* --------- end of match --------- */
function endMatch() {
  match.over = true;
  sensors.disarm();
  stopMarkerLoop();
  document.body.classList.remove("fire", "clutch");

  const chased = match.target != null && match.runs >= match.target;
  const failedChase = match.target != null && !chased;

  if (duel.active && match.mode === "duel1") {
    duel.p1Runs = match.runs; duel.p1Wkts = match.wickets;
    duel.target = match.runs + 1;
    $("handover-title").textContent = `${duel.p1} SETS ${duel.target}`;
    $("handover-score").textContent = `${match.runs}/${match.wickets}`;
    $("handover-sub").textContent = `${duel.p2} needs ${duel.target} off ${match.maxBalls} balls to win.`;
    const l = `${duel.p1} finishes on ${match.runs}. ${duel.p2}, the chase is yours!`;
    speak(l, 0.6);
    setTimeout(() => show("screen-handover"), 1300);
    return;
  }

  let newRecord = false;
  if (match.runs > best.score) { best.score = match.runs; newRecord = true; }
  if (match.stats.bestBat > best.batSpeed) { best.batSpeed = match.stats.bestBat; newRecord = true; }
  if (match.stats.longestSix > best.longestSix) { best.longestSix = match.stats.longestSix; newRecord = true; }
  best.six = Math.max(best.six, match.stats.sixes);
  best.perfectLife = (best.perfectLife || 0) + match.stats.perfect;
  saveBest();

  $("end-kicker").textContent = match.mode === "practice" ? "NETS SESSION" : `${batterName()} · FULL TIME`;
  $("end-title").textContent = chased ? "TARGET CHASED! 🏆" : failedChase ? "CHASE FALLS SHORT" : "INNINGS OVER";
  $("end-score").textContent = `${match.runs}/${match.wickets}`;
  const sr = match.balls ? Math.round((match.runs / match.balls) * 100) : 0;
  const fav = Object.values(match.vsBowler).filter((t) => t.balls >= 3).sort((a, b) => b.runs - a.runs)[0];
  $("end-verdict").textContent =
    (chased ? "What a finish! " : "") + (newRecord ? "NEW PERSONAL BEST! " : "") + verdictLine(match.runs) +
    (fav ? ` Favourite bowler to bully: ${fav.name}, ${fav.runs} off ${fav.balls}.` : "");

  if (duel.active && match.mode === "duel2") {
    duel.justFinished = true;
    duel.active = false;
    const tie = !chased && match.runs === duel.target - 1;
    $("end-kicker").textContent = "FRIEND DUEL · FULL TIME";
    $("end-score").textContent = `${match.runs}/${match.wickets}`;
    if (tie) {
      $("end-title").textContent = "IT'S A TIE!";
      $("end-verdict").textContent = `${duel.p1} ${duel.p1Runs}/${duel.p1Wkts} · ${duel.p2} ${match.runs}/${match.wickets}. Unbelievable scenes. Rematch swaps the batting order!`;
    } else if (chased) {
      $("end-title").textContent = `${duel.p2} WINS! 🏆`;
      $("end-verdict").textContent = `Chased ${duel.target} with ${match.maxBalls - match.balls} ball${match.maxBalls - match.balls === 1 ? "" : "s"} to spare. ${duel.p1} fetches the snacks.`;
      unlockBadge("duel");
    } else {
      const margin = duel.target - 1 - match.runs;
      $("end-title").textContent = `${duel.p1} WINS! 🏆`;
      $("end-verdict").textContent = `${duel.p2} needed ${duel.target}, made ${match.runs}. ${duel.p1} wins by ${margin} run${margin === 1 ? "" : "s"}.`;
      unlockBadge("duel");
    }
  }

  $("end-stats").innerHTML = `
    <div class="stat-card"><b>${battingGrade()}</b><small>batting grade</small></div>
    <div class="stat-card"><b>${match.stats.perfect}</b><small>perfect-timed shots</small></div>
    <div class="stat-card"><b>${match.stats.bestBat || "--"}</b><small>fastest bat (km/h)</small></div>
    <div class="stat-card"><b>${match.stats.longestSix || "--"}</b><small>longest six (m)</small></div>
    <div class="stat-card"><b>${match.stats.sixes}×6 &nbsp; ${match.stats.fours}×4</b><small>boundaries</small></div>
    <div class="stat-card"><b>${sr}</b><small>strike rate</small></div>`;

  if (best.perfectLife >= 10) unlockBadge("p10");
  if (battingGrade() === "A+" && match.balls >= 6) unlockBadge("aplus");
  if (match.mode === "chase" && chased) unlockBadge("chase");

  const line = chased
    ? pickLine("win", { bat: batterName() })
    : failedChase ? pickLine("lose", { bat: batterName() }) : null;
  if (line) speak(line, chased ? 1 : 0.3);
  if (chased || newRecord) fireworks(3);

  setTimeout(() => { show("screen-end"); drawWheel(); }, 1400);
}

function battingGrade() {
  const s = match.stats;
  if (!s.swings) return "D";
  const perfectRate = s.perfect / s.swings;
  const sr = match.balls ? (match.runs / match.balls) * 100 : 0;
  const score = perfectRate * 50 + Math.min(50, sr / 4) + (s.sixes + s.fours) * 2 - match.wickets * 6;
  return score > 75 ? "A+" : score > 60 ? "A" : score > 45 ? "B" : score > 30 ? "C" : "D";
}

function verdictLine(runs) {
  if (runs >= 40) return "You emptied the stands. Selectors are calling.";
  if (runs >= 25) return "Proper hitting! The bowlers are scared of you.";
  if (runs >= 12) return "Solid knock. Now add some sixes.";
  return "The pitch was doing a bit. Go again!";
}

$("btn-share").addEventListener("click", async () => {
  const text = `🏏 ${batterName()} (me) smashed ${match.runs}/${match.wickets} in Gyro Cricket, top bat speed ${match.stats.bestBat} km/h, longest six ${match.stats.longestSix} m. I swing my ACTUAL phone. Beat that.`;
  if (navigator.share) { try { await navigator.share({ text }); } catch (_) {} }
  else {
    try { await navigator.clipboard.writeText(text); } catch (_) {}
    $("btn-share").textContent = "COPIED 📋";
    setTimeout(() => ($("btn-share").textContent = "SHARE 📤"), 1500);
  }
});

/* wagon wheel */
function drawWheel() {
  const c = $("wheel");
  const ctx = c.getContext("2d");
  const W = c.width, cx = W / 2, cy = W / 2, R = W / 2 - 8;
  ctx.clearRect(0, 0, W, W);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "#0e3d20"; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.44, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.setLineDash([4, 5]); ctx.lineWidth = 1; ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "#f2f6ff"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#d8c28c";
  ctx.fillRect(cx - 3.5, cy - R * 0.3, 7, R * 0.3);
  for (const s of match.wheel) {
    const a = (s.dir * Math.PI) / 180;
    const len = Math.min(1.02, s.dist / BOUNDARY) * R;
    const x = cx + Math.sin(a) * len, y = cy - Math.cos(a) * len;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
    ctx.strokeStyle = s.runs === 6 ? "#b6ff3b" : s.runs === 4 ? "#ffd54a" : "rgba(242,246,255,.45)";
    ctx.lineWidth = s.runs >= 4 ? 2.5 : 1.5;
    ctx.stroke();
    if (s.runs >= 4) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
  }
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = "#b6ff3b"; ctx.fill();
}

/* ============================== button mode swing ============================== */
function buttonSwing(windowEnd) {
  return new Promise((resolve) => {
    const btn = $("btn-swing");
    let downAt = 0, resolved = false;
    btn.textContent = "HOLD TO CHARGE";
    const down = (e) => { e.preventDefault(); downAt = performance.now(); btn.classList.add("charging"); btn.textContent = "CHARGING..."; };
    const up = (e) => {
      e.preventDefault();
      if (!downAt || resolved) return;
      finish(performance.now(), Math.min(1, (performance.now() - downAt) / 700));
    };
    const key = (e) => { if (e.code === "Space" && !e.repeat && !downAt) down(e); };
    const keyUp = (e) => { if (e.code === "Space") up(e); };
    function finish(time, power) {
      resolved = true; cleanup();
      btn.classList.remove("charging"); btn.textContent = "HOLD TO CHARGE";
      resolve({
        time, power,
        batSpeedKmh: Math.round(25 + power * 115),
        tilt: 20 + power * 40,
        dirBias: (Math.random() * 2 - 1) * 0.4,
        source: "button",
      });
    }
    function cleanup() {
      btn.removeEventListener("pointerdown", down);
      btn.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", keyUp);
    }
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", keyUp);
    const guard = () => {
      if (resolved) return;
      if (performance.now() > windowEnd) { cleanup(); btn.classList.remove("charging"); btn.textContent = "HOLD TO CHARGE"; resolve(null); }
      else setTimeout(guard, 40);
    };
    setTimeout(guard, 40);
  });
}

/* ============================== canvases ============================== */
const field = $("field");
const fctx = field.getContext("2d");

function resizeCanvases() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = field.parentElement.getBoundingClientRect();
  field.width = Math.max(1, r.width * dpr);
  field.height = Math.max(1, r.height * dpr);
  fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fx.width = innerWidth * dpr;
  fx.height = innerHeight * dpr;
  xctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!markerLoopOn && !ringOn && r.width > 10) drawScene();
}
window.addEventListener("resize", resizeCanvases);
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => resizeCanvases()).observe(field.parentElement);
}

/* ============================================================
   PERSPECTIVE BATTING CAMERA — premium night-stadium render.
   World: batter stumps z=0, bowler stumps z=20, x lateral (m),
   +x = off side for a right hander, y = height (m).
   ============================================================ */
const CAM = { ey: 2.3, ez: -5, f: 1.88, horizon: 0.42 };
function pgeo() {
  const r = field.parentElement.getBoundingClientRect();
  return { w: r.width, h: r.height };
}
function proj(x, y, z, w, h) {
  const dz = Math.max(0.6, z - CAM.ez);
  const s = (CAM.f * h) / dz;
  return { x: w / 2 + x * s, y: h * CAM.horizon - (y - CAM.ey) * s, s };
}
function groundY(z, w, h) { return proj(0, 0, z, w, h).y; }
function markerXm(d) {
  return (settings.rightHanded ? 1 : -1) * d.line.xOff * 1.15;
}
function ellipseFill(x, y, rx, ry) {
  fctx.beginPath();
  fctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  fctx.fill();
}

// static star field (deterministic)
const STARS = Array.from({ length: 42 }, (_, i) => ({
  x: ((i * 131) % 100) / 100,
  y: ((i * 79) % 60) / 100,
  a: 0.15 + ((i * 37) % 10) / 28,
  p: (i * 53) % 7,
}));

const HOARD_TEXT = ["GYRO", "SIX!!", "CRICKET", "SWING", "HOWZAT", "PREMIUM"];
const HOARD_COLS = ["#8dd63c", "#3aa7e0", "#e0b93a", "#d05468"];

let lastSwingDir = null; // handed swing angle, drawn on the replay
let batAnim = null;   // { t0, dur, side, cross }
let batReadyP = 0;    // 0..1 delivery progress: drives the batter's backlift
function triggerBatSwing(swing) {
  const az = swing.azPlayed ?? 0;
  batAnim = {
    t0: performance.now(),
    dur: 260,
    side: az >= 0 ? 1 : -1,
    cross: (swing.horizFrac ?? 0) > 0.5,
  };
  audio.playBatWhoosh();
}

function drawPerspective(opts = {}) {
  const { w, h } = pgeo();
  if (w < 10 || h < 10) return;
  CAM.f = 1.88 + 0.17 * (opts.zoom || 0);
  fctx.clearRect(0, 0, w, h);
  const hor = h * CAM.horizon;
  const now = performance.now();

  /* ---- sky ---- */
  let g = fctx.createLinearGradient(0, 0, 0, hor);
  g.addColorStop(0, "#03060e");
  g.addColorStop(0.55, "#0a1430");
  g.addColorStop(1, "#1b2c55");
  fctx.fillStyle = g;
  fctx.fillRect(0, 0, w, hor + 2);
  for (const st of STARS) {
    fctx.fillStyle = `rgba(230,240,255,${st.a * (0.7 + 0.3 * Math.sin(now / 900 + st.p))})`;
    fctx.fillRect(st.x * w, st.y * hor, 1.4, 1.4);
  }
  // moon with halo
  {
    const mx0 = w * 0.76, my0 = hor * 0.2;
    const mg = fctx.createRadialGradient(mx0, my0, 2, mx0, my0, 44);
    mg.addColorStop(0, "rgba(220,232,255,.35)");
    mg.addColorStop(1, "transparent");
    fctx.fillStyle = mg;
    fctx.fillRect(mx0 - 46, my0 - 46, 92, 92);
    fctx.fillStyle = "#e8eefc";
    fctx.beginPath(); fctx.arc(mx0, my0, 10, 0, Math.PI * 2); fctx.fill();
    fctx.fillStyle = "rgba(180,195,225,.5)";
    fctx.beginPath(); fctx.arc(mx0 - 3, my0 + 2, 2.2, 0, Math.PI * 2); fctx.fill();
    fctx.beginPath(); fctx.arc(mx0 + 4, my0 - 3, 1.5, 0, Math.PI * 2); fctx.fill();
  }
  // thin drifting clouds
  fctx.fillStyle = "rgba(170,195,240,.05)";
  ellipseFill(w * 0.3 + Math.sin(now / 9000) * 20, hor * 0.3, w * 0.3, 9);
  ellipseFill(w * 0.68 + Math.cos(now / 11000) * 16, hor * 0.48, w * 0.24, 7);

  /* ---- floodlight towers with flare ---- */
  for (const fx0 of [0.09, 0.91]) {
    const lx = w * fx0, ly = hor * 0.28;
    const gl = fctx.createRadialGradient(lx, ly, 3, lx, ly, h * 0.34);
    gl.addColorStop(0, "rgba(228,244,255,.6)");
    gl.addColorStop(0.1, "rgba(170,215,255,.16)");
    gl.addColorStop(1, "transparent");
    fctx.fillStyle = gl;
    fctx.fillRect(lx - h * 0.34, ly - h * 0.34, h * 0.68, h * 0.68);
    // lens-flare cross
    fctx.strokeStyle = "rgba(220,240,255,.28)";
    fctx.lineWidth = 1.5;
    fctx.beginPath();
    fctx.moveTo(lx - h * 0.09, ly); fctx.lineTo(lx + h * 0.09, ly);
    fctx.moveTo(lx, ly - h * 0.07); fctx.lineTo(lx, ly + h * 0.07);
    fctx.stroke();
    // tower + lamp grid
    fctx.strokeStyle = "rgba(105,125,165,.6)";
    fctx.lineWidth = 2.5;
    fctx.beginPath(); fctx.moveTo(lx, ly + 4); fctx.lineTo(lx, hor); fctx.stroke();
    fctx.fillStyle = "rgba(238,250,255,.95)";
    for (let i = -2; i <= 2; i++) for (let j = 0; j < 2; j++) fctx.fillRect(lx + i * 5 - 1.5, ly - 8 + j * 5, 3, 3);
  }

  /* ---- stands: two tiers + animated crowd ---- */
  const tier2Top = hor - h * 0.13;
  const tier1Top = hor - h * 0.065;
  g = fctx.createLinearGradient(0, tier2Top, 0, hor);
  g.addColorStop(0, "#070d20");
  g.addColorStop(0.5, "#0d1832");
  g.addColorStop(1, "#182746");
  fctx.fillStyle = g;
  fctx.fillRect(0, tier2Top, w, hor - tier2Top + 1);
  // roof line
  fctx.strokeStyle = "rgba(190,210,240,.35)";
  fctx.lineWidth = 2;
  fctx.beginPath(); fctx.moveTo(0, tier2Top); fctx.lineTo(w, tier2Top); fctx.stroke();
  // tier divider
  fctx.strokeStyle = "rgba(120,140,180,.3)";
  fctx.lineWidth = 1;
  fctx.beginPath(); fctx.moveTo(0, tier1Top); fctx.lineTo(w, tier1Top); fctx.stroke();
  // crowd speckles, twinkling
  for (let i = 0; i < 210; i++) {
    const xx = (((i * 97) % 700) / 700) * w;
    const yy = tier2Top + 3 + (((i * 57) % 100) / 100) * (hor - tier2Top - 4);
    const tw = 0.09 + ((i * 31) % 12) / 55 + 0.05 * Math.sin(now / 420 + i);
    fctx.fillStyle = `rgba(230,238,255,${Math.max(0.05, tw)})`;
    fctx.fillRect(xx, yy, 1.7, 1.7);
  }
  // floodlit haze hanging over the ground
  {
    const hz = fctx.createLinearGradient(0, hor - h * 0.03, 0, hor + h * 0.07);
    hz.addColorStop(0, "rgba(150,200,255,0)");
    hz.addColorStop(0.45, "rgba(150,200,255,.11)");
    hz.addColorStop(1, "rgba(150,200,255,0)");
    fctx.fillStyle = hz;
    fctx.fillRect(0, hor - h * 0.03, w, h * 0.1);
  }

  /* ---- stadium scoreboard (live!) ---- */
  {
    const sw = Math.min(120, w * 0.3), sh = 30;
    const sx = w * 0.5 - sw / 2, sy = tier2Top - sh - 5;
    fctx.fillStyle = "rgba(4,8,18,.92)";
    fctx.beginPath(); fctx.roundRect(sx, sy, sw, sh, 5); fctx.fill();
    fctx.strokeStyle = "rgba(182,255,59,.35)";
    fctx.lineWidth = 1; fctx.stroke();
    fctx.fillStyle = "#b6ff3b";
    fctx.font = `800 ${Math.min(15, sw * 0.14)}px 'Archivo Black', sans-serif`;
    fctx.textAlign = "left";
    fctx.fillText(`${match.runs}/${match.wickets}`, sx + 9, sy + sh * 0.62);
    fctx.fillStyle = "rgba(200,214,240,.85)";
    fctx.font = `600 ${Math.min(9, sw * 0.085)}px 'Space Grotesk', sans-serif`;
    fctx.textAlign = "right";
    fctx.fillText(
      isFinite(match.maxBalls) ? `${Math.floor(match.balls / 6)}.${match.balls % 6} OV` : `${match.balls} B`,
      sx + sw - 8, sy + sh * 0.62);
    fctx.fillStyle = "#ff4d6d";
    fctx.beginPath(); fctx.arc(sx + sw - 8, sy + 8, 2.2, 0, Math.PI * 2); fctx.fill();
  }

  /* ---- boundary hoardings ---- */
  const hy = groundY(58, w, h);
  fctx.fillStyle = "#0a1128";
  fctx.fillRect(0, hy - 11, w, 11);
  const segW = w / 6;
  for (let i = 0; i < 6; i++) {
    const c = HOARD_COLS[i % 4];
    fctx.fillStyle = c;
    fctx.globalAlpha = 0.85;
    fctx.beginPath(); fctx.roundRect(i * segW + 2, hy - 10, segW - 4, 9, 2); fctx.fill();
    fctx.globalAlpha = 1;
    if (segW > 46) {
      fctx.fillStyle = "rgba(10,14,26,.92)";
      fctx.font = "800 7px 'Archivo Black', sans-serif";
      fctx.textAlign = "center";
      fctx.fillText(HOARD_TEXT[i % HOARD_TEXT.length], i * segW + segW / 2, hy - 3.4);
    }
  }
  fctx.strokeStyle = "#f2f6ff";
  fctx.lineWidth = 2;
  fctx.beginPath(); fctx.moveTo(0, hy + 1); fctx.lineTo(w, hy + 1); fctx.stroke();
  // LED board glow spilling onto the grass
  {
    const bg2 = fctx.createLinearGradient(0, hy, 0, hy + h * 0.05);
    bg2.addColorStop(0, "rgba(140,220,255,.12)");
    bg2.addColorStop(1, "transparent");
    fctx.fillStyle = bg2;
    fctx.fillRect(0, hy, w, h * 0.05);
  }

  /* ---- outfield: gradient grass + perspective stripes + light pools ---- */
  g = fctx.createLinearGradient(0, hy, 0, h);
  g.addColorStop(0, "#0c351d");
  g.addColorStop(0.55, "#11492a");
  g.addColorStop(1, "#175c34");
  fctx.fillStyle = g;
  fctx.fillRect(0, hy, w, h - hy);
  const zBands = [58, 40, 28, 20.5, 14.5, 10, 6.6, 4.2, 2.4];
  for (let i = 0; i < zBands.length; i += 2) {
    const yTop = groundY(zBands[i], w, h);
    const yBot = i + 1 >= zBands.length ? h : groundY(zBands[i + 1], w, h);
    fctx.fillStyle = "rgba(0,0,0,.14)";
    fctx.fillRect(0, yTop, w, yBot - yTop + 1);
  }
  // floodlight pools on the grass
  for (const px0 of [0.22, 0.78]) {
    const py = groundY(18, w, h);
    const pool = fctx.createRadialGradient(w * px0, py, 4, w * px0, py, w * 0.4);
    pool.addColorStop(0, "rgba(215,255,220,.07)");
    pool.addColorStop(1, "transparent");
    fctx.fillStyle = pool;
    fctx.fillRect(0, hy, w, h - hy);
  }
  // circular mow rings around the square
  fctx.strokeStyle = "rgba(255,255,255,.05)";
  for (const zc of [8.5, 14.5]) {
    fctx.lineWidth = h * 0.014;
    fctx.beginPath();
    fctx.ellipse(w / 2, groundY(zc, w, h), w * 0.44, h * 0.022, 0, 0, Math.PI * 2);
    fctx.stroke();
  }

  /* ---- sight screen behind the bowler ---- */
  {
    const scw = 5.4, sch = 3.4, sz = 34;
    const a = proj(-scw / 2 + 0.6, 0, sz, w, h), b = proj(scw / 2 + 0.6, 0, sz, w, h);
    const tp = proj(0.6, sch, sz, w, h);
    fctx.fillStyle = "rgba(226,232,244,.92)";
    fctx.beginPath(); fctx.roundRect(a.x, tp.y, b.x - a.x, a.y - tp.y, 3); fctx.fill();
    fctx.strokeStyle = "rgba(90,110,150,.5)";
    fctx.lineWidth = 1.5; fctx.stroke();
  }

  /* ---- 30-yard dashes ---- */
  const y30 = groundY(27, w, h);
  fctx.setLineDash([5, 8]);
  fctx.strokeStyle = "rgba(242,246,255,.25)";
  fctx.lineWidth = 1.2;
  fctx.beginPath(); fctx.moveTo(w * 0.05, y30); fctx.lineTo(w * 0.95, y30); fctx.stroke();
  fctx.setLineDash([]);

  /* ---- pitch: receding, worn, lit ---- */
  const pw2 = 1.53, zFar = 20.4;
  const fl = proj(-pw2, 0, zFar, w, h), fr = proj(pw2, 0, zFar, w, h);
  const nl = proj(-pw2 * 1.7, 0, 2.4, w, h), nr = proj(pw2 * 1.7, 0, 2.4, w, h);
  g = fctx.createLinearGradient(0, fl.y, 0, h);
  g.addColorStop(0, "#a98f58");
  g.addColorStop(0.55, "#c9ae74");
  g.addColorStop(1, "#e0cb94");
  fctx.fillStyle = g;
  fctx.beginPath();
  fctx.moveTo(nl.x, h); fctx.lineTo(fl.x, fl.y); fctx.lineTo(fr.x, fr.y); fctx.lineTo(nr.x, h);
  fctx.closePath(); fctx.fill();
  // side shading for depth
  fctx.fillStyle = "rgba(0,0,0,.12)";
  fctx.beginPath(); fctx.moveTo(nl.x, h); fctx.lineTo(fl.x, fl.y); fctx.lineTo(fl.x + (fr.x - fl.x) * 0.07, fl.y); fctx.lineTo(nl.x + (nr.x - nl.x) * 0.07, h); fctx.closePath(); fctx.fill();
  fctx.beginPath(); fctx.moveTo(nr.x, h); fctx.lineTo(fr.x, fr.y); fctx.lineTo(fr.x - (fr.x - fl.x) * 0.07, fr.y); fctx.lineTo(nr.x - (nr.x - nl.x) * 0.07, h); fctx.closePath(); fctx.fill();
  // wear patches on a length
  fctx.fillStyle = "rgba(120,95,55,.25)";
  const wp = proj(0.2, 0, 7, w, h);
  ellipseFill(wp.x, wp.y, wp.s * 0.5, wp.s * 0.16);
  const wp2 = proj(-0.4, 0, 12, w, h);
  ellipseFill(wp2.x, wp2.y, wp2.s * 0.4, wp2.s * 0.12);
  // creases
  // roller sheen streaks down the deck
  fctx.strokeStyle = "rgba(255,255,255,.05)";
  fctx.lineWidth = 2;
  for (const rx of [-0.75, 0, 0.75]) {
    const a = proj(rx * 1.5, 0, 2.4, w, h), b = proj(rx, 0, zFar, w, h);
    fctx.beginPath(); fctx.moveTo(a.x, h); fctx.lineTo(b.x, b.y); fctx.stroke();
  }
  const crease = (z, alpha) => {
    const a = proj(-pw2, 0, z, w, h), b = proj(pw2, 0, z, w, h);
    fctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    fctx.beginPath(); fctx.moveTo(a.x, a.y); fctx.lineTo(b.x, b.y); fctx.stroke();
  };
  fctx.lineWidth = 1.6;
  crease(18.9, 0.85); // popping crease
  crease(20.1, 0.55); // bowling crease
  crease(3.4, 0.5);
  // return creases at the far end
  fctx.strokeStyle = "rgba(255,255,255,.5)";
  for (const rx of [-pw2 * 0.62, pw2 * 0.62]) {
    const a = proj(rx, 0, 18.9, w, h), b = proj(rx, 0, 20.3, w, h);
    fctx.beginPath(); fctx.moveTo(a.x, a.y); fctx.lineTo(b.x, b.y); fctx.stroke();
  }

  /* ---- far stumps: LED glow, like an IPL night game ---- */
  {
    const base = proj(0, 0, 20.1, w, h);
    fctx.fillStyle = "rgba(0,0,0,.3)";
    ellipseFill(base.x + base.s * 0.06, base.y + 1, base.s * 0.13, base.s * 0.035);
    fctx.save();
    fctx.shadowColor = "rgba(182,255,59,.75)";
    fctx.shadowBlur = 7;
    fctx.strokeStyle = "#ffffff";
    fctx.lineWidth = Math.max(1.6, base.s * 0.05);
    for (const off of [-0.115, 0, 0.115]) {
      const b0 = proj(off, 0, 20.1, w, h), t0 = proj(off, 0.71, 20.1, w, h);
      fctx.beginPath(); fctx.moveTo(b0.x, b0.y); fctx.lineTo(t0.x, t0.y); fctx.stroke();
    }
    const bl = proj(-0.16, 0.73, 20.1, w, h), br = proj(0.16, 0.73, 20.1, w, h);
    fctx.beginPath(); fctx.moveTo(bl.x, bl.y); fctx.lineTo(br.x, br.y); fctx.stroke();
    fctx.restore();
  }

  /* ---- umpire behind the stumps ---- */
  {
    const p = proj(-(settings.rightHanded ? 1 : -1) * 0.55, 0, 22.2, w, h);
    const H = Math.min(120, Math.max(8, p.s * 1.72));
    fctx.fillStyle = "rgba(0,0,0,.28)";
    ellipseFill(p.x, p.y + 1, H * 0.14, H * 0.04);
    fctx.strokeStyle = "#23262e"; // dark trousers
    fctx.lineWidth = Math.max(1.4, H * 0.08);
    fctx.lineCap = "round";
    fctx.beginPath();
    fctx.moveTo(p.x - H * 0.05, p.y); fctx.lineTo(p.x - H * 0.04, p.y - H * 0.42);
    fctx.moveTo(p.x + H * 0.05, p.y); fctx.lineTo(p.x + H * 0.04, p.y - H * 0.42);
    fctx.stroke();
    fctx.fillStyle = "#e8ecf5"; // white shirt
    fctx.beginPath();
    fctx.roundRect(p.x - H * 0.12, p.y - H * 0.74, H * 0.24, H * 0.34, H * 0.05);
    fctx.fill();
    fctx.fillStyle = "#e8c39e";
    fctx.beginPath(); fctx.arc(p.x, p.y - H * 0.84, H * 0.09, 0, Math.PI * 2); fctx.fill();
    fctx.fillStyle = "#2a2f3a"; // wide-brim hat
    ellipseFill(p.x, p.y - H * 0.9, H * 0.13, H * 0.035);
    fctx.beginPath(); fctx.arc(p.x, p.y - H * 0.91, H * 0.06, Math.PI, 0); fctx.fill();
  }

  /* ---- fielders ---- */
  for (const f0 of fielderPositions()) {
    const a = (f0.dir * Math.PI) / 180;
    const X = Math.sin(a) * f0.dist * (settings.rightHanded ? 1 : -1);
    const Z = Math.cos(a) * f0.dist;
    if (Z < 4.5) continue;
    const p = proj(X, 0, Z, w, h);
    if (p.x < -30 || p.x > w + 30) continue;
    fctx.fillStyle = "rgba(0,0,0,.3)";
    ellipseFill(p.x, p.y + 1, Math.min(16, p.s * 0.22), Math.min(5, p.s * 0.06));
    drawFigure(p.x, p.y, p.s);
  }

  /* ---- pitch marker ---- */
  if (opts.marker && currentDelivery) {
    const mx = markerXm(currentDelivery);
    const mz = currentDelivery.length.pitchM;
    const p = proj(mx, 0, mz, w, h);
    const pulse = 1 + Math.sin(now / 140) * 0.22;
    const mrx = Math.min(34, p.s * 0.38), mry = Math.min(13, p.s * 0.14);
    fctx.fillStyle = "rgba(255,213,74,.28)";
    ellipseFill(p.x, p.y, mrx * pulse, mry * pulse);
    fctx.fillStyle = "#ffd54a";
    ellipseFill(p.x, p.y, Math.min(13, p.s * 0.14), Math.min(5, p.s * 0.055));
    const shift = (settings.rightHanded ? 1 : -1) * currentDelivery.move.dirShift;
    if (shift) {
      const dx = Math.sign(shift) * Math.min(46, p.s * 0.55);
      fctx.strokeStyle = "#b6ff3b";
      fctx.lineWidth = 2.5;
      fctx.beginPath();
      fctx.moveTo(p.x + Math.sign(shift) * Math.min(17, p.s * 0.2), p.y);
      fctx.lineTo(p.x + dx, p.y);
      fctx.lineTo(p.x + dx - Math.sign(shift) * 6, p.y - 4);
      fctx.moveTo(p.x + dx, p.y);
      fctx.lineTo(p.x + dx - Math.sign(shift) * 6, p.y + 4);
      fctx.stroke();
    }
  }

  /* ---- bowler ---- */
  if (opts.bowlerZ) {
    const bx = (settings.rightHanded ? 0.85 : -0.85);
    const p = proj(bx, 0, opts.bowlerZ, w, h);
    fctx.fillStyle = "rgba(0,0,0,.32)";
    ellipseFill(p.x + 3, p.y + 1, Math.min(22, p.s * 0.3), Math.min(6, p.s * 0.07));
    drawBowler(p.x, p.y, p.s, opts.bowlerPose || { kind: "idle", t: performance.now() / 1000 }, !opts.ball);
  }

  /* ---- ball: shadow, motion blur, seam ---- */
  if (opts.ball) {
    const b = opts.ball;
    const sp = proj(b.x, 0, b.z, w, h);
    fctx.fillStyle = "rgba(0,0,0,.45)";
    ellipseFill(sp.x, sp.y, Math.min(14, sp.s * 0.085), Math.min(5, sp.s * 0.032));
    const bp = proj(b.x, b.y, b.z, w, h);
    if (opts.trail && opts.trail.length > 1) {
      const t0p = opts.trail[Math.max(0, opts.trail.length - 4)];
      const pp = proj(t0p.x, t0p.y, t0p.z, w, h);
      const grad2 = fctx.createLinearGradient(pp.x, pp.y, bp.x, bp.y);
      grad2.addColorStop(0, "rgba(255,90,90,0)");
      grad2.addColorStop(1, "rgba(255,90,90,.55)");
      fctx.strokeStyle = grad2;
      fctx.lineWidth = Math.max(3, bp.s * 0.06);
      fctx.lineCap = "round";
      fctx.beginPath(); fctx.moveTo(pp.x, pp.y); fctx.lineTo(bp.x, bp.y); fctx.stroke();
    }
    const r0 = Math.max(3, bp.s * 0.05);
    fctx.save();
    fctx.shadowColor = "rgba(255,80,80,.9)";
    fctx.shadowBlur = 10;
    const bg = fctx.createRadialGradient(bp.x - r0 / 3, bp.y - r0 / 3, r0 * 0.2, bp.x, bp.y, r0);
    bg.addColorStop(0, "#ff9d9d");
    bg.addColorStop(0.5, "#f03e3e");
    bg.addColorStop(1, "#a11212");
    fctx.beginPath(); fctx.arc(bp.x, bp.y, r0, 0, Math.PI * 2);
    fctx.fillStyle = bg; fctx.fill();
    fctx.restore();
    if (r0 > 4) {
      fctx.strokeStyle = "rgba(255,235,235,.6)";
      fctx.lineWidth = 1;
      fctx.beginPath();
      fctx.arc(bp.x, bp.y, r0 * 0.62, -0.9, 1.1);
      fctx.stroke();
    }
  }

  /* ---- bounce flash ---- */
  if (opts.bounceFlash && currentDelivery) {
    const p = proj(markerXm(currentDelivery), 0, currentDelivery.length.pitchM, w, h);
    fctx.strokeStyle = `rgba(255,213,74,${opts.bounceFlash})`;
    fctx.lineWidth = 2;
    fctx.beginPath();
    fctx.ellipse(p.x, p.y,
      Math.min(52, p.s * (0.5 - opts.bounceFlash * 0.2)),
      Math.min(20, p.s * (0.2 - opts.bounceFlash * 0.08)), 0, 0, Math.PI * 2);
    fctx.stroke();
  }

  /* ---- contact flash ---- */
  if (opts.contactFlash) {
    const cp = proj(0.15, 0.8, 2, w, h);
    const cf = fctx.createRadialGradient(cp.x, cp.y, 2, cp.x, cp.y, h * 0.22);
    cf.addColorStop(0, `rgba(255,255,240,${opts.contactFlash * 0.9})`);
    cf.addColorStop(1, "transparent");
    fctx.fillStyle = cf;
    fctx.fillRect(0, 0, w, h);
  }

  if (opts.gauge) drawSwingGauge(w, h);
  drawBatter(w, h);

  /* ---- cinematic vignette + film grade ---- */
  const vg = fctx.createRadialGradient(w / 2, h * 0.45, h * 0.3, w / 2, h * 0.45, h * 0.85);
  vg.addColorStop(0, "transparent");
  vg.addColorStop(1, "rgba(2,4,10,.35)");
  fctx.fillStyle = vg;
  fctx.fillRect(0, 0, w, h);
  const grade = fctx.createLinearGradient(0, 0, 0, h);
  grade.addColorStop(0, "rgba(70,120,255,.05)");
  grade.addColorStop(0.5, "rgba(0,0,0,0)");
  grade.addColorStop(1, "rgba(255,150,60,.045)");
  fctx.fillStyle = grade;
  fctx.fillRect(0, 0, w, h);
}

/* fielder at true human scale, in team blues */
function drawFigure(x, y, s) {
  const H = Math.min(130, Math.max(7, s * 1.7));
  const lw = Math.max(1.2, H * 0.09);
  fctx.strokeStyle = "#12275c";
  fctx.lineWidth = lw;
  fctx.lineCap = "round";
  fctx.beginPath();
  fctx.moveTo(x - H * 0.08, y); fctx.lineTo(x, y - H * 0.42);
  fctx.moveTo(x + H * 0.08, y); fctx.lineTo(x, y - H * 0.42);
  fctx.stroke();
  // shoes
  fctx.fillStyle = "#f2f6ff";
  ellipseFill(x - H * 0.08, y, H * 0.05, H * 0.025);
  ellipseFill(x + H * 0.08, y, H * 0.05, H * 0.025);
  const jg = fctx.createLinearGradient(x, y - H * 0.78, x, y - H * 0.38);
  jg.addColorStop(0, "#3f7dff");
  jg.addColorStop(1, "#1e4dc4");
  fctx.fillStyle = jg;
  fctx.beginPath();
  fctx.roundRect(x - H * 0.13, y - H * 0.78, H * 0.26, H * 0.4, H * 0.06);
  fctx.fill();
  fctx.strokeStyle = "rgba(6,10,24,.4)";
  fctx.lineWidth = 1;
  fctx.stroke();
  fctx.strokeStyle = "#2e6bff";
  fctx.lineWidth = lw * 0.8;
  fctx.beginPath();
  fctx.moveTo(x - H * 0.12, y - H * 0.7); fctx.lineTo(x - H * 0.2, y - H * 0.45);
  fctx.moveTo(x + H * 0.12, y - H * 0.7); fctx.lineTo(x + H * 0.2, y - H * 0.45);
  fctx.stroke();
  fctx.fillStyle = "#e8c39e";
  fctx.beginPath(); fctx.arc(x, y - H * 0.88, H * 0.11, 0, Math.PI * 2); fctx.fill();
  fctx.fillStyle = "#12275c"; // cap
  fctx.beginPath(); fctx.arc(x, y - H * 0.92, H * 0.1, Math.PI + 0.4, -0.4); fctx.fill();
}

/* the bowler: keyframed action, viewed front-on.
   run (knees pumping, arms driving) -> gather (the leap, arms loading)
   -> deliver (arm whips over the top) -> follow-through */
function drawBowler(x, y, s, pose = { kind: "idle", t: 0 }, hasBall = true) {
  const H = Math.min(170, Math.max(10, s * 1.85));
  const lw = Math.max(1.6, H * 0.085);
  const k = pose.kind, t = pose.t;

  let bob = 0, lean = 0;
  let liftL = 0, liftR = 0;        // knee lifts 0..1
  let angL = 0.12, angR = -0.1;    // hand angle: 0 = straight down, PI = overhead
  let extL = 0.9, extR = 0.9;      // arm extension

  if (k === "run") {
    const c = Math.sin(t);
    bob = Math.abs(Math.cos(t)) * H * 0.025;
    lean = 0.12;
    liftL = Math.max(0, c); liftR = Math.max(0, -c);
    angL = 0.5 + 0.45 * c; angR = 0.5 - 0.45 * c;
    extL = extR = 0.55;
  } else if (k === "gather") {
    const e = Math.sin(Math.min(1, t) * Math.PI);
    bob = -H * 0.07 * e; // the leap
    lean = 0.05;
    liftL = 0.75 * e; liftR = 0.3 * e;
    angL = 2.1 * Math.min(1, t); angR = 2.5 * Math.min(1, t); // both arms load up
    extL = extR = 0.75;
  } else if (k === "deliver") {
    const e = Math.min(1, t);
    lean = 0.26 * e;
    liftR = 0.35 * (1 - e);
    angR = 2.9 - e * 3.3;  // bowling arm whips over the top and down
    angL = 2.2 - e * 2.6;  // front arm pulls through
    extR = 1; extL = 0.7;
  } else if (k === "follow") {
    lean = 0.2;
    angR = -0.7; angL = 0.35;
    extL = extR = 0.8;
  } else { // idle at the top of the mark
    bob = Math.sin(t * 2.1) * H * 0.008;
    angL = 0.15; angR = 0.35; // ball cradled at waist
    extL = 0.85; extR = 0.5;
  }

  const hipY = y - H * 0.44 + bob;
  const shoY = y - H * 0.72 + bob;
  const armLen = H * 0.3;

  // legs: hip -> knee -> foot, knees lift while running
  fctx.strokeStyle = "#12275c";
  fctx.lineWidth = lw;
  fctx.lineCap = "round";
  fctx.lineJoin = "round";
  const leg = (side, lift) => {
    const hx = x + side * H * 0.06;
    const footY = y - lift * H * 0.2;
    const footX = x + side * H * 0.09 + lift * side * H * 0.04;
    const kneeX = hx + side * H * 0.03 + lift * side * H * 0.06;
    const kneeY = (hipY + footY) / 2 - lift * H * 0.1;
    fctx.beginPath();
    fctx.moveTo(hx, hipY); fctx.lineTo(kneeX, kneeY); fctx.lineTo(footX, footY);
    fctx.stroke();
  };
  leg(-1, liftL); leg(1, liftR);

  // torso with lean
  const jg = fctx.createLinearGradient(x, shoY - H * 0.05, x, hipY);
  jg.addColorStop(0, "#3f7dff");
  jg.addColorStop(1, "#1e4dc4");
  fctx.save();
  fctx.translate(x, (shoY + hipY) / 2);
  fctx.rotate(lean * 0.5);
  fctx.fillStyle = jg;
  fctx.beginPath();
  fctx.roundRect(-H * 0.14, -(hipY - shoY) / 2 - H * 0.03, H * 0.28, (hipY - shoY) + H * 0.06, H * 0.07);
  fctx.fill();
  fctx.restore();

  // arms: shoulder -> elbow -> hand. Front view: the hand mostly travels
  // vertically as the arm rotates through the action.
  fctx.strokeStyle = "#2e6bff";
  fctx.lineWidth = lw * 0.85;
  const arm = (side, ang, ext) => {
    const sx = x + side * H * 0.13, sy = shoY + H * 0.02;
    const L = armLen * ext;
    const hx2 = sx + side * L * (0.12 + 0.22 * Math.abs(Math.sin(ang)));
    const hy2 = sy + Math.cos(ang) * L;
    const ex2 = sx + side * L * 0.2;
    const ey2 = sy + Math.cos(ang * 0.6) * L * 0.55;
    fctx.beginPath();
    fctx.moveTo(sx, sy); fctx.lineTo(ex2, ey2); fctx.lineTo(hx2, hy2);
    fctx.stroke();
    return { x: hx2, y: hy2 };
  };
  arm(-1, angL, extL);
  const handR = arm(1, angR, extR);

  // head + a hint of collar
  fctx.fillStyle = "#e8c39e";
  fctx.beginPath(); fctx.arc(x + lean * H * 0.08, shoY - H * 0.14, H * 0.105, 0, Math.PI * 2); fctx.fill();
  fctx.fillStyle = "#12275c";
  fctx.beginPath(); fctx.arc(x + lean * H * 0.08, shoY - H * 0.2, H * 0.105, Math.PI + 0.5, -0.5); fctx.fill();

  if (hasBall) {
    fctx.fillStyle = "#ff5252";
    fctx.beginPath();
    fctx.arc(handR.x, handR.y, Math.max(1.5, H * 0.04), 0, Math.PI * 2);
    fctx.fill();
  }
}

/* YOUR batter at the crease: pads, jersey, helmet, live bat swing */
function drawBatter(w, h) {
  const now = performance.now();
  const side = settings.rightHanded ? 1 : -1;
  const cxs = w / 2;
  const H = Math.min(270, h * 0.34);
  const bx = cxs + side * H * 0.42;
  const by = h + H * 0.04;

  // near stumps behind him, LED glow
  fctx.save();
  fctx.shadowColor = "rgba(182,255,59,.6)";
  fctx.shadowBlur = 8;
  fctx.fillStyle = "rgba(244,248,255,.95)";
  for (const off of [-12, 0, 12]) {
    fctx.beginPath();
    fctx.roundRect(cxs + off - 3, h - H * 0.16, 6, H * 0.16, 3);
    fctx.fill();
  }
  fctx.fillRect(cxs - 15, h - H * 0.165, 30, 2.5);
  fctx.restore();

  // shadow
  fctx.fillStyle = "rgba(0,0,0,.4)";
  ellipseFill(bx, h - 4, H * 0.3, H * 0.045);

  // pads (white, back view)
  fctx.fillStyle = "#e9edf6";
  fctx.beginPath(); fctx.roundRect(bx - H * 0.17, by - H * 0.46, H * 0.14, H * 0.42, H * 0.05); fctx.fill();
  fctx.beginPath(); fctx.roundRect(bx + H * 0.03, by - H * 0.46, H * 0.14, H * 0.42, H * 0.05); fctx.fill();
  fctx.strokeStyle = "rgba(150,160,185,.55)";
  fctx.lineWidth = 1;
  for (const px of [bx - H * 0.1, bx + H * 0.1]) {
    fctx.beginPath(); fctx.moveTo(px - H * 0.06, by - H * 0.3); fctx.lineTo(px + H * 0.06, by - H * 0.3); fctx.stroke();
    fctx.beginPath(); fctx.moveTo(px - H * 0.06, by - H * 0.2); fctx.lineTo(px + H * 0.06, by - H * 0.2); fctx.stroke();
  }

  // swing phase drives both the bat AND the body pivot
  let animT = null;
  if (batAnim) {
    animT = (now - batAnim.t0) / batAnim.dur;
    if (animT >= 1.7) { batAnim = null; animT = null; }
  }
  let ang, bodyRot = 0;
  if (animT != null && animT <= 0.55) {
    // downswing: bat whips through, hips open
    const e = 1 - Math.pow(1 - animT / 0.55, 2.6);
    ang = side * (-2.35 + e * 2.75);
    bodyRot = side * 0.14 * e;
  } else if (animT != null && animT <= 1) {
    // follow-through: wraps around the shoulders
    const e = (animT - 0.55) / 0.45;
    ang = side * (0.4 + e * 0.95);
    bodyRot = side * (0.14 + 0.08 * e);
  } else if (animT != null) {
    ang = side * 1.35;
    bodyRot = side * 0.2;
  } else {
    // idle: soft bat tap; backlift loads as the ball comes in
    ang = side * (-0.42 - batReadyP * 0.75 + Math.sin(now / 520) * 0.05 * (1 - batReadyP));
    bodyRot = -side * 0.05 * batReadyP; // coils slightly back
  }

  // torso + helmet pivot together around the hips
  fctx.save();
  fctx.translate(bx, by - H * 0.44);
  fctx.rotate(bodyRot);
  const jg = fctx.createLinearGradient(0, -H * 0.41, 0, H * 0.04);
  jg.addColorStop(0, "#3f7dff");
  jg.addColorStop(1, "#173d9e");
  fctx.fillStyle = jg;
  fctx.beginPath();
  fctx.roundRect(-H * 0.2, -H * 0.4, H * 0.4, H * 0.42, H * 0.09);
  fctx.fill();
  fctx.strokeStyle = "rgba(182,255,59,.5)";
  fctx.lineWidth = 2;
  fctx.beginPath(); fctx.moveTo(-H * 0.2, -H * 0.06); fctx.lineTo(H * 0.2, -H * 0.06); fctx.stroke();
  // jersey number on the back
  fctx.fillStyle = "rgba(255,255,255,.85)";
  fctx.font = `800 ${Math.round(H * 0.14)}px 'Archivo Black', sans-serif`;
  fctx.textAlign = "center";
  fctx.fillText(String(duel.active ? 7 : batterDef().num || 18), 0, -H * 0.16);
  // helmet
  fctx.fillStyle = "#101c46";
  fctx.beginPath(); fctx.arc(-side * H * 0.03, -H * 0.48, H * 0.11, 0, Math.PI * 2); fctx.fill();
  fctx.strokeStyle = "rgba(190,205,235,.4)";
  fctx.lineWidth = 1.5;
  fctx.beginPath(); fctx.arc(-side * H * 0.03, -H * 0.48, H * 0.11, 0.4, 2.7); fctx.stroke();
  fctx.restore();

  // bat, swung about the hands
  const handleX = bx + side * H * 0.16 + bodyRot * H * 0.3;
  const handleY = by - H * 0.62;
  if (animT != null && animT <= 1) {
    // swoosh arc chasing the blade
    fctx.save();
    fctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - animT)})`;
    fctx.lineWidth = H * 0.05;
    fctx.lineCap = "round";
    fctx.beginPath();
    const a0 = side * -2.35 + Math.PI / 2, a1 = ang + Math.PI / 2;
    fctx.arc(handleX, handleY, H * 0.52, Math.min(a0, a1), Math.max(a0, a1));
    fctx.stroke();
    fctx.restore();
  }
  fctx.save();
  fctx.translate(handleX, handleY);
  fctx.rotate(ang);
  fctx.fillStyle = "#2a2118";
  fctx.beginPath(); fctx.roundRect(-H * 0.02, -H * 0.02, H * 0.04, H * 0.18, H * 0.02); fctx.fill();
  const blade = fctx.createLinearGradient(-H * 0.05, 0, H * 0.05, 0);
  blade.addColorStop(0, "#b89a63");
  blade.addColorStop(0.5, "#e3c990");
  blade.addColorStop(1, "#a58852");
  fctx.fillStyle = blade;
  fctx.beginPath(); fctx.roundRect(-H * 0.05, H * 0.14, H * 0.1, H * 0.5, H * 0.04); fctx.fill();
  fctx.restore();

  // gloves/arms to the handle
  fctx.strokeStyle = "#e8c39e";
  fctx.lineWidth = Math.max(2, H * 0.045);
  fctx.lineCap = "round";
  fctx.beginPath();
  fctx.moveTo(bx - side * H * 0.06, by - H * 0.68);
  fctx.lineTo(handleX, handleY + H * 0.03);
  fctx.stroke();
}

/* bottom swing gauge: gold tick = ideal line, green needle = your gyro */
function drawSwingGauge(w, h) {
  const gx = w / 2, gy = h - 4, R = Math.min(126, w * 0.3);
  fctx.strokeStyle = "rgba(242,246,255,.16)";
  fctx.lineWidth = 5;
  fctx.beginPath(); fctx.arc(gx, gy, R, Math.PI * 1.08, Math.PI * 1.92); fctx.stroke();
  fctx.fillStyle = "rgba(141,154,192,.8)";
  fctx.font = "700 9px 'Space Grotesk', sans-serif";
  fctx.textAlign = "center";
  fctx.fillText("LEG", gx - R - 2, gy - 12);
  fctx.fillText("OFF", gx + R + 2, gy - 12);
  const toXY = (deg, len) => {
    const ang = (deg * Math.PI) / 180;
    return { x: gx + Math.sin(ang) * len, y: gy - Math.cos(ang) * len };
  };
  if (currentDelivery) {
    const ideal = (settings.rightHanded ? 1 : -1) * idealShotDeg(currentDelivery);
    const p1 = toXY(ideal, R - 9), p2 = toXY(ideal, R + 9);
    fctx.strokeStyle = "#ffd54a";
    fctx.lineWidth = 4;
    fctx.beginPath(); fctx.moveTo(p1.x, p1.y); fctx.lineTo(p2.x, p2.y); fctx.stroke();
  }
  if (!match.buttonMode) {
    const lm = sensors.liveMotion();
    if (lm.pointDeg != null || lm.rot > 60) {
      let azv = lm.pointDeg != null
        ? lm.pointDeg * (settings.gyroSign || 1)                  // where the bat points
        : -(lm.yaw || 0) * 0.22 * (settings.gyroSign || 1);       // fallback: rate
      if (!settings.rightHanded) azv = -azv;
      const tip = toXY(Math.max(-100, Math.min(100, azv)), R - 14);
      fctx.save();
      fctx.shadowColor = "rgba(182,255,59,.9)";
      fctx.shadowBlur = 10;
      fctx.strokeStyle = "#b6ff3b";
      fctx.lineWidth = 4;
      fctx.lineCap = "round";
      fctx.beginPath(); fctx.moveTo(gx, gy); fctx.lineTo(tip.x, tip.y); fctx.stroke();
      fctx.restore();
    }
  }
}

/* ---- scout & run-up loop ---- */
let markerLoopOn = false;
function startMarkerLoop() {
  if (markerLoopOn) return;
  markerLoopOn = true;
  const step = () => {
    if (!markerLoopOn) return;
    const now = performance.now();
    const ru = runupState.active
      ? Math.min(1, Math.max(0, (now - runupState.t0) / runupState.dur))
      : 0;
    // run -> gather leap -> delivery stride, timed to the run-up
    let pose;
    if (!runupState.active) pose = { kind: "idle", t: now / 1000 };
    else if (ru < 0.72) pose = { kind: "run", t: now / 95 };
    else if (ru < 0.9) pose = { kind: "gather", t: (ru - 0.72) / 0.18 };
    else pose = { kind: "deliver", t: (ru - 0.9) / 0.1 };
    drawPerspective({
      marker: true,
      bowlerZ: 27.5 - ru * 6.9,
      bowlerPose: pose,
      gauge: true,
      zoom: ru,
    });
    nextFrame(step);
  };
  nextFrame(step);
}
function stopMarkerLoop() { markerLoopOn = false; }

/* ---- delivery: perspective ball tracking ---- */
let ringOn = false;
function startTimingRing(tRelease, tBounce, tContact) {
  stopTimingRing();
  stopMarkerLoop();
  ringOn = true;
  const trail = [];
  let dustDone = false;

  // ---- real ball physics, precomputed for this delivery ----
  // Pre-bounce: projectile under gravity from a 2.2 m release point,
  // solved so the ball meets the pitch exactly at the marker.
  // Post-bounce: restitution off the deck. Full balls skid low,
  // short balls climb; bouncers genuinely go for the badge.
  const d0 = currentDelivery;
  const tbS = (tBounce - tRelease) / 1000;
  const taS = (tContact - tBounce) / 1000;
  const G = 9.81;
  let vy0 = d0 ? (0.5 * G * tbS * tbS - 2.2) / tbS : 0;
  vy0 = Math.max(-4, Math.min(1, vy0));
  const yEnd = 2.2 + vy0 * tbS - 0.5 * G * tbS * tbS; // residual after clamping
  const mzP = d0 ? d0.length.pitchM : 6;
  const vyImp = Math.abs(vy0 - G * tbS);
  const kickMul = Math.max(0.35, Math.min(1.55, mzP / 6)) * (d0 && d0.length.key === "bouncer" ? 1.25 : 1);
  const vy1 = vyImp * 0.42 * kickMul;
  // swing moves in the AIR (pace), spin breaks OFF THE PITCH
  const isAirSwing = d0 && ["inswing", "outswing"].includes(d0.move.key);
  const devSign = d0 ? (settings.rightHanded ? 1 : -1) * Math.sign(d0.move.dirShift || 0) : 0;
  const devMag = d0 ? Math.abs(d0.move.dirShift) * 0.011 : 0;

  const step = () => {
    if (!ringOn) return;
    const now = performance.now();
    const p = Math.min(1, (now - tRelease) / (tContact - tRelease));
    const d = currentDelivery;
    let ball = null;
    if (d) {
      const mx = markerXm(d);
      const mz = d.length.pitchM;
      if (now < tBounce) {
        const t = Math.max(0, (now - tRelease) / 1000);
        const u = Math.min(1, t / tbS);
        // late in-air swing bends into (or away from) the marker
        const bendFull = isAirSwing ? devSign * devMag : 0;
        const aimX = mx - bendFull;
        ball = {
          x: mx * 0.2 * (1 - u) + aimX * u + bendFull * u * u * u,
          y: Math.max(0.03, 2.2 + vy0 * t - 0.5 * G * t * t - yEnd * u),
          z: 19.6 - (19.6 - mz) * u,
        };
      } else {
        const t = Math.max(0, (now - tBounce) / 1000);
        const u = Math.min(1, t / taS);
        // spin grips and breaks off the pitch; swing mostly done by now
        const breakM = (isAirSwing ? devSign * devMag * 0.3 : devSign * devMag * 1.6);
        ball = {
          x: mx + breakM * u,
          y: Math.max(0.04, vy1 * t - 0.5 * G * t * t),
          z: mz - (mz - 1.9) * u,
        };
      }
      trail.push(ball);
      if (trail.length > 7) trail.shift();
      batReadyP = p; // batter raises the backlift as the ball comes in
    }
    const sinceBounce = now - tBounce;
    if (sinceBounce > 0 && !dustDone && d) {
      dustDone = true;
      spawnDust(markerXm(d), d.length.pitchM);
    }
    drawPerspective({
      marker: true,
      bowlerZ: 20.6,
      bowlerPose: { kind: "follow", t: 0 },
      ball,
      trail,
      gauge: true,
      zoom: 1,
      bounceFlash: sinceBounce > 0 && sinceBounce < 200 ? 0.8 - sinceBounce / 260 : 0,
    });
    const { w, h } = pgeo();
    const cp = proj((d ? markerXm(d) : 0) * 0.85, 0.72, 1.9, w, h);
    const rr = (1 - p) * h * 0.34 + 16;
    fctx.beginPath();
    fctx.arc(cp.x, Math.min(cp.y, h - 30), rr, 0, Math.PI * 2);
    fctx.lineWidth = p > 0.85 ? 5 : 3;
    fctx.strokeStyle = p > 0.85 ? "#b6ff3b" : "rgba(242,246,255,.6)";
    fctx.stroke();
    if (p < 1.15) nextFrame(step);
    else ringOn = false;
  };
  nextFrame(step);
}
function stopTimingRing() { ringOn = false; }

/* ---- contact: ball rockets away in the batting camera ---- */
function animateHitPersp(flight) {
  return new Promise((res) => {
    const t0 = performance.now(), dur = 470;
    const dirRad = (flight.dir * Math.PI) / 180;
    const D = Math.min(32, flight.dist);
    const X = Math.sin(dirRad) * D, Z = Math.cos(dirRad) * D;
    const yPk = flight.airborne ? Math.min(13, flight.dist * 0.22) : 0.9;
    const trail = [];
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      const x0 = currentDelivery ? markerXm(currentDelivery) * 0.85 : 0.15;
      const ball = {
        x: x0 + (X - x0) * t,
        y: 0.8 + yPk * Math.sin(Math.min(1, t) * Math.PI * 0.55),
        z: 2 + (Z - 2) * t,
      };
      trail.push(ball);
      if (trail.length > 6) trail.shift();
      drawPerspective({
        zoom: 1,
        ball,
        trail,
        contactFlash: t < 0.22 ? 1 - t * 4.5 : 0,
      });
      if (t < 1) nextFrame(step);
      else res();
    };
    nextFrame(step);
  });
}

/* ---- swing and a miss: ball whistles past to the keeper ---- */
function missBeat(delivery) {
  return new Promise((res) => {
    const t0 = performance.now(), dur = 340;
    const mx = markerXm(delivery);
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      drawPerspective({
        zoom: 1,
        ball: { x: mx * (0.85 + 0.3 * t), y: Math.max(0.12, 0.5 - 0.4 * t), z: 1.9 - 2.2 * t },
        gauge: false,
      });
      if (t < 1) nextFrame(step);
      else res();
    };
    nextFrame(step);
  });
}

/* ---- stump explosion (screen-space particles on the fx layer) ---- */
function shatterStumps() {
  const r = field.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height - 20;
  for (let i = 0; i < 16; i++) {
    const shard = i < 4;
    particles.push({
      x: cx + Math.random() * 26 - 13,
      y: cy - Math.random() * 30,
      vx: (Math.random() - 0.5) * 9,
      vy: -(2.5 + Math.random() * 6),
      life: 1, decay: 0.016 + Math.random() * 0.012,
      color: shard ? "#f2f6ff" : "#e3c990",
      size: shard ? 3 : 3 + Math.random() * 4,
    });
  }
  if (!fxRunning) { fxRunning = true; nextFrame(fxStep); }
}

/* ---- dust puff where the ball pitches ---- */
function spawnDust(xm, zm) {
  const r = field.getBoundingClientRect();
  const { w, h } = pgeo();
  const p = proj(xm, 0, zm, w, h);
  for (let i = 0; i < 7; i++) {
    particles.push({
      x: r.left + p.x + Math.random() * 10 - 5,
      y: r.top + p.y,
      vx: (Math.random() - 0.5) * 2.2,
      vy: -(0.5 + Math.random() * 1.4),
      life: 0.7, decay: 0.03,
      color: "rgba(216,196,140,0.8)",
      size: 2 + Math.random() * 3,
    });
  }
  if (!fxRunning) { fxRunning = true; nextFrame(fxStep); }
}

/* ============================================================
   TOP-DOWN BROADCAST REPLAY
   ============================================================ */
function geo() {
  const r = field.parentElement.getBoundingClientRect();
  const cx = r.width / 2;
  const cy = r.height * 0.52;
  const R = Math.max(40, Math.min(r.width / 2 - 34, r.height / 2 - 36));
  return { w: r.width, h: r.height, cx, cy, R, scale: R / BOUNDARY };
}

function drawScene(ballPt = null, trail = [], landing = null) {
  const { w, h, cx, cy, R } = geo();
  fctx.clearRect(0, 0, w, h);

  fctx.beginPath(); fctx.arc(cx, cy, R + 30, 0, Math.PI * 2);
  fctx.fillStyle = "#0a1128"; fctx.fill();
  for (let i = 0; i < 130; i++) {
    const a = (i / 130) * Math.PI * 2;
    const rr = R + 10 + ((i * 37) % 18);
    fctx.beginPath();
    fctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.4, 0, Math.PI * 2);
    fctx.fillStyle = `rgba(230,238,255,${0.13 + ((i * 53) % 10) / 55})`;
    fctx.fill();
  }

  for (let s = 0; s < 12; s++) {
    fctx.beginPath();
    fctx.moveTo(cx, cy);
    fctx.arc(cx, cy, R, (s * Math.PI) / 6 - Math.PI / 2, ((s + 1) * Math.PI) / 6 - Math.PI / 2);
    fctx.closePath();
    fctx.fillStyle = s % 2 ? "#0e3d20" : "#124d27";
    fctx.fill();
  }
  fctx.beginPath();
  fctx.setLineDash([6, 7]);
  fctx.arc(cx, cy, 27 * (R / BOUNDARY), 0, Math.PI * 2);
  fctx.lineWidth = 1.5;
  fctx.strokeStyle = "rgba(242,246,255,.38)";
  fctx.stroke();
  fctx.setLineDash([]);

  fctx.beginPath(); fctx.arc(cx, cy, R, 0, Math.PI * 2);
  fctx.lineWidth = 3; fctx.strokeStyle = "#f2f6ff"; fctx.stroke();
  fctx.beginPath(); fctx.arc(cx, cy, R + 5, 0, Math.PI * 2);
  fctx.lineWidth = 1.5; fctx.strokeStyle = "rgba(182,255,59,.45)"; fctx.stroke();

  const pw = Math.max(15, R * 0.115), ph = R * 0.56;
  const grad = fctx.createLinearGradient(0, cy - ph, 0, cy);
  grad.addColorStop(0, "#c2a874"); grad.addColorStop(0.5, "#dcc691"); grad.addColorStop(1, "#c2a874");
  fctx.fillStyle = grad;
  fctx.fillRect(cx - pw / 2, cy - ph, pw, ph);
  fctx.fillStyle = "rgba(255,255,255,.75)";
  fctx.fillRect(cx - pw / 2, cy - ph + 5, pw, 1.5);
  fctx.fillRect(cx - pw / 2, cy - 7, pw, 1.5);
  fctx.fillStyle = "#f2f6ff";
  for (const off of [-3.2, 0, 3.2]) {
    fctx.fillRect(cx + off - 0.7, cy - ph - 5, 1.4, 5);
    fctx.fillRect(cx + off - 0.7, cy, 1.4, 5);
  }

  dot(cx, cy + 10, 5, "#b6ff3b");
  dot(cx, cy + 18, 3.5, "rgba(242,246,255,.8)");
  dot(cx, cy - ph - 13, 4, "#4dc9ff");

  for (const f of fielderPositions()) {
    const p = fieldPoint(f.dir, f.dist);
    dot(p.x, p.y, 4, "#f2f6ff");
    fctx.beginPath(); fctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
    fctx.strokeStyle = "rgba(242,246,255,.22)"; fctx.lineWidth = 1; fctx.stroke();
  }

  // dashed lime arrow = the swing WE READ from your gyro. If the gold ball
  // path differs, the gap is drag/edge/movement, not misreading.
  if (lastSwingDir != null) {
    const a2 = (lastSwingDir * Math.PI) / 180;
    const sx2 = cx + Math.sin(a2) * R * 0.42, sy2 = cy - Math.cos(a2) * R * 0.42;
    fctx.save();
    fctx.setLineDash([6, 6]);
    fctx.strokeStyle = "rgba(182,255,59,.75)";
    fctx.lineWidth = 3;
    fctx.beginPath(); fctx.moveTo(cx, cy); fctx.lineTo(sx2, sy2); fctx.stroke();
    fctx.setLineDash([]);
    const ah = 9;
    fctx.beginPath();
    fctx.moveTo(sx2, sy2);
    fctx.lineTo(sx2 - Math.sin(a2 + 0.4) * ah, sy2 + Math.cos(a2 + 0.4) * ah);
    fctx.moveTo(sx2, sy2);
    fctx.lineTo(sx2 - Math.sin(a2 - 0.4) * ah, sy2 + Math.cos(a2 - 0.4) * ah);
    fctx.stroke();
    fctx.restore();
  }

  if (trail.length > 1) {
    fctx.save();
    fctx.shadowColor = "rgba(255,213,74,.8)";
    fctx.shadowBlur = 8;
    fctx.beginPath();
    fctx.moveTo(trail[0].x, trail[0].y);
    for (const p of trail) fctx.lineTo(p.x, p.y);
    fctx.lineWidth = 3;
    fctx.strokeStyle = "rgba(255,213,74,.9)";
    fctx.stroke();
    fctx.restore();
  }
  if (landing) {
    fctx.beginPath(); fctx.arc(landing.x, landing.y, 8, 0, Math.PI * 2);
    fctx.strokeStyle = "#ffd54a"; fctx.lineWidth = 2; fctx.stroke();
  }
  if (ballPt) {
    const rr = 4 + (ballPt.h || 0) * 6;
    fctx.save();
    fctx.shadowColor = "rgba(255,91,91,.9)";
    fctx.shadowBlur = 10;
    fctx.beginPath(); fctx.arc(ballPt.x, ballPt.y, rr, 0, Math.PI * 2);
    fctx.fillStyle = "#ff5b5b"; fctx.fill();
    fctx.restore();
    fctx.beginPath(); fctx.arc(ballPt.x - rr / 3, ballPt.y - rr / 3, rr / 3, 0, Math.PI * 2);
    fctx.fillStyle = "rgba(255,255,255,.6)"; fctx.fill();
  }
}

function dot(x, y, r, color) {
  fctx.beginPath(); fctx.arc(x, y, r, 0, Math.PI * 2);
  fctx.fillStyle = color; fctx.fill();
}
function fieldPoint(dirDeg, distM) {
  const { cx, cy, scale } = geo();
  const a = (dirDeg * Math.PI) / 180;
  return { x: cx + Math.sin(a) * distM * scale, y: cy - Math.cos(a) * distM * scale };
}

function animateFlight(flight, kind) {
  return new Promise((resolve) => {
    const { cx, cy } = geo();
    const start = performance.now();
    const dur = flight.airborne ? Math.max(750, flight.hangTime * 360) : 620;
    const end = fieldPoint(flight.dir, flight.dist);
    const trail = [];
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / dur);
      const ease = 1 - Math.pow(1 - t, 2.2);
      const x = cx + (end.x - cx) * ease;
      const y = cy + (end.y - cy) * ease;
      const hgt = flight.airborne ? Math.sin(t * Math.PI) : 0;
      trail.push({ x, y });
      drawScene({ x, y, h: hgt }, trail, t > 0.95 ? { x: end.x, y: end.y } : null);
      if (t < 1) nextFrame(step);
      else setTimeout(resolve, 250);
    };
    nextFrame(step);
  });
}

/* ============================== fx ============================== */
const fx = $("fx");
const xctx = fx.getContext("2d");
let particles = [];
let fxRunning = false;

function fireworks(bursts = 1) {
  const colors = ["#b6ff3b", "#ffd54a", "#4dc9ff", "#ff4d6d", "#ffffff"];
  for (let b = 0; b < bursts; b++) {
    const bx = innerWidth * (0.2 + Math.random() * 0.6);
    const by = innerHeight * (0.15 + Math.random() * 0.3);
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      particles.push({
        x: bx, y: by,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
        life: 1, decay: 0.012 + Math.random() * 0.015,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 2 + Math.random() * 3,
      });
    }
  }
  if (!fxRunning) { fxRunning = true; nextFrame(fxStep); }
}
function fxStep() {
  xctx.clearRect(0, 0, innerWidth, innerHeight);
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life -= p.decay;
    xctx.globalAlpha = Math.max(0, p.life);
    xctx.fillStyle = p.color;
    xctx.fillRect(p.x, p.y, p.size, p.size);
  }
  xctx.globalAlpha = 1;
  if (particles.length) nextFrame(fxStep);
  else fxRunning = false;
}

/* ============================== utils ============================== */
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nextFrame(cb) {
  let fired = false;
  const fire = () => { if (!fired) { fired = true; cb(); } };
  requestAnimationFrame(fire);
  setTimeout(fire, 40);
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function describeSwing(swing) {
  if (swing.source === "button") return "button swing";
  const d = swing.swingDirDeg ?? (swing.azimuth ?? 0) * 90;
  if (Math.abs(d) < 12) return "straight-bat swing";
  return d < 0 ? "cross-bat to LEG" : "cross-bat to OFF";
}
function moveArrow(d) {
  if (!d.move.dirShift) return "·";
  const towardLeg = (settings.rightHanded ? d.move.dirShift : -d.move.dirShift) < 0;
  return towardLeg ? "◀" : "▶";
}
function countUp(el, target, dur) {
  const start = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
    if (t < 1) nextFrame(step);
  };
  nextFrame(step);
}

/* boot */
resizeCanvases();

/* ?demo=1 : self-playing demo (used for automated visual testing) */
if (location.search.includes("demo")) {
  setTimeout(() => {
    $("btn-splash-start").click();
    $("btn-grip-ok").click();
    document.querySelector('.menu-card[data-mode="practice"]').click();
    if ($("screen-setup").classList.contains("active")) $("btn-button-mode").click();
    const cue = $("ball-cue");
    const btn = $("btn-swing");
    new MutationObserver(() => {
      const t = cue.textContent;
      if (t === "👀") btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      else if (t.includes("SWING")) setTimeout(() => btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })), 300);
    }).observe(cue, { childList: true, subtree: true, characterData: true });
    setInterval(() => {
      if (!$("view-scout").classList.contains("hidden")) $("btn-ready").click();
      else if (!$("view-result").classList.contains("hidden")) $("btn-next-ball").click();
      else if (!$("view-break").classList.contains("hidden")) $("btn-break-continue").click();
    }, 800);
  }, 300);
}
