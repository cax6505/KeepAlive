import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rawDir = resolve(process.argv[2] || `${root}/src/data/raw/f1-9126`);
const outputPath = `${root}/src/data/f1-demo.json`;
const load = async name => JSON.parse(await readFile(`${rawDir}/${name}.json`, 'utf8'));
const [raceControl, pits, laps, positions] = await Promise.all(['race_control', 'pit', 'laps', 'position'].map(load));
const sessionStart = Math.min(...laps.filter(lap => lap.lap_number === 1 && lap.date_start).map(lap => Date.parse(lap.date_start)));
const finishMark = raceControl.find(row => /CHEQUERED FLAG/i.test(row.message || ''));
const sessionEnd = finishMark ? Date.parse(finishMark.date) : Math.max(...laps.map(lap => Date.parse(lap.date_start)));
const driverNames = new Map(Object.entries({
  1: 'Verstappen', 2: 'Sargeant', 4: 'Norris', 10: 'Gasly', 11: 'Perez', 14: 'Alonso', 16: 'Leclerc',
  18: 'Stroll', 20: 'Magnussen', 21: 'De Vries', 22: 'Tsunoda', 23: 'Albon', 24: 'Zhou', 27: 'Hulkenberg',
  31: 'Ocon', 44: 'Hamilton', 55: 'Sainz', 63: 'Russell', 77: 'Bottas', 81: 'Piastri',
}).map(([number, name]) => [Number(number), name]));
const nameFor = number => driverNames.get(Number(number)) || `Car ${number}`;
const candidate = [];

function add({ id, date, lap, type, importance, players = [], display, text }) {
  const absolute = Date.parse(date);
  if (!Number.isFinite(absolute)) return;
  const demoTime = Math.max(0, Math.min(360, (absolute - sessionStart) / Math.max(1, sessionEnd - sessionStart) * 360));
  const item = {
    id: `f1-${id}`,
    t: Number(demoTime.toFixed(2)),
    sport: 'f1',
    type,
    importance,
    score: { runs: display.position || 0, wkts: 0, overs: `LAP ${lap || '—'}`, display: { label: display.label || 'F1', value: display.value, context: `LAP ${lap || '—'}` } },
    players: [...new Set(players.filter(Boolean))],
    text: { en: text, hi: `⟦हिंदी · प्रूफ़रीड⟧ ${text}` },
    bytes: 0,
  };
  for (let tries = 0; tries < 8; tries += 1) {
    const size = JSON.stringify(item).length;
    if (size === item.bytes) break;
    item.bytes = size;
  }
  candidate.push(item);
}

for (const row of raceControl) {
  const message = String(row.message || '');
  if (row.category === 'SafetyCar' || /SAFETY CAR|VIRTUAL SAFETY CAR/i.test(message)) {
    const label = /IN THIS LAP/i.test(message) ? 'SAFETY CAR IN' : /VIRTUAL/i.test(message) ? 'VIRTUAL SAFETY CAR' : 'SAFETY CAR';
    add({ id: `race-control-${row.date}-${message}`, date: row.date, lap: row.lap_number, type: 'safety_car', importance: 3, display: { label: 'SC', value: label }, text: `${label} · LAP ${row.lap_number || '—'}` });
  } else if (row.category === 'Flag' && row.flag && row.flag !== 'GREEN' && row.flag !== 'CHEQUERED') {
    const flag = String(row.flag).toUpperCase();
    add({ id: `flag-${row.date}-${flag}-${row.sector || ''}`, date: row.date, lap: row.lap_number, type: 'flag', importance: flag.includes('RED') ? 3 : 2, display: { label: 'FLAG', value: flag }, text: `${flag} FLAG${row.scope === 'Track' ? '' : ` · ${row.scope || 'TRACK'}`} · LAP ${row.lap_number || '—'}` });
  }
}

