#!/usr/bin/env node
// The Treni server on the VM: watches Jordan's trains on Viaggiatreno and keeps the iPhone's Live Activity up to
// date through Apple's push service. Runs as the user service `treni` (treni.service), on localhost:8795, which
// the VM's Cloudflare tunnel publishes as treni.jordancox.org (outside Cloudflare Access: the app can't log in
// there, so every /api call carries the shared secret instead).
//
// In a window (settings.windows, Rome time) it starts the Live Activity on the phone by itself (push-to-start,
// subscribed to that direction's broadcast channel), checks the trains every 45 seconds, pushes when something
// changes (and every 4 minutes anyway, so the phone knows it's fresh), and ends it when the window closes.
// The app can also start one by hand (POST /api/live), stop it (DELETE /api/live) or skip today.
//
//   node treni.mjs           the server
//   node treni.mjs --print   what the Live Activity would show now, both ways, then exit
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { journeys, stations } from './lib/viaggiatreno.mjs';
import { APNs } from './lib/apns.mjs';
import { rome, dueWindow, nextStart, autoFrom, liveContent, change, startAlert, validSettings } from './lib/schedule.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const env = process.env;
const PORT = +(env.PORT || 8795);
const DATA = env.DATA_DIR || path.join(os.homedir(), '.local/share/treni');
const SECRET = env.TRENI_SECRET || '';
const BUNDLE = env.BUNDLE_ID || 'org.jordancox.treni';
const TICK = 45e3, HEARTBEAT = 4 * 60e3, STALE = 12 * 60;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
fs.mkdirSync(DATA, { recursive: true });

const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const write = (file, data) => { fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1)); fs.renameSync(file + '.tmp', file); };
const SETTINGS = path.join(DATA, 'settings.json'), STATE = path.join(DATA, 'state.json');
let settings = read(SETTINGS, null) || read(path.join(HERE, 'defaults.json'));
const state = { tokens: {}, channels: {}, started: {}, live: null, ...read(STATE, {}) };
const save = () => write(STATE, state);

const apns = new APNs({
  keyPath: env.APNS_KEY_PATH, keyId: env.APNS_KEY_ID, teamId: env.APPLE_TEAM_ID, bundleId: BUNDLE,
  sandbox: env.APNS_SANDBOX === '1', log,
});

const other = from => (from === 'home' ? 'work' : 'home');

