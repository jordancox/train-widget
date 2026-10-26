// node --test test.mjs   (no network: the fixtures are Viaggiatreno's real answers, saved on 16 Oct 2026 at 09:10
// Rome time and trimmed to the fields the server reads)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { journeys, estimate } from './lib/viaggiatreno.mjs';
import { rome, dueWindow, nextStart, liveContent, change, startAlert, validSettings, autoFrom, hm } from './lib/schedule.mjs';
import { Phones, LEGACY, MAX_PHONES, migrate } from './lib/phones.mjs';

const fx = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const NOW = +fs.readFileSync(new URL('./fixtures/now.txt', import.meta.url), 'utf8');
const api = {
  departures: code => fx(`dep-${code}.json`),
  arrivals: code => fx(`arr-${code}.json`),
  progress: (origin, n) => { try { return fx(`run-${n}.json`); } catch { throw new Error('no run saved'); } },
};
const TUSCOLANA = 'S08408', MURATELLA = 'S08400';
const settings = JSON.parse(fs.readFileSync(new URL('./defaults.json', import.meta.url)));

test('to work: only trains that reach Muratella after Tuscolana, soonest first', async () => {
  const list = await journeys(TUSCOLANA, MURATELLA, NOW, api);
  assert.ok(list.length >= 3);
  for (const t of list) {
    assert.equal(t.dest, 'Fiumicino Aeroporto'); // the Fara Sabina/Poggio Mirteto ones pass Muratella first
    assert.ok(t.arr > t.exp);
    assert.ok(t.exp >= t.dep && t.delay === Math.floor((t.exp - t.dep) / 60));
  }
  assert.deepEqual(list.map(t => t.exp), [...list.map(t => t.exp)].sort((a, b) => a - b));
});

test('home: the other way round, including trains the old widget missed (Poggio Mirteto, Fara Sabina)', async () => {
  const list = await journeys(MURATELLA, TUSCOLANA, NOW, api);
  assert.ok(list.length >= 3);
  for (const t of list) assert.notEqual(t.dest, 'Fiumicino Aeroporto');
});

test('a train that has left is dropped even though the board still lists it', async () => {
  const run = fx('run-20423.json');
  const left = run.fermate.find(f => f.id === TUSCOLANA).partenzaReale;
  const list = await journeys(TUSCOLANA, MURATELLA, NOW, api);
  assert.equal(list.some(t => t.n === '20423'), !left);
  // and one that hasn't left yet, past its time, stays when its run says so
  const late = { ...run, fermate: run.fermate.map(f => (f.id === TUSCOLANA ? { ...f, partenzaReale: null } : f)) };
  const list2 = await journeys(TUSCOLANA, MURATELLA, NOW, { ...api, progress: (o, n) => (n === '20423' ? late : api.progress(o, n)) });
  assert.ok(list2.some(t => t.n === '20423'));
});

test('a stop cancelled at either end marks the train cancelled', async () => {
  const run = fx('run-20423.json');
  const cut = { ...run, fermate: run.fermate.map(f => (f.id === MURATELLA ? { ...f, actualFermataType: 3 } : { ...f, partenzaReale: null })) };
  const list = await journeys(TUSCOLANA, MURATELLA, NOW, { ...api, progress: (o, n) => (n === '20423' ? cut : api.progress(o, n)) });
  assert.equal(list.find(t => t.n === '20423').cancelled, true);
});

test('rome() is Rome time, whatever the VM clock says', () => {
  const r = rome(Date.UTC(2026, 9, 16, 7, 10)); // 09:10 in Rome (summer time)
  assert.deepEqual(r, { date: '2026-10-16', minutes: 9 * 60 + 10, dow: 5 });
  assert.equal(rome(Date.UTC(2026, 11, 1, 7, 10)).minutes, 8 * 60 + 10); // winter time
});

