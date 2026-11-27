// Bandtwerp App — Cloudflare Worker (backend + built-in frontend)
// Needs one D1 binding named DB. Tables are created automatically.
// The frontend HTML can be replaced at runtime by the admin (self-update),
// so most changes never need a new paste into Cloudflare.

const VERSION = '__VERSION__';
const APP_HTML = __APP_HTML__;
const ICONS = __ICONS__; // band logo PNGs (base64), filled in by build.py from src/icons

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS bands (id TEXT PRIMARY KEY, name TEXT NOT NULL, pw TEXT NOT NULL, data TEXT, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, band TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER, by TEXT)`,
  `CREATE INDEX IF NOT EXISTS items_band ON items(band, kind)`,
  `CREATE TABLE IF NOT EXISTS live (band TEXT PRIMARY KEY, data TEXT, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS mail (id TEXT NOT NULL, band TEXT NOT NULL, data TEXT NOT NULL, received INTEGER, PRIMARY KEY (band, id))`,
  `CREATE INDEX IF NOT EXISTS mail_band ON mail(band, received)`,
  `CREATE TABLE IF NOT EXISTS avail (band TEXT NOT NULL, event TEXT NOT NULL, member TEXT NOT NULL, status TEXT NOT NULL, updated INTEGER, PRIMARY KEY (band, event, member))`,
  `CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, band TEXT NOT NULL, created INTEGER, size INTEGER, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS backups_band ON backups(band, created)`,
  `CREATE TABLE IF NOT EXISTS push (endpoint TEXT PRIMARY KEY, band TEXT NOT NULL, member TEXT, lang TEXT, keys TEXT NOT NULL, created INTEGER)`,
  // personal accounts (email + password); a user belongs to bands through `members`
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, pw TEXT NOT NULL, admin INTEGER DEFAULT 0, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS members (band TEXT NOT NULL, user TEXT NOT NULL, role TEXT NOT NULL, created INTEGER, PRIMARY KEY (band, user))`,
  `CREATE INDEX IF NOT EXISTS members_user ON members(user)`,
  // one-time password reset links (only the SHA-256 of the token is stored)
  `CREATE TABLE IF NOT EXISTS resets (hash TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL)`,
];
const BACKUPS_KEPT = 12;
let schemaReady = false;
const KINDS = new Set(['song', 'setlist', 'event', 'project', 'post', 'plan']);
const SESSION_DAYS = 180;

export default {
  async fetch(request, env, ctx) {
    try {
      if (!env.DB) return new Response(noDbPage(), { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
      await ensureSchema(env);
      const url = new URL(request.url);
      const p = url.pathname;
      // the old workers.dev address only serves the API (Gmail script, old installs); people are sent to the real domain
      if (url.hostname.endsWith('.workers.dev') && !p.startsWith('/api/') && env.APP_HOST !== '') return Response.redirect('https://' + (env.APP_HOST || 'app.bandtwerp.com') + p + url.search, 302);
      if (p.startsWith('/api/')) return await api(request, env, url, ctx);
      if (p === '/sw.js') return new Response(SW_JS, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } });
      if (p === '/manifest.webmanifest') return json(MANIFEST, 200, { 'content-type': 'application/manifest+json' });
      const ic = { '/apple-touch-icon.png': 180, '/icon-192.png': 192, '/icon-512.png': 512 }[p];
      if (ic) return new Response(Uint8Array.from(atob(ICONS[ic]), c => c.charCodeAt(0)), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
      if (p === '/privacy' || p === '/terms') {
        const want = url.searchParams.get('lang') || (request.headers.get('accept-language') || '').slice(0, 2).toLowerCase();
        return new Response(legalPage(p.slice(1), want, parse(await kvGet(env, 'legal'))), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      }
      if (p === '/icon.svg') return new Response(ICON_SVG, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
      // a self-updated page is used only while it matches the pasted Worker version
      const custom = (await kvGet(env, 'app_base')) === VERSION ? await kvGet(env, 'app_html') : null;
      return new Response(custom || APP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
    } catch (e) {
      return json({ error: 'server', detail: String(e && e.message || e) }, 500);
    }
  },
  // weekly backup of every band (cron in wrangler.toml)
  // weekly backup (Monday cron) + daily project deadline reminders (daily cron)
  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    const { results } = await env.DB.prepare('SELECT id FROM bands').all();
    if (!event || !event.cron || event.cron === '0 3 * * 1') for (const r of results) await storeBackup(env, r.id);
    if (!event || !event.cron || event.cron === DAILY_CRON) for (const r of results) await remindDeadlines(env, r.id);
  },
};
async function ensureSchema(env) { if (!schemaReady) { await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))); schemaReady = true; } }

