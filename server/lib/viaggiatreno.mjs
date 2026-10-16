// Viaggiatreno (RFI's live train data, the same feed as the Trenitalia app's boards). Plain http, JSON, no key.
// Akamai in front of it answers 403 to curl's and some other clients' User-Agent, so every call sends a browser one.
const BASE = 'http://www.viaggiatreno.it/infomobilitamobile/resteasy/viaggiatreno';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function get(path, json = true) {
  const res = await fetch(BASE + path, {
    headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/plain' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`viaggiatreno ${res.status} on ${path.split('/')[1]}`);
  return json ? res.json() : res.text();
}

// The API wants the time as JavaScript's Date.toString() ("Fri Oct 16 2026 07:44:03 GMT+0000 (…)"); the offset
// in it makes the VM's UTC clock fine.
const when = ts => encodeURIComponent(new Date(ts).toString());
export const departures = (code, ts) => get(`/partenze/${code}/${when(ts)}`);
export const arrivals = (code, ts) => get(`/arrivi/${code}/${when(ts)}`);
// One train's run: every stop with scheduled, actual and cancelled times. date = dataPartenzaTreno (ms, midnight).
export const progress = (origin, number, date) => get(`/andamentoTreno/${origin}/${number}/${date}`);

// Station search matches the start of the name only ("TUSCOL" finds nothing, "ROMA TUS" finds Roma Tuscolana),
// so a short answer is topped up with the Rome stations starting that way.
export async function stations(query) {
  const look = async q => (await get(`/autocompletaStazione/${encodeURIComponent(q.toUpperCase())}`, false))
    .split('\n').filter(l => l.includes('|')).map(l => {
      const [name, code] = l.trim().split('|');
      return { name: titleCase(name), code };
    });
  const found = await look(query.trim());
  if (found.length < 3 && !/^roma\b/i.test(query.trim())) found.push(...await look(`ROMA ${query.trim()}`));
  return found.filter((s, i) => found.findIndex(x => x.code === s.code) === i).slice(0, 20);
}

export const titleCase = s => (s || '').toLowerCase().replace(/(^|[\s\-'(./])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// Trains seen to have left a station, so each is asked about once. Small, and trimmed now and then.
const gone = new Set();
function remember(key) {
  if (gone.size > 500) gone.clear();
  gone.add(key);
}

// The trains from one station that also stop at the other one later, soonest first, with live delay, platform and
// arrival. A train counts when it's on `from`'s departure board and on `to`'s arrival board with a later time, so
// the opposite direction (which passes `to` first) and branches that never reach `to` drop out by themselves.
// Trains about to leave, or just past their time, are checked against their own run (andamentoTreno): the board
// keeps a train for about 10 minutes after it has gone, and its run says when it actually left.
export async function journeys(from, to, now = Date.now(), api = { departures, arrivals, progress }) {
  const [deps, arrs] = await Promise.all([api.departures(from, now), api.arrivals(to, now)]);
  const arrBy = new Map(arrs.map(a => [`${a.numeroTreno}/${a.dataPartenzaTreno}`, a]));
  const out = [];
  for (const d of deps) {
    const a = arrBy.get(`${d.numeroTreno}/${d.dataPartenzaTreno}`);
    if (!a || !(a.orarioArrivo > d.orarioPartenza)) continue;
    const delay = Math.max(0, d.ritardo ?? 0, a.ritardo ?? 0);
    const t = {
      n: String(d.numeroTreno),
      cat: d.categoriaDescrizione?.trim() || d.categoria || '',
      dest: titleCase(d.destinazione),
      origin: d.codOrigine,
      date: d.dataPartenzaTreno,
      dep: d.orarioPartenza / 1000,
      delay,
      plat: (d.binarioEffettivoPartenzaDescrizione || d.binarioProgrammatoPartenzaDescrizione || '').trim() || undefined,
      arrSched: a.orarioArrivo / 1000,
      cancelled: d.provvedimento === 1 || /soppress|cancellat/i.test(d.compRitardo?.[0] || ''),
      notStarted: !!d.nonPartito,
    };
    t.exp = t.dep + delay * 60;
    t.arr = t.arrSched + delay * 60;
    out.push(t);
  }
  out.sort((x, y) => x.exp - y.exp);

  const nowS = now / 1000;
  const kept = [];
  for (const t of out) {
    if (t.exp < nowS - 20 * 60) continue; // long gone
    const key = `${from}/${t.n}/${t.date}`;
    if (gone.has(key)) continue;
    if (t.exp < nowS + 5 * 60 && !t.cancelled) {
      try {
        const run = await api.progress(t.origin, t.n, t.date);
        const stopA = run.fermate?.find(f => f.id === from);
        const stopB = run.fermate?.find(f => f.id === to);
        if (stopA?.partenzaReale) { remember(key); continue; } // it has left
        if (stopA?.actualFermataType === 3 || stopB?.actualFermataType === 3 || run.provvedimento === 1) t.cancelled = true;
        const delay = Math.max(t.delay, run.ritardo ?? 0);
        if (delay !== t.delay) { t.delay = delay; t.exp = t.dep + delay * 60; t.arr = t.arrSched + delay * 60; }
        if (stopA?.binarioEffettivoPartenzaDescrizione?.trim()) t.plat = stopA.binarioEffettivoPartenzaDescrizione.trim();
      } catch {
        if (t.exp < nowS - 2 * 60) continue; // can't ask: assume it left a couple of minutes after its time
      }
    }
    kept.push(t);
    if (kept.length >= 8) break;
  }
  return kept;
}