test('windows: on in the morning on weekdays, off at weekends and skipped days', () => {
  const fri0745 = Date.UTC(2026, 9, 16, 5, 45);
  const w = dueWindow(settings, fri0745);
  assert.equal(w.id, 'morning');
  assert.equal(w.endsAt, Date.UTC(2026, 9, 16, 7, 0)); // 09:00 Rome
  assert.equal(dueWindow(settings, Date.UTC(2026, 9, 17, 5, 45)), null); // Saturday
  assert.equal(dueWindow({ ...settings, skip: ['2026-10-16'] }, fri0745), null);
  assert.equal(dueWindow(settings, Date.UTC(2026, 9, 16, 7, 0)), null); // 09:00 exactly: over
  assert.equal(dueWindow(settings, Date.UTC(2026, 9, 16, 15, 0)).id, 'evening'); // 17:00
});

test('next start skips the weekend and skipped days', () => {
  assert.deepEqual(nextStart(settings, Date.UTC(2026, 9, 16, 17, 0)), { id: 'morning', date: '2026-10-19', dow: 1, start: '07:30' });
  assert.equal(nextStart({ ...settings, skip: ['2026-10-19'] }, Date.UTC(2026, 9, 16, 17, 0)).date, '2026-10-20');
  assert.equal(nextStart(settings, Date.UTC(2026, 9, 16, 5, 0)).id, 'morning'); // 07:00 Friday: this morning
  assert.equal(nextStart(settings, Date.UTC(2026, 9, 16, 9, 0)).id, 'evening');
});

test('autoFrom: home in the morning, work in the afternoon', () => {
  assert.equal(autoFrom(Date.UTC(2026, 9, 16, 6, 0)), 'home');
  assert.equal(autoFrom(Date.UTC(2026, 9, 16, 13, 0)), 'work'); // 15:00
  assert.equal(autoFrom(Date.UTC(2026, 9, 16, 21, 0)), 'home'); // 23:00
});

test('content-state: short names, at most three trains, Unix seconds, no empty fields', async () => {
  const list = await journeys(TUSCOLANA, MURATELLA, NOW, api);
  const c = liveContent({ from: settings.home, to: settings.work, trains: list, now: NOW });
  assert.equal(c.from, 'Tuscolana');
  assert.equal(c.to, 'Muratella');
  assert.ok(c.trains.length <= 3);
  assert.equal(c.updated, Math.floor(NOW / 1000));
  for (const t of c.trains) {
    assert.deepEqual(Object.keys(t).filter(k => !['n', 'dep', 'exp', 'delay', 'dest', 'cancelled', 'plat', 'arr'].includes(k)), []);
    assert.equal(typeof t.n, 'string');
    assert.ok(t.dep > 1.7e9 && t.dep < 2e9);
  }
  assert.ok(JSON.stringify(c).length < 1500); // well under APNs' 4–5 KB
  const empty = liveContent({ from: settings.home, to: settings.work, trains: [], now: NOW });
  assert.equal(empty.note, 'No trains in the next hour');
});

test('change: high for what changes your plans, low for the rest, null for nothing', () => {
  const t = { n: '1', dep: 1, exp: 1, delay: 0, dest: 'X', cancelled: false, plat: '5' };
  const a = { from: 'A', to: 'B', trains: [t, { ...t, n: '2' }], updated: 1 };
  assert.equal(change(a, { ...a, updated: 99 }), null);
  assert.equal(change(null, a), 'high');
  assert.equal(change(a, { ...a, trains: [{ ...t, delay: 3 }, a.trains[1]] }), 'high');
  assert.equal(change(a, { ...a, trains: [{ ...t, plat: '4' }, a.trains[1]] }), 'high');
  assert.equal(change(a, { ...a, trains: [a.trains[1]] }), 'high');
  assert.equal(change(a, { ...a, trains: [t, { ...t, n: '2', delay: 4 }] }), 'low');
});