// ---------- API ----------
async function api(req, env, url, ctx) {
  const later = pr => { if (ctx && ctx.waitUntil) ctx.waitUntil(pr.catch(() => {})); else pr.catch(() => {}); };
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  const me = await readSession(req, env);

  if (p === '/api/state' && m === 'GET') {
    const admin = await kvGet(env, 'admin');
    const bands = me ? await bandsFor(env, me) : [];
    const hasUsers = !!(await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first());
    return json({ setup: !admin && !hasUsers, me: me ? { role: me.r, user: !!me.u, email: me.email || '', band: me.b || null, name: me.n || '' } : null, bands,
      signupOpen: (await kvGet(env, 'signup_open')) === '1', hasUsers, version: VERSION, custom: (await kvGet(env, 'app_base')) === VERSION && !!(await kvGet(env, 'app_html')) });
  }

  if (p === '/api/setup' && m === 'POST') {
    if (await kvGet(env, 'admin')) return json({ error: 'already_setup' }, 409);
    const b = await body(req);
    if (!okPw(b.adminPassword) || !okPw(b.bandPassword) || !clean(b.bandName)) return json({ error: 'invalid' }, 400);
    if (b.adminPassword === b.bandPassword) return json({ error: 'same_password' }, 400);
    await kvSet(env, 'admin', await hashPw(b.adminPassword));
    const id = newId();
    await env.DB.prepare('INSERT INTO bands (id,name,pw,data,created) VALUES (?,?,?,?,?)').bind(id, clean(b.bandName), await hashPw(b.bandPassword), '{}', Date.now()).run();
    return withSession(env, { r: 'admin', n: clean(b.name || '') }, { ok: true });
  }

  if (p === '/api/login' && m === 'POST' && (await body(req.clone())).email) {
    const b = await body(req);
    const u = await env.DB.prepare('SELECT id,pw FROM users WHERE email=?').bind(normEmail(b.email)).first();
    if (u && await checkPw(String(b.password || ''), u.pw)) return withSession(env, { r: 'user', u: u.id }, { ok: true });
    await new Promise(r => setTimeout(r, 600));
    return json({ error: 'wrong_password' }, 401);
  }
  if (p === '/api/signup' && m === 'POST') {
    const b = await body(req);
    const email = normEmail(b.email), name = clean(b.name).slice(0, 40);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !okUserPw(b.password)) return json({ error: 'invalid' }, 400);
    let join = null, newBand = null;
    if (b.invite) { join = await inviteBand(env, b.invite); if (!join) return json({ error: 'invite_invalid' }, 400); }
    else {
      if ((await kvGet(env, 'signup_open')) !== '1') return json({ error: 'signup_closed' }, 403);
      newBand = clean(b.bandName); if (!newBand) return json({ error: 'invalid' }, 400);
    }
    if (!b.terms) return json({ error: 'terms' }, 400);
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) return json({ error: 'email_taken' }, 409);
    const uid = newId(), now = Date.now();
    await env.DB.prepare('INSERT INTO users (id,email,name,pw,admin,created) VALUES (?,?,?,?,0,?)').bind(uid, email, name, await hashPw(b.password), now).run();
    await kvSet(env, 'terms:' + uid, String(now));
    if (join) await addMember(env, join.id, uid, 'member');
    if (newBand) { const bid = newId(); await env.DB.prepare('INSERT INTO bands (id,name,pw,data,created) VALUES (?,?,?,?,?)').bind(bid, newBand, '-', JSON.stringify({ legacyOff: true }), now).run(); await addMember(env, bid, uid, 'owner'); }
    return withSession(env, { r: 'user', u: uid }, { ok: true });
  }
  // invite link: anyone may see which band it is for
  const iv = p.match(/^\/api\/invite\/([\w.-]+)$/);
  if (iv && m === 'GET') { const bnd = await inviteBand(env, iv[1]); return bnd ? json({ band: bnd.name }) : json({ error: 'invite_invalid' }, 404); }
  // "forgot password": a one-time link by email (needs the Email Service binding EMAIL, Workers Paid). Never tells whether the address exists.
  if (p === '/api/forgot' && m === 'POST') {
    if (!env.EMAIL) return json({ ok: false, mailer: false });
    const b = await body(req);
    const email = normEmail(b.email), lang = ['en', 'nl', 'fr', 'de', 'he'].includes(b.lang) ? b.lang : 'en';
    const u = email && await env.DB.prepare('SELECT id,name FROM users WHERE email=?').bind(email).first();
    const k = 'forgot:' + email, last = +(await kvGet(env, k) || 0);
    if (u && Date.now() - last > 5 * 60e3) {
      await kvSet(env, k, String(Date.now()));
      const token = b64u(crypto.getRandomValues(new Uint8Array(24)));
      await env.DB.prepare('INSERT INTO resets (hash,user,expires) VALUES (?,?,?)').bind(await sha256(token), u.id, Date.now() + 2 * 3600e3).run();
      const M = MAIL_TEXT[lang], link = `${url.origin}/#reset=${token}`;
      later(env.EMAIL.send({ to: email, from: { email: env.MAIL_FROM || 'no-reply@bandtwerp.com', name: 'Bandtwerp App' }, subject: M.subject,
        text: `${M.hi} ${u.name || ''},\n\n${M.body}\n${link}\n\n${M.ignore}\n\nBandtwerp App` }));
    }
    return json({ ok: true, mailer: true });
  }
  if (p === '/api/reset' && m === 'POST') {
    const b = await body(req);
    if (!okUserPw(b.password)) return json({ error: 'invalid' }, 400);
    const h = await sha256(String(b.token || ''));
    const r = await env.DB.prepare('SELECT user,expires FROM resets WHERE hash=?').bind(h).first();
    if (!r || r.expires < Date.now()) return json({ error: 'reset_invalid' }, 400);
    await env.DB.batch([env.DB.prepare('UPDATE users SET pw=? WHERE id=?').bind(await hashPw(b.password), r.user), env.DB.prepare('DELETE FROM resets WHERE user=?').bind(r.user)]);
    return withSession(env, { r: 'user', u: r.user }, { ok: true });
  }

  if (p === '/api/login' && m === 'POST') {
    const b = await body(req);
    const pw = String(b.password || '');
    const name = clean(b.name || '').slice(0, 40);
    if (!pw) return json({ error: 'invalid' }, 400);
    const admin = await kvGet(env, 'admin');
    if (admin && await checkPw(pw, admin)) return withSession(env, { r: 'admin', n: name }, { ok: true, role: 'admin' });
    const { results } = await env.DB.prepare('SELECT id, pw, data FROM bands').all();
    for (const r of results) if (!parse(r.data).legacyOff && r.pw !== '-' && await checkPw(pw, r.pw)) return withSession(env, { r: 'band', b: r.id, n: name }, { ok: true, role: 'band' });
    await new Promise(r => setTimeout(r, 600));
    return json({ error: 'wrong_password' }, 401);
  }

  // Gmail → app: the Apps Script in the band's Gmail posts new messages here with the band's inbox token
  const ib = p.match(/^\/api\/inbox\/([\w-]+)$/);
  if (ib && m === 'POST') {
    const row = await env.DB.prepare('SELECT data FROM bands WHERE id=?').bind(ib[1]).first();
    const want = row && parse(row.data).inboxTokenHash;
    const got = req.headers.get('x-inbox-token') || '';
    if (!want || !got || !safeEq(await sha256(got), want)) { await new Promise(r => setTimeout(r, 400)); return json({ error: 'auth' }, 401); }
    const b = await body(req);
    const stmts = [], fresh = [];
    for (const x of (Array.isArray(b.messages) ? b.messages : []).slice(0, 100)) {
      if (!x || !/^[\w-]{1,64}$/.test(x.id || '')) continue;
      const date = isNaN(new Date(x.date)) ? Date.now() : +new Date(x.date);
      const str = (v, n) => String(v || '').slice(0, n);
      const data = { thread: /^[\w-]{1,64}$/.test(x.thread || '') ? x.thread : '', from: str(x.from, 300), to: str(x.to, 1000), cc: str(x.cc, 1000),
        subject: str(x.subject, 500), date, text: str(x.text, 60000), attachments: (Array.isArray(x.attachments) ? x.attachments : []).slice(0, 30).map(a => str(a, 200)) };
      stmts.push(env.DB.prepare('INSERT INTO mail (id,band,data,received) VALUES (?,?,?,?) ON CONFLICT(band,id) DO NOTHING').bind(x.id, ib[1], JSON.stringify(data), date)); fresh.push(data);
    }
    let added = 0, firstNew = null;
    for (let i = 0; i < stmts.length; i += 50) {
      const res = await env.DB.batch(stmts.slice(i, i + 50));
      res.forEach((r, j) => { if (r.meta && r.meta.changes) { added++; if (!firstNew) firstNew = fresh[i + j]; } });
    }
    if (added) later(notify(env, ib[1], { kind: 'mail', n: added, subject: firstNew.subject, from: firstNew.from, tab: 'inbox' }));
    return json({ ok: true, count: stmts.length, added });
  }
  // Gmail script → Google Drive: a fresh backup of the band, fetched with the same inbox token
  const bk = p.match(/^\/api\/inbox\/([\w-]+)\/backup$/);
  if (bk && m === 'GET') {
    const row = await env.DB.prepare('SELECT data FROM bands WHERE id=?').bind(bk[1]).first();
    const want = row && parse(row.data).inboxTokenHash;
    const got = req.headers.get('x-inbox-token') || '';
    if (!want || !got || !safeEq(await sha256(got), want)) { await new Promise(r => setTimeout(r, 400)); return json({ error: 'auth' }, 401); }
    return json(await snapshot(env, bk[1]));
  }

  if (p === '/api/logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });

  if (!me) return json({ error: 'auth' }, 401);

  if (p === '/api/me' && m === 'PUT') {
    const b = await body(req);
    const n = clean(b.name || '').slice(0, 40);
    if (me.u) { if (n) await env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(n, me.u).run(); return json({ ok: true }); }
    return withSession(env, { ...me, n }, { ok: true });
  }
  if (p === '/api/account' && m === 'PUT') {
    if (!me.u) return json({ error: 'forbidden' }, 403);
    const b = await body(req);
    const u = await env.DB.prepare('SELECT pw FROM users WHERE id=?').bind(me.u).first();
    if (!u || !(await checkPw(String(b.oldPassword || ''), u.pw))) { await new Promise(r => setTimeout(r, 600)); return json({ error: 'wrong_password' }, 401); }
    if (b.email) {
      const email = normEmail(b.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid' }, 400);
      const ex = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
      if (ex && ex.id !== me.u) return json({ error: 'email_taken' }, 409);
      await env.DB.prepare('UPDATE users SET email=? WHERE id=?').bind(email, me.u).run();
    }
    if (b.password) { if (!okUserPw(b.password)) return json({ error: 'invalid' }, 400); await env.DB.prepare('UPDATE users SET pw=? WHERE id=?').bind(await hashPw(b.password), me.u).run(); }
    return json({ ok: true });
  }
  if (p === '/api/account' && m === 'DELETE') {
    if (!me.u) return json({ error: 'forbidden' }, 403);
    const b = await body(req);
    const u = await env.DB.prepare('SELECT pw FROM users WHERE id=?').bind(me.u).first();
    if (!u || !(await checkPw(String(b.password || ''), u.pw))) { await new Promise(r => setTimeout(r, 600)); return json({ error: 'wrong_password' }, 401); }
    const { results: mine } = await env.DB.prepare(`SELECT m.band, b.name, m.role,
      (SELECT COUNT(*) FROM members x WHERE x.band=m.band) n, (SELECT COUNT(*) FROM members x WHERE x.band=m.band AND x.role='owner') owners
      FROM members m JOIN bands b ON b.id=m.band WHERE m.user=?`).bind(me.u).all();
    const blocked = mine.filter(r => r.role === 'owner' && r.owners < 2 && r.n > 1);
    if (blocked.length) return json({ error: 'sole_owner', bands: blocked.map(r => r.name) }, 409);
    for (const r of mine) if (r.n < 2) await deleteBand(env, r.band);
    await env.DB.batch([env.DB.prepare('DELETE FROM members WHERE user=?').bind(me.u), env.DB.prepare('DELETE FROM resets WHERE user=?').bind(me.u), env.DB.prepare('DELETE FROM users WHERE id=?').bind(me.u)]);
    return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  }
  if (iv && m === 'POST') {
    if (!me.u) return json({ error: 'need_account' }, 403);
    const bnd = await inviteBand(env, iv[1]); if (!bnd) return json({ error: 'invite_invalid' }, 404);
    await addMember(env, bnd.id, me.u, 'member');
    return json({ ok: true, band: bnd.id });
  }
  // the old admin (shared admin password) makes the first personal account: platform admin, owner of every band
  if (p === '/api/account/claim' && m === 'POST') {
    if (me.r !== 'admin' || me.u) return json({ error: 'forbidden' }, 403);
    if (await env.DB.prepare('SELECT 1 FROM users WHERE admin=1').first()) return json({ error: 'already_claimed' }, 409);
    const b = await body(req);
    const email = normEmail(b.email), name = clean(b.name).slice(0, 40);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !okUserPw(b.password)) return json({ error: 'invalid' }, 400);
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) return json({ error: 'email_taken' }, 409);
    const uid = newId();
    await env.DB.prepare('INSERT INTO users (id,email,name,pw,admin,created) VALUES (?,?,?,?,1,?)').bind(uid, email, name, await hashPw(b.password), Date.now()).run();
    const { results } = await env.DB.prepare('SELECT id FROM bands').all();
    for (const r of results) await addMember(env, r.id, uid, 'owner');
    return withSession(env, { r: 'user', u: uid }, { ok: true });
  }
  // a signed-in user starts a new band (admin always; others when sign-up is open)
  if (p === '/api/bands' && m === 'POST') {
    if (!me.u) return json({ error: 'need_account' }, 403);
    if (me.r !== 'admin' && (await kvGet(env, 'signup_open')) !== '1') return json({ error: 'signup_closed' }, 403);
    const b = await body(req); const name = clean(b.name); if (!name) return json({ error: 'invalid' }, 400);
    const bid = newId();
    await env.DB.prepare('INSERT INTO bands (id,name,pw,data,created) VALUES (?,?,?,?,?)').bind(bid, name, '-', JSON.stringify({ legacyOff: true }), Date.now()).run();
    await addMember(env, bid, me.u, 'owner');
    return json({ ok: true, id: bid });
  }

  if (p === '/api/push/key' && m === 'GET') return json({ key: (await vapid(env)).pub });

  // ----- admin -----
  if (p.startsWith('/api/admin/')) {
    const ob = p.match(/^\/api\/admin\/band\/([\w-]+)(\/inbox-token)?$/);
    if (me.r !== 'admin' && !(ob && (ob[2] ? m === 'POST' : m === 'PUT') && (await bandRole(env, me, ob[1])) === 'owner')) return json({ error: 'forbidden' }, 403);
    // control panel: every band with its members, owners and activity
    if (p === '/api/admin/overview' && m === 'GET') {
      const q = sql => env.DB.prepare(sql).all().then(r => r.results);
      const [bands, mem, items, users] = await Promise.all([
        q('SELECT id,name,data,created FROM bands ORDER BY created'),
        q('SELECT m.band,m.role,m.created,u.name,u.email FROM members m JOIN users u ON u.id=m.user ORDER BY m.created'),
        q("SELECT band, SUM(kind='song') songs, SUM(kind='setlist') setlists, SUM(kind='project') projects, SUM(kind='post') posts, MAX(updated) last FROM items GROUP BY band"),
        q('SELECT COUNT(*) n, MAX(created) last FROM users')]);
      const byBand = {}; for (const x of mem) (byBand[x.band] = byBand[x.band] || []).push(x);
      const it = {}; for (const x of items) it[x.band] = x;
      return json({ users: users[0].n, lastUser: users[0].last, signupOpen: (await kvGet(env, 'signup_open')) === '1', legal: parse(await kvGet(env, 'legal')), mailer: !!env.EMAIL,
        bands: bands.map(b => { const ms = byBand[b.id] || [], d = parse(b.data), i = it[b.id] || {};
          return { id: b.id, name: b.name, created: b.created, members: ms.length, owners: ms.filter(x => x.role === 'owner').map(x => ({ name: x.name, email: x.email })),
            people: ms.map(x => ({ name: x.name, email: x.email, role: x.role, joined: x.created })), legacy: !d.legacyOff && b.pw !== '-',
            calendar: !!d.calendarId, mail: !!d.inboxTokenHash, songs: i.songs || 0, setlists: i.setlists || 0, projects: i.projects || 0, last: i.last || null }; }) });
    }
    if (p === '/api/admin/legal' && m === 'PUT') {
      const b = await body(req);
      const email = normEmail(b.email);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid' }, 400);
      await kvSet(env, 'legal', JSON.stringify({ owner: clean(b.owner), email }));
      return json({ ok: true });
    }
    if (p === '/api/admin/signup' && m === 'PUT') { const b = await body(req); await kvSet(env, 'signup_open', b.open ? '1' : '0'); return json({ ok: true }); }
    if (p === '/api/admin/band' && m === 'POST') {
      const b = await body(req);
      if (!clean(b.name) || !okPw(b.password)) return json({ error: 'invalid' }, 400);
      if (await pwInUse(env, b.password)) return json({ error: 'password_in_use' }, 409);
      const id = newId();
      await env.DB.prepare('INSERT INTO bands (id,name,pw,data,created) VALUES (?,?,?,?,?)').bind(id, clean(b.name), await hashPw(b.password), '{}', Date.now()).run();
      return json({ ok: true, id });
    }
    let tm = p.match(/^\/api\/admin\/band\/([\w-]+)\/inbox-token$/);
    if (tm && m === 'POST') {
      const row = await env.DB.prepare('SELECT data FROM bands WHERE id=?').bind(tm[1]).first();
      if (!row) return json({ error: 'not_found' }, 404);
      const token = b64u(crypto.getRandomValues(new Uint8Array(24)));
      await env.DB.prepare('UPDATE bands SET data=? WHERE id=?').bind(JSON.stringify({ ...parse(row.data), inboxTokenHash: await sha256(token) }), tm[1]).run();
      return json({ ok: true, token, url: `${url.origin}/api/inbox/${tm[1]}` });
    }
    let mm = p.match(/^\/api\/admin\/band\/([\w-]+)$/);
    if (mm && m === 'PUT') {
      const b = await body(req);
      if (b.name && clean(b.name)) await env.DB.prepare('UPDATE bands SET name=? WHERE id=?').bind(clean(b.name), mm[1]).run();
      if ('legacyOff' in b) {
        const row = await env.DB.prepare('SELECT data FROM bands WHERE id=?').bind(mm[1]).first();
        if (row) await env.DB.prepare('UPDATE bands SET data=? WHERE id=?').bind(JSON.stringify({ ...parse(row.data), legacyOff: !!b.legacyOff }), mm[1]).run();
      }
      if (b.password) {
        if (!okPw(b.password)) return json({ error: 'invalid' }, 400);
        if (await pwInUse(env, b.password, mm[1])) return json({ error: 'password_in_use' }, 409);
        const row = await env.DB.prepare('SELECT data FROM bands WHERE id=?').bind(mm[1]).first();
        await env.DB.prepare('UPDATE bands SET pw=?, data=? WHERE id=?').bind(await hashPw(b.password), JSON.stringify({ ...parse(row && row.data), legacyOff: false }), mm[1]).run();
      }
      if ('calendarId' in b) {
        const cid = String(b.calendarId || '').trim();
        if (cid && !/^[\w.+-]+@[\w.-]+$/.test(cid)) return json({ error: 'invalid' }, 400);
        const row = await env.DB.prepare('SELECT data FROM bands WHERE id=?').bind(mm[1]).first();
        if (!row) return json({ error: 'not_found' }, 404);
        await env.DB.prepare('UPDATE bands SET data=? WHERE id=?').bind(JSON.stringify({ ...parse(row.data), calendarId: cid }), mm[1]).run();
      }
      return json({ ok: true });
    }
    if (p === '/api/admin/password' && m === 'PUT') {
      const b = await body(req);
      if (!okPw(b.password)) return json({ error: 'invalid' }, 400);
      if (await pwInUse(env, b.password)) return json({ error: 'password_in_use' }, 409);
      await kvSet(env, 'admin', await hashPw(b.password));
      return json({ ok: true });
    }
    if (p === '/api/admin/app') {
      if (m === 'GET') return json({ custom: !!(await kvGet(env, 'app_html')), builtin: VERSION });
      if (m === 'PUT') {
        const html = await req.text();
        if (!/^<!DOCTYPE html>/i.test(html.trim()) || html.length > 3_000_000) return json({ error: 'invalid' }, 400);
        await kvSet(env, 'app_html', html);
        await kvSet(env, 'app_base', VERSION);
        return json({ ok: true, bytes: html.length });
      }
      if (m === 'DELETE') { await env.DB.prepare('DELETE FROM kv WHERE k=?').bind('app_html').run(); return json({ ok: true }); }
    }
    return json({ error: 'not_found' }, 404);
  }

  // ----- band data -----
  const bm = p.match(/^\/api\/band\/([\w-]+)(\/.*)?$/);
  if (bm) {
    const band = bm[1], rest = bm[2] || '';
    const role = await bandRole(env, me, band);
    if (!role) return json({ error: 'forbidden' }, 403);
    const row = await env.DB.prepare('SELECT id,name,data FROM bands WHERE id=?').bind(band).first();
    if (!row) return json({ error: 'not_found' }, 404);
    if (role === 'band' && parse(row.data).legacyOff) return json({ error: 'auth' }, 401); // shared password was switched off
    const manager = role === 'admin' || role === 'owner';

    if (rest === '' && m === 'DELETE') {
      if (!manager) return json({ error: 'forbidden' }, 403);
      const b = await body(req);
      if (String(b.name || '').trim() !== row.name) return json({ error: 'name_mismatch' }, 400);
      await deleteBand(env, band);
      return json({ ok: true });
    }
    // ----- members, invite link, reset links (owners) -----
    if (rest === '/members' && m === 'GET') {
      const { results } = await env.DB.prepare('SELECT u.id,u.name,u.email,m.role FROM members m JOIN users u ON u.id=m.user WHERE m.band=? ORDER BY m.created').bind(band).all();
      const d = parse(row.data);
      return json({ members: results.map(r => manager ? r : { id: r.id, name: r.name, role: r.role }), invite: manager ? { on: !!d.inviteHash && d.inviteExp > Date.now(), exp: d.inviteExp || 0 } : null, legacyOff: !!d.legacyOff, myRole: role });
    }
    if (rest === '/invite' && (m === 'POST' || m === 'DELETE')) {
      if (!manager) return json({ error: 'forbidden' }, 403);
      const d = parse(row.data);
      if (m === 'DELETE') { delete d.inviteHash; delete d.inviteExp; await env.DB.prepare('UPDATE bands SET data=? WHERE id=?').bind(JSON.stringify(d), band).run(); return json({ ok: true }); }
      const token = band + '.' + b64u(crypto.getRandomValues(new Uint8Array(18)));
      d.inviteHash = await sha256(token); d.inviteExp = Date.now() + INVITE_DAYS * 864e5;
      await env.DB.prepare('UPDATE bands SET data=? WHERE id=?').bind(JSON.stringify(d), band).run();
      return json({ ok: true, token, exp: d.inviteExp });
    }
    const mem = rest.match(/^\/members\/([\w-]+)(\/reset)?$/);
    if (mem) {
      const self = me.u === mem[1];
      if (!manager && !(self && m === 'DELETE' && !mem[2])) return json({ error: 'forbidden' }, 403);
      const target = await env.DB.prepare('SELECT role FROM members WHERE band=? AND user=?').bind(band, mem[1]).first();
      if (!target) return json({ error: 'not_found' }, 404);
      const owners = async () => (await env.DB.prepare("SELECT COUNT(*) n FROM members WHERE band=? AND role='owner'").bind(band).first()).n;
      if (mem[2] && m === 'POST') {
        const token = b64u(crypto.getRandomValues(new Uint8Array(24)));
        await env.DB.prepare('INSERT INTO resets (hash,user,expires) VALUES (?,?,?)').bind(await sha256(token), mem[1], Date.now() + 3 * 864e5).run();
        return json({ ok: true, token });
      }
      if (!mem[2] && m === 'PUT') {
        const b = await body(req); if (!['owner', 'member'].includes(b.role)) return json({ error: 'invalid' }, 400);
        if (target.role === 'owner' && b.role !== 'owner' && await owners() < 2) return json({ error: 'last_owner' }, 409);
        await env.DB.prepare('UPDATE members SET role=? WHERE band=? AND user=?').bind(b.role, band, mem[1]).run();
        return json({ ok: true });
      }
      if (!mem[2] && m === 'DELETE') {
        if (target.role === 'owner' && await owners() < 2) return json({ error: 'last_owner' }, 409);
        await env.DB.prepare('DELETE FROM members WHERE band=? AND user=?').bind(band, mem[1]).run();
        return json({ ok: true });
      }
    }

    if (rest === '' && m === 'GET') {
      const { results } = await env.DB.prepare('SELECT id,kind,data,updated,by FROM items WHERE band=?').bind(band).all();
      const { inboxTokenHash, inviteHash, ...bdata } = parse(row.data);
      const out = { band: { id: row.id, name: row.name, ...bdata, inboxOn: !!inboxTokenHash, myRole: role }, songs: [], setlists: [], events: [], projects: [], posts: [], plans: [] };
      for (const r of results) (out[r.kind + 's'] || []).push({ ...parse(r.data), id: r.id, updated: r.updated, by: r.by });
      return json(out);
    }
    if (rest === '/settings' && m === 'PUT') {
      const b = await body(req);
      const data = { ...parse(row.data), ...pick(b, ['color', 'members', 'notes']) };
      await env.DB.prepare('UPDATE bands SET data=? WHERE id=?').bind(JSON.stringify(data), band).run();
      return json({ ok: true });
    }
    if (rest === '/item' && m === 'PUT') {
      const b = await body(req);
      if (!KINDS.has(b.kind) || typeof b.data !== 'object') return json({ error: 'invalid' }, 400);
      const data = JSON.stringify(b.data);
      if (data.length > 400_000) return json({ error: 'too_big' }, 413);
      let id = b.id;
      if (id) {
        const ex = await env.DB.prepare('SELECT band FROM items WHERE id=?').bind(id).first();
        if (ex && ex.band !== band) return json({ error: 'forbidden' }, 403);
      } else id = newId();
      const now = Date.now();
      await env.DB.prepare('INSERT INTO items (id,band,kind,data,updated,by) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated=excluded.updated, by=excluded.by')
        .bind(id, band, b.kind, data, now, me.n || '').run();
      if (b.kind === 'post' && !b.id) later(notify(env, band, { kind: 'post', text: String(b.data.text || '').slice(0, 140), important: !!b.data.important, by: me.n || '', tab: 'board' }, me.n));
      // a rehearsal plan is saved on every edit too: at most one push per 30 minutes per plan
      if (b.kind === 'plan') later((async () => {
        const k = 'pushpl:' + id, last = +(await kvGet(env, k) || 0);
        if (now - last < 30 * 60e3) return;
        await kvSet(env, k, String(now));
        await notify(env, band, { kind: 'plan', name: String(b.data.title || ''), date: String(b.data.date || ''), by: me.n || '', tab: 'calendar' }, me.n);
      })());
      if (b.kind === 'project' && !b.id) later(notify(env, band, { kind: 'project', name: String(b.data.name || ''), by: me.n || '', tab: 'projects' }, me.n));
      // a setlist is saved on every edit: tell the band at most once per 30 minutes per setlist
      if (b.kind === 'setlist') later((async () => {
        const k = 'pushsl:' + id, last = +(await kvGet(env, k) || 0);
        if (now - last < 30 * 60e3) return;
        await kvSet(env, k, String(now));
        await notify(env, band, { kind: 'setlist', name: String(b.data.name || ''), by: me.n || '', tab: 'setlists' }, me.n);
      })());
      return json({ ok: true, id, updated: now });
    }
    // board post: "seen" (✓) is toggled on the server so two people tapping at once don't overwrite each other
    const sm = rest.match(/^\/item\/([\w-]+)\/seen$/);
    if (sm && m === 'POST') {
      const it = await env.DB.prepare("SELECT data FROM items WHERE id=? AND band=? AND kind='post'").bind(sm[1], band).first();
      if (!it) return json({ error: 'not_found' }, 404);
      const name = clean(me.n || '').slice(0, 40); if (!name) return json({ error: 'need_name' }, 400);
      const d = parse(it.data), seen = new Set(d.seen || []);
      seen.has(name) ? seen.delete(name) : seen.add(name);
      d.seen = [...seen];
      await env.DB.prepare('UPDATE items SET data=? WHERE id=?').bind(JSON.stringify(d), sm[1]).run();
      return json({ ok: true, seen: d.seen });
    }
    let im = rest.match(/^\/item\/([\w-]+)$/);
    if (im && m === 'DELETE') {
      await env.DB.prepare('DELETE FROM items WHERE id=? AND band=?').bind(im[1], band).run();
      return json({ ok: true });
    }
    if (rest === '/live') {
      if (m === 'GET') {
        const r = await env.DB.prepare('SELECT data,updated FROM live WHERE band=?').bind(band).first();
        return json(r ? { ...parse(r.data), updated: r.updated } : { on: false });
      }
      if (m === 'PUT') {
        const b = await body(req);
        const data = { on: !!b.on, setlist: String(b.setlist || ''), idx: Number(b.idx) || 0, by: me.n || '' };
        const now = Date.now();
        await env.DB.prepare('INSERT INTO live (band,data,updated) VALUES (?,?,?) ON CONFLICT(band) DO UPDATE SET data=excluded.data, updated=excluded.updated').bind(band, JSON.stringify(data), now).run();
        return json({ ok: true, updated: now });
      }
    }
    // ----- band inbox (filled by the Gmail script) -----
    if (rest === '/inbox' && m === 'GET') {
      const { results } = await env.DB.prepare("SELECT id,data FROM mail WHERE band=? AND json_extract(data,'$.hidden') IS NULL ORDER BY received DESC LIMIT 300").bind(band).all();
      return json({ on: !!parse(row.data).inboxTokenHash, messages: results.map(r => { const d = parse(r.data); const { text, ...head } = d;
        return { id: r.id, ...head, snippet: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160) }; }) });
    }
    const mi = rest.match(/^\/inbox\/([\w-]+)$/);
    if (mi && m === 'GET') {
      const r = await env.DB.prepare('SELECT id,data FROM mail WHERE band=? AND id=?').bind(band, mi[1]).first();
      return r ? json({ id: r.id, ...parse(r.data) }) : json({ error: 'not_found' }, 404);
    }
    if (mi && m === 'DELETE') {
      // kept as hidden, so the Gmail script's overlap does not bring it back
      await env.DB.prepare("UPDATE mail SET data=json_set(data,'$.hidden',1) WHERE band=? AND id=?").bind(band, mi[1]).run();
      return json({ ok: true });
    }
    // ----- availability per calendar event (who can make it) -----
    if (rest === '/avail' && m === 'PUT') {
      const b = await body(req);
      const name = clean(me.n || '').slice(0, 40);
      if (!name) return json({ error: 'name_required' }, 400);
      if (!/^[\w-]{1,200}$/.test(b.event || '')) return json({ error: 'invalid' }, 400);
      if (!b.status) await env.DB.prepare('DELETE FROM avail WHERE band=? AND event=? AND member=?').bind(band, b.event, name).run();
      else if (['yes', 'no', 'maybe'].includes(b.status))
        await env.DB.prepare('INSERT INTO avail (band,event,member,status,updated) VALUES (?,?,?,?,?) ON CONFLICT(band,event,member) DO UPDATE SET status=excluded.status, updated=excluded.updated').bind(band, b.event, name, b.status, Date.now()).run();
      else return json({ error: 'invalid' }, 400);
      return json({ ok: true });
    }
    // ----- backups (admin) -----
    if (rest === '/backups' || rest.startsWith('/backups/')) {
      if (!manager) return json({ error: 'forbidden' }, 403);
      if (rest === '/backups' && m === 'GET') {
        const { results } = await env.DB.prepare('SELECT id,created,size FROM backups WHERE band=? ORDER BY created DESC').bind(band).all();
        return json({ backups: results });
      }
      if (rest === '/backups' && m === 'POST') return json({ ok: true, ...(await storeBackup(env, band)) });
      const bm2 = rest.match(/^\/backups\/([\w-]+)$/);
      if (bm2 && m === 'GET') {
        const r = await env.DB.prepare('SELECT data,created FROM backups WHERE band=? AND id=?').bind(band, bm2[1]).first();
        if (!r) return json({ error: 'not_found' }, 404);
        return new Response(r.data, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
          'content-disposition': `attachment; filename="${row.name.replace(/[^\w-]+/g, '_')}-backup-${new Date(r.created).toISOString().slice(0, 10)}.json"` } });
      }
    }
    // ----- push notifications: this device's subscription -----
    if (rest === '/push' && (m === 'POST' || m === 'DELETE')) {
      const b = await body(req);
      const sub = b.subscription || {};
      if (!/^https:\/\/[^\s]{10,800}$/.test(sub.endpoint || '')) return json({ error: 'invalid' }, 400);
      if (m === 'DELETE') { await env.DB.prepare('DELETE FROM push WHERE endpoint=?').bind(sub.endpoint).run(); return json({ ok: true }); }
      const keys = sub.keys || {};
      if (!/^[\w-]{20,200}$/.test(keys.p256dh || '') || !/^[\w-]{10,100}$/.test(keys.auth || '')) return json({ error: 'invalid' }, 400);
      await env.DB.prepare('INSERT INTO push (endpoint,band,member,lang,keys,created) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET band=excluded.band, member=excluded.member, lang=excluded.lang, keys=excluded.keys')
        .bind(sub.endpoint, band, clean(me.n || '').slice(0, 40), ['he', 'en', 'nl', 'fr', 'de'].includes(b.lang) ? b.lang : 'en', JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }), Date.now()).run();
      if (b.test) later(sendPush(env, { endpoint: sub.endpoint, keys }, { title: 'Bandtwerp App', body: PUSH_TEXT[b.lang in PUSH_TEXT ? b.lang : 'en'].test, tab: 'settings' }));
      return json({ ok: true });
    }
    // ----- Google Calendar (two-way, through a service account the band calendar is shared with) -----
    if (rest === '/cal' || rest.startsWith('/cal/')) {
      const sa = saKey(env);
      const calId = parse(row.data).calendarId || '';
      if (!sa || !calId) return json({ configured: false, hasKey: !!sa, saEmail: sa ? sa.client_email : null, calendarId: calId });
      const base = `${env.GCAL_BASE || 'https://www.googleapis.com/calendar/v3'}/calendars/${encodeURIComponent(calId)}/events`;
      const em = rest.match(/^\/cal\/([\w-]+)$/);
      if (rest === '/cal' && m === 'GET') {
        const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
          timeMin: isoOr(url.searchParams.get('from'), Date.now() - 864e5), timeMax: isoOr(url.searchParams.get('to'), Date.now() + 365 * 864e5) });
        const r = await gcal(env, sa, `${base}?${q}`);
        if (r.error) return json(r, 502);
        const evs = (r.items || []).filter(e => e.status !== 'cancelled').map(fromG);
        const { results: av } = await env.DB.prepare('SELECT event,member,status FROM avail WHERE band=?').bind(band).all();
        const byEv = {}; for (const a of av) (byEv[a.event] = byEv[a.event] || {})[a.member] = a.status;
        for (const e of evs) e.avail = byEv[e.id] || {};
        return json({ configured: true, saEmail: sa.client_email, calendarId: calId, timeZone: r.timeZone || '', events: evs });
      }
      if ((rest === '/cal' && m === 'POST') || (em && m === 'PUT')) {
        const ev = toG(await body(req), me);
        if (!ev) return json({ error: 'invalid' }, 400);
        const r = await gcal(env, sa, em ? `${base}/${em[1]}` : base, { method: em ? 'PATCH' : 'POST',
          // nulls clear the other start/end form on PATCH (timed ↔ all-day); a new event just leaves them out
          body: JSON.stringify(ev, em ? null : (k, v) => v === null ? undefined : v) });
        if (r.error) return json(r, 502);
        const out = fromG(r);
        later(notify(env, band, { kind: em ? 'evChanged' : 'evNew', type: out.type, title: out.title, date: out.date, start: out.start, by: me.n || '', tab: 'calendar' }, me.n));
        return json({ ok: true, event: out });
      }
      if (em && m === 'DELETE') {
        const r = await gcal(env, sa, `${base}/${em[1]}`, { method: 'DELETE' });
        return r.error && r.status !== 410 ? json(r, 502) : json({ ok: true });
      }
    }
    if (rest === '/import' && m === 'POST') {
      const b = await body(req);
      const stmts = [];
      for (const kind of ['song', 'setlist', 'event', 'project', 'post', 'plan']) for (const it of (b[kind + 's'] || [])) {
        if (!it || typeof it !== 'object') continue;
        const { id, updated, by, ...data } = it;
        stmts.push(env.DB.prepare('INSERT INTO items (id,band,kind,data,updated,by) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated=excluded.updated WHERE items.band=excluded.band')
          .bind(/^[\w-]+$/.test(id || '') ? id : newId(), band, kind, JSON.stringify(data), Date.now(), me.n || ''));
      }
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
      return json({ ok: true, count: stmts.length });
    }
  }
  return json({ error: 'not_found' }, 404);
}

