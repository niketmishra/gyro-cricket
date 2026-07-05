# Gyro Cricket 🏏

Swing your phone like a cricket bat. The accelerometer and gyroscope measure your real swing speed, timing, and bat angle; a physics sim decides where the ball went: six, four, caught in the deep, or bowled. No server, no accounts, pure sensor math.

## Play it

It is a static web app. Any static server works:

```bash
cd GyroCricket
python3 -m http.server 8000
# open http://localhost:8000
```

**Important for phones:** motion sensors only work over HTTPS (or localhost). To test on a real phone:

- Quick: `npx serve` + a tunnel like `npx localtunnel --port 3000` or ngrok
- Proper: push to GitHub Pages / Netlify / Vercel (it is just static files)

On iPhone, the game asks for motion permission with a button tap (required by iOS). If sensors are unavailable or denied, Button Mode kicks in: hold to charge, release at the bounce.

## How it plays

Every ball is on your terms: read the scout report, pick a shot intent (DEFEND / DRIVE / SLOG), tap I'M READY, and the bowler charges in for about four and a half seconds before the ball arrives. Three named bowlers (Raftaar Khan express, Guru Patel spin, Captain Swing) bowl whole overs with their own habits. Three boundaries in a row puts you ON FIRE. The innings ends with a wagon wheel of every shot you played.


0. Read the bowler: before each ball a plan card shows the delivery speed in km/h, the LENGTH (yorker / full / good / back of a length / bouncer) and LINE (leg stump, middle, off, wide outside off), and which way it will swing or turn. A glowing marker on the pitch shows exactly where it will land, and you watch the ball travel from the bowler's hand to that spot and on to your bat.
1. Bowler runs in (accelerating footstep audio).
2. Whoosh on release, then a *thock* as the ball pitches. A timing ring closes on the batter.
3. Swing the phone right after the bounce.
4. Gyro peak = swing moment and bat speed. Accelerometer peak = power. Phone tilt = launch angle. Timing error = shot direction (early pulls to leg, late edges to the keeper).
5. Top-down stadium replay shows the ball flight, with commentary (Web Speech, prefers an Indian English voice) and a synthesized crowd.
6. After every ball a shot analysis card breaks down bowling vs batting: delivery speed, length and movement against your bat speed, timing error in ms, contact stars, and where the shot went ("90 m over long on").

The delivery model is real cricket: yorkers smother the bat and are nearly impossible to loft, bouncers sit up asking to be pulled but sky the top edge if you're early, wide-outside-off balls can be safely left alone, and a missed straight one at middle stump is usually fatal. Your actual swing direction (from the gyro) is the main steer for where the shot goes; timing error, line, and movement pull at it. Ground shots must find the gaps, since ring fielders cut off anything within about 12 degrees of them. There are no-balls with FREE HITS, end-of-over calls, and a one-run penalty against the bowler.

## Modes

- **Quick Match**: 2 overs, 3 wickets
- **Run Chase**: chase 16 to 32 off 2 overs
- **Practice Nets**: endless balls with coach feedback in milliseconds ("You were 120 ms early")
- **Survival**: one wicket, bat forever

## Settings

Sound, voice commentary, vibration, left/right hand, and difficulty (KIDS / NORMAL / PRO changes the timing window, catch probability, and swing threshold).

## Tech

- Zero dependencies, zero assets: all sounds are synthesized with the Web Audio API (bat crack scales with your swing power), commentary is Web Speech.
- `js/sensors.js` swing detection, `js/physics.js` shot outcome model, `js/audio.js` synth engine, `js/commentary.js` lines + TTS, `js/game.js` game loop and canvas stadium renderer.
- Personal bests (score, fastest bat speed, longest six) persist in localStorage.

## Safety (and marketing)

The grip-check screen is not a joke. Phones fly, Wii-remote style. Wipe your hands, clear two metres, keep the dog out of the swing zone.