// Trains, cached for 20 seconds per direction so the app and the push loop share one set of calls.
const cache = new Map();
async function trains(from) {
  const a = settings[from], b = settings[other(from)];
  const key = `${a.code}>${b.code}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 20e3) return hit.trains;
  const list = await journeys(a.code, b.code);
  cache.set(key, { at: Date.now(), trains: list });
  return list;
}
const content = async from => liveContent({ from: settings[from], to: settings[other(from)], trains: await trains(from) });

async function channel(from) {
  const have = state.channels[from];
  if (!have || (have.startsWith('dry-') && !apns.dry)) { state.channels[from] = await apns.createChannel(); save(); log('new channel for', from); }
  return state.channels[from];
}

const secs = (ms = Date.now()) => Math.floor(ms / 1000);
const tokenGone = r => r.status === 410 || (r.status === 400 && /BadDeviceToken|ExpiredToken/.test(JSON.stringify(r.body)));

async function startWindow(w, key) {
  state.started[key] = Date.now();
  const tokens = Object.keys(state.tokens);
  if (!tokens.length) { log(`${w.id}: due, but no phone has registered yet (open the app once)`); return; }
  const c = await content(w.from);
  const aps = {
    timestamp: secs(), event: 'start', 'content-state': c,
    'attributes-type': 'TrainAttributes', attributes: { window: w.id, from: w.from },
    alert: startAlert(c), 'input-push-channel': await channel(w.from),
    'stale-date': secs() + STALE, 'relevance-score': 100,
  };
  let ok = 0;
  for (const t of tokens) {
    const r = await apns.start(t, aps);
    if (r.status === 200) ok++;
    else if (tokenGone(r)) { delete state.tokens[t]; log('dropped a stale phone token'); }
    else log(`${w.id}: start refused`, r.status, JSON.stringify(r.body));
  }
  if (ok) {
    state.live = { kind: w.id, from: w.from, until: w.endsAt, startedAt: Date.now(), last: c, lastPushAt: Date.now(), pushes: 1 };
    log(`${w.id}: started on ${ok} phone(s)`);
  } else if ((state.started[key + '#tries'] = (state.started[key + '#tries'] || 0) + 1) < 3) {
    delete state.started[key]; // try again next tick, twice more
  }
}

let failures = 0;
async function updateLive(force = false) {
  const live = state.live;
  let c;
  try { c = await content(live.from); failures = 0; } catch (e) {
    if (++failures < 3 || !live.last) return log('trains:', e.message);
    c = { ...live.last, note: 'Live train data paused', updated: secs() };
  }
  const what = change(live.last, c);
  if (!what && !force && Date.now() - live.lastPushAt < HEARTBEAT) return;
  const aps = { timestamp: secs(), event: 'update', 'content-state': c, 'stale-date': secs() + STALE };
  const r = await apns.broadcast(await channel(live.from), aps, what === 'high' ? 10 : 5);
  if (r.status === 200) { live.last = c; live.lastPushAt = Date.now(); live.pushes++; }
  else log('update refused', r.status, JSON.stringify(r.body));
}

async function endLive(why) {
  const live = state.live;
  if (!live) return;
  state.live = null;
  const aps = { timestamp: secs(), event: 'end', 'dismissal-date': secs() + 60 };
  if (live.last) aps['content-state'] = { ...live.last, updated: secs() };
  const r = await apns.broadcast(await channel(live.from), aps, 10, 60);
  log(`ended (${why}) after ${live.pushes} pushes`, r.status === 200 ? '' : `— refused ${r.status} ${JSON.stringify(r.body)}`);
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now(), w = dueWindow(settings, now), today = rome(now).date;
    if (w) {
      const key = `${today}/${w.id}`;
      if (state.live?.from === w.from) {
        if (state.live.kind !== w.id) Object.assign(state.live, { kind: w.id, until: w.endsAt }); // a manual one becomes the window's
        state.started[key] ??= now;
      } else if (!state.started[key]) {
        if (state.live) await endLive('the other direction is due');
        await startWindow(w, key);
      }
    }
    if (state.live && now >= state.live.until) await endLive('window over');
    if (state.live) await updateLive();
    for (const k of Object.keys(state.started)) if (k.slice(0, 10) < rome(now - 3 * 86400e3).date) delete state.started[k];
    save();
  } catch (e) {
    log('tick:', e.message);
  } finally {
    ticking = false;
  }
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

async function snapshot(from) {
  from = from === 'home' || from === 'work' ? from : state.live?.from || autoFrom();
  const list = await trains(from);
  return {
    now: secs(), from, settings,
    trains: list.map(({ origin, date, arrSched, notStarted, ...t }) => t),
    content: liveContent({ from: settings[from], to: settings[other(from)], trains: list }),
    channel: await channel(from),
    live: state.live && { kind: state.live.kind, from: state.live.from, until: secs(state.live.until) },
    next: nextStart(settings),
    today: rome().date,
    registered: Object.keys(state.tokens).length,
    dry: apns.dry,
  };
}

const routes = {
  'GET /api/state': async (req, res, q) => send(res, 200, await snapshot(q.get('from'))),
  'GET /api/stations': async (req, res, q) => send(res, 200, await stations(q.get('q') || '')),
  'PUT /api/settings': async (req, res) => {
    const s = await body(req);
    if (!validSettings(s)) return send(res, 400, { error: 'settings not valid' });
    settings = { home: s.home, work: s.work, windows: s.windows, skip: (s.skip || []).filter(d => d >= rome().date) };
    write(SETTINGS, settings);
    cache.clear();
    log('settings saved');
    send(res, 200, settings);
  },
  'POST /api/register': async (req, res) => {
    const { token, device, frequent } = await body(req);
    if (!/^[0-9a-f]{32,200}$/i.test(token || '')) return send(res, 400, { error: 'token' });
    const known = !!state.tokens[token];
    state.tokens[token] = { device: String(device || '').slice(0, 60), frequent: !!frequent, at: Date.now() };
    save();
    if (!known) log('phone registered:', state.tokens[token].device);
    send(res, 200, { ok: true });
  },
  'POST /api/live': async (req, res) => {
    const { from, minutes = 90 } = await body(req);
    if (!['home', 'work'].includes(from)) return send(res, 400, { error: 'from' });
    if (state.live && state.live.from !== from) await endLive('started the other way in the app');
    const w = dueWindow(settings);
    if (!state.live) {
      const until = w?.from === from ? w.endsAt : Date.now() + Math.min(Math.max(+minutes || 90, 10), 8 * 60) * 60e3;
      state.live = { kind: w?.from === from ? w.id : 'manual', from, until, startedAt: Date.now(), last: null, lastPushAt: 0, pushes: 0 };
      if (w?.from === from) state.started[`${rome().date}/${w.id}`] ??= Date.now();
      log(`live: started in the app (${from})`);
    }
    await updateLive(true);
    save();
    send(res, 200, await snapshot(from));
  },
  'DELETE /api/live': async (req, res) => {
    await endLive('stopped in the app');
    save();
    send(res, 200, { ok: true });
  },
  'POST /api/skip': async (req, res) => {
    const today = rome().date;
    settings.skip = [...new Set([...(settings.skip || []).filter(d => d >= today), today])].sort();
    write(SETTINGS, settings);
    if (state.live && state.live.kind !== 'manual') await endLive('skipped today');
    save();
    log('skipping today');
    send(res, 200, settings);
  },
  'DELETE /api/skip': async (req, res, q) => {
    settings.skip = (settings.skip || []).filter(d => d !== (q.get('date') || rome().date));
    write(SETTINGS, settings);
    send(res, 200, settings);
  },
};

async function serve(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return send(res, 404, { error: 'not found' });
  if (!authed(req)) return send(res, 401, { error: 'unauthorised' });
  try { await route(req, res, url.searchParams); } catch (e) {
    log(req.method, url.pathname, e.message);
    send(res, 502, { error: e.message });
  }
}

if (process.argv.includes('--print')) {
  for (const from of ['home', 'work']) console.log(JSON.stringify(await content(from), null, 1));
  process.exit(0);
}
if (!SECRET) { console.error('TRENI_SECRET is not set (~/.config/treni/env)'); process.exit(1); }
http.createServer(serve).listen(PORT, '127.0.0.1', () =>
  log(`treni on 127.0.0.1:${PORT}`, apns.dry ? '(no APNs key yet: pushes are only logged)' : '(APNs on)', `${Object.keys(state.tokens).length} phone(s)`));
tick();
setInterval(tick, TICK);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { save(); apns.close(); process.exit(0); });