async function bandsFor(env, me) {
  let results;
  // the platform admin with a personal account only sees their own bands in the app (others' bands are listed in the control panel)
  if (me.r === 'admin' && !me.u) ({ results } = await env.DB.prepare('SELECT id,name,data,? role FROM bands ORDER BY created').bind('admin').all());
  else if (me.u) ({ results } = await env.DB.prepare('SELECT b.id,b.name,b.data,m.role FROM members m JOIN bands b ON b.id=m.band WHERE m.user=? ORDER BY m.created').bind(me.u).all());
  else ({ results } = await env.DB.prepare("SELECT id,name,data,'band' role FROM bands WHERE id=?").bind(me.b).all());
  return results.filter(r => me.r !== 'band' || !parse(r.data).legacyOff).map(r => ({ id: r.id, name: r.name, color: parse(r.data).color || '', role: r.role }));
}
// what this session may do in a band: 'admin' | 'owner' | 'member' | 'band' (shared band password) | null
async function bandRole(env, me, band) {
  if (me.r === 'admin') return 'admin';
  if (me.u) { const r = await env.DB.prepare('SELECT role FROM members WHERE band=? AND user=?').bind(band, me.u).first(); return r ? r.role : null; }
  return me.r === 'band' && me.b === band ? 'band' : null;
}
// everything a band owns in D1 (events live in Google Calendar and stay there)
async function deleteBand(env, band) {
  await env.DB.batch(['items', 'live', 'mail', 'avail', 'backups', 'push', 'members'].map(t => env.DB.prepare(`DELETE FROM ${t} WHERE band=?`).bind(band))
    .concat([env.DB.prepare('DELETE FROM bands WHERE id=?').bind(band)]));
}
async function addMember(env, band, user, role) {
  await env.DB.prepare('INSERT INTO members (band,user,role,created) VALUES (?,?,?,?) ON CONFLICT(band,user) DO NOTHING').bind(band, user, role, Date.now()).run();
}
// invite tokens look like "<bandId>.<random>"; the band keeps only the SHA-256 of the current one
async function inviteBand(env, token) {
  const id = String(token || '').split('.')[0];
  if (!/^[\w-]+$/.test(id)) return null;
  const row = await env.DB.prepare('SELECT id,name,data FROM bands WHERE id=?').bind(id).first();
  const d = row && parse(row.data);
  if (!d || !d.inviteHash || !(d.inviteExp > Date.now()) || !safeEq(await sha256(String(token)), d.inviteHash)) return null;
  return row;
}
const INVITE_DAYS = 14;
const MAIL_TEXT = {
  en: { subject: 'Reset your Bandtwerp App password', hi: 'Hi', body: 'Click this link to choose a new password (valid for 2 hours):', ignore: 'Did not ask for this? Then you can ignore this email.' },
  nl: { subject: 'Je Bandtwerp App-wachtwoord resetten', hi: 'Hoi', body: 'Klik op deze link om een nieuw wachtwoord te kiezen (2 uur geldig):', ignore: 'Niet gevraagd? Dan kun je deze mail negeren.' },
  fr: { subject: 'Réinitialiser ton mot de passe Bandtwerp App', hi: 'Salut', body: 'Clique sur ce lien pour choisir un nouveau mot de passe (valable 2 heures) :', ignore: 'Tu n’as rien demandé ? Ignore simplement ce mail.' },
  de: { subject: 'Bandtwerp App-Passwort zurücksetzen', hi: 'Hallo', body: 'Klicke auf diesen Link, um ein neues Passwort zu wählen (2 Stunden gültig):', ignore: 'Nicht angefordert? Dann kannst du diese Mail ignorieren.' },
  he: { subject: 'איפוס הסיסמה ל-Bandtwerp App', hi: 'שלום', body: 'לחצו על הקישור כדי לבחור סיסמה חדשה (בתוקף שעתיים):', ignore: 'לא ביקשתם? אפשר להתעלם מהמייל הזה.' },
};
const normEmail = e => String(e || '').trim().toLowerCase().slice(0, 200);
const okUserPw = s => typeof s === 'string' && s.length >= 8 && s.length <= 200;

