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
