# Room Rush: Dev Log

A short daily record of what was built and decided during the Meta Global AI Developer Hackathon (Oct 27 – Nov 4, 2026). All work in this repository was created during the hackathon.

Format: what got done, key decisions (with the reason), what we learned, what's next.

---

## Tue Oct 27: Kickoff and planning
**Done**
- Reviewed the hackathon rules, judging rubric and resources
- Set up accounts: Meta Model API, Supabase, GitHub

**Decisions**
- **Indie track, "Build for Your World" theme.** Solo build.
- **Initial idea: "Mystery Quest,"** an AI planner that turns group-chat plans into a mystery outing with verified photo challenges.

---

## Wed Oct 28: Pivot to Room Rush, project setup
**Done**
- Verified the Meta API key; confirmed available models (`muse-spark-1.3`, `sam-3.1`, `muse-image-1.0`, `muse-wonder-1.0`, `muse-voice-transcribe-1.0`)
- Verified the Supabase connection
- Created the Git repo, `.gitignore`, `.env.example`, `CLAUDE.md` (project rules for AI coding agents)

**Decisions**
- **Pivoted from Mystery Quest to Room Rush:** an AI party-game producer that reads the room from one photo, designs a safe game from what's there, runs it, referees results, and makes a highlight reel.
  - *Why:* Mystery Quest was two products glued together (planner + scavenger hunt); date matching added nothing to the demo; bookings couldn't be delivered; city-quest apps already exist. Room Rush is one focused product with a smaller scope and a stronger demo.
- **Single phone, no accounts** for the MVP. *Why:* multi-device sync is the biggest time and bug risk. Revisit at the Sat Oct 31 checkpoint.
- **Regular `muse-spark-1.3`, never `-contributor` variants.** *Why:* photos contain people.
- **Safety is a product feature:** no alcohol, heights, stunts or physical risk in generated games, enforced in prompts and in code.
- **Referee challenges must be judgeable from a single photo** (count, height, presence, pose). *Why:* video judging is too unreliable for this timeline.
- **Real footage only in the demo video.** *Why:* the rules require showing the real product; faked usage risks disqualification.

**Learned**
- Judging weights: Impact 30%, Meta tooling 25%, Technical depth 20%, Demo 25%. Impact will be our weakest category, so we win on Demo and Tooling.
- Several other projects use SAM + Muse Spark with verification steps; verification alone won't stand out. The read-the-room game design is our differentiator.

**Done (evening build session)**
- Node/Express server + Meta API client (Muse Spark structured JSON, SAM 3.1 segmentation)
- **Space report:** Muse Spark lists props, fixtures (with allowed actions), hazards (with a fix), space size and notes on people who shouldn't be asked to play; SAM 3.1 verifies and counts every item
- **Location safety check** (~3 s): go / caution / move. Streets, railroads, parking lots, water edges and rooftops are always "move", enforced in code.
- **Latency-hiding flow:** safety check → head-count question right away → report and game cards in the background → instant filter by the host's answer → rounds written while the host reads the cards
- **Mobile web app** (React): snap, verdict, head count with seated roles, game cards, rounds, and a "What the AI saw" overlay (people/props/fixtures/hazards)
- Referee pipeline (SAM measures, code computes, Muse Spark rules) built and smoke-tested; not yet in the app

**Decisions**
- **Host confirms the player count; the AI never decides who plays.** It flags people who probably shouldn't (a baby, someone asleep) and asks. *Why:* the host isn't in the photo, and judging people from a photo is unreliable and intrusive.
- **Hazards are called out with a fix, not silently dropped.** *Why:* some things need to be moved before playing.
- **Indoor and outdoor** spaces supported. *Why:* backyard parties are a core use case.
- **Safety rules live in code as well as prompts:** seats only for sitting; no touching windows, glass, stairs, pools or grills; banned-content check on every game; never cover faces or pile people; crowd limits by space size.
- **Muse Spark reasoning effort "low":** halved report time (16 s → 8 s) with equal quality.
- **Game cards first, rounds on demand:** host wait after answering fell from 8.6 s to ~0.1 s; after tapping a game, ~0 s.
- **SAM requests use `store: false`** so photos of people aren't retained.
- **Mobile web app, not a native iOS app.** *Why:* judges need a link; no Xcode time.

