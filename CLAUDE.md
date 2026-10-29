# Room Rush

An AI party-game producer. When a party or gathering goes flat, the host snaps a photo of the room. Room Rush sees who's there and what's around, designs a safe game using those things, assigns roles, runs timed rounds, referees results from photos, and produces a highlight reel to share.

Built solo for the Meta Global AI Developer Hackathon (Indie track, "Build for Your World"). **Submission deadline: Wed Nov 4, 2026, 6:00 PM CST** (hard deadline 8:00 PM CST).

## Core loop
1. **Read the room:** one photo → SAM 3.1 finds people and objects → Muse Spark understands the scene
2. **Design the game:** Muse Spark builds a safe game from what's actually in the room (structured JSON)
3. **Assign roles:** host, referee, camera, teams
4. **Run rounds:** timer, rules, scoreboard
5. **AI referee:** each round is recorded as a short clip → SAM measures/counts/tracks on its frames → Muse Spark rules pass/fail/winner and explains why
6. **Highlight reel (later):** round clips + Muse Image graphics + captions, ready for Reels/X. Deferred until the referee works.

## Stack
- **Frontend:** React (Vite), mobile-first web app, in-browser camera
- **Backend:** Node.js (Express). Holds API keys and runs all AI calls.
- **Data/storage:** Supabase
- **AI:** Meta Model API, OpenAI-compatible, base URL `https://api.meta.ai/v1`
  - `muse-spark-1.3`: reasoning, game design, referee decisions, captions
  - `sam-3.1`: segmentation and counting from text prompts
  - `muse-image-1.0`: title cards, contestant cards, scoreboard graphics
  - `muse-wonder-1.0`: optional, multi-step agent planning (test before relying on it)
- **Hosting:** Vercel (frontend), Render (backend)

## Scope
- **In:** single phone, no accounts, read-the-room, game design, roles, timed rounds, photo referee, scoreboard, highlight reel
- **Out (pitch only):** multiple phones, Muse/WhatsApp integration, ordering props via Muse connectors, Ray-Ban Meta glasses, sponsored challenges
- Multi-phone is decided at the Sat Oct 31 checkpoint, only if the core loop already works.

## Hard rules
- **Never use `-contributor` model variants** (photos contain people).
- **Never commit secrets.** Keys live in `.env` only (git-ignored). Read config from env vars.
- **Safety is a feature.** Generated games must never involve alcohol, heights, climbing/standing on objects, fire, food dares, traffic, or physical risk. Enforce in prompts *and* with a code check.
- **Every round is a 5–15 s video clip.** The referee judges from frames pulled out on the phone: the last frame for final results (count, height, presence, pose), frames sampled at ~2/sec for what happened (who moved, who got there first). Never judge split-second or blurry fast action. Clips are also kept for the highlight reel.
- **Demo shows only real usage.** No AI-generated people or fake footage.
- **Use plain code for math; use AI for judgment.** Measure and validate AI output; don't trust it blindly.
- **Avoid looking like a "simple image analyzer"** (banned project type). The agent designing and running the game is the hero.

## Process
- **Per feature:** Context → Plan → Build → Verify. Propose a short plan before large changes.
- **Verify before saying "done":** run it, test it, show the result.
- **Small, working steps.** Every session ends with something that runs.
- **Measure:** referee accuracy on a labeled photo set (target ≥ 90%), latency per call, cost per game.
- **If time is short, cut scope, not quality.** Protect: working demo → accuracy numbers → video → docs.
- **Dev log:** at the end of each session, add a short entry to `docs/DEVLOG.md` (done, decisions with the reason, learned, next). Keep it to a few lines. No chat transcripts, no secrets, no personal job-search notes.

## Working with the owner
- The owner directs and reviews; the AI writes the code. Explain every change in a few short lines: **what changed and why.**
- Keep explanations short and simple. Tables and bullets over long prose.
- Be blunt about problems and risks.

## Judging (for prioritizing)
Impact 30% · Use of Meta AI tooling 25% · Technical depth 20% · Demo 25%. 3-minute demo video; judges also review the code and the live app.