test('start alert reads well', () => {
  const t = { n: '1', dep: NOW / 1000, exp: NOW / 1000 + 120, delay: 2, dest: 'X', cancelled: false, plat: '5' };
  const a = startAlert({ from: 'Tuscolana', to: 'Muratella', trains: [t, { ...t, exp: NOW / 1000 + 900 }], updated: 1 });
  assert.equal(a.title, 'Trains to Muratella');
  assert.match(a.body, /^09:10 \+2 · platform 5 · then 09:25$/);
});

test('settings are checked before they are saved', () => {
  assert.ok(validSettings(settings));
  assert.ok(!validSettings({ ...settings, home: { code: 'x', name: 'y' } }));
  assert.ok(!validSettings({ ...settings, windows: [{ ...settings.windows[0], end: '07:00' }] }));
  assert.ok(!validSettings({ ...settings, windows: [{ ...settings.windows[0], start: '06:00', end: '15:00' }] })); // > 8 h
  assert.ok(!validSettings({ ...settings, skip: ['tomorrow'] }));
});

test('estimate: from the last stop the train was logged at, to the half minute (train 20693, 16 Oct 2026)', () => {
  const at = hm => Date.parse(`2026-10-16T${hm}+02:00`);
  const run = { fermate: [
    { id: 'S08403', partenza_teorica: at('17:08:00'), arrivoReale: at('17:10:00'), partenzaReale: at('17:11:30') },
    { id: MURATELLA, partenza_teorica: at('17:13:00') },
  ] };
  assert.equal(estimate(run, MURATELLA), at('17:16:30') / 1000); // it left at 17:16:00; the board's +4 said 17:17
  run.fermate[1].arrivoReale = at('17:15:30');
  assert.equal(estimate(run, MURATELLA), at('17:16:00') / 1000); // at the platform: half a minute after pulling in
  assert.equal(estimate({ fermate: [{ id: MURATELLA, partenza_teorica: at('17:13:00') }] }, MURATELLA), null);
  const early = { fermate: [{ id: 'S08403', partenza_teorica: at('17:08:00'), partenzaReale: at('17:07:00') }, { id: MURATELLA, partenza_teorica: at('17:13:00') }] };
  assert.equal(estimate(early, MURATELLA), at('17:13:00') / 1000); // never before its time
});

test('walk time: "Start walking in" for the next train you can still walk to; the ones out of reach are left out', () => {
  const a = { n: '1', dep: 1000, exp: 1000 + 10 * 60, delay: 0, dest: 'X', cancelled: false };
  const b = { ...a, n: '2', dep: a.dep + 15 * 60, exp: a.exp + 15 * 60 };
  const c = (s, trains = [a, b]) => liveContent({ from: { name: 'Muratella', walk: 8 }, to: { name: 'Roma Tuscolana' }, trains, now: s * 1000 });
  assert.equal(c(1000).walk, 8); // 10 minutes to go, 8 to walk
  assert.equal(c(1000).trains[0].n, '1');
  assert.deepEqual(c(1000 + 3 * 60).trains.map(t => t.n), ['2']); // 7 to go: you'd miss it, so set off for the next
  assert.equal(c(1000 + 3 * 60).walk, 8);
  const off = c(1000, [{ ...a, cancelled: true }, b]); // the one you'd have gone for is cancelled
  assert.equal(off.trains[0].n, '2');
  assert.equal(off.note, `${hm(a.dep)} cancelled`);
  assert.equal(c(1000 + 3 * 60, [{ ...a, cancelled: true }, b]).note, undefined); // out of reach anyway
  assert.equal(c(1000 + 3 * 60, [a]).walk, undefined); // nothing left to walk to: count to the train
  assert.equal(c(1000 + 3 * 60, [a]).trains[0].n, '1');
  assert.equal(liveContent({ from: { name: 'Muratella' }, to: { name: 'Roma Tuscolana' }, trains: [a, b], now: 1000e3 + 3 * 60e3 }).trains[0].n, '1');
  assert.equal(change(c(1000), c(1000 + 3 * 60)), 'high');
  assert.equal(change(c(1000), c(1000, [{ ...a, exp: a.exp + 90 }, b])), 'high'); // time to leave moved a minute
  assert.equal(change(c(1000), c(1000, [{ ...a, exp: a.exp + 30 }, b])), 'low');
  const s = structuredClone(settings);
  assert.ok(validSettings(s));
  s.work.walk = 61;
  assert.ok(!validSettings(s));
});