for (const pit of pits) {
  const name = nameFor(pit.driver_number);
  add({ id: `pit-${pit.driver_number}-${pit.lap_number}-${pit.date}`, date: pit.date, lap: pit.lap_number, type: 'pit_stop', importance: 2, players: [name], display: { label: 'PIT', value: `${name} IN` }, text: `PIT STOP · ${name} · LAP ${pit.lap_number}` });
}

const byDriver = new Map();
for (const row of positions) {
  const list = byDriver.get(Number(row.driver_number)) || [];
  list.push(row);
  byDriver.set(Number(row.driver_number), list);
}
for (const [number, list] of byDriver) {
  list.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  let previous;
  for (const row of list) {
    if (previous && row.position !== previous.position && (row.position <= 5 || previous.position <= 5)) {
      const from = Number(previous.position);
      const to = Number(row.position);
      const name = nameFor(number);
      const lap = laps.filter(item => Number(item.driver_number) === number && Date.parse(item.date_start) <= Date.parse(row.date)).reduce((latest, item) => Math.max(latest, item.lap_number), 0);
      add({ id: `position-${number}-${row.date}-${from}-${to}`, date: row.date, lap, type: 'position_change', importance: 2, players: [name], display: { label: name, value: `P${to}`, position: to }, text: `${name} P${from}->P${to} · LAP ${lap}` });
    }
    previous = row;
  }
}

const validLaps = laps.filter(lap => Number.isFinite(Number(lap.lap_duration)) && !lap.is_pit_out_lap);
const fastest = validLaps.reduce((best, lap) => !best || lap.lap_duration < best.lap_duration ? lap : best, null);
if (fastest) {
  const name = nameFor(fastest.driver_number);
  const date = new Date(Date.parse(fastest.date_start) + fastest.lap_duration * 1000).toISOString();
  add({ id: `fastest-lap-${fastest.driver_number}-${fastest.lap_number}`, date, lap: fastest.lap_number, type: 'fastest_lap', importance: 3, players: [name], display: { label: 'FASTEST', value: name }, text: `FASTEST LAP · ${name} · LAP ${fastest.lap_number}` });
}

const lapsByDriver = new Map();
for (const lap of laps) {
  const key = Number(lap.driver_number);
  const max = lapsByDriver.get(key);
  if (!max || lap.lap_number > max.lap_number) lapsByDriver.set(key, lap);
}
const raceLap = Math.max(...[...lapsByDriver.values()].map(lap => lap.lap_number));
for (const [number, finalLap] of lapsByDriver) {
  if (finalLap.lap_number < raceLap - 1) {
    const name = nameFor(number);
    add({ id: `retirement-${number}-${finalLap.lap_number}`, date: finalLap.date_start, lap: finalLap.lap_number, type: 'retirement', importance: 3, players: [name], display: { label: 'OUT', value: name }, text: `RETIRED · ${name} · LAP ${finalLap.lap_number}` });
  }
}

const eventEnd = Math.max(...candidate.map(event => event.t), 1);
for (const event of candidate) event.t = Number((event.t / eventEnd * 360).toFixed(2));
candidate.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
const events = candidate.map((event, index) => ({ ...event, id: `f1-${String(index + 1).padStart(3, '0')}-${event.id.slice(3)}` }));
for (const event of events) {
  for (let tries = 0; tries < 8; tries += 1) {
    const size = JSON.stringify(event).length;
    if (size === event.bytes) break;
    event.bytes = size;
  }
}
const demo = {
  source: { provider: 'OpenF1', sessionKey: 9126, attribution: 'OpenF1 historical session data' },
  match: { teams: ['Formula 1'], date: '2023-07-09', venue: 'Silverstone', event: 'British Grand Prix · Race', outcome: {} },
  events,
};
await writeFile(outputPath, `${JSON.stringify(demo, null, 2)}\n`);
console.log(`Normalized ${events.length} OpenF1 events to a 360s replay timeline. Wrote ${outputPath}`);
