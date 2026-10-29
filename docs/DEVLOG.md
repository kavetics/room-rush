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
- Referee needs distance measurements ("closest pillow to the sofa")
- Games must respect prop counts (2 pillows can't serve 4 players)
- Test photos with people, outdoors, and unsafe locations