// ---- Several phones (17 Oct 2026): a fake clock, fake trains and a fake APNs that records what it was asked ----

function world() {
  const clock = { t: Date.UTC(2026, 9, 19, 5, 30, 10) }; // Monday 07:30:10 in Rome
  const sent = [];
  let n = 0;
  const apns = {
    dry: false,
    createChannel: async () => `ch${++n}`,
    start: async (token, aps) => { sent.push({ kind: 'start', token, aps }); return { status: 200 }; },
    // `refuse`: answer every broadcast with this status instead (429: too many).
    broadcast: async (channel, aps, prio) => {
      sent.push({ kind: aps.event, channel, aps, prio });
      return apns.refuse ? { status: apns.refuse, body: { reason: 'TooManyRequests' } } : { status: 200 };
    },
  };
  const journeys = async (a, b) => [{ n: `${a}-${b}`, dep: clock.t / 1000 + 20 * 60, exp: clock.t / 1000 + 20 * 60, delay: 0, dest: 'X', cancelled: false, plat: '5' }];
  const old = { tokens: { aaaa1111aaaa1111aaaa1111aaaa1111: { device: 'iPhone', frequent: true, at: 1 } }, channels: { home: 'jordan-home', work: 'jordan-work' }, started: {}, live: null };
  const data = migrate(old, structuredClone(settings), clock.t);
  const phones = new Phones({ data, defaults: settings, apns, journeys, log: () => {}, now: () => clock.t });
  const later = async minutes => { clock.t += minutes * 60e3; await phones.tick(); };
  return { clock, sent, data, phones, later, apns };
}
const BOB = 'b0b0b0b0-0000-4000-8000-000000000000', TOKEN_B = 'bbbb2222bbbb2222bbbb2222bbbb2222';

test('phones: the one phone from before becomes the legacy record, settings and all', () => {
  const { data } = world();
  const j = data.phones[LEGACY];
  assert.equal(data.version, 2);
  assert.deepEqual(j.settings, settings);
  assert.equal(j.setup, false);
  assert.deepEqual(j.channels, { home: 'jordan-home', work: 'jordan-work' });
  assert.deepEqual(migrate({}, null).phones, {}); // a fresh server: nobody yet
});

test('phones: a new phone starts with nothing automatic, and only its own settings change', async () => {
  const { phones, data } = world();
  const bob = phones.ensure(BOB);
  assert.equal(bob.setup, true);
  assert.ok(bob.settings.windows.every(w => !w.on));
  const mine = structuredClone(bob.settings);
  mine.home = { code: 'S08406', name: 'Roma Ostiense', walk: 5 };
  mine.windows[0] = { ...mine.windows[0], start: '08:00', on: true };
  assert.ok(phones.saveSettings(bob, mine));
  assert.equal(bob.setup, false);
  assert.deepEqual(data.phones[LEGACY].settings, settings); // Jordan's untouched
  assert.ok(!phones.saveSettings(bob, { ...mine, home: { code: 'nope' } }));
});

