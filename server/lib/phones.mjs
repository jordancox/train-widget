// Everyone's phones (Jordan's colleagues joined on 17 Oct 2026). Each has its own settings (stations, walk times,
// windows, days off), push-to-start tokens, broadcast channels and Live Activity, so nobody's settings, day off or
// stop touch anyone else's. Channels are per phone and direction: the content-state carries the phone's walk time,
// and ending a broadcast ends every Live Activity listening to it.
//
// The app sends a random phone id with every call (X-Treni-Phone). Builds before that (13 and older, Jordan's only)
// send none and get the LEGACY record; a newer build claims it when it registers the same push-to-start token.
// Kept in state.json (version 2) by the caller's save(). Tested in ../test.mjs with fake trains and a fake APNs.
import { rome, dueWindow, nextStart, autoFrom, liveContent, change, startAlert, validSettings, short, hm } from './schedule.mjs';

export const LEGACY = 'legacy';
export const MAX_PHONES = 20;
// The line at the top of the app on a phone that hasn't saved its own settings yet; tapping it opens Settings.
export const WELCOME = 'Hello friends. In the settings menu, set your home station, how long it takes you to walk to that platform, and when this app should turn up on your lock screen by itself.';
const CHECK = 45e3, HEARTBEAT = 4 * 60e3, STALE = 12 * 60, DAY = 86400e3, CALM = 15 * 60e3;

const other = from => (from === 'home' ? 'work' : 'home');
const tokenGone = r => r.status === 410 || (r.status === 400 && /BadDeviceToken|ExpiredToken/.test(JSON.stringify(r.body)));

// Every 45 s, but every 15 s around the time to set off, the departure, and the departure of the train you may be
// walking to, so the countdown moves on to the next train and a train that has left goes, without waiting.
const busy = (c, now) => {
  const t = c?.trains?.[0], s = now / 1000;
  return !!t && [t.exp - (c.walk || 0) * 60, t.exp, c.show?.lineUntil].some(x => x && s > x - 90 && s < x + 180);
};

// The single-phone files from before 17 Oct 2026 (state.json without a version, and settings.json).
export function migrate(old, settings, now = Date.now()) {
  const phones = {};
  if (settings) {
    phones[LEGACY] = {
      id: LEGACY, created: now, seen: now, setup: false, settings,
      tokens: old?.tokens || {}, channels: old?.channels || {}, started: old?.started || {}, live: old?.live || null,
    };
  }
  return { version: 2, phones };
}

export class Phones {
  constructor({ data, defaults, apns, journeys, log = console.log, save = () => {}, now = () => Date.now() }) {
    Object.assign(this, { data, defaults, apns, journeys, log, save, now });
    this.cache = new Map(); // trains per route, shared by every phone and the app for 10 seconds
    this.checked = new Map(); // phone id → when its trains were last looked at
    this.failures = new Map();
  }

  get list() { return Object.values(this.data.phones); }
  get(id) { return this.data.phones[id] || null; }
  label(p) { return `${p.id === LEGACY ? LEGACY : p.id.slice(0, 6)} (${short(p.settings.home.name)})`; }
  secs(ms = this.now()) { return Math.floor(ms / 1000); }

  // A phone seen for the first time starts from the default stations with nothing starting by itself, until its
  // owner has picked their own in Settings (`setup` until then).
  ensure(id) {
    let p = this.data.phones[id];
    if (!p) {
      if (this.list.length >= MAX_PHONES) throw Object.assign(new Error('this server is full'), { status: 403 });
      const settings = structuredClone(this.defaults);
      for (const w of settings.windows) w.on = false;
      settings.skip = [];
      p = this.data.phones[id] = { id, created: this.now(), seen: this.now(), setup: true, settings, tokens: {}, channels: {}, started: {}, live: null };
      this.save();
      this.log('new phone', this.label(p));
    }
    // `app`: the app itself called in. `seen` also moves on when Apple takes a start, which it kept doing for a
    // deleted copy (20 Oct 2026), so only `app` shows a copy that's gone.
    p.seen = p.app = this.now();
    return p;
  }

  async trains(p, from) {
    const a = p.settings[from], b = p.settings[other(from)];
    const key = `${a.code}>${b.code}`, hit = this.cache.get(key);
    if (hit && this.now() - hit.at < 10e3) return hit.trains;
    const list = await this.journeys(a.code, b.code);
    this.cache.set(key, { at: this.now(), trains: list });
    return list;
  }

  async content(p, from) {
    const walking = p.live?.from === from ? p.live.walking : undefined;
    return liveContent({ from: p.settings[from], to: p.settings[other(from)], trains: await this.trains(p, from), now: this.now(), walking });
  }

  async channel(p, from) {
    const have = p.channels[from];
    if (!have || (have.startsWith('dry-') && !this.apns.dry)) {
      p.channels[from] = await this.apns.createChannel();
      this.save();
      this.log(this.label(p), 'new channel for', from);
    }
    return p.channels[from];
  }

