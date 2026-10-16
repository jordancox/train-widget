// node --test test.mjs   (no network: the fixtures are Viaggiatreno's real answers, saved on 16 Oct 2026 at 09:10
// Rome time and trimmed to the fields the server reads)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { journeys } from './lib/viaggiatreno.mjs';
import { rome, dueWindow, nextStart, liveContent, change, startAlert, validSettings, autoFrom } from './lib/schedule.mjs';

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
    assert.equal(t.exp, t.dep + t.delay * 60);
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
