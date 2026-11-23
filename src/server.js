// Band Manager — Cloudflare Worker (backend + built-in frontend)
// Needs one D1 binding named DB. Tables are created automatically.
// The frontend HTML can be replaced at runtime by the admin (self-update),
// so most changes never need a new paste into Cloudflare.

const VERSION = '__VERSION__';
const APP_HTML = __APP_HTML__;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS bands (id TEXT PRIMARY KEY, name TEXT NOT NULL, pw TEXT NOT NULL, data TEXT, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, band TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER, by TEXT)`,
  `CREATE INDEX IF NOT EXISTS items_band ON items(band, kind)`,
  `CREATE TABLE IF NOT EXISTS live (band TEXT PRIMARY KEY, data TEXT, updated INTEGER)`,
];
let schemaReady = false;
const KINDS = new Set(['song', 'setlist', 'event']);
const SESSION_DAYS = 180;

export default {
  async fetch(request, env) {
    try {
      if (!env.DB) return new Response(noDbPage(), { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (!schemaReady) { await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))); schemaReady = true; }
      const url = new URL(request.url);
      const p = url.pathname;
      if (p.startsWith('/api/')) return await api(request, env, url);
      if (p === '/sw.js') return new Response(SW_JS, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } });
      if (p === '/manifest.webmanifest') return json(MANIFEST, 200, { 'content-type': 'application/manifest+json' });
      if (p === '/icon.svg') return new Response(ICON_SVG, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
      // a self-updated page is used only while it matches the pasted Worker version
      const custom = (await kvGet(env, 'app_base')) === VERSION ? await kvGet(env, 'app_html') : null;
      return new Response(custom || APP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
    } catch (e) {
      return json({ error: 'server', detail: String(e && e.message || e) }, 500);
    }
  },
};

// ---------- API ----------
async function api(req, env, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  const me = await readSession(req, env);

  if (p === '/api/state' && m === 'GET') {
    const admin = await kvGet(env, 'admin');
    const bands = me ? await bandsFor(env, me) : [];
    return json({ setup: !admin, me: me ? { role: me.r, band: me.b || null, name: me.n || '' } : null, bands, version: VERSION, custom: (await kvGet(env, 'app_base')) === VERSION && !!(await kvGet(env, 'app_html')) });
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

  if (p === '/api/login' && m === 'POST') {
    const b = await body(req);
    const pw = String(b.password || '');
    const name = clean(b.name || '').slice(0, 40);
    if (!pw) return json({ error: 'invalid' }, 400);
    const admin = await kvGet(env, 'admin');
    if (admin && await checkPw(pw, admin)) return withSession(env, { r: 'admin', n: name }, { ok: true, role: 'admin' });
    const { results } = await env.DB.prepare('SELECT id, pw FROM bands').all();
    for (const r of results) if (await checkPw(pw, r.pw)) return withSession(env, { r: 'band', b: r.id, n: name }, { ok: true, role: 'band' });
    await new Promise(r => setTimeout(r, 600));
    return json({ error: 'wrong_password' }, 401);
  }

  if (p === '/api/logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });

  if (!me) return json({ error: 'auth' }, 401);

  if (p === '/api/me' && m === 'PUT') {
    const b = await body(req);
    return withSession(env, { ...me, n: clean(b.name || '').slice(0, 40) }, { ok: true });
  }

  // ----- admin -----
  if (p.startsWith('/api/admin/')) {
    if (me.r !== 'admin') return json({ error: 'forbidden' }, 403);
    if (p === '/api/admin/band' && m === 'POST') {
      const b = await body(req);
      if (!clean(b.name) || !okPw(b.password)) return json({ error: 'invalid' }, 400);
      if (await pwInUse(env, b.password)) return json({ error: 'password_in_use' }, 409);
      const id = newId();
      await env.DB.prepare('INSERT INTO bands (id,name,pw,data,created) VALUES (?,?,?,?,?)').bind(id, clean(b.name), await hashPw(b.password), '{}', Date.now()).run();
      return json({ ok: true, id });
    }
    let mm = p.match(/^\/api\/admin\/band\/([\w-]+)$/);
    if (mm && m === 'PUT') {
      const b = await body(req);
      if (b.name && clean(b.name)) await env.DB.prepare('UPDATE bands SET name=? WHERE id=?').bind(clean(b.name), mm[1]).run();
      if (b.password) {
        if (!okPw(b.password)) return json({ error: 'invalid' }, 400);
        if (await pwInUse(env, b.password, mm[1])) return json({ error: 'password_in_use' }, 409);
        await env.DB.prepare('UPDATE bands SET pw=? WHERE id=?').bind(await hashPw(b.password), mm[1]).run();
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
    if (!(me.r === 'admin' || me.b === band)) return json({ error: 'forbidden' }, 403);
    const row = await env.DB.prepare('SELECT id,name,data FROM bands WHERE id=?').bind(band).first();
    if (!row) return json({ error: 'not_found' }, 404);

    if (rest === '' && m === 'GET') {
      const { results } = await env.DB.prepare('SELECT id,kind,data,updated,by FROM items WHERE band=?').bind(band).all();
      const out = { band: { id: row.id, name: row.name, ...parse(row.data) }, songs: [], setlists: [], events: [] };
      for (const r of results) out[r.kind + 's'].push({ ...parse(r.data), id: r.id, updated: r.updated, by: r.by });
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
      return json({ ok: true, id, updated: now });
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
    if (rest === '/import' && m === 'POST') {
      const b = await body(req);
      const stmts = [];
      for (const kind of ['song', 'setlist', 'event']) for (const it of (b[kind + 's'] || [])) {
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
  const q = me.r === 'admin'
    ? env.DB.prepare('SELECT id,name,data FROM bands ORDER BY created')
    : env.DB.prepare('SELECT id,name,data FROM bands WHERE id=?').bind(me.b);
  const { results } = await q.all();
  return results.map(r => ({ id: r.id, name: r.name, color: parse(r.data).color || '' }));
}

async function pwInUse(env, pw, exceptBand) {
  const admin = await kvGet(env, 'admin');
  if (admin && await checkPw(pw, admin)) return true;
  const { results } = await env.DB.prepare('SELECT id,pw FROM bands').all();
  for (const r of results) if (r.id !== exceptBand && await checkPw(pw, r.pw)) return true;
  return false;
}

// ---------- helpers ----------
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

const MANIFEST = { name: 'Band Manager', short_name: 'Bands', start_url: '/', display: 'standalone', background_color: '#111114', theme_color: '#111114', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] };
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111114"/><path d="M20 46V18l26-6v28" fill="none" stroke="#f5a524" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15" cy="46" r="6" fill="#f5a524"/><circle cx="41" cy="40" r="6" fill="#f5a524"/></svg>`;

// Offline support: the app page and the last band data are cached, so stage mode keeps working without signal.
const SW_JS = `const C='bands-v1';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==location.origin)return;
 if(u.pathname.endsWith('/live'))return;
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cl=r.clone();caches.open(C).then(c=>c.put(e.request,cl));}return r;}).catch(()=>caches.match(e.request).then(r=>r||new Response('{"error":"offline"}',{status:503,headers:{'content-type':'application/json'}}))));
});`;