  async startWindow(p, w, key) {
    p.started[key] = this.now();
    const tokens = Object.keys(p.tokens);
    if (!tokens.length) { this.log(`${this.label(p)} ${w.id}: due, but the phone hasn't registered (open the app once)`); return; }
    const c = await this.content(p, w.from);
    const aps = {
      timestamp: this.secs(), event: 'start', 'content-state': c,
      'attributes-type': 'TrainAttributes', attributes: { window: w.id, from: w.from },
      alert: startAlert(c), 'input-push-channel': await this.channel(p, w.from),
      'stale-date': this.secs() + STALE, 'relevance-score': 100,
    };
    let ok = 0;
    for (const t of tokens) {
      const r = await this.apns.start(t, aps);
      if (r.status === 200) ok++;
      else if (tokenGone(r)) { delete p.tokens[t]; this.log(this.label(p), 'dropped a stale push-to-start token'); }
      else this.log(`${this.label(p)} ${w.id}: start refused`, r.status, JSON.stringify(r.body));
    }
    if (ok) {
      p.seen = this.now(); // still in use, even if the app itself stays closed
      p.live = { kind: w.id, from: w.from, until: w.endsAt, startedAt: this.now(), last: c, lastPushAt: this.now(), pushes: 1 };
      this.log(`${this.label(p)} ${w.id}: started`);
    } else if ((p.started[key + '#tries'] = (p.started[key + '#tries'] || 0) + 1) < 3) {
      delete p.started[key]; // try again next time round, twice more
    }
  }

  async updateLive(p, force = false) {
    const live = p.live;
    let c;
    try { c = await this.content(p, live.from); this.failures.delete(p.id); } catch (e) {
      const n = (this.failures.get(p.id) || 0) + 1;
      this.failures.set(p.id, n);
      if (n < 3 || !live.last) return this.log(this.label(p), 'trains:', e.message);
      c = { ...live.last, note: 'Live train data paused', updated: this.secs() };
    }
    const what = change(live.last, c);
    if (!what && !force && this.now() - live.lastPushAt < HEARTBEAT) return c;
    // Apple refused an update for too many (429, "TooManyRequests"; Apple publishes no limit). Until 26 Oct 2026 the
    // server tried again every 15 seconds, urgently, and a colleague's lock screen stayed frozen for the hour. Now it
    // waits (1, 2, 4, then 8 minutes) and stays at the low priority for a quarter of an hour after it gets through.
    const t = live.throttled;
    if (t && !force && this.now() < t.until) return c;
    const prio = what === 'high' && !t && !(this.now() < live.calmUntil) ? 10 : 5;
    const aps = { timestamp: this.secs(), event: 'update', 'content-state': c, 'stale-date': this.secs() + STALE };
    const r = await this.apns.broadcast(await this.channel(p, live.from), aps, prio);
    if (r.status === 200) {
      Object.assign(live, { last: c, lastPushAt: this.now(), pushes: live.pushes + 1, urgent: (live.urgent || 0) + (prio === 10) });
      if (t) {
        this.log(`${this.label(p)} updates go through again, after ${Math.round((this.now() - t.since) / 60e3)} min refused for too many`);
        delete live.throttled;
        live.calmUntil = this.now() + CALM;
      }
    } else if (r.status === 429) {
      const wait = Math.min((t?.wait || 30e3) * 2, 8 * 60e3);
      live.throttled = { since: t?.since || this.now(), wait, until: this.now() + wait };
      if (!t) this.log(`${this.label(p)} Apple refused an update for too many (429) after ${live.pushes} pushes, ${live.urgent || 0} urgent: waiting`);
    } else this.log(this.label(p), 'update refused', r.status, JSON.stringify(r.body));
    return c;
  }

  async endLive(p, why) {
    const live = p.live;
    if (!live) return;
    p.live = null;
    const aps = { timestamp: this.secs(), event: 'end', 'dismissal-date': this.secs() + 60 };
    if (live.last) aps['content-state'] = { ...live.last, updated: this.secs() };
    const r = await this.apns.broadcast(await this.channel(p, live.from), aps, 10, 60);
    this.log(`${this.label(p)} ended (${why}) after ${live.pushes} pushes, ${live.urgent || 0} urgent`, r.status === 200 ? '' : `— refused ${r.status} ${JSON.stringify(r.body)}`);
  }

  async tickPhone(p, now) {
    if (now - (this.checked.get(p.id) || 0) < CHECK - 1e3 && !(p.live && busy(p.live.last, now))) return;
    this.checked.set(p.id, now);
    const w = dueWindow(p.settings, now), today = rome(now).date;
    if (w) {
      const key = `${today}/${w.id}`;
      if (p.live?.from === w.from) {
        if (p.live.kind !== w.id) Object.assign(p.live, { kind: w.id, until: w.endsAt }); // a manual one becomes the window's
        p.started[key] ??= now;
      } else if (!p.started[key]) {
        if (p.live) await this.endLive(p, 'the other direction is due');
        await this.startWindow(p, w, key);
      }
    }
    if (p.live && now >= p.live.until) await this.endLive(p, 'window over');
    if (p.live) await this.updateLive(p);
    for (const k of Object.keys(p.started)) if (k.slice(0, 10) < rome(now - 3 * 86400e3).date) delete p.started[k];
  }

