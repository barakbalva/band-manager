# Band Manager (bands.barakbalva.workers.dev)

BandHelper-style app for Barak's bands. Currently one band: **Ctrl-V** (rock cover band). Maria Unchained will be added later from the app's Settings (admin → "Add band"), no code change needed.
Barak writes in Hebrew; answer him in Hebrew.

## Layout
- `src/server.js` – Cloudflare Worker: API + auth + D1. `__APP_HTML__` / `__VERSION__` are filled in by the build.
- `src/app.html` – the whole frontend (one file, vanilla JS, HE/EN/NL, RTL aware).
- `build.py` – builds `worker.js` (run `python3 build.py`).
- `worker.js` – build output that gets deployed. Never edit by hand.
- `wrangler.toml` – Worker name `bands`, D1 binding `DB` → database `bands`.

## Deploy (the whole point: no more pasting code into the Cloudflare dashboard)
1. One time: `npm install` then `npx wrangler login` (opens the browser; Barak approves).
2. Check `database_id` in `wrangler.toml` against `npx wrangler d1 list` (the id was read off a photo — verify it before the first deploy, or the binding will break).
3. Every change: `python3 build.py && npx wrangler deploy`.
4. Verify: `curl -s https://bands.barakbalva.workers.dev/api/state` → `version` must match the build.

Local testing: `npx wrangler dev --local` (local D1, setup screen appears on a fresh DB).

## Data – live, real band data. Do not wipe.
Tables are created automatically (`kv`, `bands`, `items`, `live`). Songs/setlists live in `items` as JSON:
- song: `title, artist, origKey, shift, key (= origKey shifted), bpm, duration (sec), tuning, status (active|learning|parked), notes, chords (free text, original key), parts: [{type: intro|verse|prechorus|chorus|bridge|solo|outro, name?, chords}], link, midi, midiCh`
- setlist: `name, date, time, venue, entries: [{s: songId} | {b: 1}]` (b = set break)
Chords are always stored in the ORIGINAL key; the app transposes on display with `shift`.

## Auth
Admin password (Barak only) + one password per band; signed cookie session. The admin can also replace the frontend at runtime (`PUT /api/admin/app`), but with wrangler deploy that is no longer needed.

## Ideas Barak has mentioned
- Gigs/rehearsals + member availability, Google Calendar sync
- Fill chords for the 8 "parked" brainstorm songs when they start learning them
- Custom domain for the band later