async function pwInUse(env, pw, exceptBand) {
  const admin = await kvGet(env, 'admin');
  if (admin && await checkPw(pw, admin)) return true;
  const { results } = await env.DB.prepare('SELECT id,pw FROM bands').all();
  for (const r of results) if (r.id !== exceptBand && await checkPw(pw, r.pw)) return true;
  return false;
}

// ---------- backups ----------
// same shape as the app's "Export backup", so "Import backup" restores it
async function snapshot(env, band) {
  const row = await env.DB.prepare('SELECT id,name,data FROM bands WHERE id=?').bind(band).first();
  const { inboxTokenHash, inviteHash, inviteExp, ...bdata } = parse(row && row.data);
  const out = { band: row ? row.name : '', bandInfo: bdata, exported: new Date().toISOString(), songs: [], setlists: [], events: [], projects: [], posts: [], plans: [] };
  const { results } = await env.DB.prepare('SELECT id,kind,data,updated,by FROM items WHERE band=?').bind(band).all();
  for (const r of results) (out[r.kind + 's'] || []).push({ ...parse(r.data), id: r.id, updated: r.updated, by: r.by });
  return out;
}
async function storeBackup(env, band) {
  const data = JSON.stringify(await snapshot(env, band)), id = newId(), now = Date.now();
  await env.DB.prepare('INSERT INTO backups (id,band,created,size,data) VALUES (?,?,?,?,?)').bind(id, band, now, data.length, data).run();
  await env.DB.prepare('DELETE FROM backups WHERE band=? AND id NOT IN (SELECT id FROM backups WHERE band=? ORDER BY created DESC LIMIT ?)').bind(band, band, BACKUPS_KEPT).run();
  return { id, created: now, size: data.length };
}