test('phones: each starts at its own time, on its own token and channel', async () => {
  const { phones, sent, later, data } = world();
  const bob = phones.ensure(BOB);
  phones.register(BOB, { token: TOKEN_B, device: 'iPhone', frequent: true });
  const s = structuredClone(bob.settings);
  s.home = { code: 'S08406', name: 'Roma Ostiense', walk: 5 };
  s.windows[0] = { ...s.windows[0], start: '08:00', on: true };
  phones.saveSettings(bob, s);

  await phones.tick(); // 07:30:10: Jordan's morning
  const starts = sent.filter(x => x.kind === 'start');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].token, 'aaaa1111aaaa1111aaaa1111aaaa1111');
  assert.equal(starts[0].aps['input-push-channel'], 'jordan-home');
  assert.equal(starts[0].aps['content-state'].walk, 13);
  assert.equal(data.phones[BOB].live, null);

  const opened = bob.app;
  await later(30); // 08:00:10: Bob's
  assert.equal(data.phones[BOB].app, opened); // a start Apple took isn't the app calling in (a deleted copy, 20 Oct 2026)
  assert.ok(data.phones[BOB].seen > opened);
  const bobStart = sent.filter(x => x.kind === 'start')[1];
  assert.equal(bobStart.token, TOKEN_B);
  assert.equal(bobStart.aps['content-state'].from, 'Ostiense');
  assert.equal(bobStart.aps['content-state'].walk, 5);
  assert.notEqual(bobStart.aps['input-push-channel'], 'jordan-home');
  assert.equal(data.phones[BOB].live.kind, 'morning');
  assert.equal(data.phones[LEGACY].live.kind, 'morning');
});

test("phones: one phone's day off or stop ends only its own Live Activity", async () => {
  const { phones, sent, data } = world();
  const bob = phones.ensure(BOB);
  phones.register(BOB, { token: TOKEN_B, device: 'iPhone', frequent: true });
  const s = structuredClone(bob.settings);
  s.windows[0].on = true;
  phones.saveSettings(bob, s);
  await phones.tick();
  assert.ok(data.phones[LEGACY].live && data.phones[BOB].live);
  const bobChannel = bob.channels.home;

  await phones.skipToday(bob);
  const ends = sent.filter(x => x.kind === 'end');
  assert.deepEqual(ends.map(x => x.channel), [bobChannel]);
  assert.ok(data.phones[LEGACY].live);
  assert.deepEqual(data.phones[LEGACY].settings.skip, []);

  await phones.startLive(bob, 'work');
  await phones.stopLive(bob);
  assert.ok(sent.filter(x => x.kind === 'end').every(x => x.channel !== 'jordan-home'));
  assert.ok(data.phones[LEGACY].live);
});

test('phones: a newer build on the legacy phone takes it over by its push-to-start token', async () => {
  const { phones, data } = world();
  const NEW = '11111111-2222-4333-8444-555555555555';
  await phones.tick(); // Jordan's morning is live
  phones.ensure(NEW); // the new build looks at /api/state before iOS hands it the token
  phones.register(NEW, { token: 'aaaa1111aaaa1111aaaa1111aaaa1111', device: 'iPhone', frequent: true });
  assert.equal(data.phones[LEGACY], undefined);
  const j = data.phones[NEW];
  assert.deepEqual(j.settings, settings);
  assert.deepEqual(j.channels, { home: 'jordan-home', work: 'jordan-work' });
  assert.equal(j.live.kind, 'morning');
  assert.equal(j.id, NEW);
  // A token belongs to one phone: registering it elsewhere moves it.
  phones.register(BOB, { token: 'aaaa1111aaaa1111aaaa1111aaaa1111', device: 'iPhone', frequent: true });
  assert.deepEqual(Object.keys(data.phones[NEW].tokens), []);
});

test('phones: at most MAX_PHONES, and quiet ones are forgotten', async () => {
  const { phones, data, clock } = world();
  for (let i = 1; i < MAX_PHONES; i++) phones.ensure(`phone-${String(i).padStart(4, '0')}`);
  assert.throws(() => phones.ensure('one-too-many'), { status: 403 });
  clock.t += 31 * 86400e3; // a month on: the ones with no token go; Jordan's has one
  await phones.tick();
  assert.deepEqual(Object.keys(data.phones), [LEGACY]);
});

