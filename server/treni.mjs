#!/usr/bin/env node
// The Treni server on the VM: watches the trains on Viaggiatreno and keeps each phone's Live Activity up to date
// through Apple's push service. Runs as the user service `treni` (treni.service), on localhost:8795, which the VM's
// Cloudflare tunnel publishes as treni.jordancox.org (outside Cloudflare Access: the app can't log in there, so every
// /api call carries the shared secret instead). Jordan's and his colleagues' phones each have their own settings
// and Live Activity (lib/phones.mjs).
//
// In a phone's window (its settings.windows, Rome time) it starts the Live Activity on that phone by itself
// (push-to-start, subscribed to the phone's broadcast channel for that direction), checks the trains every 45
// seconds (every 15 around the time to set off and the departure), pushes when something changes (and every 4
// minutes anyway, so the phone knows it's fresh), and ends it when the window closes.
// The app can also start one by hand (POST /api/live), stop it (DELETE /api/live) or skip today, and the Live
// Activity's "Yes, I'm walking to the 08:37" button says which train you've set off for (POST /api/walking).
//
//   node treni.mjs           the server
//   node treni.mjs --print   what each phone's Live Activity would show now, both ways, then exit
//   node treni.mjs --phones  who's on it: stations, walk times, automatic starts, last seen, when the app last called
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { journeys, stations } from './lib/viaggiatreno.mjs';
import { APNs } from './lib/apns.mjs';
import { Phones, LEGACY, migrate } from './lib/phones.mjs';
import { short } from './lib/schedule.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const env = process.env;
const PORT = +(env.PORT || 8795);
const DATA = env.DATA_DIR || path.join(os.homedir(), '.local/share/treni');
const SECRET = env.TRENI_SECRET || '';
const BUNDLE = env.BUNDLE_ID || 'org.jordancox.treni';
const TICK = 15e3;

const log = (...a) => console.log(new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Rome' }), ...a); // Rome time, like everything else
fs.mkdirSync(DATA, { recursive: true });

const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const write = (file, data) => { fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1)); fs.renameSync(file + '.tmp', file); };
const STATE = path.join(DATA, 'state.json'), OLD_SETTINGS = path.join(DATA, 'settings.json');
const defaults = read(path.join(HERE, 'defaults.json'));

// state.json from before 17 Oct 2026 held one phone, with its settings in settings.json: both are kept as *.v1.json.
let data = read(STATE, null);
if (!data?.version) {
  const old = read(OLD_SETTINGS, null);
  data = migrate(data, old);
  if (fs.existsSync(STATE)) fs.copyFileSync(STATE, path.join(DATA, 'state.v1.json'));
  if (old) fs.renameSync(OLD_SETTINGS, path.join(DATA, 'settings.v1.json'));
  write(STATE, data);
  if (old) log('state.json: moved the one phone to the', LEGACY, 'record');
}

const apns = new APNs({
  keyPath: env.APNS_KEY_PATH, keyId: env.APNS_KEY_ID, teamId: env.APPLE_TEAM_ID, bundleId: BUNDLE,
  sandbox: env.APNS_SANDBOX === '1', log,
});
const phones = new Phones({ data, defaults, apns, journeys, log, save: () => write(STATE, data) });

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try { await phones.tick(); } catch (e) { log('tick:', e.message); } finally { ticking = false; }
}

// ---- HTTP: the app's API ----

const authed = req => {
  const got = Buffer.from((req.headers.authorization || '').replace(/^Bearer /i, ''));
  const want = Buffer.from(SECRET);
  return SECRET && got.length === want.length && crypto.timingSafeEqual(got, want);
};
const body = req => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', c => { s += c; if (s.length > 16384) { reject(new Error('too big')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('bad json')); } });
});
const send = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

// The phone a call is for: X-Treni-Phone, a random id the app makes once; builds without it are the legacy phone.
function phoneId(req) {
  const id = req.headers['x-treni-phone'];
  if (id === undefined) return LEGACY;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw Object.assign(new Error('phone id'), { status: 400 });
  return id;
}

