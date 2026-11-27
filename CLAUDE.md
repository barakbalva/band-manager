# Bandtwerp App (app.bandtwerp.com, formerly BandBase)

BandHelper-style app for Barak's bands, named **Bandtwerp App** (renamed from BandBase on 2026-11-26 because bandbase.nl is an existing Dutch band app with the same name; never use "BandBase" in the app again, except the Google service account id below). Currently one band: **Ctrl-V** (rock cover band). Maria Unchained will be added later from the app's Settings (admin → "Add band"), no code change needed.
Barak writes in Hebrew; answer him in Hebrew.

## Layout
- `src/server.js` – Cloudflare Worker: API + auth + D1. `__APP_HTML__` / `__VERSION__` are filled in by the build.
- `src/app.html` – the whole frontend (one file, vanilla JS, languages EN/NL/FR/DE/HE in `T`, RTL aware for HE). Every new UI string needs all 5 languages (also `PUSH_TEXT` in server.js).
- `build.py` – builds `worker.js` (run `python3 build.py`).
- `worker.js` – build output that gets deployed. Never edit by hand.
- `src/icons/` – app icons (the shield logo `logo.jpg`, cropped by `make_icons.py`). `build.py` embeds the PNGs; served at `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`.
- `wrangler.toml` – Worker name `bands`, D1 binding `DB` → database `bands`.

## Deploy (the whole point: no more pasting code into the Cloudflare dashboard)
1. One time: `npm install` then `npx wrangler login` (opens the browser; Barak approves).
2. Check `database_id` in `wrangler.toml` against `npx wrangler d1 list` (the id was read off a photo — verify it before the first deploy, or the binding will break).
3. Every change: push to `main` on GitHub (barakbalva/band-manager). Cloudflare Workers Builds is connected (2026-11-26): build `npm run build` (= python3 build.py), deploy `npx wrangler deploy`. Manual fallback: `python3 build.py && npx wrangler deploy`.
4. Verify: `curl -s https://bands.barakbalva.workers.dev/api/state` → `version` must match the build.

Local testing: `npx wrangler dev --local` (local D1, setup screen appears on a fresh DB).

## Data – live, real band data. Do not wipe.
Tables are created automatically (`kv`, `bands`, `items`, `live`). Songs/setlists live in `items` as JSON:
- song: `title, artist, origKey, shift, key (= origKey shifted), bpm, duration (sec), tuning, status (active|learning|parked), notes, chords (free text, original key), parts: [{type: intro|verse|prechorus|chorus|bridge|solo|outro, name?, chords}], link, midi, midiCh`
- setlist: `name, date, time, venue, entries: [{s: songId} | {b: 1}]` (b = set break)
Chords are always stored in the ORIGINAL key; the app transposes on display with `shift`.

