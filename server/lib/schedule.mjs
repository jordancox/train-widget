// When the Live Activity should be up, in Rome time, and what it shows. Pure functions, tested in ../test.mjs.

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
});
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// { date: '2026-10-16', minutes: 545 (09:05), dow: 5 (Mon=1 … Sun=7) }
export function rome(ts = Date.now()) {
  const p = Object.fromEntries(parts.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute, dow: DAYS.indexOf(p.weekday) + 1 };
}

export const toMinutes = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

// The window that's on right now, if any: { id, from, start, end, endsAt (ms) }.
export function dueWindow(settings, now = Date.now()) {
  const r = rome(now);
  if ((settings.skip || []).includes(r.date)) return null;
  for (const w of settings.windows) {
    if (!w.on || !w.days.includes(r.dow)) continue;
    const s = toMinutes(w.start), e = toMinutes(w.end);
    if (r.minutes >= s && r.minutes < e) return { ...w, endsAt: now + (e - r.minutes) * 60e3 - (now % 60e3) };
  }
  return null;
}

// The next time a window starts, for the app's "next: Mon 07:30" line. Looks a week ahead.
export function nextStart(settings, now = Date.now()) {
  for (let day = 0; day < 8; day++) {
    const ts = now + day * 86400e3, r = rome(ts);
    if ((settings.skip || []).includes(r.date)) continue;
    const todays = settings.windows.filter(w => w.on && w.days.includes(r.dow))
      .filter(w => day > 0 || toMinutes(w.start) > r.minutes)
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    if (todays.length) return { id: todays[0].id, date: r.date, dow: r.dow, start: todays[0].start };
  }
  return null;
}

// Which way the app looks by default when nothing is live: from home before 14:00, from work until 22:00.
export const autoFrom = (now = Date.now()) => { const m = rome(now).minutes; return m >= 14 * 60 && m < 22 * 60 ? 'work' : 'home'; };

// "Roma Tuscolana" → "Tuscolana": the lock screen has little room and every station here is in Rome.
export const short = name => (name || '').replace(/^Roma\s+/i, '');

// The Live Activity's content-state. Its fields match TrainAttributes.ContentState in the app
// (ios/Shared/TrainAttributes.swift); times are Unix seconds, because iOS decodes these with its default JSON
// rules and a Swift Date would expect seconds since 2001.
export function liveContent({ from, to, trains, now = Date.now(), note }) {
  // Minutes from setting off to standing on the platform (Settings, per station). The countdown is to when to set
  // off ("Leave in") for the next train you can still walk to, and the ones you can't reach any more are left out:
  // with a train every 15 minutes and a 13-minute walk, counting to the first train mostly showed one you'd miss
  // (Jordan, 19 Oct 2026). No walk set, or no train left that you can reach: it counts to the train itself.
  const walk = from.walk || 0, s = now / 1000;
  const reach = t => !t.cancelled && s < t.exp - walk * 60;
  const i = walk ? trains.findIndex(reach) : -1;
  const state = {
    from: short(from.name),
    to: short(to.name),
    trains: trains.slice(Math.max(i, 0), Math.max(i, 0) + 3).map(t => {
      const out = { n: t.n, dep: t.dep, exp: t.exp, delay: t.delay, dest: t.dest, cancelled: !!t.cancelled };
      if (t.plat) out.plat = t.plat;
      if (t.arr) out.arr = t.arr;
      return out;
    }),
    updated: Math.floor(s),
  };
  // A cancelled train you'd have set off for is skipped too; the note says why the next one is shown.
  const cancelled = trains.slice(0, Math.max(i, 0)).filter(t => t.cancelled && s < t.exp - walk * 60);
  if (note) state.note = note;
  else if (!trains.length) state.note = 'No trains in the next hour';
  else if (cancelled.length) state.note = `${cancelled.map(t => hm(t.dep)).join(', ')} cancelled`;
  if (i >= 0) state.walk = walk;
  return state;
}

// What changed between two content-states, to choose the push priority: 10 (now, counts against Apple's budget)
// for things that change what you'd do, 5 (when the phone is awake anyway) for the rest. null if nothing changed.
export function change(prev, next) {
  const strip = s => s && JSON.stringify({ ...s, updated: 0 });
  if (prev && strip(prev) === strip(next)) return null;
  if (!prev) return 'high';
  const a = prev.trains[0], b = next.trains[0];
  if (!a || !b || a.n !== b.n || a.delay !== b.delay || a.plat !== b.plat || a.cancelled !== b.cancelled) return 'high';
  if (Math.abs(a.exp - b.exp) >= 60 || prev.walk !== next.walk || prev.note !== next.note) return 'high';
  return 'low';
}

export const hm = s => new Date(s * 1000).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });

// The banner text Apple requires when the server starts a Live Activity.
export function startAlert(state) {
  const t = state.trains[0];
  const title = `Trains to ${state.to}`;
  if (!t) return { title, body: state.note || 'No trains right now' };
  const then = state.trains.slice(1).map(x => hm(x.exp)).join(', ');
  const body = t.cancelled ? `${hm(t.dep)} cancelled` :
    `${hm(t.dep)}${t.delay ? ` +${t.delay}` : ''}${t.plat ? ` · platform ${t.plat}` : ''}${then ? ` · then ${then}` : ''}`;
  return { title, body };
}

export function validSettings(s) {
  const st = x => x && /^S\d{5}$/.test(x.code) && typeof x.name === 'string' && x.name.length < 80 &&
    (x.walk === undefined || (Number.isInteger(x.walk) && x.walk >= 0 && x.walk <= 60));
  const time = x => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
  if (!s || !st(s.home) || !st(s.work) || !Array.isArray(s.windows) || s.windows.length > 6) return false;
  for (const w of s.windows) {
    if (!['home', 'work'].includes(w.from) || !time(w.start) || !time(w.end) || toMinutes(w.end) <= toMinutes(w.start)) return false;
    if (toMinutes(w.end) - toMinutes(w.start) > 8 * 60) return false; // iOS ends a Live Activity after 8 hours
    if (!Array.isArray(w.days) || w.days.some(d => !Number.isInteger(d) || d < 1 || d > 7) || typeof w.on !== 'boolean') return false;
    if (typeof w.id !== 'string' || !/^[a-z0-9-]{1,20}$/.test(w.id)) return false;
  }
  if (s.skip && (!Array.isArray(s.skip) || s.skip.some(d => !/^\d{4}-\d\d-\d\d$/.test(d)))) return false;
  return true;
}
