# Room Rush: To-do

Deadline: **Wed Nov 4, 6:00 PM CST** (hard deadline 8:00 PM CST).

## New plan (Fri Oct 30): one game, Clap Catch, new UI
Flow: ① consent → ② scan (in-app camera) → ③ reading your room → ④ confirm room + people → ⑤ games → ⑥ rules → ⑦ referee mode (player x of y, hold to record) → ⑧ podium with scores + faces → ⑨ share.

## Fri Oct 30 (2 hours)
- [x] HTTPS on the LAN link (needed for the in-app camera)
- [x] In-app camera: 1× lens, zoom limited to 1–2×, grid
- [x] Screen ① consent + play safe, screen ② hold-to-scan sweep with coverage ring
- [x] Server reads the room from several frames (no double counting)
- [x] Live labels while scanning (SAM), full-screen camera at 1×
- [x] Guided scan: 8 stops + ceiling, auto-capture, scanner look
- [ ] Test the guided scan on iPhone (compass direction, steadiness threshold)
- [ ] Check SAM usage cost after a few real scans (~80 extra SAM calls per scan)
- [ ] Test the camera on iPhone

## Backlog (in order, after the in-app camera works)
- [x] ⑦ Referee mode: record a turn with sound (hold, or solo countdown), player x of y
- [x] Catch judge: SAM follows the ball, Muse Spark rules caught, dropped or unclear
- [x] Catch accuracy test: 20 of 20 (one player, one room)
- [ ] Catch accuracy with other people and rooms, hand-held
- [x] Clap counting from the audio (plain code), scores and winner
- [x] Clap accuracy test: 11 of 11 exact after tuning, on the same turns (quiet room, one player)
- [ ] Fresh clap test to confirm, since those turns guided the tuning
- [ ] Clap counting with background noise and music
- [ ] Scan checks overhead clearance for Clap Catch (ceiling fan, chandelier, lamps)
- [ ] ⑧ Podium (faces from each player's clip) + Muse Image graphics
- [ ] ⑨ Share the best clip (Web Share to Instagram, Facebook, WhatsApp)
- [ ] Muse Voice Transcribe: players say their name before their turn
- [ ] Test deploy (Render + Vercel); others hit "model_not_found" on Render
- [ ] Fix "Caution" on every indoor room
- [ ] Retest Freeze Dance frame pulling on iPhone (backup game)
- [ ] Saved rooms (after Muse Image; kept until deleted): reuse a room's report without rescanning. On the phone only, with a delete button; on reopening, show the photo and hazards and ask "Still look like this?", with Rescan. Suggest a rescan after about 30 days.
- [ ] **Before public launch:** stop saving video and sound, and restore the consent line "Room Rush doesn't save them." Today this is automatic: recording runs only on the dev Mac, and the hosted app already shows the original line.
- [x] Referee phases, SAM once per turn, VAR on the results screen
- [x] Seated options for both games (balloon; clues within reach)
- [ ] Talk to a senior community activities director; test seated mode with real players
- [ ] Metrics: anonymous game events in Supabase, 👍/👎 on referee calls and clap counts, `npm run metrics` summary. Numbers only: no videos, sound, names or IP addresses. Add a line to the consent screen.

## Weekend (Sat Oct 31 – Sun Nov 1)
- [ ] Build Clap Catch into the app (if the test passes)
- [ ] Find 1–3 people: multi-player Freeze Dance, hand-held camera test
- [ ] Choose the demo games and lock the player range (1–4)
- [ ] Accuracy test for the demo games
- [ ] Feature freeze (Sun), film the demo, README

## Mon Nov 2 – Wed Nov 4
- [ ] Fix bugs from filming, screen recordings
- [ ] Edit the 3-minute video, partner feedback report
- [ ] Post the demo on X, submit by 6 PM CST Wed

## Demo games (candidates)
| Game | Players | Referee | Status |
|---|---|---|---|
| **Freeze Dance** | 1–4 | Video frames: SAM movement meter + Muse Spark call | ✅ Working (1 player) |
| **Clap Catch** | 1–4, one at a time | **Audio** counts claps (sharp spikes, code on the phone); **video** last frames judge the catch (SAM finds the ball, Muse Spark rules caught vs. dropped). Claps after the catch don't count. | 🧪 To test |
| Tower Stack or Scavenger Rush | 2–4 | Last frame: SAM measures, Muse Spark rules | Built, untested on clips |

### Clap Catch rules
- Each player takes a turn: throw a soft ball up, clap as many times as possible, catch it.
- Most claps **with a clean catch** wins. A drop scores 0 for that turn.
- **Music off during turns** so claps can be heard.
- Soft ball only; play away from chandeliers, lamps, TVs and anything breakable.
- Turn-based, so only one person is filmed at a time.