## Auth (personal accounts since 2026-11-26)
- Live at **https://app.bandtwerp.com** (Custom Domain on the Worker, zone bandtwerp.com — note the t: Band + Antwerp) and still at bands.barakbalva.workers.dev. Cookies are per host. Since 2026-11-27 every non-API page on *.workers.dev redirects (302) to app.bandtwerp.com (`APP_HOST` var overrides, empty string disables); `/api/*` keeps working there because Ctrl-V's Gmail script posts to the workers.dev URL.
- Tables `users` (email unique, PBKDF2 pw, `admin` = platform admin), `members` (band, user, role owner|member), `resets` (SHA-256 of one-time reset token, 3 days).
- Login: email + password (`POST /api/login {email,password}`), session `{r:'user', u}`; `readSession` loads the user each request (name, email, admin → `me.r='admin'`).
- Direct sign-up link **https://app.bandtwerp.com/#signup** opens the sign-up form (or says sign-up is closed).
- One account, many bands: signing up with an email that already has an account + the right password just adds the new band (or joins the invite) to that account; wrong password → `email_taken` with a hint. Signed-in users also get "Start a band" in Settings when sign-up is open.
- Sign-up `POST /api/signup`: with an invite token (joins as member) or, when admin switched "open sign-up" on (kv `signup_open`), with a new band name (becomes owner). `POST /api/bands` = signed-in user starts another band.
- Invite link: `/#invite=<bandId>.<random>`; band keeps `inviteHash` + `inviteExp` (14 days) in `bands.data`; a new link replaces the old. Owners: `/api/band/:id/invite` (POST/DELETE), `/members` (GET), `/members/:uid` (PUT role, DELETE), `/members/:uid/reset` (POST → `/#reset=<token>` link; no email sending yet).
- Band owners may also use `PUT /api/admin/band/:id` (name, calendarId, shared password, `legacyOff`) and `POST /api/admin/band/:id/inbox-token`; backups too.
- Legacy (still works until switched off): admin password (kv `admin`) and one shared password per band. `bands.data.legacyOff` blocks the band password and its sessions. Settings → "Make your personal account" (`POST /api/account/claim`, legacy admin only, once): creates the platform-admin user, owner of all bands.
- Deleting (GDPR): `DELETE /api/account {password}` (blocked with `sole_owner` if you are the only owner of a band that has other members; bands where you are alone are deleted too); `DELETE /api/band/:id {name}` (owner/admin, must type the band name) → `deleteBand()` clears items, live, mail, avail, backups, push, members, band. Google Calendar events stay.
- Sign-up needs `terms: true` (checkbox; time stored in kv `terms:<uid>`). Privacy policy + terms: `src/legal.js` (EN/NL/FR/DE), inlined by build.py at `/*__LEGAL__*/`, served at `/privacy` and `/terms?lang=`. Owner name + contact email come from kv `legal` (Control panel), not from the repo.
- Forgot password: `POST /api/forgot {email, lang}` sends a 2-hour reset link with `env.EMAIL.send()` (Cloudflare Email Service, needs Workers Paid + a `[[send_email]] name = "EMAIL"` binding in wrangler.toml + bandtwerp.com onboarded for sending; optional `MAIL_FROM` var, default no-reply@bandtwerp.com). Without the binding it answers `mailer:false` and the app tells people to ask a band owner for a reset link. Never reveals whether an email exists; max one mail per 5 min per address.
- Languages: Hebrew is not offered in the switcher to the public (Barak's wish); shown for admins or when already selected / device is Hebrew.
- The platform admin with a personal account sees only his own bands in the app (other bands only in the control panel; `bandRole` still grants admin access for support). Legacy admin password sessions still see all bands.
- Admin control panel: Settings → "Control panel", direct link **https://app.bandtwerp.com/#admin** (`GET /api/admin/overview`): every band, owners, members, songs, last change, calendar/mail/legacy flags.
- Not done yet: turning on email sending (Workers Paid), public landing page on bandtwerp.com (blog later), payments. PBKDF2 is only 5000 iterations (Workers Free CPU limit) — raise on a paid plan.
## Google Calendar (two-way)
- Calendar tab reads/writes the band's own Google Calendar through `/api/band/:id/cal` (GET list, POST, PUT/:eid, DELETE/:eid). Events are NOT stored in D1.
- Auth: a Google service account. Its JSON key is the Worker secret `GOOGLE_SA_KEY` (`npx wrangler secret put GOOGLE_SA_KEY < key.json`, Barak runs it). The band calendar is shared with the service account email ("Make changes to events").
- Calendar ID per band: `bands.data.calendarId`, set by the admin in the Calendar tab or Settings → Bands (calendar icon).
- Event type (rehearsal/gig/other) lives in `extendedProperties.private.bandType`; events made in Google get a type guessed from the title. Times are shown in the calendar's own time zone.
- Local testing: `GCAL_BASE` / `GTOKEN_URL` env vars point the Worker at a fake Google server.
- Live setup (done 2026-11-24, working): Google Cloud project `ctrlvagenda` (in the ctrlvpartyband@gmail.com account), service account `bandbase-calendar@ctrlvagenda.iam.gserviceaccount.com`, key installed as `GOOGLE_SA_KEY`. Ctrl-V's calendar = "Ctrl-V Partyband", ID `ctrlvpartyband@gmail.com` (shared with the service account: make changes + see all details). The other calendar "Ctrlv" is not the band calendar.

## Band mailbox (Mail tab)
- The band has its own Gmail. An Apps Script in that Gmail (generated by the app, admin → Mail tab → "Create connection script") runs every 5 min and POSTs new inbox mail to `/api/inbox/:bandId` with header `x-inbox-token`.
- Token: random, shown once inside the script; only its SHA-256 is stored (`bands.data.inboxTokenHash`, stripped from band GET → `inboxOn`). Making a new script invalidates the old one.
- Stored in table `mail` (band, id = Gmail message id): plain-text body only, no HTML, attachment names only. "Remove from app" sets `hidden` (not deleted) so the script's 15-min overlap doesn't bring it back. Read/unread is per device (localStorage).
- Replies go out by mailto (member's own mail) or "Open in Gmail".
- Live setup (done 2026-11-24, working): the script runs in ctrlvpartyband@gmail.com for band Ctrl-V.

## Backups
- Cron (`wrangler.toml` [triggers], Monday 03:00 UTC; the daily 06:00 cron is only for project reminders) → `scheduled()` stores a snapshot of every band in table `backups` (last 12 per band). Same shape as "Export backup", so "Import backup" restores it. Admin: Settings → Backups (list, download, "Back up now").
- Off-site copy: the Gmail Apps Script also runs `backupToDrive` weekly → `GET /api/inbox/:band/backup` (inbox token) → Drive folder "Bandtwerp backups" (scripts made before 2026-11-26 still write to "BandBase backups") (last 12). Scripts made before 2026-11-24 only sync mail. Ctrl-V's script got `setupBackup` + `backupToDrive` appended by hand (same token) on 2026-11-24 and works: triggers syncInbox (5 min) + backupToDrive (Mon 05:00).

## Availability, gig details, notifications, song extras
- Availability: table `avail` (band, event = Google event id, member = login name, yes|no|maybe); returned inside the calendar GET as `event.avail`. Band roster for "no answer yet" = `bands.data.members` (Settings → band members).
- Gig details (arrive, soundcheck, contact, fee, bring) live in the Google event's private properties (`GIG_FIELDS`). Mail tab has "Add to calendar" (prefills title/notes).
- Web Push without any library (VAPID ES256 + RFC 8291 aes128gcm in `sendPush`); VAPID keys auto-made in kv `vapid`. Subscriptions in table `push` (with language). Sent on: event created/changed in the app, new mail ingested, setlist saved (max once per 30 min per setlist). Not for events made directly in Google. iPhone needs the home-screen app.
- Songs: `practice` flag (chip + filter), YouTube search button, `sig` (time signature, empty = 4/4).
- Click for in-ears (rebuilt 2026-11-27): `Click` schedules ticks on the audio clock (25 ms look-ahead pump), so tempo is exact; accent on beat 1 of `sig`, count-in with a higher tone. Settings in localStorage via `clickSettings()` (CK): volume, output L / both / R (StereoPanner – send the click to one side of the in-ear mix), count-in 0/1/2 bars, start mode auto (every song) / tap ▶ / tap = count-in only, sound beep/woodblock/high. Stage mode: "Click" pill arms it, ⚙ opens settings, big ▶/■ button next to the BPM, `K` key (pedal) toggles; the beat light follows the click. A running click survives redraws (font size etc.) and stops/changes on the next song. `navigator.audioSession.type = 'playback'` so iPhones play with the silent switch on (Safari 16.4+).

## Projects tab (built 2026-11-26)
Social media / video projects. Stored in `items` as kind `project`:
`name, type (video|post|photo|other), status (idea|progress|editing|published), deadline (YYYY-MM-DD), owner, tasks: [{text, owner, date, done}], linkDrive, linkDraft, linkPub, songId, gigId (+gigTitle, gigDate cached), notes, inCal, calEventId`.
- Filters: active / this week (incl. overdue) / overdue (red) / published.
- "Put the deadline in the band calendar" keeps one all-day event (`🎬 name`, type other) in Google Calendar; id in `calEventId`; removed when unticked or the project is deleted.
- Push: new project (from the app); daily cron `0 6 * * *` → `remindDeadlines()` pushes for project deadlines and undone tasks due today/tomorrow (Europe/Brussels), once each (kv `due:...`).

## Home dashboard (2026-11-27, idea from the band)
- The first tab (`board`, label "Home"/"Overzicht") = dashboard on top (`drawNews`) + the board below. Cards: coming up (next 3 events in 21 days, answer availability ✓ ? ✗ right there), unread mail (per-device read state), project deadlines this week/overdue, and "new since your last visit": songs/setlists/projects/plans changed by someone else (`updated` > last visit, max 7 days back; last visit in localStorage `home:<bandId>`, taken once per app session in `S.homeSince`). Calendar/mail for the home are fetched in `loadNews()` (own `S.homeCal`, 1-min cache).

## Board + rehearsal plans (built 2026-11-27)
- **Board** tab (first tab, default for new devices): items kind `post` = `{text, important, author, created, seen: [names]}`. Important posts sort first. "Seen ✓" toggles via `POST /api/band/:id/item/:id/seen` (server-side, so taps don't overwrite each other). Author or band owner can pin/delete. Unread dot on the tab: posts newer than localStorage `board:<bandId>` by someone else. Push on every new post (title "📌 Important" when flagged).
- **Rehearsal plan**: items kind `plan` = `{eventId, date, start, title, goal, notes, blocks: [{min, text, songs: [songId]}]}`, one per rehearsal event (Google event id). Opened from the rehearsal's sheet in the Calendar ("📋 Rehearsal plan"); 📋 chip on planned rehearsals. Start time per block is computed from the event start; total vs. rehearsal length shown. "Play these songs" opens stage mode with the plan's songs. Push at most once per 30 min per plan.

## Ideas Barak has mentioned
- Brainstorm songs: section chords filled 2026-11-26 (7 of 8; "In de maneschijn" is Barak's own arrangement, left as is). Verify by ear when they start learning them.
- Plan: bandtwerp.com = blog about band gigs/projects; app.bandtwerp.com = Bandtwerp App for any band (free first, paid later).
