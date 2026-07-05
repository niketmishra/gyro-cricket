// Commentary engine: picks a line per outcome, shows it as text and
// optionally speaks it with the Web Speech API (prefers an Indian English voice).

const LINES = {
  six: [
    "That is OUT of the ground! {bat}, you BEAUTY!",
    "{bat} has DESTROYED that! Into the second tier!",
    "Stand and deliver! {bat} sends {bowl} into the crowd!",
    "Bat speed, timing, everything! {bat} with a MONSTER six!",
    "Gone! That ball needs a passport! {bat} is on a rampage!",
    "{bowl} can only watch! That one landed in the parking lot!",
  ],
  four: [
    "Cracking shot from {bat}! Races away for four!",
    "{bat} pierces the gap, NOBODY is stopping that!",
    "Sweetly timed! Vintage {bat}, kisses the rope!",
    "Fielder dives... not even close! Four more for {bat}!",
    "Middle of the bat! {bowl} shakes his head!",
  ],
  runs3: ["Great running! They come back for three!", "Into the gap, three runs taken!"],
  runs2: ["Good push, they scamper back for two!", "Smart cricket, two more added!"],
  runs1: ["Tucked away for a quick single.", "Soft hands, easy single.", "Rotates the strike, good cricket."],
  dot: [
    "Solid defence, no run.",
    "Straight to the fielder, dot ball.",
    "Well bowled, keeps him quiet.",
    "Watchful. Nothing offered at that one.",
  ],
  bowled: [
    "BOWLED HIM! {bowl} sends the stumps FLYING!",
    "Cleaned up! Timber! {bat} is gone!",
    "{bowl} goes through the gate! {bat} has to walk!",
    "Knocked him over! What a delivery from {bowl}!",
  ],
  caught: [
    "Up in the air... and TAKEN! {bat} has to go!",
    "Straight down the fielder's throat! {bowl} gets his man!",
    "{bat} holes out in the deep! The big shot costs him!",
    "Skied it... the fielder settles under it! {bowl} strikes!",
  ],
  edge4: [
    "Thick edge... and it flies past the keeper for four! Lucky runs!",
    "Edged! But safe, and it runs away to the boundary!",
  ],
  edgeOut: [
    "Feather of an edge... the keeper takes it! He has to go!",
    "Nicked it! Simple catch behind! Out!",
  ],
  beaten: [
    "Swing and a miss! {bowl} beats {bat} all ends up!",
    "Fresh air! The keeper collects, {bowl} smiles.",
    "{bat} went fishing and caught nothing!",
  ],
  missLine: [
    "He's played all around it! Completely the wrong line!",
    "Swung across the line and hit nothing but night air!",
    "The ball was out there and the bat went through here! Wrong postcode!",
  ],
  missEarly: [
    "Through the shot far too early! The ball hadn't even arrived!",
    "He finished the swing before the ball got there!",
    "Way too eager! The ball arrived after the party ended.",
  ],
  missLate: [
    "Too late on it! The keeper takes it clean.",
    "Beaten for pace! The bat came down after the ball went through.",
    "That one rushed him! Late on the swing.",
  ],
  lbw: [
    "Rapped on the pads... the finger goes UP! {bowl} traps {bat} LBW!",
    "{bat} is trapped DEAD in front! That is plumb!",
    "Huge appeal from {bowl}... and GIVEN! Leg before wicket!",
  ],
  leave: [
    "Shoulders arms! Well left, that one was wide of the stumps.",
    "Watchful leave. Good judgement outside off.",
    "Let it go through to the keeper. Smart cricket.",
  ],
  fielded: [
    "Straight to the fielder! Great stop!",
    "Hit hard, but picked the wrong gap!",
    "The ring fielder cuts it off. No run.",
  ],
  noBall: [
    "The umpire's arm is out, that is a NO BALL! Free hit coming up!",
    "He has overstepped! No ball, and the next one is a FREE HIT!",
  ],
  noBallSave: [
    "Wait... NO BALL! The batter survives, and it's a free hit next!",
    "The stumps are gone but the umpire says NO BALL! What an escape!",
  ],
  freeHitSave: [
    "Doesn't matter, it's a FREE HIT! Not out, swing without fear!",
    "Free hit, so the batter cannot be out! What a life!",
  ],
  overEnd: [
    "That's the end of the over.",
    "The bowler takes his cap. End of the over.",
  ],
  welcome: [
    "{bat} walks out under the lights, and {bowl} has the new ball. Here we GO!",
    "Full house tonight! {bat} takes guard, {bowl} at the top of his mark!",
  ],
  fifty: ["That's a FIFTY for {bat}! Raise that bat! Take a bow!"],
  win: ["{bat} has DONE it! What a chase! The crowd goes absolutely wild!"],
  lose: ["It was not to be tonight. A brave effort from {bat} in the chase."],
  hattrick6: ["THREE sixes in a row! {bat} is ON FIRE tonight!"],
};

const lastPick = {};
// ctx = { bat, bowl } fills {bat}/{bowl} tokens with real player names
export function pickLine(kind, ctx) {
  const pool = LINES[kind] || LINES.dot;
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === lastPick[kind]) i = (i + 1) % pool.length;
  lastPick[kind] = i;
  return pool[i]
    .replace(/\{bat\}/g, (ctx && ctx.bat) || "the batter")
    .replace(/\{bowl\}/g, (ctx && ctx.bowl) || "the bowler");
}

let voiceOn = true;
let chosenVoice = null;

export function setVoiceEnabled(v) {
  voiceOn = v;
  if (!v && "speechSynthesis" in window) speechSynthesis.cancel();
}

function findVoice() {
  if (chosenVoice || !("speechSynthesis" in window)) return chosenVoice;
  const voices = speechSynthesis.getVoices();
  chosenVoice =
    voices.find(v => v.lang === "en-IN") ||
    voices.find(v => v.lang && v.lang.startsWith("en-GB")) ||
    voices.find(v => v.lang && v.lang.startsWith("en")) ||
    null;
  return chosenVoice;
}
if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = () => { chosenVoice = null; findVoice(); };
}

// excitement 0..1 raises rate and pitch so big moments sound BIG
export function speak(text, excitement = 0.4) {
  if (!voiceOn || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  // "V. Kholi" reads as "vee dot Kholi" otherwise
  const u = new SpeechSynthesisUtterance(text.replace(/\./g, " "));
  const v = findVoice();
  if (v) u.voice = v;
  u.rate = 1.02 + excitement * 0.42;
  u.pitch = 1.02 + excitement * 0.5;
  u.volume = 1;
  speechSynthesis.speak(u);
}