const routes = {
  'GET /api/state': async (req, res, q, p) => send(res, 200, await phones.snapshot(p, q.get('from'))),
  'GET /api/stations': async (req, res, q) => send(res, 200, await stations(q.get('q') || '')),
  'PUT /api/settings': async (req, res, q, p) => {
    if (!phones.saveSettings(p, await body(req))) return send(res, 400, { error: 'settings not valid' });
    send(res, 200, p.settings);
  },
  'POST /api/register': async (req, res, q, p, id) => {
    const { token, device, frequent } = await body(req);
    if (!/^[0-9a-f]{32,200}$/i.test(token || '')) return send(res, 400, { error: 'token' });
    phones.register(id, { token, device, frequent });
    send(res, 200, { ok: true });
  },
  'POST /api/live': async (req, res, q, p) => {
    const { from, minutes = 90 } = await body(req);
    if (!['home', 'work'].includes(from)) return send(res, 400, { error: 'from' });
    await phones.startLive(p, from, minutes);
    send(res, 200, await phones.snapshot(p, from));
  },
  // The Live Activity's buttons (builds from 26 Oct 2026): { train: '20423' } walking to it, { train: '' } not.
  'POST /api/walking': async (req, res, q, p) => {
    const { train } = await body(req);
    if (typeof train !== 'string' || !/^\w{0,12}$/.test(train)) return send(res, 400, { error: 'train' });
    if (!p.live) return send(res, 409, { error: 'nothing on the lock screen' });
    const content = await phones.walkingTo(p, train);
    if (!content) return send(res, 502, { error: 'no train times just now' });
    send(res, 200, { from: p.live.from, content });
  },
  'DELETE /api/live': async (req, res, q, p) => {
    await phones.stopLive(p);
    send(res, 200, { ok: true });
  },
  'POST /api/skip': async (req, res, q, p) => {
    await phones.skipToday(p);
    send(res, 200, p.settings);
  },
  'DELETE /api/skip': async (req, res, q, p) => {
    phones.unskip(p, q.get('date'));
    send(res, 200, p.settings);
  },
};

async function serve(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  if (url.pathname === '/privacy') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(HERE, 'privacy.html')));
  }
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return send(res, 404, { error: 'not found' });
  if (!authed(req)) return send(res, 401, { error: 'unauthorised' });
  try {
    const id = phoneId(req);
    // A phone the server hasn't seen yet only gets a record once it looks at something of its own.
    const p = url.pathname === '/api/stations' ? null : url.pathname === '/api/register' ? phones.get(id) : phones.ensure(id);
    await route(req, res, url.searchParams, p, id);
  } catch (e) {
    log(req.method, url.pathname, e.message);
    send(res, e.status || 502, { error: e.message });
  }
}

if (process.argv.includes('--print')) {
  for (const p of phones.list) for (const from of ['home', 'work']) console.log(phones.label(p), JSON.stringify(await phones.content(p, from), null, 1));
  process.exit(0);
}
if (process.argv.includes('--phones')) {
  const hm = ms => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' });
  for (const p of phones.list) {
    const s = p.settings, on = s.windows.filter(w => w.on).map(w => `${w.from === 'home' ? '→' : '←'}${w.start}`).join(' ') || 'nothing by itself';
    console.log(`${phones.label(p).padEnd(22)} ${short(s.home.name)} ${s.home.walk ?? 0}′ ⇄ ${short(s.work.name)} ${s.work.walk ?? 0}′  ${on}${p.setup ? '  (not set up)' : ''}` +
      `  tokens ${Object.keys(p.tokens).length}  seen ${hm(p.seen)}  app ${p.app ? hm(p.app) : '?'}${p.live ? `  LIVE ${p.live.from}` : ''}`);
  }
  process.exit(0);
}
if (!SECRET) { console.error('TRENI_SECRET is not set (~/.config/treni/env)'); process.exit(1); }
http.createServer(serve).listen(PORT, '127.0.0.1', () =>
  log(`treni on 127.0.0.1:${PORT}`, apns.dry ? '(no APNs key yet: pushes are only logged)' : '(APNs on)', `${phones.list.length} phone(s)`));
tick();
setInterval(tick, TICK);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { write(STATE, data); apns.close(); process.exit(0); });