test('show: every word on the lock screen, and what the countdowns count to, from the server', () => {
  const a = { n: '1', dep: 1000, exp: 1000 + 10 * 60, delay: 0, dest: 'X', cancelled: false, plat: '5' };
  const b = { ...a, n: '2', dep: a.dep + 15 * 60, exp: a.exp + 15 * 60 + 120, delay: 2 };
  const c = (s, trains = [a, b], walk = 8) => liveContent({ from: { name: 'Muratella', walk }, to: { name: 'Roma Tuscolana' }, trains, now: s * 1000 }).show;
  assert.deepEqual(c(1000), { title: 'To Tuscolana', corner: 'Platform 5', time: hm(a.dep), status: 'on time', tone: 'green',
    label: 'Start walking in', until: a.exp - 8 * 60, after: 'to start walking', icon: 'figure.walk' });
  const later = c(1000 + 3 * 60); // too late to set off for the first: on the way to it, or walking for the next
  assert.equal(later.label, 'Start walking in');
  assert.equal(later.until, b.exp - 8 * 60);
  assert.equal(later.status, '2 min late');
  assert.equal(later.tone, 'orange');
  assert.equal(later.line, `Walking to the ${hm(a.dep)}? Leaves in`);
  assert.equal(later.lineUntil, a.exp);
  assert.equal(c(1000 + 11 * 60).line, undefined); // it has left
  assert.equal(c(1000, [a, b], 0).label, 'Train leaves in');
  assert.equal(c(1000, [a, b], 0).until, a.exp);
  assert.equal(c(1000, [{ ...a, cancelled: true }], 0).big, 'Cancelled');
  assert.equal(c(1000, [{ ...a, cancelled: true }], 0).until, undefined);
  assert.deepEqual(c(1000, []), { title: 'To Tuscolana' });
  const content = s => liveContent({ from: { name: 'Muratella', walk: 8 }, to: { name: 'Roma Tuscolana' }, trains: [a, b], now: s * 1000 });
  assert.equal(change(content(1000 + 10 * 60 - 1), content(1000 + 10 * 60 + 1)), 'high'); // the walking-to line goes at once
});

test('walking: "Yes" on the Live Activity counts to that train from then on; "Undo" goes back', () => {
  const a = { n: '1', dep: 1000, exp: 1000 + 10 * 60, delay: 0, dest: 'X', cancelled: false, plat: '5' };
  const b = { ...a, n: '2', dep: a.dep + 15 * 60, exp: a.exp + 15 * 60 };
  const c = { ...a, n: '3', dep: a.dep + 30 * 60, exp: a.exp + 30 * 60 };
  const late = { ...a, n: '0', dep: a.dep - 10 * 60, exp: a.exp - 60, delay: 9 }; // an earlier one running late
  const content = (s, walking, trains = [late, a, b, c]) =>
    liveContent({ from: { name: 'Roma Tuscolana', walk: 13 }, to: { name: 'Muratella' }, trains, now: s * 1000, walking });
  // 6 minutes before the first leaves: too late to set off for it, so on the way to it, or at home for the next.
  const asks = content(a.exp - 6 * 60, undefined, [a, b, c]);
  assert.equal(asks.show.label, 'Start walking in');
  assert.equal(asks.show.until, b.exp - 13 * 60);
  assert.match(asks.show.line, /^Walking to the \d\d:\d\d\? Leaves in$/);
  assert.deepEqual([asks.show.button, asks.show.buttonTrain], ['Yes', '1']);
  assert.equal(asks.show.buttonWatch, `I'm walking to the ${hm(a.dep)}`);
  // Yes: the countdown is to that train, not to setting off; nothing earlier, even running late, and no button but Undo.
  const going = content(a.exp - 6 * 60, { n: '1', dep: a.dep });
  assert.deepEqual(going.trains.map(t => t.n), ['1', '2', '3']);
  assert.equal(going.walk, undefined);
  assert.deepEqual([going.show.label, going.show.until, going.show.time], ['Train leaves in', a.exp, hm(a.dep)]);
  assert.equal(going.show.line, undefined);
  assert.deepEqual([going.show.button, going.show.buttonTrain, going.show.buttonWatch], ['Undo', '', undefined]);
  assert.equal(change(asks, going), 'high');
  // Once it has gone (caught, or missed and at the station): the next train itself, still not the walk.
  const after = content(a.exp + 60, { n: '1', dep: a.dep }, [b, c]);
  assert.deepEqual([after.trains[0].n, after.show.label, after.show.until], ['2', 'Train leaves in', b.exp]);
  // A cancelled one you'd set off for still says so.
  assert.equal(content(a.exp - 6 * 60, { n: '1', dep: a.dep }, [{ ...a, cancelled: true }, b]).show.big, 'Cancelled');
});