**Learned**
- SAM 3.1 works best with simple nouns ("pillow"), not descriptions ("blue striped throw pillow").
- The two-model check catches hallucinations: Muse Spark "saw" a pillow that SAM couldn't find, and it was dropped.
- Over-strict safety prompts starve the game designer; separating props (handle) from fixtures (use as zones) fixed it.
- A web page can't force the iPhone's 1× lens through the native camera; an in-app camera needs HTTPS.

**Late decisions**
- **Video referee:** every round is a 5–15 s clip; the referee judges from frames (last frame for results, ~2/sec for what happened). *Why:* we record the action anyway, so one capture serves both refereeing and the reel, and short rounds give games a clear structure. Both SAM 3.1 and Muse Spark accept video; limits are undocumented, so test first.
- **Highlight reel deferred** until the referee works.
- Fixed: overlay boxes now line up (drawn on the same shrunk image the AI analyzes); people in paintings, photos and screens are no longer counted (Muse Spark sorts SAM's person boxes).

**Next**
- Test clip: 5–10 s, everyone freezes and one person moves slightly → test SAM tracking vs. frames → Muse Spark
- Recording screen in the app (record a round → referee result with outlines)

---

## Thu Oct 29: Classics library and AI experiments
**Done**
- **Curated classics:** Freeze Dance, Hot Potato, Tower Stack, Scavenger Rush. Rules, player ranges, round lengths and referee checks are fixed and vetted; Muse Spark only adapts them to the room (which prop, where to play, home base, setup line).
- **AI Experiments section:** games invented for the room, tagged "AI-invented · untested" with a note that the referee may be less reliable.
- **docs/ROADMAP.md:** pitch-only items (community library, multi-phone, group chats, glasses, reel export, connectors, accessibility).

**Decisions**
- **Classics first, AI experiments second.** *Why:* proven games are more fun, safer and easier to referee accurately; AI still adapts and referees them, and the experiments keep the creative side, clearly labeled.
- **Community library is roadmap only.** *Why:* no users yet (never fake popularity), and user-submitted challenges need moderation before launch.
- **Code verifies the AI's prop choice** against SAM's counts: Tower Stack is skipped when there are fewer than 3 stackable items.

**Learned**
- Letting the model type a prop name failed on small spelling differences; giving it the verified list as choices (an enum) fixed it.

### Video referee test (Freeze Dance, 10 s clip, 1 player)
Ground truth (checked frame by frame): dancing 1.0–5.5 s, frozen 6.0–8.0 s, moved at 8.5 s.

| Method | Result | Time |
|---|---|---|
| **A. Muse Spark watches the whole video** | Correct both ways (moved at 8.5 s; held still when the buzzer was at 8.0 s) | 10–14 s |
| **B. SAM 3.1 tracks the person through the video** | Clear numbers: outline shift ≤2% while frozen, jumps to 14% at 8.5 s | 28 s (all 302 frames) |
| **C. Frames (2/sec) from the freeze window → Muse Spark** | **6/6 correct** (3 held-still, 3 moved, all at 8.5 s) | **3–5 s** |

**Decision:** referee = frames → Muse Spark for the call, plus SAM on the same frames (in parallel) for a measured "movement meter" as evidence. Whole-video calls are too slow for a party.
**Untested:** several players at once, a hand-held (shaky) camera, music playing.

### Recording screen + round referee
**Done**
- Round screen: instructions → record the round with the phone camera → frames pulled out on the phone (2/sec) → referee verdict, evidence frame with outlines, and a SAM "movement meter"
- **Freeze is detected automatically:** the iPhone camera covers the app while recording, so the app can't mark when the music stopped. The referee finds the moment the group goes still (SAM movement below 6%) and judges only after that.
- Last-frame games (Hot Potato, Tower Stack, Scavenger Rush, AI experiments) use the photo referee on the final frame
- Full flow tested against the live server: scan → head count → Freeze Dance → upload frames → "froze at 6 s, P1 moved at 8.5 s" (6 s referee time)

**Bug found and fixed:** framed photos on the wall were tracked as players P2 and P3 ("held perfectly still"), which also broke freeze detection. Players must now be at least 20% of the frame height.

**Decision:** keep the standard (non-contributor) models and pay usage directly. *Why:* hackathon credits only cover contributor models, whose inputs (including users' photos) may be used for training.
- Referee needs distance measurements ("closest pillow to the sofa")
- Games must respect prop counts (2 pillows can't serve 4 players)
- Test photos with people, outdoors, and unsafe locations

---

## Fri Oct 30: New plan, in-app camera
**Decisions**
- **One game first: Clap Catch.** New UI flow from the owner's sketches: consent → scan → reading → confirm → games → rules → referee mode (player x of y) → podium → share. Freeze Dance stays as the backup.
- **Own in-app camera** instead of the iPhone camera app. *Why:* we control the lens and zoom, and later get the audio and video as they're recorded (no slow frame pulling).
- **Room scan is a hold-to-record sweep** (owner's call). The phone compass tracks coverage and keeps one frame per 45° of turning (max 8); the video is kept for the reel. *Why one frame per direction:* a sweep shows the same couch many times, so each item's count is its highest count in any single frame, never the sum.

**Done**
- HTTPS on the LAN link (self-signed, `@vitejs/plugin-basic-ssl`); the iPhone camera requires it
- Camera: picks the 1× "Back Camera" lens, zoom limited to 1–2× (lens zoom if supported, else center crop), 4:3, grid, preview matches the photo exactly
- Screen ① consent + play safe, screen ② scan; capture feeds the existing read-the-room pipeline
- Hold-to-scan: coverage ring, "slow down" warning, min 2 s / max 30 s, timer fallback without a compass
- Server reads the room from 1–8 frames: Muse Spark lists which frames each item is in, SAM counts it only there (3 frames: report in 16 s vs ~8 s for one photo, hidden behind the head-count question)
- Verified in headless Chrome with a fake camera and a simulated 360° turn (8 frames, 100% coverage, end to end); iPhone test pending
- **Live labels while scanning:** each sweep frame gets a quick SAM 3.1 look for 10 party-relevant things (person, ball, pillow, couch, chair, table, lamp, TV, ceiling fan, staircase), all in parallel (~1.5–2 s per frame). Labels pop up as the host turns; hazards in yellow. *Why a fixed list:* SAM finds what you name but can't name things itself; Muse Spark's report stays the source of truth.
- Camera is now full screen and always 1× (zoom buttons removed).

**Learned**
- SAM prompt wording matters: "stairs" scored 0.55 on a clear staircase, "staircase" 0.70.

### Guided scan (replaces the hold-to-record sweep)
- **Decision (owner's design):** no video. The host stands in the middle of the room, taps Start, and is guided to 8 directions (every 45°, turning right) plus one ceiling shot. *Why:* photos taken while still are sharp, coverage is predictable, and the ceiling shot catches overhead hazards (fans, chandeliers) that matter for throwing games.
- Photos are taken automatically when the phone is lined up (compass) and still for 0.4 s: a target dot and ring show where to turn; timed prompts if there's no compass. "Done turning" after 4 shots, "Skip ceiling".
- Scanner look: corner brackets, moving mesh, sweeping scan line, progress pips, "Got it ✓ 3 of 8".
- Muse Spark is told how the photos relate (one spot, turning right, frame 8 = ceiling) and to check overhead hazards.
- Verified with a simulated phone turning through the real room photos: 8 sides + ceiling captured, live labels (couch ×2, lamp, stairs, ball, pillow ×2, table), full flow to the head-count question. iPhone test pending.
- **Ceiling guide fixed** (owner report: "doesn't really work"). Two bugs: the dot sat *below* the ring (following it meant tilting down), and the "hold still" check counted compass swings, which jump around when the phone points up, so the photo never fired. Now: dot above the ring with a bouncing ↑, only tilt counts for the ceiling, 30° up is enough, and "still" = moved less than 5° over the last 0.3 s (robust to sensor jitter). Simulated with hand wobble: fires 0.5–1.3 s after lining up.

### Clap Catch: record a turn + catch referee + test mode
**Decisions**
- **Caught or dropped only for now; no scores or winner.** Clap counting is in the backlog (owner's call).
- **No "hold the pose" rule, so the referee follows the ball through the whole clip:** SAM on every frame (4/sec), code finds the throw's peak and where the ball ended, Muse Spark rules caught, dropped or unclear from up to 12 frames after the peak.
- **Accuracy test is voice-guided (owner's idea):** one continuous recording, the phone calls out catch or drop, so every turn is labeled automatically and can be re-run as the referee changes.

**Done**
- Turn screen: player x of y, hold to film or solo (3-2-1, 10 s), review, redo or submit, verdict
- `?test=catch` (20 throws) saves labeled turns to git-ignored `test-photos/catch-runs`; `npm run test:catch` reports accuracy

**Verified:** full flow with a fake camera; one synthetic falling ball (real ball pasted on a person frame) called "dropped" in 7.3 s. **Not yet tested on any real throw; accuracy unknown.**

**Learned:** SAM ignored a flat painted circle but found the real ball at 0.78 confidence even at about 20 px.

### Clap counting
- **Back in scope (owner's call):** clap counts decide the winner. Plain code finds sudden loud spikes in the sound and counts those between the throw (from SAM's ball path) and the catch; the spike at the catch is the ball landing. A drop scores 0.
- `?test=claps`: 13 on-screen-guided turns with the mic on, labeled with the expected count. `npm run test:catch` reports clap accuracy.
- Verified with math checks and a fake mic. **Not yet tested on real claps or the iPhone mic.**

### "What the AI saw" for Clap Catch
- **Live while judging:** the referee streams each step (one JSON line each), so the phone shows every frame with SAM's ball box, then the throw, then Muse Spark's call.
- **Replay after:** the video with the ball outlined, a trail, and throw/clap/catch markers appearing on time; tap a marker to jump. Each player's report stays available at game over.
- *Why:* it makes the AI's work visible, which serves both the demo and trust in the referee's calls.
- Report also shows an audio map: the clip's sound with every spike marked, counted as a clap (green) or not (grey), so a clap count can be checked by eye.

### Test menu, camera retry
- `?test=menu`: direct links to a real turn and both accuracy tests, no scan needed. *Why:* testing kept requiring the whole flow.
- **Phone reports camera steps to the Mac in dev** (we can't see its screen). It showed iPhone Chrome refusing the camera on page load (NotAllowedError) three times, then allowing it. Added a "Turn on camera" button that asks again from a tap.
- Tests and Solo use the front camera, so the player can read the screen and see the shot. Hold-to-film stays on the back camera. Voice in the catch test is now pre-recorded clips; browser speech was silent on iPhone.
- **Test rhythm rebuilt (owner feedback: the pacing was off):** each turn is now task → 3-2-1 → GO with a 6 s timer → the referee checks it live → correct or missed → get the ball → next. Each turn records its own clip, so sound timing matches a real game. Score shows as you go.

### Catch accuracy: first real result
20 of 20 correct (10 catches, 10 drops), front camera, one player, one room: one hand, against the chest, drop then pick up. Median about 8–9 s per turn; 36 SAM calls and 12 Muse Spark frames per turn. Target was at least 90%, but 20 turns from one person is a small sample, and these were deliberate catches and drops.

### Clap accuracy: first real result
Exact clap count on 10 of 11 caught turns (1, 2, 3 claps; claps after the catch ignored); all 13 catch calls right, making 33 of 33 across both tests. The one miss: a single quiet clap removed as the sound of the catch. Left untuned: one miss isn't enough to tune on, and the same rule correctly removed a real catch sound in another turn. Quiet room, one player; noise is untested.


### Multiple players and rounds
- Setup screen (1–8 players, names, 1/3/5 rounds), turn order, scoreboard between rounds, final standings with every turn's report, Play again. Total claps with clean catches decides; catches break ties. Turn-based, so the player cap is about patience, not technology.
- Muse Spark now judges only the person throwing, since others may be in the shot at a party.
- Hosting: one Render service serves both the API and the built app (`render.yaml`).

### Meta API 404 on hosted servers
Render gets 404 model_not_found from Muse Spark while the same key works from the Mac. Per the hackathon Discord, Meta confirmed it isn't caused by builders and is investigating a likely entitlement caching issue. Added retries (3, with growing pauses) for 404s only, because the error can clear up on its own. This won't fix Render if every call fails; open a support ticket and report it in the partner feedback.

### Voice and hands-free Solo
- Owner feedback: the game was too quiet. The phone now speaks: the task, 3-2-1-Go, and the verdict with the clap count (pre-recorded clips, shared with the tests).
- Solo is hands-free after the first START: turns submit, advance and restart by themselves, with a "tap to stay here" escape.
- "Load failed" on a turn: not reproduced from the Mac (4 of 4 saved turns fine), so likely the phone's connection. The phone now resends up to 3 times, since the frames are still in memory. Each judged turn reports its numbers to the Mac in dev.
- Noticed: a replayed turn counted 2 claps, then 1 on another run, because Muse Spark's catch time varies. Worth a stabler catch time.
- Game voice was silent on iPhone with the mic open all game. The mic now opens only while a turn records. Big instruction cards added to the game, with a voice test on setup. Phone reports also go to a git-ignored log file.

### Mic fix and test recording
- Owner saw a mic prompt mid-game: that caused the freeze. The mic is now requested once when the host taps Start game, and each turn waits for the mic before saying Go.
- Test recording (dev Mac only): each game's timeline, video, frames, sound map and referee result go to the git-ignored `test-photos/sessions`. `npm run review` shows stalls, failures and suspicious calls; `--rerun` replays turns through the current referee. Consent updated to say footage is saved and reviewed; saving stays off in the hosted app.

### First reviewed game: billing error hidden as a referee call
Session recording found it right away. Meta's API started answering 402 "Billing verification failed" on every call. The referee swallowed SAM errors, saw no ball, and told the player "I couldn't see the ball". Now, if most SAM looks fail, the real error is shown. The timeline also lost about 4 minutes of events to a dropped connection; unsent events are now kept and resent.

- Owner's call: Clap Catch is the only game for now. Classics and AI-invented games stay in the code but aren't generated or shown, which saves API calls and wait time after the scan.

### Turns without interruptions
- Owner's call: no verdict or AI screen between turns. Turns run back to back, the referee works through a background queue, and "Getting the results…" finishes what's left after the last turn of each round. The AI analysis still shows on that screen, and the replay stays in the final report.
- Since nobody sees a verdict during play, the results screen offers a Retake for turns the referee couldn't call, that lost their clap count, or that failed.

### Voice test result, flow fixes
- Voice test on iPhone (Chrome, Safari): no clip stuck in any logged run; both playback methods sound alike; the mic opens in about 0.9 s; the owner heard better sound with the mic closed, and tapping noises with it open. Decision: mic closed except during a turn.
- The last game's 24 s countdown and stuck timer came from clips that hung while the flow waited on them. Timing no longer waits on voice; clips load into memory up front and fall back to Web Audio. Nothing speaks until a turn starts; Go and Time mark each turn. One camera + mic prompt on the first tap.
- Clap count no longer goes blank when SAM misses the throw: everything up to the catch counts (a missed throw lost 4 correctly heard claps).


### Referee fixes from the first reviewed game with players
Two of three real turns came back "couldn't tell". SAM not finding the small ball no longer skips Muse Spark; frames are chosen from the first clap or the throw, whichever is earlier (16 frames, up from 12); Muse Spark is told it won't see every moment. Spikes in the first 0.25 s are ignored (the mic opening).
- Clap counting now follows the claps' rhythm (a long gap ends the burst; a late last spike near the catch is the ball landing), because Muse Spark's catch time shifts between runs. Reran saved turns: catch 33 of 33, exact claps 11 of 11. Those turns also guided the tuning, so this needs fresh turns to confirm. Turns from other players aren't labeled yet.

### Post-scan flow, resume, shorter turns
- "How many players?" appears as soon as the scan finishes; the room check runs behind it. Games talk is gone: Clap Catch opens next. One player is allowed, with a note. Clearly unsafe locations and rooms rated small are blocked, with a rescan; hazards are warnings.
- Turns are 6 s: catches so far came by about 4 s, and it means 40% fewer frames. The mic opens after "1", which caused a blip in the voice.
- A game survives a page reload: progress and clips are stored on the phone (IndexedDB), with a "Resume your game?" prompt. A turn mid-recording is lost, so that player goes again; unchecked turns get checked on resume.

### Recording started too late
Two of three players had thrown before recording began (first frame already mid-play; no claps recorded), because the mic opened after "1", leaving about 2 s before recording. The mic now opens before the countdown, and recording starts as "1" ends, on "Go". Sounds in the first 0.45 s are ignored as the word "Go".

### High throws leaving the frame
Owner's point: the highest throws earn the most claps, so a ball leaving the frame must never count against the player. Muse Spark is told it's normal, and what matters is the ball being in the hands afterwards. Code now detects a rising ball that disappears, as a throw, and passes when it left and came back. `?test=high` added: 10 labeled high throws.

### Hung test: the phone dropping off Wi-Fi
A test froze with about 2 minutes of silence, then a burst of logs and "Load failed", like the earlier 4-minute stall. From the Mac, pings to the router were 15 of 15, and to the phone 19 of 30 ("No route to host"). Requests could wait indefinitely. Added time limits with retries: referee (30 s of silence, 4 tries), test saves, session saves and logs.
- Scan upload had no time limit: in a new location, the phone lost its link to the Mac and the room check waited forever. It now gives up after 30 s, tries once more, then says what to check. Some networks may also block devices from reaching each other, so the hosted link matters.

### Party feedback: a start signal for everyone
- First real group game (5 players, hand-held, hotspot): finished with no errors logged in about 80 s; the owner's count matched the app on 3 of 4 catches. People threw as soon as they got the ball, because hold-to-record gave them no start signal.
- Someone films is now the default: tap Start, 3-2-1-Go, 6 s or tap Done. A spoken rule at game start says to wait for Go. Solo moved to setup, and stays hands-free.
- Clap bar fix: a loud pop in the ignored start set the bar so high that one player's 4 claps counted as 0.
- Party footage reviewed. Clap counts still depend on Muse Spark's rough catch time: one saved turn gave 1, 2 and 1 across three runs. When SAM misses the throw, sounds before it can count. Both are next on the list.

### Referee rebuilt around phases (owner's design), and VAR
- A turn is now ready → throw → in the air → caught or dropped. Muse Spark names the player and object from the first frames, SAM 3.1 outlines them once, then Muse Spark labels what the ball is doing in each frame. Plain code reads the labels and finds the phases; only sounds while the ball is in the air count. Picking up a dropped ball can't change a drop, and only the first throw counts. If no catch or drop is seen, the call is "couldn't tell".
- SAM calls per turn: about 36 down to 2. Spark frames: 16 up to 24 plus a short identify call.
- VAR (owner's idea): on the final results, a player can request a review. SAM follows the ball through every frame, Muse Spark looks harder, and the new call replaces the old one.
- On saved footage, each party turn repeated its call and clap count across 4 runs (one drop's clap reading varied, but drops score 0). Labeled tests: catch calls 33 of 33; claps 11 of 11 offline after a rhythm rule for the catch sound. Those turns guided the tuning, so fresh turns are needed. Average 18 s per turn in that run (three test suites at once), up from about 10 s, but it runs in the background now.

### Room Scavenger (second game)
Makes the scan matter: Muse Spark writes clues from what the scan verified in this room; the player walks, finds it, and shows it to the camera; SAM checks the last frame and Muse Spark judges. Plain code blocks unsafe clues and items, swaps in safe backup clues, and scores (one point per second left, at least one). The two games share the camera, turns, queue, results and resume through a small game definition.

### Direction: seniors, standing or seated
Owner's direction, personal to them: Room Rush for group activity time in senior communities, for camaraderie and entertainment. No health claims. Setup now asks Standing/Walking or Seated. Seated Clap Catch uses a balloon with an 8 s turn; seated Scavenger clues are solved with what's worn or within reach (15 s). Standing modes are unchanged, for active players. Not yet tested with a balloon or with seniors; talk to an activities director first.