// ---------- push notifications (Web Push: VAPID + aes128gcm, RFC 8291/8292) ----------
const PUSH_TEXT = {
  en: { post: 'New message', postImportant: '📌 Important', plan: 'Rehearsal plan', project: 'New project', dueToday: 'Deadline today', dueTomorrow: 'Deadline tomorrow', taskToday: 'Task due today', taskTomorrow: 'Task due tomorrow', test: 'Notifications are on.', mail: n => n > 1 ? `${n} new emails` : 'New email', setlist: 'Setlist updated', evNew: { rehearsal: 'New rehearsal', gig: 'New gig', other: 'New event' }, evChanged: 'Event changed', by: 'by' },
  nl: { post: 'Nieuw bericht', postImportant: '📌 Belangrijk', plan: 'Repetitieplan', project: 'Nieuw project', dueToday: 'Deadline vandaag', dueTomorrow: 'Deadline morgen', taskToday: 'Taak voor vandaag', taskTomorrow: 'Taak voor morgen', test: 'Meldingen staan aan.', mail: n => n > 1 ? `${n} nieuwe mails` : 'Nieuwe mail', setlist: 'Setlist bijgewerkt', evNew: { rehearsal: 'Nieuwe repetitie', gig: 'Nieuw optreden', other: 'Nieuwe afspraak' }, evChanged: 'Afspraak gewijzigd', by: 'door' },
  fr: { post: 'Nouveau message', postImportant: '📌 Important', plan: 'Plan de répétition', project: 'Nouveau projet', dueToday: 'Échéance aujourd’hui', dueTomorrow: 'Échéance demain', taskToday: 'Tâche pour aujourd’hui', taskTomorrow: 'Tâche pour demain', test: 'Les notifications sont activées.', mail: n => n > 1 ? `${n} nouveaux mails` : 'Nouveau mail', setlist: 'Setlist mise à jour', evNew: { rehearsal: 'Nouvelle répétition', gig: 'Nouveau concert', other: 'Nouvel événement' }, evChanged: 'Événement modifié', by: 'par' },
  de: { post: 'Neue Nachricht', postImportant: '📌 Wichtig', plan: 'Probenplan', project: 'Neues Projekt', dueToday: 'Deadline heute', dueTomorrow: 'Deadline morgen', taskToday: 'Aufgabe für heute', taskTomorrow: 'Aufgabe für morgen', test: 'Benachrichtigungen sind an.', mail: n => n > 1 ? `${n} neue Mails` : 'Neue Mail', setlist: 'Setlist aktualisiert', evNew: { rehearsal: 'Neue Probe', gig: 'Neuer Auftritt', other: 'Neuer Termin' }, evChanged: 'Termin geändert', by: 'von' },
  he: { post: 'הודעה חדשה', postImportant: '📌 חשוב', plan: 'תוכנית חזרה', project: 'פרויקט חדש', dueToday: 'דדליין היום', dueTomorrow: 'דדליין מחר', taskToday: 'משימה להיום', taskTomorrow: 'משימה למחר', test: 'ההתראות פועלות.', mail: n => n > 1 ? `${n} מיילים חדשים` : 'מייל חדש', setlist: 'הסט־ליסט עודכן', evNew: { rehearsal: 'חזרה חדשה', gig: 'הופעה חדשה', other: 'אירוע חדש' }, evChanged: 'אירוע השתנה', by: 'ע״י' },
};
function pushMessage(lang, x) {
  const L = PUSH_TEXT[lang] || PUSH_TEXT.en;
  const by = x.by ? ` (${L.by} ${x.by})` : '';
  if (x.kind === 'mail') return { title: L.mail(x.n), body: [x.from && String(x.from).replace(/\s*<[^>]*>/, ''), x.subject].filter(Boolean).join(': ') };
  if (x.kind === 'setlist') return { title: L.setlist, body: x.name + by };
  if (x.kind === 'project') return { title: L.project, body: x.name + by };
  if (x.kind === 'post') return { title: (x.important ? L.postImportant : L.post) + (x.by ? ' · ' + x.by : ''), body: x.text };
  if (x.kind === 'plan') return { title: L.plan, body: [x.date && new Date(x.date + 'T12:00').toLocaleDateString(lang === 'he' ? 'he-IL' : lang, { weekday: 'short', day: 'numeric', month: 'short' }), x.name].filter(Boolean).join(' · ') + by };
  if (x.kind === 'due') return { title: L[(x.task ? 'task' : 'due') + (x.today ? 'Today' : 'Tomorrow')], body: x.task ? `${x.task}${x.owner ? ' (' + x.owner + ')' : ''} · ${x.name}` : x.name + (x.owner ? ` (${x.owner})` : '') };
  const d = x.date ? new Date(x.date + 'T12:00').toLocaleDateString(lang === 'he' ? 'he-IL' : lang, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  return { title: x.kind === 'evNew' ? (L.evNew[x.type] || L.evNew.other) : L.evChanged, body: `${x.title} · ${d}${x.start ? ' ' + x.start : ''}${by}` };
}
// everyone in the band except the person who made the change
async function notify(env, band, x, exceptMember) {
  const { results } = await env.DB.prepare('SELECT endpoint,member,lang,keys FROM push WHERE band=?').bind(band).all();
  await Promise.all(results.filter(r => !exceptMember || r.member !== exceptMember).map(r =>
    sendPush(env, { endpoint: r.endpoint, keys: parse(r.keys) }, { ...pushMessage(r.lang, x), tab: x.tab })));
}
// ---------- project deadline reminders (daily cron) ----------
const DAILY_CRON = '0 6 * * *';
const DONE_STATUS = new Set(['published']);
function dayIn(tz, plus = 0) { return new Date(Date.now() + plus * 864e5).toLocaleDateString('sv-SE', { timeZone: tz }); }
async function remindDeadlines(env, band) {
  const today = dayIn('Europe/Brussels'), tomorrow = dayIn('Europe/Brussels', 1);
  const { results } = await env.DB.prepare("SELECT id,data FROM items WHERE band=? AND kind='project'").bind(band).all();
  for (const r of results) {
    const pj = parse(r.data); if (DONE_STATUS.has(pj.status)) continue;
    const hits = [];
    if (pj.deadline === today || pj.deadline === tomorrow) hits.push({ key: `due:${r.id}:${pj.deadline}:${pj.deadline === today}`, x: { kind: 'due', name: pj.name || '', owner: pj.owner || '', today: pj.deadline === today } });
    (pj.tasks || []).forEach((tk, i) => { if (!tk.done && (tk.date === today || tk.date === tomorrow))
      hits.push({ key: `due:${r.id}:t${i}:${tk.date}:${tk.date === today}`, x: { kind: 'due', name: pj.name || '', task: String(tk.text || ''), owner: tk.owner || '', today: tk.date === today } }); });
    for (const h of hits) { if (await kvGet(env, h.key)) continue; await kvSet(env, h.key, '1'); await notify(env, band, { ...h.x, tab: 'projects' }); }
  }
}
async function vapid(env) {
  let v = parse(await kvGet(env, 'vapid'));
  if (!v.pub) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
    await kvSet(env, 'vapid', JSON.stringify(v));
  }
  return v;
}
const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info },
  await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function sendPush(env, sub, msg) {
  try {
    const v = await vapid(env), aud = new URL(sub.endpoint).origin;
    const seg = o => b64u(enc.encode(JSON.stringify(o)));
    const unsigned = seg({ typ: 'JWT', alg: 'ES256' }) + '.' + seg({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://bands.barakbalva.workers.dev' });
    const sk = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const jwt = unsigned + '.' + b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sk, enc.encode(unsigned)));
    // payload encryption (RFC 8291)
    const uaPub = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
    const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
    const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
    const ikm = await hkdf(authSecret, shared, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(enc.encode(JSON.stringify(msg)), new Uint8Array([2]))));
    const head = new Uint8Array(21); head.set(salt); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65;
    const r = await fetch(sub.endpoint, { method: 'POST', body: cat(head, asPub, ct), headers: {
      authorization: `vapid t=${jwt}, k=${v.pub}`, 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'normal' } });
    if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM push WHERE endpoint=?').bind(sub.endpoint).run();
    return r.status;
  } catch (e) { return 0; }
}