test('phones: the walking button on the lock screen, through the server', async () => {
  const { phones, sent, data, clock } = world();
  const s = clock.t / 1000;
  phones.journeys = async () => [
    { n: '20423', dep: s + 6 * 60, exp: s + 6 * 60, delay: 0, dest: 'X', cancelled: false, plat: '5' },
    { n: '20443', dep: s + 21 * 60, exp: s + 21 * 60, delay: 0, dest: 'X', cancelled: false, plat: '5' },
  ];
  await phones.tick(); // Jordan's morning: walking for the 20443, or on the way to the 20423?
  const j = data.phones[LEGACY];
  assert.equal(sent.at(-1).aps['content-state'].show.buttonTrain, '20423');
  const c = await phones.walkingTo(j, '20423');
  assert.equal(c.show.until, s + 6 * 60);
  assert.equal(j.live.walking.n, '20423');
  assert.deepEqual([sent.at(-1).kind, sent.at(-1).prio, sent.at(-1).aps['content-state'].show.until], ['update', 10, s + 6 * 60]);
  assert.equal((await phones.walkingTo(j, 'gone')).show.until, s + 6 * 60); // a train that has left changes nothing
  const back = await phones.walkingTo(j, '');
  assert.equal(j.live.walking, undefined);
  assert.equal(back.show.until, s + 21 * 60 - 13 * 60);
  await phones.walkingTo(j, '20423');
  await phones.stopLive(j);
  await phones.startLive(j, 'home');
  assert.equal(j.live.walking, undefined); // a new Live Activity starts afresh
});

test('phones: refused for too many updates, it waits longer each time instead of asking every 15 seconds', async () => {
  const { phones, sent, data, clock, apns } = world();
  await phones.tick();
  const j = data.phones[LEGACY];
  let n = 0;
  phones.journeys = async () => [{ n: 'x', dep: clock.t / 1000 + 30 * 60, exp: clock.t / 1000 + 30 * 60 + 120 * ++n, delay: 0, dest: 'X', cancelled: false }];
  apns.refuse = 429;
  const tries = () => sent.filter(x => x.kind === 'update').length;
  const before = tries();
  for (let i = 0; i < 4 * 20; i++) { clock.t += 15e3; phones.cache.clear(); await phones.tick(); } // 20 minutes
  assert.ok(tries() - before <= 6, `${tries() - before} tries in 20 minutes`); // at 0, 1, 3, 7, 15 minutes
  assert.ok(sent.filter(x => x.kind === 'update').slice(-3).every(x => x.prio === 5));
  apns.refuse = 0;
  clock.t += 8 * 60e3;
  phones.cache.clear();
  await phones.tick();
  assert.equal(j.live.throttled, undefined);
  assert.equal(sent.at(-1).prio, 5); // through, but calm for a quarter of an hour
  clock.t += 16 * 60e3;
  phones.cache.clear();
  await phones.tick();
  assert.equal(sent.at(-1).prio, 10);
});

test('phones: the snapshot is the asking phone\'s own', async () => {
  const { phones } = world();
  const bob = phones.ensure(BOB);
  const snap = await phones.snapshot(bob, 'home');
  assert.equal(snap.setup, true);
  assert.match(snap.welcome, /^Hello friends\./);
  assert.equal((await phones.snapshot(phones.get(LEGACY), 'home')).welcome, undefined);
  assert.equal(snap.registered, 0);
  assert.notEqual(snap.channel, 'jordan-home');
  assert.equal((await phones.snapshot(phones.get(LEGACY), 'home')).channel, 'jordan-home');
});