  // Every 15 seconds. One phone's trouble doesn't hold up the others.
  async tick() {
    const now = this.now();
    for (const p of this.list) {
      try { await this.tickPhone(p, now); } catch (e) { this.log(this.label(p), 'tick:', e.message); }
      // Forgotten (as server/privacy.html says): a month after Apple stopped taking its token (the app was
      // deleted), or four months without use.
      const quiet = now - p.seen;
      if (!p.live && (quiet > 120 * DAY || (!Object.keys(p.tokens).length && quiet > 30 * DAY))) {
        delete this.data.phones[p.id];
        this.log('forgot', this.label(p));
      }
    }
    this.save();
  }

  async snapshot(p, from) {
    from = from === 'home' || from === 'work' ? from : p.live?.from || autoFrom(this.now());
    const list = await this.trains(p, from);
    return {
      now: this.secs(), from, settings: p.settings,
      trains: list.map(({ origin, date, arrSched, notStarted, ...t }) => t),
      content: await this.content(p, from),
      channel: await this.channel(p, from),
      live: p.live && { kind: p.live.kind, from: p.live.from, until: this.secs(p.live.until) },
      next: nextStart(p.settings, this.now()),
      today: rome(this.now()).date,
      registered: Object.keys(p.tokens).length,
      setup: !!p.setup,
      welcome: p.setup ? WELCOME : undefined,
      dry: this.apns.dry,
    };
  }

  // The app hands over its push-to-start token (and sometimes a new one). A token belongs to one phone only.
  register(id, { token, device, frequent }) {
    const legacy = this.data.phones[LEGACY];
    if (id !== LEGACY && legacy?.tokens[token]) {
      const mine = this.data.phones[id];
      const claimed = { ...legacy, id, seen: this.now(), tokens: { ...legacy.tokens, ...mine?.tokens } };
      if (mine && !mine.setup) claimed.settings = mine.settings; // it has already picked its own
      delete this.data.phones[LEGACY];
      this.data.phones[id] = claimed;
      this.log(`${this.label(claimed)}: a newer build took over the legacy phone`);
    }
    for (const q of this.list) if (q.id !== id && q.tokens[token]) delete q.tokens[token];
    const p = this.ensure(id);
    const known = !!p.tokens[token];
    p.tokens[token] = { device: String(device || '').slice(0, 60), frequent: !!frequent, at: this.now() };
    this.save();
    if (!known) this.log(this.label(p), 'registered for automatic starts');
  }

  saveSettings(p, s) {
    if (!validSettings(s)) return false;
    const today = rome(this.now()).date;
    p.settings = { home: s.home, work: s.work, windows: s.windows, skip: (s.skip || []).filter(d => d >= today) };
    p.setup = false;
    this.save();
    this.log(this.label(p), 'settings saved');
    return true;
  }

  async startLive(p, from, minutes = 90) {
    if (p.live && p.live.from !== from) await this.endLive(p, 'started the other way in the app');
    const w = dueWindow(p.settings, this.now());
    if (!p.live) {
      const until = w?.from === from ? w.endsAt : this.now() + Math.min(Math.max(+minutes || 90, 10), 8 * 60) * 60e3;
      p.live = { kind: w?.from === from ? w.id : 'manual', from, until, startedAt: this.now(), last: null, lastPushAt: 0, pushes: 0 };
      if (w?.from === from) p.started[`${rome(this.now()).date}/${w.id}`] ??= this.now();
      this.log(`${this.label(p)} live: started in the app (${from})`);
    }
    await this.updateLive(p, true);
    this.save();
  }

  // The Live Activity's "Yes" (walking to train n) or "Undo" (n empty), from the app's WalkingTo intent. Answers with
  // the new content-state, which the app puts on the lock screen at once, whatever Apple's push does.
  async walkingTo(p, n) {
    const t = n ? (await this.trains(p, p.live.from)).find(x => x.n === n) : null;
    if (t) p.live.walking = { n: t.n, dep: t.dep, at: this.now() };
    else if (!n) delete p.live.walking;
    this.log(this.label(p), t ? `walking to the ${hm(t.dep)}` : n ? `walking to ${n}, which has gone` : 'not walking after all');
    const c = await this.updateLive(p, true);
    this.save();
    return c;
  }

  async stopLive(p) {
    await this.endLive(p, 'stopped in the app');
    this.save();
  }

  async skipToday(p) {
    const today = rome(this.now()).date;
    p.settings.skip = [...new Set([...(p.settings.skip || []).filter(d => d >= today), today])].sort();
    if (p.live && p.live.kind !== 'manual') await this.endLive(p, 'skipped today');
    this.save();
    this.log(this.label(p), 'skipping today');
  }

  unskip(p, date) {
    p.settings.skip = (p.settings.skip || []).filter(d => d !== (date || rome(this.now()).date));
    this.save();
  }
}