// ---------- Google Calendar ----------
// GOOGLE_SA_KEY is a Worker secret holding the service account's JSON key (wrangler secret put GOOGLE_SA_KEY < key.json)
function saKey(env) {
  try { const k = JSON.parse(env.GOOGLE_SA_KEY || ''); return k.client_email && k.private_key ? k : null; } catch { return null; }
}
let gTok = null;
async function gToken(env, sa) {
  if (gTok && gTok.email === sa.client_email && gTok.exp > Date.now() + 60_000) return gTok.t;
  const now = Math.floor(Date.now() / 1000);
  const seg = o => b64u(enc.encode(JSON.stringify(o)));
  const unsigned = seg({ alg: 'RS256', typ: 'JWT' }) + '.' + seg({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const jwt = unsigned + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned)));
  const r = await fetch(env.GTOKEN_URL || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('google_token: ' + (j.error_description || j.error || r.status));
  gTok = { email: sa.client_email, t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return gTok.t;
}
async function gcal(env, sa, url, opts = {}) {
  let r;
  try { r = await fetch(url, { ...opts, headers: { authorization: 'Bearer ' + await gToken(env, sa), 'content-type': 'application/json' } }); }
  catch (e) { return { error: 'google', status: 0, detail: String(e.message || e) }; }
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  return r.ok ? j : { error: 'google', status: r.status, detail: (j.error && j.error.message) || '' };
}
const isoOr = (v, fb) => { const d = new Date(v || NaN); return (isNaN(d) ? new Date(fb) : d).toISOString(); };
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
const TYPES = ['rehearsal', 'gig', 'other'];
const GIG_FIELDS = ['arrive', 'soundcheck', 'contact', 'fee', 'bring']; // gig details, kept in the event's private properties
function guessType(s) {
  s = String(s || '').toLowerCase();
  return /rehears|repet|oefen|חזר/.test(s) ? 'rehearsal' : /gig|show|concert|optreden|הופע/.test(s) ? 'gig' : 'other';
}
// app event → Google event body
function toG(b, me) {
  const date = String(b.date || ''), title = String(b.title || '').trim().slice(0, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) return null;
  const tm = v => /^\d{2}:\d{2}$/.test(v || '') ? v : '';
  const ev = { summary: title, location: String(b.location || '').slice(0, 300), description: String(b.notes || '').slice(0, 5000),
    extendedProperties: { private: { bandType: TYPES.includes(b.type) ? b.type : 'other', by: String(me.n || '').slice(0, 40) } } };
  for (const k of GIG_FIELDS) ev.extendedProperties.private[k] = String(b[k] || '').slice(0, 300);
  const start = tm(b.start);
  if (b.allDay || !start) {
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(b.endDate || '') && b.endDate >= date ? b.endDate : date;
    ev.start = { date, dateTime: null, timeZone: null }; ev.end = { date: addDays(endDate, 1), dateTime: null, timeZone: null };
  } else {
    const tz = /^[\w+/-]{1,60}$/.test(b.timeZone || '') ? b.timeZone : 'Europe/Amsterdam';
    const mins = v => +v.slice(0, 2) * 60 + +v.slice(3, 5);
    const s = mins(start); let e = tm(b.end) ? mins(b.end) : s + 120;
    let endDate = date; if (e <= s) e += 1440; // an end before the start means it ends after midnight
    if (e >= 1440) { endDate = addDays(date, Math.floor(e / 1440)); e %= 1440; }
    const hm = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
    ev.start = { dateTime: `${date}T${start}:00`, timeZone: tz, date: null }; ev.end = { dateTime: `${endDate}T${hm(e)}:00`, timeZone: tz, date: null };
  }
  return ev;
}
// Google event → app event (times stay in the calendar's own time zone)
function fromG(e) {
  const s = e.start || {}, en = e.end || {}, allDay = !!s.date;
  const p = e.extendedProperties && e.extendedProperties.private || {};
  return { id: e.id, title: e.summary || '', allDay, date: allDay ? s.date : String(s.dateTime || '').slice(0, 10),
    start: allDay ? '' : String(s.dateTime || '').slice(11, 16), end: allDay ? '' : String(en.dateTime || '').slice(11, 16),
    endDate: allDay ? addDays(en.date || s.date, -1) : String(en.dateTime || '').slice(0, 10),
    location: e.location || '', notes: e.description || '', type: TYPES.includes(p.bandType) ? p.bandType : guessType(e.summary),
    by: p.by || '', link: e.htmlLink || '', recurring: !!e.recurringEventId,
    ...Object.fromEntries(GIG_FIELDS.map(k => [k, p[k] || ''])) };
}

// ---------- helpers ----------
async function sha256(s) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
function safeEq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function json(o, status = 200, headers = {}) {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
async function body(req) { try { return await req.json(); } catch { return {}; } }
function parse(s) { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } }
function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }
function clean(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80); }
function okPw(s) { return typeof s === 'string' && s.length >= 4 && s.length <= 200; }
function newId() { const a = new Uint8Array(9); crypto.getRandomValues(a); return [...a].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 14); }
async function kvGet(env, k) { const r = await env.DB.prepare('SELECT v FROM kv WHERE k=?').bind(k).first(); return r ? r.v : null; }
async function kvSet(env, k, v) { await env.DB.prepare('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, v).run(); }

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const ITER = 5000; // kept low: Workers Free allows ~10 ms CPU per request

async function hashPw(pw, saltB64) {
  const salt = saltB64 ? unb64u(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return b64u(salt) + ':' + b64u(bits);
}
async function checkPw(pw, stored) {
  const [salt] = String(stored).split(':');
  const h = await hashPw(pw, salt);
  if (h.length !== stored.length) return false;
  let d = 0; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ stored.charCodeAt(i);
  return d === 0;
}
async function secret(env) {
  let s = await kvGet(env, 'secret');
  if (!s) { s = b64u(crypto.getRandomValues(new Uint8Array(32))); await kvSet(env, 'secret', s); }
  return crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function cookie(v, maxAge) { return `bs=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
async function withSession(env, s, payload) {
  const data = b64u(enc.encode(JSON.stringify({ ...s, e: Date.now() + SESSION_DAYS * 864e5 })));
  const sig = b64u(await crypto.subtle.sign('HMAC', await secret(env), enc.encode(data)));
  return json(payload, 200, { 'set-cookie': cookie(data + '.' + sig, SESSION_DAYS * 86400) });
}
async function readSession(req, env) {
  const c = (req.headers.get('cookie') || '').match(/(?:^|;\s*)bs=([\w-]+)\.([\w-]+)/);
  if (!c) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await secret(env), unb64u(c[2]), enc.encode(c[1]));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64u(c[1])));
    if (!s.e || s.e < Date.now()) return null;
    if (s.u) {
      const u = await env.DB.prepare('SELECT name,email,admin FROM users WHERE id=?').bind(s.u).first();
      if (!u) return null;
      return { ...s, r: u.admin ? 'admin' : 'user', n: u.name || '', email: u.email };
    }
    if (s.r === 'admin' && !(await kvGet(env, 'admin'))) return null;
    return s;
  } catch { return null; }
}

function noDbPage() {
  return `<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;max-width:560px;margin:40px auto;padding:0 16px">
<h2>Almost there — database not connected</h2>
<p>This Worker needs a D1 database bound with the variable name <b>DB</b>.</p>
<p dir="rtl" style="text-align:right">כמעט מוכן — צריך לחבר מסד נתונים D1 בשם המשתנה <b>DB</b> (Bindings → Add binding → D1).</p>`;
}

const MANIFEST = { name: 'Bandtwerp App', short_name: 'Bandtwerp', start_url: '/', display: 'standalone', background_color: '#111114', theme_color: '#111114', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] };
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111114"/><path d="M20 46V18l26-6v28" fill="none" stroke="#f5a524" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15" cy="46" r="6" fill="#f5a524"/><circle cx="41" cy="40" r="6" fill="#f5a524"/></svg>`;

// Offline support: the app page and the last band data are cached, so stage mode keeps working without signal.
const SW_JS = `const C='bands-v1';
self.addEventListener('push',e=>{let d={};try{d=e.data.json();}catch(x){d={title:'Bandtwerp App',body:e.data?e.data.text():''};}
 e.waitUntil(self.registration.showNotification(d.title||'Bandtwerp App',{body:d.body||'',icon:'/icon-192.png',badge:'/icon-192.png',data:{tab:d.tab||''}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const u='/'+(e.notification.data&&e.notification.data.tab?'#'+e.notification.data.tab:'');
 e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c){c.navigate(u);return c.focus();}}return clients.openWindow(u);}));});
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==location.origin)return;
 if(u.pathname.endsWith('/live'))return;
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cl=r.clone();caches.open(C).then(c=>c.put(e.request,cl));}return r;}).catch(()=>caches.match(e.request).then(r=>r||new Response('{"error":"offline"}',{status:503,headers:{'content-type':'application/json'}}))));
});`;

// ---------- privacy policy + terms (src/legal.js, inlined by build.py) ----------
/*__LEGAL__*/
